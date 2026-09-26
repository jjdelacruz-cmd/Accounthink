-- Phases 4–6 smoke test: randomization, access code, sessions/devices, integrity
-- events, leave limit, live monitor. Paste into Supabase SQL Editor and Run (after 0004).
-- Creates throwaway data and deletes everything it made.

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
  v_st    uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_course uuid;
  v_sec uuid;
  v_items uuid[] := '{}';
  v_mcq uuid;
  v_exam uuid;       -- shuffled
  v_exam_plain uuid; -- not shuffled
  v_exam_code uuid;  -- access code + leave limit
  v_attempts uuid[] := '{}';
  v_a uuid; v_b uuid;
  v_tok uuid; v_tok2 uuid; v_tok3 uuid;
  v_code text;
  v_r jsonb;
  v_n int;
  v_txt text;
  v_ts timestamptz;
  v_ts2 timestamptz;
  i int;
begin

  -- ---------- setup ----------
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smoke46.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke46.inst2@example.invalid', '{"full_name":"Other Instructor"}');
  for i in 1 .. 6 loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_st[i], 'smoke46.s' || i || '@example.invalid', jsonb_build_object('full_name', 'Smoke, S' || i, 'student_no', '00' || i));
  end loop;
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMK460', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'SMK-A') returning id into v_sec;
  for i in 1 .. 6 loop
    insert into public.section_members values (v_sec, v_st[i]);
  end loop;

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"},{"key":"C","text":"Expense"},{"key":"D","text":"Dividends"},{"key":"E","text":"None of the above"}]'::jsonb),
    '{"correct":"B"}');
  v_items := v_items || v_mcq;
  for i in 1 .. 9 loop
    v_items := v_items || public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
      'stem', 'Question ' || i), jsonb_build_object('accepted', jsonb_build_array('answer ' || i)));
  end loop;

  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices)
    values (v_course, 'Shuffled', 30, v_inst, true, true) returning id into v_exam;
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices)
    values (v_course, 'Plain', 30, v_inst, false, false) returning id into v_exam_plain;
  insert into public.exams (course_id, title, time_limit_minutes, created_by, require_access_code, leave_limit)
    values (v_course, 'Coded', 30, v_inst, true, 3) returning id into v_exam_code;
  for i in 1 .. 10 loop
    insert into public.exam_items values (v_exam, v_items[i], i), (v_exam_plain, v_items[i], i);
  end loop;
  insert into public.exam_items values (v_exam_code, v_mcq, 1), (v_exam_code, v_items[2], 2);
  insert into public.exam_sections values (v_exam, v_sec), (v_exam_plain, v_sec), (v_exam_code, v_sec);
  update public.exams set status = 'published' where id in (v_exam, v_exam_plain, v_exam_code);
  perform pg_temp.act_as_owner();

  -- ---------- randomization ----------
  for i in 1 .. 5 loop
    perform pg_temp.act_as(v_st[i]);
    v_attempts := v_attempts || public.start_attempt(v_exam);
    perform pg_temp.act_as_owner();
  end loop;

  select count(*) into v_n from public.attempts a
   where a.id = any (v_attempts)
     and (select array_agg(x order by x) from unnest(a.item_order) x) = (select array_agg(x order by x) from unnest(v_items) x);
  perform pg_temp.ok('Every student gets all 10 questions exactly once', v_n = 5, v_n || ' of 5');

  select count(distinct item_order) into v_n from public.attempts where id = any (v_attempts);
  perform pg_temp.ok('Question order differs between students', v_n >= 4, v_n || ' distinct orders among 5');

  select count(distinct choice_orders -> v_mcq::text) into v_n from public.attempts where id = any (v_attempts);
  perform pg_temp.ok('Choice order differs between students', v_n >= 2, v_n || ' distinct choice orders among 5');

  select count(*) into v_n from public.attempts
   where id = any (v_attempts) and choice_orders -> v_mcq::text ->> 4 = 'E'
     and (select count(*) from jsonb_array_elements_text(choice_orders -> v_mcq::text)) = 5;
  perform pg_temp.ok('"None of the above" always stays last', v_n = 5, v_n || ' of 5');

  -- Student 1 answers the MC by its key; shuffled display must not affect grading.
  v_a := v_attempts[1];
  perform pg_temp.act_as(v_st[1]);
  v_tok := (public.claim_attempt(v_a, '{"hash":"s1-phone","label":"S1 phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  select ord - 1 into v_n from public.attempts a, unnest(a.item_order) with ordinality t(x, ord) where a.id = v_a and x = v_mcq;
  perform pg_temp.act_as(v_st[1]);
  v_r := public.attempt_question(v_a, v_tok, v_n);
  perform pg_temp.act_as_owner();
  select string_agg(c ->> 'key', '' order by ord) into v_txt from jsonb_array_elements(v_r -> 'choices') with ordinality t(c, ord);
  perform pg_temp.ok('Question shows choices in this student''s shuffled order',
    v_txt = (select string_agg(k, '' order by ord) from public.attempts a,
             jsonb_array_elements_text(a.choice_orders -> v_mcq::text) with ordinality t(k, ord) where a.id = v_a),
    v_txt);
  perform pg_temp.act_as(v_st[1]);
  perform public.save_response(v_a, v_tok, v_n, '{"choice":"B"}');
  v_r := public.submit_attempt(v_a, v_tok);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Shuffled MC is graded by the choice, not its position', (v_r ->> 'score')::numeric = 1, v_r ->> 'score');

  perform pg_temp.act_as(v_st[1]);
  v_b := public.start_attempt(v_exam_plain);
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.attempts where id = v_b and item_order = v_items and choice_orders = '{}'::jsonb;
  perform pg_temp.ok('With shuffling off, everyone gets the instructor''s order', v_n = 1);

  perform pg_temp.act_as(v_st[1]);
  v_tok := (public.claim_attempt(v_b, '{"hash":"s1-phone","label":"S1 phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  begin
    perform pg_temp.act_as(v_st[1]);
    v_r := public.attempt_question(v_b, v_tok, null);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Empty question number is rejected', false, 'returned');
  exception when others then
    perform pg_temp.ok('Empty question number is rejected', sqlerrm = 'No such question', sqlerrm);
  end;

  -- ---------- sessions ----------
  v_a := v_attempts[2];
  perform pg_temp.act_as(v_st[2]);
  v_tok := (public.claim_attempt(v_a, '{"hash":"s2-phone","label":"S2 phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  begin
    perform pg_temp.act_as(v_st[2]);
    perform public.save_response(v_a, gen_random_uuid(), 0, '{"text":"x"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Calls without the session token are refused', false, 'saved');
  exception when others then
    perform pg_temp.ok('Calls without the session token are refused', sqlerrm = 'This exam was opened on another device', sqlerrm);
  end;

  -- Page reload in the same tab (passes its previous token): not flagged.
  perform pg_temp.act_as(v_st[2]);
  v_tok := (public.claim_attempt(v_a, '{"hash":"s2-phone","label":"S2 phone"}', null, v_tok) ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.integrity_events where attempt_id = v_a;
  perform pg_temp.ok('Reloading the page is not flagged', v_n = 0, v_n || ' events');

  -- Second tab on the same phone: takes over and is flagged; old tab is locked out.
  perform pg_temp.act_as(v_st[2]);
  v_tok2 := (public.claim_attempt(v_a, '{"hash":"s2-phone","label":"S2 phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.integrity_events where attempt_id = v_a and kind = 'session_takeover';
  perform pg_temp.ok('Opening a second tab is flagged', v_n = 1, v_n || ' events');
  begin
    perform pg_temp.act_as(v_st[2]);
    perform public.attempt_ping(v_a, v_tok);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('The first tab is locked out', false, 'still works');
  exception when others then
    perform pg_temp.ok('The first tab is locked out', true, sqlerrm);
  end;

  -- Different device: allowed (no code on this exam) but flagged.
  perform pg_temp.act_as(v_st[2]);
  v_tok3 := (public.claim_attempt(v_a, '{"hash":"laptop","label":"Windows laptop"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.integrity_events where attempt_id = v_a and kind = 'device_changed';
  perform pg_temp.ok('Switching to another device is flagged', v_n = 1, v_n || ' events');

  begin
    perform pg_temp.act_as(v_st[3]);
    v_r := public.claim_attempt(v_a, '{"hash":"x","label":"x"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Another student cannot claim my attempt', false, 'claimed');
  exception when others then
    perform pg_temp.ok('Another student cannot claim my attempt', true, sqlerrm);
  end;

  -- ---------- integrity events ----------
  perform pg_temp.act_as(v_st[2]);
  v_r := public.log_integrity_events(v_a, v_tok3, '[
    {"kind":"left_app","detail":{"at":"t1"}},
    {"kind":"returned","detail":{"away_seconds":12}},
    {"kind":"paste","detail":{}},
    {"kind":"left_app"},
    {"kind":"returned","detail":{"away_seconds":30}},
    {"kind":"device_changed"},
    {"kind":"totally_fake"}]');
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.integrity_events where attempt_id = v_a and kind in ('left_app', 'returned', 'paste');
  perform pg_temp.ok('Leave/return/paste events are recorded', v_n = 5, v_n || ' of 5');
  select count(*) into v_n from public.integrity_events where attempt_id = v_a and kind = 'device_changed';
  perform pg_temp.ok('Students cannot fake server-only or unknown events', v_n = 1, v_n || ' device events (expected 1)');

  begin
    perform pg_temp.act_as(v_st[2]);
    insert into public.integrity_events (attempt_id, kind) values (v_a, 'returned');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Students cannot write events directly', false, 'inserted');
  exception when others then
    perform pg_temp.ok('Students cannot write events directly', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_st[2]);
  select count(*) into v_n from public.integrity_events;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Students cannot read the event log', v_n = 0, 'saw ' || v_n);

  -- ---------- access code ----------
  begin
    perform pg_temp.act_as(v_st[4]);
    v_b := public.start_attempt(v_exam_code);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Coded exam cannot start without the code', false, 'started');
  exception when others then
    perform pg_temp.ok('Coded exam cannot start without the code', sqlerrm = 'Wrong or expired access code', sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[4]);
    v_b := public.start_attempt(v_exam_code, '000000x');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Wrong code is rejected', false, 'started');
  exception when others then
    perform pg_temp.ok('Wrong code is rejected', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[4]);
    v_r := public.current_access_code(v_exam_code);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Students cannot get the access code', false, 'got it');
  exception when others then
    perform pg_temp.ok('Students cannot get the access code', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[4]);
    select access_secret::text into v_txt from public.exams where id = v_exam_code;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Students cannot read the code secret', false, 'read it');
  exception when others then
    perform pg_temp.ok('Students cannot read the code secret', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_st[4]);
  select title into v_txt from public.exams where id = v_exam_code;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Students can still read exam details (title, times)', v_txt = 'Coded', v_txt);

  perform pg_temp.act_as(v_inst);
  select title into v_txt from public.exams where id = v_exam_code;
  v_code := public.current_access_code(v_exam_code) ->> 'code';
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Instructor gets a 6-digit code', v_code ~ '^\d{6}$', v_code);

  perform pg_temp.act_as(v_st[4]);
  v_b := public.start_attempt(v_exam_code, v_code);
  v_tok := (public.claim_attempt(v_b, '{"hash":"s4-phone","label":"S4 phone"}') ->> 'token')::uuid;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Correct code starts the exam', v_b is not null and v_tok is not null);

  perform pg_temp.act_as(v_st[4]);
  v_r := public.claim_attempt(v_b, '{"hash":"friend-phone","label":"Other phone"}');
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Continuing on another device needs the code', (v_r ->> 'needs_code')::boolean, v_r::text);

  perform pg_temp.act_as(v_st[4]);
  v_r := public.claim_attempt(v_b, '{"hash":"friend-phone","label":"Other phone"}', '12345x');
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.integrity_events where attempt_id = v_b and kind = 'code_failed';
  perform pg_temp.ok('A wrong code from another device is logged', (v_r ->> 'needs_code')::boolean and v_n = 1, v_n || ' events');

  -- ---------- leave limit (3) ----------
  perform pg_temp.act_as(v_st[4]);
  v_r := public.log_integrity_events(v_b, v_tok, '[{"kind":"left_app"},{"kind":"returned","detail":{"away_seconds":3}},{"kind":"left_app"}]');
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Below the leave limit the exam continues', not (v_r ->> 'ended')::boolean, v_r::text);
  perform pg_temp.act_as(v_st[4]);
  v_r := public.log_integrity_events(v_b, v_tok, '[{"kind":"left_app"}]');
  perform pg_temp.act_as_owner();
  select end_reason into v_txt from public.attempts where id = v_b;
  perform pg_temp.ok('Reaching the leave limit auto-submits', (v_r ->> 'ended')::boolean and v_txt = 'leave_limit', v_txt);

  -- ---------- monitor + controls ----------
  perform pg_temp.act_as(v_inst);
  v_r := public.exam_monitor(v_exam);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Monitor lists every enrolled student (incl. not started)',
    jsonb_array_length(v_r -> 'students') = 6, jsonb_array_length(v_r -> 'students')::text);
  select (s -> 'attempt' ->> 'leaves')::int into v_n from jsonb_array_elements(v_r -> 'students') s
   where s ->> 'student_id' = v_st[2]::text;
  perform pg_temp.ok('Monitor shows leave count', v_n = 2, v_n::text);
  select (s -> 'attempt' ->> 'away_seconds')::int into v_n from jsonb_array_elements(v_r -> 'students') s
   where s ->> 'student_id' = v_st[2]::text;
  perform pg_temp.ok('Monitor shows total time away', v_n = 42, v_n || ' s');
  select (s -> 'attempt' ->> 'device_flags')::int into v_n from jsonb_array_elements(v_r -> 'students') s
   where s ->> 'student_id' = v_st[2]::text;
  perform pg_temp.ok('Monitor shows device/session flags', v_n = 2, v_n::text);
  select count(*) into v_n from jsonb_array_elements(v_r -> 'students') s where s -> 'attempt' = 'null'::jsonb;
  perform pg_temp.ok('Monitor shows who has not started', v_n = 1, v_n::text);

  begin
    perform pg_temp.act_as(v_inst2);
    v_r := public.exam_monitor(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot open the monitor', false, 'opened');
  exception when others then
    perform pg_temp.ok('Other instructor cannot open the monitor', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[2]);
    v_r := public.exam_monitor(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot open the monitor', false, 'opened');
  exception when others then
    perform pg_temp.ok('Student cannot open the monitor', true, sqlerrm);
  end;

  v_a := v_attempts[2];
  select deadline_at into v_ts from public.attempts where id = v_a;
  perform pg_temp.act_as(v_inst);
  v_ts2 := public.extend_attempt(v_a, 5);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Instructor can add 5 minutes', v_ts2 = v_ts + interval '5 minutes', (v_ts2 - v_ts)::text);
  perform pg_temp.act_as(v_st[2]);
  v_r := public.attempt_ping(v_a, v_tok3);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student''s screen receives the new deadline', (v_r ->> 'deadline_at')::timestamptz = v_ts2);

  begin
    perform pg_temp.act_as(v_st[2]);
    perform public.extend_attempt(v_a, 60);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot extend their own time', false, 'extended');
  exception when others then
    perform pg_temp.ok('Student cannot extend their own time', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_inst);
  perform public.end_attempt(v_attempts[3]);
  perform pg_temp.act_as_owner();
  select end_reason into v_txt from public.attempts where id = v_attempts[3];
  perform pg_temp.ok('Instructor can end a student''s attempt', v_txt = 'instructor', v_txt);

  select count(*) into v_n from (values
    (to_regprocedure('public.save_response(uuid,int,jsonb)')),
    (to_regprocedure('public.attempt_question(uuid,int)')),
    (to_regprocedure('public.attempt_state(uuid)')),
    (to_regprocedure('public.submit_attempt(uuid)'))) t(f) where f is not null;
  perform pg_temp.ok('Old token-less student functions are removed', v_n = 0, v_n || ' remain');

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smoke46.%@example.invalid';
select test, result, detail from smoke_results order by n;
