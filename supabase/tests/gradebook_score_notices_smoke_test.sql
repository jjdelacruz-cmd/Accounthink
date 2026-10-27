-- Gradebook + score-change notices smoke test.
-- Paste into Supabase SQL Editor and Run (after 0012). Creates throwaway data and deletes everything it made.

create temp table if not exists smoke_results (n serial, test text, result text, detail text);
truncate smoke_results;
-- Keep any real reminder secret safe: the test swaps it for a test value and puts it back.
create temp table if not exists smoke_secret_backup (value text);
truncate smoke_secret_backup;
insert into smoke_secret_backup select value from public.app_settings where key = 'cron_secret';
-- The email job claims every settled change in the database. Set any real pending ones aside while this test
-- runs (they are put back at the end), so the test neither sees them nor marks them as sent.
create temp table if not exists smoke_sc_hold (id bigint);
truncate smoke_sc_hold;
insert into smoke_sc_hold select id from public.score_changes where emailed_at is null;
update public.score_changes set emailed_at = now() where id in (select id from smoke_sc_hold);

-- Test helpers (outside the test block so its error handler can still use them).
create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create or replace function pg_temp.act_as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $f$;
create or replace function pg_temp.act_as_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;
-- Records a result as the owner, then goes back to acting as whoever was acting before.
create or replace function pg_temp.ok(p_test text, p_pass boolean, p_detail text default null) returns void language plpgsql as $f$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('role', true);
begin
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail) values (p_test, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
  if coalesce(v_sub, '') <> '' then perform pg_temp.act_as(v_sub::uuid);
  elsif v_role = 'anon' then perform pg_temp.act_as_anon(); end if;
end $f$;
-- Expects the statement to fail with a message containing p_like.
create or replace function pg_temp.fails(p_test text, p_sql text, p_like text default '') returns void language plpgsql as $f$
declare
  v_msg text;
begin
  begin
    execute p_sql;
    perform pg_temp.ok(p_test, false, 'it worked');
    return;
  exception when others then
    v_msg := sqlerrm;
  end;
  perform pg_temp.ok(p_test, v_msg like '%' || p_like || '%', v_msg);
end $f$;

do $test$
declare
  v_abort_ctx text;
  v_inst  uuid := gen_random_uuid();
  v_inst2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_chk   uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();   -- section A, scored by hand
  v_s2 uuid := gen_random_uuid();   -- section A, starts but never submits exam 1
  v_s3 uuid := gen_random_uuid();   -- section B, score goes up then back
  v_s4 uuid := gen_random_uuid();   -- section A, emails off, re-graded
  v_course uuid; v_secA uuid; v_secB uuid; v_course2 uuid;
  v_ex1 uuid; v_ex2 uuid; v_ex3 uuid; v_mcq uuid; v_ident uuid; v_essay uuid; v_ident2 uuid;
  v_a1 uuid; v_a3 uuid; v_a4 uuid; v_a1b uuid; v_a2 uuid; v_tok uuid;
  v_r jsonb; v_x jsonb; v_n int; v_txt text; v_bool boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smokegb.inst@example.invalid',  '{"full_name":"GB Instructor"}'),
    (v_inst2, 'smokegb.inst2@example.invalid', '{"full_name":"GB Other Instructor"}'),
    (v_admin, 'smokegb.admin@example.invalid', '{"full_name":"GB Admin"}'),
    (v_chk,   'smokegb.chk@example.invalid',   '{"full_name":"GB Checker"}'),
    (v_s1,    'smokegb.s1@example.invalid',    '{"full_name":"Gb, One","student_no":"S-1"}'),
    (v_s2,    'smokegb.s2@example.invalid',    '{"full_name":"Gb, Two","student_no":"S-2"}'),
    (v_s3,    'smokegb.s3@example.invalid',    '{"full_name":"Gb, Three","student_no":"S-3"}'),
    (v_s4,    'smokegb.s4@example.invalid',    '{"full_name":"Gb, Four","student_no":"S-4"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  update public.profiles set role = 'admin' where id = v_admin;
  update public.profiles set role = 'checker' where id = v_chk;
  update public.profiles set email_notifications = false where id = v_s4;
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKGB', 'Gradebook') returning id into v_course;
  insert into public.courses (instructor_id, code, title) values (v_inst2, 'SMKG2', 'Other') returning id into v_course2;
  insert into public.sections (course_id, name) values (v_course, 'GB-A') returning id into v_secA;
  insert into public.sections (course_id, name) values (v_course, 'GB-B') returning id into v_secB;
  insert into public.section_members values (v_secA, v_s1), (v_secA, v_s2), (v_secA, v_s4), (v_secB, v_s3);

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"}]'::jsonb), '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Continuing entity assumption.'), '{"accepted":["Going concern"]}');
  v_essay := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'essay', 'points', 5,
    'stem', 'Explain going concern.'), '{"guide":"Entity continues"}');
  v_ident2 := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification', 'points', 2,
    'stem', 'Basis of accounting.'), '{"accepted":["Accrual"]}');

  -- Exam 1: both sections, 1 + 1 + 5 = 7 points, scores visible to students.
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices, opens_at)
    values (v_course, 'GB Quiz 1', 30, v_inst, false, false, now() - interval '3 days') returning id into v_ex1;
  insert into public.exam_items values (v_ex1, v_mcq, 1), (v_ex1, v_ident, 2), (v_ex1, v_essay, 3);
  insert into public.exam_sections values (v_ex1, v_secA), (v_ex1, v_secB);
  update public.exams set status = 'published' where id = v_ex1;
  -- Exam 2: section A only, 2 points, scores hidden from students.
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices, show_score, opens_at)
    values (v_course, 'GB Quiz 2', 30, v_inst, false, false, false, now() - interval '1 day') returning id into v_ex2;
  insert into public.exam_items values (v_ex2, v_ident2, 1);
  insert into public.exam_sections values (v_ex2, v_secA);
  update public.exams set status = 'published' where id = v_ex2;
  -- Exam 3: still a draft, so it must not appear.
  insert into public.exams (course_id, title, time_limit_minutes, created_by) values (v_course, 'GB Draft', 30, v_inst) returning id into v_ex3;
  insert into public.exam_items values (v_ex3, v_mcq, 1);

  -- ====================================================== students take the exams
  perform pg_temp.act_as(v_s1);
  v_a1 := public.start_attempt(v_ex1);
  v_tok := (public.claim_attempt(v_a1, '{"hash":"d1","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a1, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a1, v_tok, 1, '{"text":"GC"}');
  perform public.save_response(v_a1, v_tok, 2, '{"text":"The entity keeps operating."}');
  perform public.submit_attempt(v_a1, v_tok);
  v_a1b := public.start_attempt(v_ex2);
  v_tok := (public.claim_attempt(v_a1b, '{"hash":"d1","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a1b, v_tok, 0, '{"text":"Accrual basis"}');
  perform public.submit_attempt(v_a1b, v_tok);

  perform pg_temp.act_as(v_s2);
  v_a2 := public.start_attempt(v_ex1);   -- never submits

  perform pg_temp.act_as(v_s3);
  v_a3 := public.start_attempt(v_ex1);
  v_tok := (public.claim_attempt(v_a3, '{"hash":"d3","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a3, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a3, v_tok, 1, '{"text":"Going concern"}');
  perform public.save_response(v_a3, v_tok, 2, '{"text":"It continues."}');
  perform public.submit_attempt(v_a3, v_tok);

  perform pg_temp.act_as(v_s4);
  v_a4 := public.start_attempt(v_ex1);
  v_tok := (public.claim_attempt(v_a4, '{"hash":"d4","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a4, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a4, v_tok, 1, '{"text":"Entity assumption"}');
  perform public.save_response(v_a4, v_tok, 2, '{"text":"Operating."}');
  perform public.submit_attempt(v_a4, v_tok);

  perform pg_temp.act_as(v_s1);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Finalizing an attempt is not a "score change"', jsonb_array_length(v_r) = 0, v_r::text);

  -- ====================================================== gradebook
  perform pg_temp.act_as(v_inst);
  v_r := public.course_gradebook(v_course);
  perform pg_temp.ok('Gradebook: course name, 2 exams (draft left out), 2 sections, 4 student rows',
    v_r -> 'course' ->> 'code' = 'SMKGB' and jsonb_array_length(v_r -> 'exams') = 2
    and jsonb_array_length(v_r -> 'sections') = 2 and jsonb_array_length(v_r -> 'students') = 4, left(v_r::text, 200));
  perform pg_temp.ok('Exams come oldest first with their total points (7 and 2)',
    v_r -> 'exams' -> 0 ->> 'title' = 'GB Quiz 1' and (v_r -> 'exams' -> 0 ->> 'max')::numeric = 7
    and v_r -> 'exams' -> 1 ->> 'title' = 'GB Quiz 2' and (v_r -> 'exams' -> 1 ->> 'max')::numeric = 2,
    (v_r -> 'exams')::text);
  perform pg_temp.ok('Each exam lists the sections it was given to',
    jsonb_array_length(v_r -> 'exams' -> 0 -> 'section_ids') = 2 and jsonb_array_length(v_r -> 'exams' -> 1 -> 'section_ids') = 1,
    (v_r -> 'exams' -> 1 -> 'section_ids')::text);
  select x into v_x from jsonb_array_elements(v_r -> 'students') x where x ->> 'full_name' = 'Gb, One';
  perform pg_temp.ok('Student 1: score 1 of 7, submitted, essay still to check',
    (v_x -> 'scores' -> v_ex1::text ->> 'score')::numeric = 1 and (v_x -> 'scores' -> v_ex1::text ->> 'max')::numeric = 7
    and (v_x -> 'scores' -> v_ex1::text ->> 'submitted')::boolean and (v_x -> 'scores' -> v_ex1::text ->> 'pending')::int = 1
    and v_x ->> 'student_no' = 'S-1' and v_x ->> 'section_name' = 'GB-A', v_x::text);
  select x into v_x from jsonb_array_elements(v_r -> 'students') x where x ->> 'full_name' = 'Gb, Two';
  perform pg_temp.ok('Student 2 started but did not submit: shown as not submitted, no exam 2 entry',
    not (v_x -> 'scores' -> v_ex1::text ->> 'submitted')::boolean and not (v_x -> 'scores' ? v_ex2::text), v_x::text);
  select x into v_x from jsonb_array_elements(v_r -> 'students') x where x ->> 'full_name' = 'Gb, Three';
  perform pg_temp.ok('Student 3 is in section B and has no entry for exam 2 (not given to that section)',
    v_x ->> 'section_name' = 'GB-B' and not (v_x -> 'scores' ? v_ex2::text) and (v_x -> 'scores' -> v_ex1::text ->> 'score')::numeric = 2,
    v_x::text);
  select x into v_x from jsonb_array_elements(v_r -> 'students') x where x ->> 'full_name' = 'Gb, One';
  perform pg_temp.ok('Student 1 exam 2: hidden-score exams still appear in the instructor''s gradebook',
    (v_x -> 'scores' -> v_ex2::text ->> 'score')::numeric = 0, (v_x -> 'scores' -> v_ex2::text)::text);

  perform pg_temp.act_as(v_admin);
  v_r := public.course_gradebook(v_course);
  perform pg_temp.ok('An admin can download any course''s gradebook', jsonb_array_length(v_r -> 'students') = 4, null);
  perform pg_temp.act_as(v_inst2);
  perform pg_temp.fails('Another instructor can''t open it', format('select public.course_gradebook(%L)', v_course), 'Not allowed');
  perform pg_temp.act_as(v_s1);
  perform pg_temp.fails('A student can''t open it', format('select public.course_gradebook(%L)', v_course), 'Not allowed');
  perform pg_temp.act_as(v_chk);
  perform pg_temp.fails('A checker can''t open it', format('select public.course_gradebook(%L)', v_course), 'Not allowed');
  perform pg_temp.act_as_anon();
  perform pg_temp.fails('Nobody signed out can open it', format('select public.course_gradebook(%L)', v_course), 'permission denied');

  -- ====================================================== score changes -> student notices
  perform pg_temp.act_as(v_inst);
  v_r := public.set_response_score(v_a1, v_essay, 4, 'Good.');
  perform pg_temp.ok('Scoring the essay: total 5 of 7 and the student will be notified',
    (v_r ->> 'score')::numeric = 5 and (v_r ->> 'notify')::boolean, v_r::text);

  v_r := public.set_response_score(v_a1, v_essay, 4, 'Good, with a comment only.');
  perform pg_temp.ok('Saving the same score again (only a comment) does not notify', not (v_r ->> 'notify')::boolean, v_r::text);

  perform pg_temp.act_as(v_s1);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Student 1 sees one notice: 1 -> 5 of 7, scored by hand',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'exam_title' = 'GB Quiz 1' and v_r -> 0 ->> 'course_code' = 'SMKGB'
    and (v_r -> 0 ->> 'old_score')::numeric = 1 and (v_r -> 0 ->> 'new_score')::numeric = 5
    and (v_r -> 0 ->> 'max_score')::numeric = 7 and (v_r -> 0 ->> 'by_hand')::boolean, v_r::text);

  perform pg_temp.act_as(v_inst);
  v_r := public.set_response_score(v_a1, v_ident, 1, null);
  perform pg_temp.act_as(v_s1);
  v_r := public.my_score_updates();
  perform pg_temp.ok('A second change is folded into the same notice: 1 -> 6',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'old_score')::numeric = 1 and (v_r -> 0 ->> 'new_score')::numeric = 6, v_r::text);

  perform pg_temp.act_as(v_s2);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Other students see nothing about it', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as(v_inst2);
  v_r := public.my_score_updates();
  perform pg_temp.ok('An unrelated instructor sees nothing', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as(v_s1);
  perform pg_temp.fails('Students can''t read the change log directly', 'select * from public.score_changes', 'permission denied');
  perform pg_temp.fails('...or write to it', format('insert into public.score_changes (attempt_id, new_score) values (%L, 7)', v_a1), 'permission denied');

  -- A change that is undone leaves no notice.
  perform pg_temp.act_as(v_inst);
  perform public.set_response_score(v_a3, v_essay, 3, null);
  perform public.set_response_score(v_a3, v_essay, null, null);
  perform pg_temp.act_as(v_s3);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Score changed and changed back: no notice', jsonb_array_length(v_r) = 0, v_r::text);

  -- A checker's scoring notifies too.
  perform pg_temp.act_as(v_inst);
  perform public.assign_checker(v_ex1, 'smokegb.chk@example.invalid');
  perform pg_temp.act_as(v_chk);
  v_r := public.set_response_score(v_a3, v_essay, 5, 'Excellent.');
  perform pg_temp.act_as(v_s3);
  v_r := public.my_score_updates();
  perform pg_temp.ok('A checker''s score notifies the student too: 2 -> 7',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'old_score')::numeric = 2 and (v_r -> 0 ->> 'new_score')::numeric = 7, v_r::text);

  -- Dismissing.
  perform pg_temp.act_as(v_s1);
  perform public.dismiss_score_updates();
  v_r := public.my_score_updates();
  perform pg_temp.ok('Dismissed notices are gone', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as(v_s3);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Dismissing is per student (student 3 still has theirs)', jsonb_array_length(v_r) = 1, v_r::text);
  perform pg_temp.act_as(v_inst);
  perform public.set_response_score(v_a1, v_essay, 5, null);
  perform pg_temp.act_as(v_s1);
  v_r := public.my_score_updates();
  perform pg_temp.ok('A later change shows a new notice: 6 -> 7',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'old_score')::numeric = 6 and (v_r -> 0 ->> 'new_score')::numeric = 7, v_r::text);

  -- Exams with hidden scores never notify.
  perform pg_temp.act_as(v_inst);
  v_r := public.set_response_score(v_a1b, v_ident2, 2, null);
  perform pg_temp.ok('Exam with scores hidden: score changes, but notify is false',
    (v_r ->> 'score')::numeric = 2 and not (v_r ->> 'notify')::boolean, v_r::text);
  perform pg_temp.act_as(v_s1);
  v_r := public.my_score_updates();
  perform pg_temp.ok('...and no notice reveals it (only the exam 1 notice is there)',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'exam_title' = 'GB Quiz 1', v_r::text);

  -- Re-grading after a corrected key.
  perform pg_temp.act_as(v_inst);
  perform public.accept_identification_answer(v_ident, 'Entity assumption');
  perform public.regrade_exam(v_ex1);
  perform pg_temp.act_as(v_s4);
  v_r := public.my_score_updates();
  perform pg_temp.ok('Re-grade after accepting a wording: student 4 gets a notice, not "by hand": 1 -> 2',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'old_score')::numeric = 1 and (v_r -> 0 ->> 'new_score')::numeric = 2
    and not (v_r -> 0 ->> 'by_hand')::boolean, v_r::text);
  perform pg_temp.act_as(v_s3);
  v_r := public.my_score_updates();
  perform pg_temp.ok('...students whose score did not change get nothing new from the re-grade',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'new_score')::numeric = 7, v_r::text);

  -- ====================================================== email digest
  perform pg_temp.act_as_owner();
  delete from public.app_settings where key = 'cron_secret';
  insert into public.app_settings (key, value) values ('cron_secret', 'test-secret-123456');

  perform pg_temp.act_as_anon();
  perform pg_temp.fails('Email job refuses a wrong secret', 'select public.claim_score_update_emails(''nope'')', 'Not allowed');
  perform pg_temp.fails('Email job refuses an empty secret', 'select public.claim_score_update_emails('''')', 'Not allowed');
  v_r := public.claim_score_update_emails('test-secret-123456');
  perform pg_temp.ok('Fresh changes are held back for 10 minutes (so a quick fix doesn''t send two emails)',
    jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.score_changes where emailed_at is not null and attempt_id in (v_a1, v_a3, v_a4, v_a1b);
  perform pg_temp.ok('...and are not marked as sent', v_n = 0, v_n::text);

  update public.score_changes set created_at = now() - interval '20 minutes' where attempt_id in (v_a1, v_a3, v_a4, v_a1b);
  perform pg_temp.act_as_anon();
  v_r := public.claim_score_update_emails('test-secret-123456');
  perform pg_temp.ok('After 10 quiet minutes: student 1 (1 -> 7) and student 3 (2 -> 7) get an email; student 4 opted out; the hidden-score exam is skipped',
    jsonb_array_length(v_r) = 2
    and exists (select 1 from jsonb_array_elements(v_r) x where x ->> 'email' = 'smokegb.s1@example.invalid' and (x ->> 'old_score')::numeric = 1
                and (x ->> 'new_score')::numeric = 7 and (x ->> 'max_score')::numeric = 7 and x ->> 'exam_title' = 'GB Quiz 1'
                and x ->> 'course_code' = 'SMKGB' and (x ->> 'by_hand')::boolean)
    and exists (select 1 from jsonb_array_elements(v_r) x where x ->> 'email' = 'smokegb.s3@example.invalid' and (x ->> 'old_score')::numeric = 2),
    v_r::text);
  perform pg_temp.ok('...none of them goes to the student who turned emails off',
    not exists (select 1 from jsonb_array_elements(v_r) x where x ->> 'email' = 'smokegb.s4@example.invalid'), null);
  v_r := public.claim_score_update_emails('test-secret-123456');
  perform pg_temp.ok('The next run sends nothing again', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.score_changes where emailed_at is null and attempt_id in (v_a1, v_a3, v_a4, v_a1b);
  perform pg_temp.ok('Every change is now marked as handled', v_n = 0, v_n::text);

  -- A change after the email starts a fresh batch.
  perform pg_temp.act_as(v_inst);
  perform public.set_response_score(v_a1, v_essay, 3, null);
  perform pg_temp.act_as_owner();
  update public.score_changes set created_at = now() - interval '20 minutes' where emailed_at is null and attempt_id in (v_a1, v_a3, v_a4, v_a1b);
  perform pg_temp.act_as_anon();
  v_r := public.claim_score_update_emails('test-secret-123456');
  perform pg_temp.ok('A later change is emailed on its own: 7 -> 5',
    jsonb_array_length(v_r) = 1 and (v_r -> 0 ->> 'old_score')::numeric = 7 and (v_r -> 0 ->> 'new_score')::numeric = 5, v_r::text);

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from public.app_settings where key = 'cron_secret';
insert into public.app_settings (key, value) select 'cron_secret', value from smoke_secret_backup;
update public.score_changes set emailed_at = null where id in (select id from smoke_sc_hold);
-- Remove the attempts first so deleting the instructor's account has no answer or score-change rows left to update
-- (the SQL Editor runs a whole script as one transaction, which would otherwise trip a foreign key).
delete from public.attempts where student_id in (select id from auth.users where email like 'smokegb.%@example.invalid');
delete from auth.users where email like 'smokegb.%@example.invalid';
select test, result, detail from smoke_results order by n;
