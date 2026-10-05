-- Student feedback smoke test. Paste into Supabase SQL Editor and Run (after 0009).
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
  v_inst uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();   -- submits
  v_s2 uuid := gen_random_uuid();   -- starts, doesn't submit
  v_s3 uuid := gen_random_uuid();   -- not in the section
  v_course uuid; v_sec uuid; v_exam uuid;
  v_mcq uuid; v_ident uuid; v_enum uuid;
  v_a uuid; v_tok uuid;
  v_r jsonb; v_it jsonb; v_txt text; v_seen text; v_bool boolean;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst, 'smokefb.inst@example.invalid', '{"full_name":"Smoke Instructor"}'),
    (v_s1,   'smokefb.s1@example.invalid',   '{"full_name":"Smoke, One"}'),
    (v_s2,   'smokefb.s2@example.invalid',   '{"full_name":"Smoke, Two"}'),
    (v_s3,   'smokefb.s3@example.invalid',   '{"full_name":"Smoke, Three"}');
  update public.profiles set role = 'instructor' where id = v_inst;
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKFB', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'SMKFB-A') returning id into v_sec;
  insert into public.section_members values (v_sec, v_s1), (v_sec, v_s2);

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"},{"key":"C","text":"Expense"},{"key":"D","text":"Capital"}]'::jsonb),
    '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Continuing entity assumption.'), '{"accepted":["Going concern"]}');
  v_enum := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'enumeration',
    'stem', 'Two current assets.', 'points', 2), '{"answers":[["Cash"],["Receivables"]],"any_order":true}');
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices)
    values (v_course, 'Feedback test', 30, v_inst, false, true) returning id into v_exam;
  insert into public.exam_items values (v_exam, v_mcq, 1), (v_exam, v_ident, 2), (v_exam, v_enum, 3);
  insert into public.exam_sections values (v_exam, v_sec);
  update public.exams set status = 'published' where id = v_exam;
  select feedback || '/' || feedback_after_close into v_txt from public.exams where id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('New exams default to answers, after the exam closes', v_txt = 'answers/true', v_txt);

  -- s1: MC right, identification wrong, enumeration half.
  perform pg_temp.act_as(v_s1);
  v_a := public.start_attempt(v_exam);
  v_tok := (public.claim_attempt(v_a, '{"hash":"d1","label":"Phone"}') ->> 'token')::uuid;
  perform public.save_response(v_a, v_tok, 0, '{"choice":"B"}');
  perform public.save_response(v_a, v_tok, 1, '{"text":"Accrual"}');
  perform public.save_response(v_a, v_tok, 2, '{"items":["Cash","Land"]}');
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('Before submitting: nothing shown', v_r ->> 'status' = 'not_submitted' and v_r -> 'items' is null, v_r::text);
  perform public.submit_attempt(v_a, v_tok);

  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('While the exam is open: held until it closes', v_r ->> 'status' = 'after_close' and v_r -> 'items' is null, v_r::text);

  -- s2 starts but hasn't submitted.
  perform pg_temp.act_as(v_s2);
  perform public.start_attempt(v_exam);
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('Unsubmitted student gets nothing', v_r ->> 'status' = 'not_submitted' and v_r -> 'items' is null, v_r::text);

  -- Release right after submitting.
  perform pg_temp.act_as(v_inst);
  update public.exams set feedback_after_close = false where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('"Right after submitting": shown while the exam is still open',
    v_r ->> 'status' = 'ready' and jsonb_array_length(v_r -> 'items') = 3, v_r ->> 'status');
  perform pg_temp.ok('Marks per question: 1/1, 0/1, 1/2',
    (v_r -> 'items' -> 0 ->> 'points_awarded')::numeric = 1 and (v_r -> 'items' -> 1 ->> 'points_awarded')::numeric = 0
    and (v_r -> 'items' -> 2 ->> 'points_awarded')::numeric = 1 and (v_r -> 'items' -> 2 ->> 'points')::numeric = 2,
    (v_r -> 'items')::text);
  v_it := v_r -> 'items' -> 0;
  select string_agg(c ->> 'key', '' order by o) into v_txt from jsonb_array_elements(v_it -> 'choices') with ordinality x(c, o);
  perform pg_temp.act_as_owner();
  select string_agg(k, '' order by o) into v_seen
    from public.attempts a, jsonb_array_elements_text(a.choice_orders -> v_mcq::text) with ordinality y(k, o)
   where a.exam_id = v_exam and a.student_id = v_s1;
  perform pg_temp.act_as(v_s1);
  perform pg_temp.ok('Choices come in the order the student saw them', v_txt = v_seen, v_txt || ' vs ' || v_seen);
  select string_agg(c ->> 'key', '') into v_txt from jsonb_array_elements(v_it -> 'choices') c where (c ->> 'is_key')::boolean;
  perform pg_temp.ok('Answers mode: correct choice and keys shown',
    v_txt = 'B' and v_it -> 'answer' ->> 'choice' = 'B'
    and v_r -> 'items' -> 1 -> 'key' -> 'accepted' ->> 0 = 'Going concern'
    and (v_r ->> 'show_answers')::boolean, v_txt);

  -- Right/wrong only.
  perform pg_temp.act_as(v_inst);
  update public.exams set feedback = 'marks' where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.my_exam_feedback(v_exam);
  select bool_or(c ? 'is_key' and c -> 'is_key' <> 'null'::jsonb) into v_bool
    from jsonb_array_elements(v_r -> 'items' -> 0 -> 'choices') c;
  perform pg_temp.ok('Right/wrong mode: no answer key anywhere',
    v_r ->> 'status' = 'ready' and not (v_r ->> 'show_answers')::boolean and not v_bool
    and v_r -> 'items' -> 1 -> 'key' = 'null'::jsonb and v_r -> 'items' -> 2 -> 'key' = 'null'::jsonb
    and v_r::text not like '%Going concern%' and v_r::text not like '%Receivables%', left(v_r::text, 200));

  -- Off.
  perform pg_temp.act_as(v_inst);
  update public.exams set feedback = 'off' where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('Off: nothing shown', v_r ->> 'status' = 'off' and v_r -> 'items' is null, v_r::text);

  -- After close, with answers.
  perform pg_temp.act_as(v_inst);
  update public.exams set feedback = 'answers', feedback_after_close = true where id = v_exam;
  update public.exams set status = 'closed' where id = v_exam;
  perform pg_temp.act_as(v_s1);
  v_r := public.my_exam_feedback(v_exam);
  perform pg_temp.ok('"After the exam closes": shown once closed',
    v_r ->> 'status' = 'ready' and jsonb_array_length(v_r -> 'items') = 3, v_r ->> 'status');

  -- Outsider.
  begin
    perform pg_temp.act_as(v_s3);
    v_r := public.my_exam_feedback(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student not in the section is refused', false, v_r::text);
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student not in the section is refused', true, sqlerrm);
  end;

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smokefb.%@example.invalid';
select test, result, detail from smoke_results order by n;
