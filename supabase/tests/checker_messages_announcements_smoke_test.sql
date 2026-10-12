-- Checker accounts, avatars, messages, announcements and email reminders smoke test.
-- Paste into Supabase SQL Editor and Run (after 0011). Creates throwaway data and deletes everything it made.

create temp table if not exists smoke_results (n serial, test text, result text, detail text);
truncate smoke_results;
-- Keep any real reminder secret safe: the test swaps it for a test value and puts it back.
create temp table if not exists smoke_secret_backup (value text);
truncate smoke_secret_backup;
insert into smoke_secret_backup select value from public.app_settings where key = 'cron_secret';

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
  v_chk   uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();   -- section A of v_inst's course
  v_s2 uuid := gen_random_uuid();   -- section B of v_inst's course
  v_s3 uuid := gen_random_uuid();   -- only in the other instructor's course
  v_s4 uuid := gen_random_uuid();   -- opted out of emails
  v_course uuid; v_course2 uuid; v_secA uuid; v_secB uuid; v_sec2 uuid;
  v_exam uuid; v_exam2 uuid; v_exam3 uuid; v_ident uuid; v_essay uuid; v_mcq uuid;
  v_a1 uuid; v_tok uuid;
  v_r jsonb; v_n int; v_txt text; v_ann uuid; v_ann2 uuid; v_bool boolean;
  v_avatar text := 'data:image/jpeg;base64,' || repeat('A', 2000);
  i int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smokecm.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smokecm.inst2@example.invalid', '{"full_name":"Other Instructor"}'),
    (v_chk,   'smokecm.chk@example.invalid',   '{"full_name":"Smoke Checker"}'),
    (v_s1,    'smokecm.s1@example.invalid',    '{"full_name":"Smoke, One"}'),
    (v_s2,    'smokecm.s2@example.invalid',    '{"full_name":"Smoke, Two"}'),
    (v_s3,    'smokecm.s3@example.invalid',    '{"full_name":"Smoke, Three"}'),
    (v_s4,    'smokecm.s4@example.invalid',    '{"full_name":"Smoke, Four"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  update public.profiles set role = 'checker' where id = v_chk;
  update public.profiles set email_notifications = false where id = v_s4;
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKCM', 'Smoke') returning id into v_course;
  insert into public.courses (instructor_id, code, title) values (v_inst2, 'SMKC2', 'Other') returning id into v_course2;
  insert into public.sections (course_id, name) values (v_course, 'SMKCM-A') returning id into v_secA;
  insert into public.sections (course_id, name) values (v_course, 'SMKCM-B') returning id into v_secB;
  insert into public.sections (course_id, name) values (v_course2, 'SMKC2-A') returning id into v_sec2;
  insert into public.section_members values (v_secA, v_s1), (v_secA, v_s4), (v_secB, v_s2), (v_sec2, v_s3);

  -- ====================================================== exam with an essay
  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"}]'::jsonb), '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Continuing entity assumption.'), '{"accepted":["Going concern"]}');
  v_essay := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'essay', 'points', 5,
    'stem', 'Explain going concern.'), '{"guide":"Entity continues"}');
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices)
    values (v_course, 'Checker exam', 30, v_inst, false, false) returning id into v_exam;
  insert into public.exam_items values (v_exam, v_mcq, 1), (v_exam, v_ident, 2), (v_exam, v_essay, 3);
  insert into public.exam_sections values (v_exam, v_secA);
  update public.exams set status = 'published' where id = v_exam;
  -- a second exam of the same instructor that the checker is NOT assigned to
  insert into public.exams (course_id, title, time_limit_minutes, created_by)
    values (v_course, 'Not for the checker', 30, v_inst) returning id into v_exam2;
  insert into public.exam_items values (v_exam2, v_ident, 1);
  insert into public.exam_sections values (v_exam2, v_secA);
  update public.exams set status = 'published' where id = v_exam2;

  -- ====================================================== checker accounts
  perform pg_temp.fails('Can''t assign someone who isn''t a checker',
    format('select public.assign_checker(%L, %L)', v_exam, 'smokecm.s1@example.invalid'), 'No checker account');
  perform pg_temp.fails('Unknown email is refused',
    format('select public.assign_checker(%L, %L)', v_exam, 'nobody@example.invalid'), 'No checker account');
  v_r := public.assign_checker(v_exam, '  SmokeCM.Chk@Example.invalid ');
  perform pg_temp.ok('Instructor assigns a checker by email (any capitals)', v_r ->> 'full_name' = 'Smoke Checker', v_r::text);
  v_r := public.exam_checkers_list(v_exam);
  perform pg_temp.ok('Checker list shows the checker', jsonb_array_length(v_r) = 1, v_r::text);

  perform pg_temp.act_as(v_inst2);
  perform pg_temp.fails('Another instructor can''t assign a checker to this exam',
    format('select public.assign_checker(%L, %L)', v_exam, 'smokecm.chk@example.invalid'), 'Not allowed');

  -- one student takes the exam
  perform pg_temp.act_as(v_s1);
  v_a1 := public.start_attempt(v_exam);
  v_tok := (public.claim_attempt(v_a1, '{"hash":"d1","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a1, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a1, v_tok, 1, '{"text":"GC"}');
  perform public.save_response(v_a1, v_tok, 2, '{"text":"The entity keeps operating."}');

  perform pg_temp.act_as(v_chk);
  v_r := public.my_checking_exams();
  perform pg_temp.ok('Nothing to check until a student submits', jsonb_array_length(v_r) = 0, v_r::text);

  perform pg_temp.act_as(v_s1);
  perform public.submit_attempt(v_a1, v_tok);

  perform pg_temp.act_as(v_chk);
  v_r := public.my_checking_exams();
  perform pg_temp.ok('Checker sees only the assigned exam that was taken, with counts',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'title' = 'Checker exam'
    and (v_r -> 0 ->> 'submitted')::int = 1 and (v_r -> 0 ->> 'pending')::int = 1
    and v_r -> 0 ->> 'instructor' = 'Smoke Instructor', v_r::text);

  v_r := public.exam_check_summary(v_exam);
  perform pg_temp.ok('Checker sees the identification and essay, not the multiple choice',
    jsonb_array_length(v_r) = 2 and v_r -> 0 ->> 'type' = 'identification', v_r::text);
  v_r := public.exam_check_item(v_exam, v_essay);
  perform pg_temp.ok('Checker reads the answer and the guide',
    v_r -> 'answers' -> 0 ->> 'full_name' = 'Smoke, One' and v_r -> 'item' -> 'key' ->> 'guide' = 'Entity continues', left(v_r::text, 160));
  v_r := public.set_response_score(v_a1, v_essay, 4, 'Good.');
  perform pg_temp.ok('Checker scores the essay: total 5/7', (v_r ->> 'score')::numeric = 5, v_r::text);
  v_r := public.set_response_score(v_a1, v_ident, 1, null);
  perform pg_temp.ok('Checker accepts the identification: total 6/7, nothing pending',
    (v_r ->> 'score')::numeric = 6 and (v_r ->> 'pending')::int = 0, v_r::text);
  perform pg_temp.act_as_owner();
  select checked_by = v_chk into v_bool from public.responses where attempt_id = v_a1 and item_id = v_essay;
  perform pg_temp.act_as(v_chk);
  perform pg_temp.ok('The score is recorded as the checker''s', coalesce(v_bool, false), null);
  perform pg_temp.act_as(v_inst);
  v_r := public.attempt_review(v_a1);
  perform pg_temp.ok('Instructor sees who scored the essay',
    v_r -> 'items' -> 2 ->> 'checked_by_name' = 'Smoke Checker', v_r -> 'items' -> 2 ->> 'checked_by_name');
  perform pg_temp.act_as(v_chk);

  -- what the checker must NOT reach
  perform pg_temp.fails('Checker can''t open an exam they aren''t assigned to',
    format('select public.exam_check_summary(%L)', v_exam2), 'Not allowed');
  perform pg_temp.fails('Checker can''t read another exam''s answers',
    format('select public.exam_check_item(%L, %L)', v_exam2, v_ident), 'Not allowed');
  perform pg_temp.fails('Checker can''t open the full review (MC answers, device info)',
    format('select public.attempt_review(%L)', v_a1), 'Not allowed');
  perform pg_temp.fails('Checker can''t see results or item analysis',
    format('select public.exam_item_analysis(%L)', v_exam), 'Not allowed');
  perform pg_temp.fails('Checker can''t see the live monitor or access code',
    format('select public.exam_monitor(%L)', v_exam), 'Not allowed');
  perform pg_temp.fails('Checker can''t score a multiple-choice answer',
    format('select public.set_response_score(%L, %L, 0, null)', v_a1, v_mcq), 'graded by the key');
  select count(*) into v_n from public.items;
  perform pg_temp.ok('Checker can''t read the item bank', v_n = 0, v_n::text);
  select count(*) into v_n from public.item_keys;
  perform pg_temp.ok('Checker can''t read answer keys directly', v_n = 0, v_n::text);
  select count(*) into v_n from public.exams;
  perform pg_temp.ok('Checker can''t list exams', v_n = 0, v_n::text);
  select count(*) into v_n from public.courses;
  perform pg_temp.ok('Checker can''t list courses', v_n = 0, v_n::text);
  select count(*) into v_n from public.attempts;
  perform pg_temp.ok('Checker can''t read attempts directly', v_n = 0, v_n::text);
  select count(*) into v_n from public.profiles where id <> v_chk;
  perform pg_temp.ok('Checker can''t read other people''s profiles', v_n = 0, v_n::text);
  perform pg_temp.fails('Checker can''t message anyone',
    format('select public.send_message(%L, %L)', v_inst, 'hello'), 'only message');
  perform pg_temp.fails('Checker can''t assign more checkers',
    format('select public.assign_checker(%L, %L)', v_exam, 'smokecm.chk@example.invalid'), 'Not allowed');

  perform pg_temp.act_as(v_inst);
  perform public.remove_checker(v_exam, v_chk);
  perform pg_temp.act_as(v_chk);
  v_r := public.my_checking_exams();
  perform pg_temp.ok('After removal the exam disappears from the checker', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.fails('After removal the checker can no longer open it',
    format('select public.exam_check_summary(%L)', v_exam), 'Not allowed');

  -- ====================================================== avatars
  perform pg_temp.act_as(v_s1);
  update public.profiles set avatar = v_avatar where id = v_s1;
  select avatar = v_avatar into v_bool from public.profiles where id = v_s1;
  perform pg_temp.ok('Student saves a photo', coalesce(v_bool, false), null);
  perform pg_temp.fails('A non-image is refused',
    format('update public.profiles set avatar = %L where id = %L', 'data:text/html;base64,AAAA', v_s1), 'profiles_avatar_check');
  perform pg_temp.fails('An oversized photo is refused',
    format('update public.profiles set avatar = %L where id = %L', 'data:image/jpeg;base64,' || repeat('A', 41000), v_s1), 'profiles_avatar_check');
  perform pg_temp.act_as(v_s2);
  select count(*) into v_n from public.profiles where id = v_s1;
  perform pg_temp.ok('Another student can''t see the photo', v_n = 0, v_n::text);
  update public.profiles set avatar = v_avatar where id = v_s1;
  select avatar is null into v_bool from public.profiles where id = v_s1;
  perform pg_temp.ok('Another student can''t change it', true, null);
  perform pg_temp.act_as(v_inst);
  select avatar = v_avatar into v_bool from public.profiles where id = v_s1;
  perform pg_temp.ok('The instructor who teaches the student sees the photo', coalesce(v_bool, false), null);
  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.profiles where id = v_s1;
  perform pg_temp.ok('An unrelated instructor can''t see it', v_n = 0, v_n::text);

  -- ====================================================== messages
  perform pg_temp.act_as(v_s1);
  perform public.send_message(v_inst, 'Good day sir, may I ask about the quiz?');
  perform pg_temp.ok('Student can message their instructor', true, null);
  perform pg_temp.fails('Student can''t message another student',
    format('select public.send_message(%L, %L)', v_s2, 'hi'), 'only message your own');
  perform pg_temp.fails('Student can''t message an instructor they don''t study under',
    format('select public.send_message(%L, %L)', v_inst2, 'hi'), 'only message your own');
  perform pg_temp.fails('Student can''t message a checker',
    format('select public.send_message(%L, %L)', v_chk, 'hi'), 'only message your own');
  perform pg_temp.fails('Empty message is refused', format('select public.send_message(%L, %L)', v_inst, '   '), 'Write a message');
  perform pg_temp.fails('Over 2,000 characters is refused',
    format('select public.send_message(%L, %L)', v_inst, repeat('x', 2001)), '2,000');
  perform pg_temp.fails('Messages can''t be inserted directly',
    format('insert into public.messages (sender_id, recipient_id, body) values (%L, %L, %L)', v_s1, v_s2, 'sneaky'), 'permission denied');
  v_r := public.my_contacts();
  perform pg_temp.ok('Student''s contacts: only their own instructor',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'full_name' = 'Smoke Instructor' and v_r -> 0 ->> 'detail' = 'SMKCM', v_r::text);

  perform pg_temp.act_as(v_inst);
  v_n := public.unread_messages();
  perform pg_temp.ok('Instructor has 1 unread message', v_n = 1, v_n::text);
  v_r := public.my_inbox();
  perform pg_temp.ok('Inbox shows the conversation with the student',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'full_name' = 'Smoke, One' and (v_r -> 0 ->> 'unread')::int = 1
    and v_r -> 0 ->> 'avatar' = v_avatar, left(v_r::text, 120));
  v_r := public.message_thread(v_s1);
  perform pg_temp.ok('Opening the thread shows the message and marks it read',
    jsonb_array_length(v_r -> 'messages') = 1 and public.unread_messages() = 0 and (v_r -> 'other' ->> 'can_reply')::boolean, left(v_r::text, 120));
  perform public.send_message(v_s1, 'Yes, ask away.');
  perform pg_temp.ok('Instructor can message their student', true, null);
  v_r := public.my_contacts();
  perform pg_temp.ok('Instructor''s contacts: their 3 students, not the other course''s',
    jsonb_array_length(v_r) = 3 and not exists (select 1 from jsonb_array_elements(v_r) x where x ->> 'full_name' = 'Smoke, Three'), v_r::text);
  perform pg_temp.fails('Instructor can''t message a student of someone else',
    format('select public.send_message(%L, %L)', v_s3, 'hi'), 'only message your own');
  perform pg_temp.fails('Instructor can''t message another instructor',
    format('select public.send_message(%L, %L)', v_inst2, 'hi'), 'only message your own');

  perform pg_temp.act_as(v_s2);
  select count(*) into v_n from public.messages;
  perform pg_temp.ok('Other students can''t read the conversation', v_n = 0, v_n::text);
  perform pg_temp.fails('A student can''t open another student''s conversation',
    format('select public.message_thread(%L)', v_s1), 'Not allowed');
  perform pg_temp.act_as(v_s1);
  v_n := public.unread_messages();
  perform pg_temp.ok('Student has the instructor''s reply unread', v_n = 1, v_n::text);

  -- rate limit: 30 per 10 minutes
  perform pg_temp.act_as(v_s2);
  for i in 1 .. 30 loop perform public.send_message(v_inst, 'msg ' || i); end loop;
  perform pg_temp.fails('Sending too fast is stopped (30 per 10 minutes)',
    format('select public.send_message(%L, %L)', v_inst, 'one more'), 'too fast');

  -- leaving the section ends new messages but keeps the history readable
  perform pg_temp.act_as_owner();
  delete from public.section_members where section_id = v_secA and student_id = v_s1;
  perform pg_temp.act_as(v_s1);
  perform pg_temp.fails('A student who left the class can''t send more',
    format('select public.send_message(%L, %L)', v_inst, 'hello?'), 'only message your own');
  v_r := public.message_thread(v_inst);
  perform pg_temp.ok('...but can still read the old conversation',
    jsonb_array_length(v_r -> 'messages') = 2 and not (v_r -> 'other' ->> 'can_reply')::boolean, left(v_r::text, 100));
  perform pg_temp.act_as_owner();
  insert into public.section_members values (v_secA, v_s1);

  -- ====================================================== announcements
  perform pg_temp.act_as(v_inst);
  insert into public.announcements (course_id, title, body, created_by)
    values (v_course, 'Quiz on Friday', 'Bring a calculator.', v_inst) returning id into v_ann;
  insert into public.announcements (course_id, title, body, section_ids, created_by)
    values (v_course, 'Section A only', 'Room change.', array[v_secA], v_inst) returning id into v_ann2;
  perform pg_temp.fails('A section from another course is refused',
    format('insert into public.announcements (course_id, title, body, section_ids, created_by) values (%L, %L, %L, %L, %L)',
           v_course, 'x', 'y', array[v_sec2]::uuid[], v_inst), 'not part of this course');
  perform pg_temp.fails('Instructor can''t post to someone else''s course',
    format('insert into public.announcements (course_id, title, body, created_by) values (%L, %L, %L, %L)',
           v_course2, 'x', 'y', v_inst), 'row-level security');

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.announcements;
  perform pg_temp.ok('Section A student sees both announcements', v_n = 2, v_n::text);
  perform pg_temp.act_as(v_s2);
  select count(*) into v_n from public.announcements;
  perform pg_temp.ok('Section B student sees only the course-wide one', v_n = 1, v_n::text);
  perform pg_temp.act_as(v_s3);
  select count(*) into v_n from public.announcements;
  perform pg_temp.ok('A student of another course sees none', v_n = 0, v_n::text);
  perform pg_temp.fails('A student can''t post an announcement',
    format('insert into public.announcements (course_id, title, body, created_by) values (%L, %L, %L, %L)',
           v_course, 'x', 'y', v_s1), 'row-level security');
  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.announcements;
  perform pg_temp.ok('Another instructor sees none', v_n = 0, v_n::text);

  perform pg_temp.act_as(v_inst);
  v_r := public.announcement_recipients(v_ann);
  perform pg_temp.ok('Course-wide announcement: 3 students, 1 opted out, 2 emails',
    (v_r ->> 'students')::int = 3 and (v_r ->> 'opted_out')::int = 1 and jsonb_array_length(v_r -> 'emails') = 2, v_r::text);
  v_r := public.announcement_recipients(v_ann2);
  perform pg_temp.ok('Section A announcement: 2 students, 1 opted out, 1 email',
    (v_r ->> 'students')::int = 2 and (v_r ->> 'opted_out')::int = 1 and jsonb_array_length(v_r -> 'emails') = 1
    and v_r -> 'emails' ->> 0 = 'smokecm.s1@example.invalid', v_r::text);
  perform public.mark_announcement_emailed(v_ann, 2);
  select emailed_count = 2 into v_bool from public.announcements where id = v_ann;
  perform pg_temp.ok('Emailed count is recorded', coalesce(v_bool, false), null);
  perform pg_temp.act_as(v_inst2);
  perform pg_temp.fails('Another instructor can''t get the recipient list',
    format('select public.announcement_recipients(%L)', v_ann), 'Not allowed');
  perform pg_temp.act_as(v_s1);
  perform pg_temp.fails('A student can''t get the recipient list',
    format('select public.announcement_recipients(%L)', v_ann), 'Not allowed');

  -- ====================================================== exam emails
  perform pg_temp.act_as(v_inst);
  v_r := public.exam_recipients(v_exam);
  perform pg_temp.ok('Exam recipients: the section''s students, opted-out one left out',
    (v_r ->> 'students')::int = 2 and jsonb_array_length(v_r -> 'emails') = 1, v_r::text);
  perform public.mark_exam_notified(v_exam);
  perform pg_temp.act_as_owner();
  select notified_at is not null into v_bool from public.exams where id = v_exam;
  perform pg_temp.act_as(v_inst);
  perform pg_temp.ok('"New exam" email is recorded', coalesce(v_bool, false), null);

  -- reminders
  perform pg_temp.act_as_owner();
  delete from public.app_settings where key = 'cron_secret';
  insert into public.app_settings (key, value) values ('cron_secret', 'test-secret-123456');
  update public.exams set opens_at = now() + interval '20 hours', closes_at = now() + interval '30 hours',
                          notified_at = null, reminded_at = null where id = v_exam;
  insert into public.exams (course_id, title, time_limit_minutes, created_by, opens_at)
    values (v_course, 'Opens in 3 days', 30, v_inst, now() + interval '3 days') returning id into v_exam3;
  insert into public.exam_items values (v_exam3, v_ident, 1);
  insert into public.exam_sections values (v_exam3, v_secA);
  update public.exams set status = 'published' where id = v_exam3;
  -- exam2: published email already went out inside the 24 h window, so no separate reminder
  update public.exams set opens_at = now() + interval '10 hours', notified_at = now() where id = v_exam2;

  perform pg_temp.act_as_anon();
  perform pg_temp.fails('Reminder job refuses a wrong secret', 'select public.claim_exam_reminders(''nope'')', 'Not allowed');
  perform pg_temp.fails('Reminder job refuses an empty secret', 'select public.claim_exam_reminders('''')', 'Not allowed');
  perform pg_temp.fails('Nobody can read the secret table', 'select * from public.app_settings', 'permission denied');
  v_r := public.claim_exam_reminders('test-secret-123456');
  perform pg_temp.ok('Reminder job returns only the exam opening within 24 h that hasn''t been mailed',
    jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'title' = 'Checker exam' and v_r -> 0 ->> 'course_code' = 'SMKCM', v_r::text);
  perform pg_temp.ok('...with the emails of students who want them',
    jsonb_array_length(v_r -> 0 -> 'emails') = 1 and v_r -> 0 -> 'emails' ->> 0 = 'smokecm.s1@example.invalid', v_r -> 0 ->> 'emails');
  v_r := public.claim_exam_reminders('test-secret-123456');
  perform pg_temp.ok('The next run sends nothing again', jsonb_array_length(v_r) = 0, v_r::text);
  perform pg_temp.act_as(v_s1);
  perform pg_temp.fails('A signed-in student without the secret can''t use it either',
    'select public.claim_exam_reminders(''guess'')', 'Not allowed');

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
delete from auth.users where email like 'smokecm.%@example.invalid';
select test, result, detail from smoke_results order by n;
