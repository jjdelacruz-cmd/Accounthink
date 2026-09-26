-- Phase 3 smoke test. Paste into Supabase SQL Editor and Run (needs migrations up to 0004).
-- Creates throwaway users/course/exam, takes the exam as students, checks grading
-- and every "cannot" rule, then deletes everything it made.

create temp table if not exists smoke_results (n serial, test text, result text, detail text);
truncate smoke_results;

-- Test helpers (outside the test block so its error handler can still use them).
create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $f$;
create or replace function pg_temp.act_as_owner() returns void language plpgsql as $f$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;
create or replace function pg_temp.ok(p_test text, p_pass boolean, p_detail text default null) returns void language sql as $f$
  insert into smoke_results (test, result, detail) values (p_test, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
$f$;

do $test$
declare
  v_abort_ctx text;
  v_inst  uuid := gen_random_uuid();
  v_inst2 uuid := gen_random_uuid();
  v_s1    uuid := gen_random_uuid();
  v_s2    uuid := gen_random_uuid();
  v_s3    uuid := gen_random_uuid();   -- not enrolled
  v_course uuid;
  v_sec uuid;
  v_mcq uuid; v_ident uuid; v_enum uuid; v_enum_ord uuid;
  v_exam uuid; v_exam2 uuid;
  v_a1 uuid; v_a2 uuid; v_tmp uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid;
  v_q jsonb;
  v_r jsonb;
  v_n int;
  v_num numeric;
  v_txt text;
begin

  -- ---------- setup (as owner) ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smoke3.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke3.inst2@example.invalid', '{"full_name":"Other Instructor"}'),
    (v_s1,    'smoke3.s1@example.invalid',    '{"full_name":"Smoke, S1"}'),
    (v_s2,    'smoke3.s2@example.invalid',    '{"full_name":"Smoke, S2"}'),
    (v_s3,    'smoke3.s3@example.invalid',    '{"full_name":"Smoke, S3"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMK301', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'SMK-A') returning id into v_sec;
  insert into public.section_members values (v_sec, v_s1), (v_sec, v_s2);

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Which is an asset?',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"},{"key":"C","text":"Expense"}]'::jsonb, 'points', 1),
    '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Assumption that the entity will continue.', 'points', 2), '{"accepted":["Going concern","GC assumption"]}');
  v_enum := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'enumeration',
    'stem', 'Give three current assets.', 'points', 3),
    '{"answers":[["Cash","Cash on hand"],["Receivables","Accounts receivable"],["Inventory"]],"any_order":true}');
  v_enum_ord := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'enumeration',
    'stem', 'Steps in order.', 'points', 2), '{"answers":[["Plan"],["Do"]],"any_order":false}');
  insert into public.exams (course_id, title, time_limit_minutes, created_by, show_score, shuffle_items, shuffle_choices)
    values (v_course, 'Smoke Exam', 30, v_inst, true, false, false) returning id into v_exam;
  insert into public.exam_items values (v_exam, v_mcq, 1), (v_exam, v_ident, 2), (v_exam, v_enum, 3), (v_exam, v_enum_ord, 4);
  insert into public.exam_sections values (v_exam, v_sec);
  perform pg_temp.act_as_owner();

  -- ---------- starting ----------
  begin
    perform pg_temp.act_as(v_s1);
    v_tmp := public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Cannot start a draft exam', false, 'started');
  exception when others then
    perform pg_temp.ok('Cannot start a draft exam', true, sqlerrm);
  end;

  update public.exams set status = 'published', opens_at = now() + interval '1 hour' where id = v_exam;
  begin
    perform pg_temp.act_as(v_s1);
    v_tmp := public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Cannot start before the opening time', false, 'started');
  exception when others then
    perform pg_temp.ok('Cannot start before the opening time', sqlerrm = 'This exam has not opened yet', sqlerrm);
  end;
  update public.exams set opens_at = null where id = v_exam;

  begin
    perform pg_temp.act_as(v_s3);
    v_tmp := public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student not in an assigned section cannot start', false, 'started');
  exception when others then
    perform pg_temp.ok('Student not in an assigned section cannot start', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst);
    v_tmp := public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor cannot start an attempt', false, 'started');
  exception when others then
    perform pg_temp.ok('Instructor cannot start an attempt', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_s1);
  v_a1 := public.start_attempt(v_exam);
  v_tmp := public.start_attempt(v_exam);
  v_t1 := (public.claim_attempt(v_a1, '{"hash":"phone-1","label":"Test phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student starts; starting again resumes the same attempt', v_a1 is not null and v_a1 = v_tmp);

  select extract(epoch from deadline_at - started_at)::int into v_n from public.attempts where id = v_a1;
  perform pg_temp.ok('Deadline = start + time limit (30 min)', v_n = 1800, v_n || ' s');

  -- ---------- questions never include keys ----------
  perform pg_temp.act_as(v_s1);
  v_q := public.attempt_question(v_a1, v_t1, 0);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Question has only safe fields (no answer key)',
    (select array_agg(k order by k) from jsonb_object_keys(v_q) k)
      = array['answer','choices','index','points','slots','stem','total','type'],
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_q) k));

  perform pg_temp.act_as(v_s1);
  select string_agg(public.attempt_question(v_a1, v_t1, i)::text, ' ') into v_txt from generate_series(0, 3) i;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('No question payload contains "correct"/"accepted"/answer text',
    v_txt not like '%correct%' and v_txt not like '%accepted%' and v_txt not ilike '%going concern%'
    and v_txt not ilike '%receivable%' and v_txt not ilike '%inventory%',
    left(v_txt, 80));

  perform pg_temp.act_as(v_s1);
  v_q := public.attempt_question(v_a1, v_t1, 2);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Enumeration tells the student how many answers to give', (v_q ->> 'slots')::int = 3, v_q ->> 'slots');

  begin
    perform pg_temp.act_as(v_s1);
    v_q := public.attempt_question(v_a1, v_t1, 4);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Out-of-range question index rejected', false, 'returned');
  exception when others then
    perform pg_temp.ok('Out-of-range question index rejected', true, sqlerrm);
  end;

  -- ---------- other people can't touch the attempt ----------
  begin
    perform pg_temp.act_as(v_s2);
    v_q := public.attempt_question(v_a1, v_t1, 0);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Another student cannot read my questions', false, 'returned');
  exception when others then
    perform pg_temp.ok('Another student cannot read my questions', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_s2);
    perform public.save_response(v_a1, v_t1, 0, '{"choice":"A"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Another student cannot answer for me', false, 'saved');
  exception when others then
    perform pg_temp.ok('Another student cannot answer for me', true, sqlerrm);
  end;

  -- ---------- answering (with variants that should still be correct) ----------
  perform pg_temp.act_as(v_s1);
  perform public.save_response(v_a1, v_t1, 0, '{"choice":"A"}');
  perform public.save_response(v_a1, v_t1, 0, '{"choice":"B","score":999}');           -- change answer; junk field
  perform public.save_response(v_a1, v_t1, 1, '{"text":"  going   CONCERN. "}');
  perform public.save_response(v_a1, v_t1, 2, '{"items":["receivables","Cash on hand","cash","Land"]}');
  perform public.save_response(v_a1, v_t1, 3, '{"items":["Do","Plan"]}');              -- wrong order
  v_r := public.attempt_state(v_a1, v_t1);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Progress shows 4 answered', jsonb_array_length(v_r -> 'answered') = 4, v_r ->> 'answered');
  select answer::text into v_txt from public.responses where attempt_id = v_a1 and item_id = v_mcq;
  perform pg_temp.ok('Saved answer keeps only the allowed field', v_txt = '{"choice": "B"}', v_txt);

  -- ---------- direct table access is closed ----------
  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.attempts;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot read the attempts table', v_n = 0, 'saw ' || v_n);

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.responses;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot read the responses table', v_n = 0, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_s1);
    update public.attempts set deadline_at = now() + interval '10 hours', score = 100 where id = v_a1;
    get diagnostics v_n = row_count;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot extend their deadline or set a score', v_n = 0, v_n || ' rows changed');
  exception when others then
    perform pg_temp.ok('Student cannot extend their deadline or set a score', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_s1);
    insert into public.responses (attempt_id, item_id, answer, points_awarded) values (v_a1, v_ident, '{}', 99);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot write responses directly', false, 'inserted');
  exception when others then
    perform pg_temp.ok('Student cannot write responses directly', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_s1);
    perform public.finalize_attempt(v_a1);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Internal grading function is not callable by students', false, 'called');
  exception when others then
    perform pg_temp.ok('Internal grading function is not callable by students', true, sqlerrm);
  end;

  -- ---------- exam is locked once someone started ----------
  begin
    perform pg_temp.act_as(v_inst);
    update public.exams set status = 'draft' where id = v_exam;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Exam with attempts cannot go back to draft', false, 'moved to draft');
  exception when others then
    perform pg_temp.ok('Exam with attempts cannot go back to draft', true, sqlerrm);
  end;

  -- ---------- submit + grading ----------
  perform pg_temp.act_as(v_s1);
  v_r := public.submit_attempt(v_a1, v_t1);
  perform pg_temp.act_as_owner();
  -- mcq 1 + ident 2 + enum 2 of 3 (cash & cash-on-hand count once, Land wrong) + ordered enum 0 = 5 of 8
  perform pg_temp.ok('Score is correct (5 of 8)', (v_r ->> 'score')::numeric = 5 and (v_r ->> 'max_score')::numeric = 8,
    (v_r ->> 'score') || ' / ' || (v_r ->> 'max_score'));
  select points_awarded into v_num from public.responses where attempt_id = v_a1 and item_id = v_ident;
  perform pg_temp.ok('Identification ignores case, spacing, trailing period', v_num = 2, v_num::text);
  select points_awarded into v_num from public.responses where attempt_id = v_a1 and item_id = v_enum;
  perform pg_temp.ok('Enumeration: alternates accepted, duplicates counted once', v_num = 2, v_num::text);
  select points_awarded into v_num from public.responses where attempt_id = v_a1 and item_id = v_enum_ord;
  perform pg_temp.ok('Ordered enumeration marks wrong order wrong', v_num = 0, v_num::text);

  begin
    perform pg_temp.act_as(v_s1);
    perform public.save_response(v_a1, v_t1, 0, '{"choice":"A"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Cannot change answers after submitting', false, 'saved');
  exception when others then
    perform pg_temp.ok('Cannot change answers after submitting', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_s1);
    v_tmp := public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Cannot retake a submitted exam', false, 'started');
  exception when others then
    perform pg_temp.ok('Cannot retake a submitted exam', sqlerrm = 'You have already submitted this exam', sqlerrm);
  end;

  perform pg_temp.act_as(v_s1);
  v_r := public.student_exam_info(v_exam);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student sees their score afterwards', (v_r -> 'attempt' ->> 'score')::numeric = 5, v_r -> 'attempt' ->> 'score');

  -- ---------- deadline enforcement (S2) ----------
  perform pg_temp.act_as(v_s2);
  v_a2 := public.start_attempt(v_exam);
  v_t2 := (public.claim_attempt(v_a2, '{"hash":"phone-2","label":"Test phone 2"}') ->> 'token')::uuid;
  perform public.save_response(v_a2, v_t2, 0, '{"choice":"B"}');
  perform pg_temp.act_as_owner();
  update public.attempts set started_at = now() - interval '31 minutes', deadline_at = now() - interval '1 minute' where id = v_a2;
  begin
    perform pg_temp.act_as(v_s2);
    perform public.save_response(v_a2, v_t2, 1, '{"text":"Going concern"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Answers after the deadline are rejected', false, 'saved');
  exception when others then
    perform pg_temp.ok('Answers after the deadline are rejected', sqlerrm = 'Time is up', sqlerrm);
  end;
  perform pg_temp.act_as(v_s2);
  perform public.student_exam_info(v_exam);   -- page load finalizes expired attempts
  perform pg_temp.act_as_owner();
  select score into v_num from public.attempts where id = v_a2;
  perform pg_temp.ok('Expired attempt is auto-submitted with answers saved in time', v_num = 1, coalesce(v_num::text, 'not submitted'));

  -- ---------- hidden scores ----------
  update public.exams set show_score = false where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.student_exam_info(v_exam);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Score hidden from student when "show score" is off',
    (v_r -> 'attempt' -> 'score') = 'null'::jsonb, v_r -> 'attempt' ->> 'score');

  -- ---------- instructors ----------
  perform pg_temp.act_as(v_inst);
  select count(*) into v_n from public.attempts where exam_id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Instructor sees attempts for their exam', v_n = 2, 'saw ' || v_n);

  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.responses;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Other instructor cannot see the responses', v_n = 0, 'saw ' || v_n);

  -- ---------- closing an exam ends open attempts ----------
  insert into public.exams (course_id, title, time_limit_minutes, created_by) values (v_course, 'Close Test', 30, v_inst)
    returning id into v_exam2;
  insert into public.exam_items values (v_exam2, v_mcq, 1);
  insert into public.exam_sections values (v_exam2, v_sec);
  update public.exams set status = 'published' where id = v_exam2;
  perform pg_temp.act_as(v_s1);
  v_tmp := public.start_attempt(v_exam2);
  v_t3 := (public.claim_attempt(v_tmp, '{"hash":"phone-1","label":"Test phone"}') ->> 'token')::uuid;
  perform public.save_response(v_tmp, v_t3, 0, '{"choice":"B"}');
  perform pg_temp.act_as_owner();
  update public.exams set status = 'closed' where id = v_exam2;
  perform pg_temp.act_as(v_inst);
  v_n := public.finalize_expired_for_exam(v_exam2);
  perform pg_temp.act_as_owner();
  select score into v_num from public.attempts where id = v_tmp;
  perform pg_temp.ok('Closing an exam finalizes in-progress attempts', v_n = 1 and v_num = 1, v_n || ' finalized, score ' || coalesce(v_num::text, 'null'));

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

-- Cleanup (cascades to everything created above).
delete from auth.users where email like 'smoke3.%@example.invalid';
select test, result, detail from smoke_results order by n;
