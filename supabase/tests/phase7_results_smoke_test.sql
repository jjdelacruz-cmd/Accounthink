-- Phase 7 smoke test: item analysis, review, re-grade, accept answer.
-- Paste into Supabase SQL Editor and Run (after 0006). Deletes everything it made.

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
  v_st uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                       gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- answers per student: MC choice, identification text, enumeration items
  v_mc text[] := array['B', 'B', 'B', 'C', 'C', 'A'];
  v_id text[] := array['going concern', 'Going Concern.', 'GC concept', 'gc concept', 'wrong', null];
  v_en jsonb[] := array['["Cash","Receivables"]', '["Cash","x"]', '["Cash"]', '[]', '["cash"]', '[]']::jsonb[];
  v_course uuid; v_sec uuid; v_exam uuid;
  v_mcq uuid; v_ident uuid; v_enum uuid;
  v_att uuid[] := '{}';
  v_a uuid; v_tok uuid;
  v_r jsonb; v_item jsonb;
  v_n int; v_num numeric; v_txt text;
  i int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smoke7.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke7.inst2@example.invalid', '{"full_name":"Other Instructor"}');
  for i in 1 .. 6 loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (v_st[i], 'smoke7.s' || i || '@example.invalid', jsonb_build_object('full_name', 'Smoke, S' || i));
  end loop;
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMK700', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'SMK-A') returning id into v_sec;
  for i in 1 .. 6 loop insert into public.section_members values (v_sec, v_st[i]); end loop;

  perform pg_temp.act_as(v_inst);
  v_mcq := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"},{"key":"C","text":"Expense"}]'::jsonb), '{"correct":"B"}');
  v_ident := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification',
    'stem', 'Continuing entity assumption.'), '{"accepted":["Going concern"]}');
  v_enum := public.save_item(jsonb_build_object('course_id', v_course, 'type', 'enumeration',
    'stem', 'Two current assets.', 'points', 2), '{"answers":[["Cash"],["Receivables"]],"any_order":true}');
  insert into public.exams (course_id, title, time_limit_minutes, created_by, shuffle_items, shuffle_choices)
    values (v_course, 'Results test', 30, v_inst, false, false) returning id into v_exam;
  insert into public.exam_items values (v_exam, v_mcq, 1), (v_exam, v_ident, 2), (v_exam, v_enum, 3);
  insert into public.exam_sections values (v_exam, v_sec);
  update public.exams set status = 'published' where id = v_exam;
  perform pg_temp.act_as_owner();

  -- Six students take it.
  for i in 1 .. 6 loop
    perform pg_temp.act_as(v_st[i]);
    v_a := public.start_attempt(v_exam);
    v_tok := (public.claim_attempt(v_a, jsonb_build_object('hash', 'dev' || i, 'label', 'Phone')) ->> 'token')::uuid;
    perform public.save_response(v_a, v_tok, 0, jsonb_build_object('choice', v_mc[i]));
    if v_id[i] is not null then
      perform public.save_response(v_a, v_tok, 1, jsonb_build_object('text', v_id[i]));
    end if;
    perform public.save_response(v_a, v_tok, 2, jsonb_build_object('items', v_en[i]));
    perform public.submit_attempt(v_a, v_tok);
    perform pg_temp.act_as_owner();
    v_att := v_att || v_a;
    perform pg_sleep(0.01);  -- distinct submit times for tie-breaks
  end loop;

  select string_agg(score::int::text, ',' order by array_position(v_att, id)) into v_txt
    from public.attempts where id = any (v_att);
  perform pg_temp.ok('Scores as expected (4,3,2,0,1,0)', v_txt = '4,3,2,0,1,0', v_txt);

  -- ---------- item analysis ----------
  perform pg_temp.act_as(v_inst);
  v_r := public.exam_item_analysis(v_exam);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Analysis covers 6 submissions, groups of 2', (v_r ->> 'submitted')::int = 6 and (v_r ->> 'group_size')::int = 2,
    (v_r ->> 'submitted') || ' / ' || (v_r ->> 'group_size'));

  v_item := v_r -> 'items' -> 0;
  perform pg_temp.ok('MC: 50% correct', (v_item ->> 'p')::numeric = 0.5, v_item ->> 'p');
  perform pg_temp.ok('MC: discrimination 1.00 (top 2 right, bottom 2 wrong)', (v_item ->> 'd')::numeric = 1, v_item ->> 'd');
  perform pg_temp.ok('MC: choice counts A1 B3 C2', v_item -> 'choice_counts' = '{"A":1,"B":3,"C":2}'::jsonb, v_item ->> 'choice_counts');

  v_item := v_r -> 'items' -> 1;
  perform pg_temp.ok('Identification: 33% correct', (v_item ->> 'p')::numeric = 0.3333, v_item ->> 'p');
  perform pg_temp.ok('Identification: 1 blank', (v_item ->> 'n_blank')::int = 1, v_item ->> 'n_blank');
  perform pg_temp.ok('Identification: common wrong answers grouped ("GC concept" ×2 first)',
    v_item -> 'wrong_answers' -> 0 ->> 'n' = '2' and lower(v_item -> 'wrong_answers' -> 0 ->> 'text') = 'gc concept'
    and jsonb_array_length(v_item -> 'wrong_answers') = 2, v_item ->> 'wrong_answers');

  v_item := v_r -> 'items' -> 2;
  perform pg_temp.ok('Enumeration: partial credit averaged (0.4167)', (v_item ->> 'p')::numeric = 0.4167, v_item ->> 'p');

  -- ---------- review ----------
  perform pg_temp.act_as(v_inst);
  v_r := public.attempt_review(v_att[3]);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Review shows student, answers and key per item',
    v_r -> 'student' ->> 'full_name' = 'Smoke, S3' and jsonb_array_length(v_r -> 'items') = 3
    and v_r -> 'items' -> 0 -> 'answer' ->> 'choice' = 'B' and v_r -> 'items' -> 0 -> 'key' ->> 'correct' = 'B'
    and (v_r -> 'items' -> 1 ->> 'points_awarded')::numeric = 0, left(v_r::text, 120));

  -- ---------- access ----------
  begin
    perform pg_temp.act_as(v_st[1]);
    v_r := public.attempt_review(v_att[1]);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot open the review (it contains keys)', false, 'opened');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot open the review (it contains keys)', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[1]);
    v_r := public.exam_item_analysis(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot open item analysis', false, 'opened');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot open item analysis', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_inst2);
    perform public.regrade_exam(v_exam);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot re-grade', false, 'regraded');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot re-grade', true, sqlerrm);
  end;
  begin
    perform pg_temp.act_as(v_st[3]);
    perform public.accept_identification_answer(v_ident, 'GC concept');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot add accepted answers', false, 'added');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot add accepted answers', true, sqlerrm);
  end;

  -- ---------- fix a wrong key, then re-grade ----------
  perform pg_temp.act_as(v_inst);
  perform public.save_item(jsonb_build_object('id', v_mcq, 'course_id', v_course, 'type', 'mcq', 'stem', 'Pick the asset.',
    'choices', '[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"},{"key":"C","text":"Expense"}]'::jsonb), '{"correct":"C"}');
  v_n := public.regrade_exam(v_exam);
  perform pg_temp.act_as_owner();
  select string_agg(score::int::text, ',' order by array_position(v_att, id)) into v_txt
    from public.attempts where id = any (v_att);
  perform pg_temp.ok('Re-grade after changing MC key to C (3,2,1,1,2,0)', v_n = 6 and v_txt = '3,2,1,1,2,0', v_n || ' re-graded: ' || v_txt);

  perform pg_temp.act_as(v_inst);
  perform public.accept_identification_answer(v_ident, '  GC Concept ');
  perform public.accept_identification_answer(v_ident, 'gc concept.');   -- same wording: not added twice
  perform public.regrade_exam(v_exam);
  perform pg_temp.act_as_owner();
  select jsonb_array_length(answer -> 'accepted') into v_n from public.item_keys where item_id = v_ident;
  select string_agg(score::int::text, ',' order by array_position(v_att, id)) into v_txt
    from public.attempts where id = any (v_att);
  perform pg_temp.ok('Accepting "GC concept" adds it once and re-grades (3,2,2,2,2,0)',
    v_n = 2 and v_txt = '3,2,2,2,2,0', v_n || ' accepted; ' || v_txt);

  -- passing_percent column readable by the instructor
  perform pg_temp.act_as(v_inst);
  update public.exams set passing_percent = 60 where id = v_exam;
  select passing_percent into v_num from public.exams where id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Passing percentage can be set and read', v_num = 60, v_num::text);

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smoke7.%@example.invalid';
select test, result, detail from smoke_results order by n;
