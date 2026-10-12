-- Essays, manual checking and camera warnings smoke test.
-- Paste into Supabase SQL Editor and Run (after 0010). Creates throwaway data and deletes everything it made.

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
-- Records a result as the owner, then goes back to acting as whoever was acting before.
create or replace function pg_temp.ok(p_test text, p_pass boolean, p_detail text default null) returns void language plpgsql as $f$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail) values (p_test, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
  if coalesce(v_sub, '') <> '' then perform pg_temp.act_as(v_sub::uuid); end if;
end $f$;

do $test$
declare
  v_abort_ctx text;
  v_inst  uuid := gen_random_uuid();
  v_inst2 uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();
  v_s2 uuid := gen_random_uuid();
  v_course uuid; v_sec uuid; v_exam uuid;
  v_mcq uuid; v_ident uuid; v_essay uuid;
  v_a1 uuid; v_a2 uuid; v_tok uuid;
  v_r jsonb; v_num numeric; v_txt text; v_bool boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smokemc.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smokemc.inst2@example.invalid', '{"full_name":"Other Instructor"}'),
    (v_s1,    'smokemc.s1@example.invalid',    '{"full_name":"Smoke, One"}'),
    (v_s2,    'smokemc.s2@example.invalid',    '{"full_name":"Smoke, Two"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKMC', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'SMKMC-A') returning id into v_sec;
  insert into public.section_members values (v_sec, v_s1), (v_sec, v_s2);

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"}]'::jsonb), '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Continuing entity assumption.'), '{"accepted":["Going concern"]}');
  v_essay := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'essay', 'points', 5,
    'stem', 'Explain the going concern assumption.'), '{"guide":"Entity continues; assets at cost"}');
  perform pg_temp.ok('Essay question can be saved with 5 points and a guide',
    (select type::text = 'essay' and points = 5 from public.items where id = v_essay), null);

  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices, require_camera)
    values (v_course, 'Checking test', 30, v_inst, false, false, true) returning id into v_exam;
  insert into public.exam_items values (v_exam, v_mcq, 1), (v_exam, v_ident, 2), (v_exam, v_essay, 3);
  insert into public.exam_sections values (v_exam, v_sec);
  update public.exams set status = 'published' where id = v_exam;

  -- s1: MC right, identification "GC" (wrong by the key), a long essay.
  perform pg_temp.act_as(v_s1);
  v_a1 := public.start_attempt(v_exam);
  v_tok := (public.claim_attempt(v_a1, '{"hash":"d1","label":"Phone"}') ->> 'token')::uuid;
  v_r := public.attempt_state(v_a1, v_tok);
  perform pg_temp.ok('Exam screen knows the camera is required', (v_r ->> 'require_camera')::boolean, v_r ->> 'require_camera');
  v_r := public.attempt_question(v_a1, v_tok, 2);
  perform pg_temp.ok('Essay is served without a key', v_r ->> 'type' = 'essay' and not (v_r ? 'key'), v_r::text);
  perform public.save_response(v_a1, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a1, v_tok, 1, '{"text":"GC"}');
  perform public.save_response(v_a1, v_tok, 2, jsonb_build_object('text', repeat('The entity will continue. ', 200)));
  perform pg_temp.act_as_owner();
  select length(answer ->> 'text') into v_num from public.responses where attempt_id = v_a1 and item_id = v_essay;
  perform pg_temp.act_as(v_s1);
  perform pg_temp.ok('Long essay (5,200 characters) is saved in full', v_num = 5200, v_num::text);
  perform public.log_integrity_events(v_a1, v_tok,
    '[{"kind":"cam_away","detail":{"phase":"start"}},{"kind":"cam_away","detail":{"phase":"end","seconds":6}},
      {"kind":"cam_no_face","detail":{"phase":"start"}},{"kind":"cam_no_face","detail":{"phase":"end","seconds":4}},
      {"kind":"cam_bogus"}]');
  perform public.submit_attempt(v_a1, v_tok);

  -- s2: leaves the essay blank.
  perform pg_temp.act_as(v_s2);
  v_a2 := public.start_attempt(v_exam);
  v_tok := (public.claim_attempt(v_a2, '{"hash":"d2","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a2, v_tok, 0, '{"choice":"A"}');
  perform public.save_response(v_a2, v_tok, 2, '{"text":"   "}');
  perform public.submit_attempt(v_a2, v_tok);
  perform pg_temp.act_as_owner();

  select score::text || '/' || max_score::text into v_txt from public.attempts where id = v_a1;
  perform pg_temp.ok('Essay is not auto-graded: score 1/7 for now', v_txt = '1.00/7.00', v_txt);
  select points_awarded is null into v_bool from public.responses where attempt_id = v_a1 and item_id = v_essay;
  perform pg_temp.ok('Written essay waits for checking', v_bool, null);
  select points_awarded::text into v_txt from public.responses where attempt_id = v_a2 and item_id = v_essay;
  perform pg_temp.ok('Blank essay gets 0 and needs no checking', v_txt = '0.00', v_txt);

  perform pg_temp.act_as(v_s1);
  v_r := public.student_exam_info(v_exam);
  perform pg_temp.ok('Student sees 1 answer still being checked', (v_r -> 'attempt' ->> 'pending')::int = 1,
    v_r ->> 'attempt');

  -- Instructor: what needs checking
  perform pg_temp.act_as(v_inst);
  v_r := public.exam_check_summary(v_exam);
  perform pg_temp.ok('Check list: identification and essay (not MC), essay has 1 to check',
    jsonb_array_length(v_r) = 2 and v_r -> 1 ->> 'type' = 'essay' and (v_r -> 1 ->> 'pending')::int = 1
    and (v_r -> 1 ->> 'answered')::int = 1, v_r::text);
  v_r := public.exam_check_item(v_exam, v_essay);
  perform pg_temp.ok('Answers to check come first, with the guide',
    v_r -> 'answers' -> 0 ->> 'full_name' = 'Smoke, One' and v_r -> 'answers' -> 0 -> 'points_awarded' = 'null'::jsonb
    and v_r -> 'item' -> 'key' ->> 'guide' like 'Entity%', left(v_r::text, 200));

  v_r := public.set_response_score(v_a1, v_essay, 4, 'Good, but mention asset valuation.');
  perform pg_temp.ok('Scoring the essay 4/5 updates the total to 5/7, nothing pending',
    (v_r ->> 'score')::numeric = 5 and (v_r ->> 'pending')::int = 0, v_r::text);

  v_r := public.set_response_score(v_a1, v_ident, 1, null);
  perform pg_temp.ok('Accepting a wrong identification by hand: 6/7', (v_r ->> 'score')::numeric = 6, v_r::text);

  perform public.regrade_exam(v_exam);
  select score into v_num from public.attempts where id = v_a1;
  perform pg_temp.ok('Re-grade keeps scores set by hand', v_num = 6, v_num::text);

  v_r := public.set_response_score(v_a1, v_ident, null, null);
  perform pg_temp.ok('Clearing the hand score goes back to the key: 5/7', (v_r ->> 'score')::numeric = 5, v_r::text);

  v_r := public.set_response_score(v_a2, v_ident, 0.5, 'Half credit');
  perform pg_temp.ok('Can score a question the student skipped', (v_r ->> 'score')::numeric = 0.5, v_r::text);

  begin
    perform public.set_response_score(v_a1, v_essay, 6, null);
    perform pg_temp.ok('More than the question''s points is refused', false, 'accepted');
  exception when others then
    perform pg_temp.ok('More than the question''s points is refused', sqlerrm like 'Score must be from 0 to%', sqlerrm);
  end;
  begin
    perform public.set_response_score(v_a1, v_mcq, 0, null);
    perform pg_temp.ok('Multiple choice can''t be scored by hand', false, 'accepted');
  exception when others then
    perform pg_temp.ok('Multiple choice can''t be scored by hand', true, sqlerrm);
  end;
  perform pg_temp.act_as(v_inst2);
  begin
    perform public.set_response_score(v_a1, v_essay, 5, null);
    perform pg_temp.ok('Another instructor can''t score it', false, 'accepted');
  exception when others then
    perform pg_temp.ok('Another instructor can''t score it', true, sqlerrm);
  end;
  perform pg_temp.act_as(v_s1);
  begin
    perform public.set_response_score(v_a1, v_essay, 5, null);
    perform pg_temp.ok('Student can''t score their own answer', false, 'accepted');
  exception when others then
    perform pg_temp.ok('Student can''t score their own answer', true, sqlerrm);
  end;
  begin
    perform public.exam_check_item(v_exam, v_essay);
    perform pg_temp.ok('Student can''t open the checking list (it has keys and classmates)', false, 'opened');
  exception when others then
    perform pg_temp.ok('Student can''t open the checking list (it has keys and classmates)', true, sqlerrm);
  end;

  -- Student feedback shows the comment
  perform pg_temp.act_as(v_inst);
  update public.exams set feedback_after_close = false where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('Student feedback shows the essay score and the comment',
    (v_r -> 'items' -> 2 ->> 'points_awarded')::numeric = 4
    and v_r -> 'items' -> 2 ->> 'comment' = 'Good, but mention asset valuation.', left(v_r -> 'items' ->> 2, 200));

  -- Camera warnings on the monitor
  perform pg_temp.act_as(v_inst);
  v_r := public.exam_monitor(v_exam);
  select x -> 'attempt' into v_r from jsonb_array_elements(v_r -> 'students') x where x ->> 'full_name' = 'Smoke, One';
  perform pg_temp.ok('Monitor counts 2 camera warnings, 10 s, unknown kinds dropped',
    (v_r ->> 'camera')::int = 2 and (v_r ->> 'camera_seconds')::int = 10
    and v_r -> 'camera_kinds' = '{"cam_away":1,"cam_no_face":1}'::jsonb, v_r::text);

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

-- Remove the attempts first so deleting the instructor's account has no answer rows left to update
-- (the SQL Editor runs a whole script as one transaction, which would otherwise trip a foreign key).
delete from public.attempts where student_id in (select id from auth.users where email like 'smokemc.%@example.invalid');
delete from auth.users where email like 'smokemc.%@example.invalid';
select test, result, detail from smoke_results order by n;
