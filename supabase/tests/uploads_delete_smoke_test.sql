-- Uploads + deleting questions smoke test. Paste into Supabase SQL Editor and Run (after 0008).
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
  v_s1    uuid := gen_random_uuid();
  v_course uuid; v_course2 uuid; v_sec uuid;
  v_b1 uuid; v_b2 uuid; v_b3 uuid; v_other_batch uuid;
  v_ids uuid[];
  v_live_exam uuid; v_draft_exam uuid;
  v_r jsonb; v_n int; v_txt text;
  v_three jsonb := '[
    {"type":"identification","stem":"Q one","answer":{"accepted":["a"]}},
    {"type":"identification","stem":"Q two","answer":{"accepted":["b"]}},
    {"type":"identification","stem":"Q three","answer":{"accepted":["c"]}}]';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smokeup.inst@example.invalid',  '{"full_name":"Instructor"}'),
    (v_inst2, 'smokeup.inst2@example.invalid', '{"full_name":"Other Instructor"}'),
    (v_s1,    'smokeup.s1@example.invalid',    '{"full_name":"Student"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKUP', 'Smoke') returning id into v_course;
  insert into public.courses (instructor_id, code, title) values (v_inst2, 'SMKUP2', 'Other') returning id into v_course2;
  insert into public.sections (course_id, name) values (v_course, 'UP-1') returning id into v_sec;
  insert into public.section_members values (v_sec, v_s1);

  -- ---------- uploads ----------
  perform pg_temp.act_as(v_inst);
  v_b1 := public.save_items(v_course, v_three, 'Chapter 3 quiz');
  v_b2 := public.save_items(v_course, v_three, null);
  v_b3 := public.save_items(v_course, v_three, 'Throwaway');
  perform pg_temp.act_as_owner();

  select count(*) into v_n from public.items where batch_id = v_b1;
  select label into v_txt from public.item_batches where id = v_b1;
  perform pg_temp.ok('Import creates a named upload holding its questions', v_n = 3 and v_txt = 'Chapter 3 quiz', v_txt || ', ' || v_n);
  select label into v_txt from public.item_batches where id = v_b2;
  perform pg_temp.ok('Unnamed import gets a dated name', v_txt like 'Upload %', v_txt);

  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.item_batches where course_id = v_course;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Other instructor cannot see my uploads', v_n = 0, 'saw ' || v_n);

  insert into public.item_batches (course_id, label) values (v_course2, 'Other course') returning id into v_other_batch;
  begin
    update public.items set batch_id = v_other_batch where batch_id = v_b1;
    perform pg_temp.ok('A question cannot be put in another course''s upload', false, 'updated');
  exception when others then
    perform pg_temp.ok('A question cannot be put in another course''s upload', true, sqlerrm);
  end;

  -- ---------- deleting ----------
  select array_agg(id order by stem) into v_ids from public.items where batch_id = v_b1;   -- Q one, Q three, Q two
  -- Q one in a published exam; Q two in a draft exam
  insert into public.exams (course_id, title, time_limit_minutes, created_by) values (v_course, 'Live', 10, v_inst) returning id into v_live_exam;
  insert into public.exams (course_id, title, time_limit_minutes, created_by) values (v_course, 'Draft', 10, v_inst) returning id into v_draft_exam;
  insert into public.exam_items values (v_live_exam, v_ids[1], 1), (v_draft_exam, v_ids[3], 1);
  insert into public.exam_sections values (v_live_exam, v_sec);
  update public.exams set status = 'published' where id = v_live_exam;

  perform pg_temp.act_as(v_inst2);
  v_r := public.delete_items(v_ids);
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.items where id = any (v_ids);
  perform pg_temp.ok('Other instructor cannot delete my questions', (v_r ->> 'deleted')::int = 0 and v_n = 3, v_r::text);

  begin
    perform pg_temp.act_as(v_s1);
    v_r := public.delete_items(v_ids);
    perform pg_temp.act_as_owner();
    select count(*) into v_n from public.items where id = any (v_ids);
    perform pg_temp.ok('Student cannot delete questions', v_n = 3, coalesce(v_r::text, '') || ' / ' || v_n || ' left');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot delete questions', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_inst);
  v_r := public.delete_items(v_ids);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Delete: 2 removed, 1 kept (it is in a published exam)',
    (v_r ->> 'deleted')::int = 2 and (v_r ->> 'kept')::int = 1, v_r::text);
  select count(*) into v_n from public.items where id = v_ids[1];
  perform pg_temp.ok('The published exam''s question is still there', v_n = 1);
  select count(*) into v_n from public.exam_items where exam_id = v_draft_exam;
  perform pg_temp.ok('Deleting removes it from draft exams too', v_n = 0, v_n || ' left in draft');

  -- ---------- delete a whole upload ----------
  perform pg_temp.act_as(v_inst);
  v_r := public.delete_batch(v_b3);
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.item_batches where id = v_b3;
  perform pg_temp.ok('Deleting an upload removes its questions and the upload',
    (v_r ->> 'deleted')::int = 3 and v_n = 0 and not exists (select 1 from public.items where batch_id = v_b3), v_r::text);

  perform pg_temp.act_as(v_inst);
  v_r := public.delete_batch(v_b1);   -- only the live-exam question is left in it
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.item_batches where id = v_b1;
  perform pg_temp.ok('An upload with a question in a live exam stays (with that question)',
    (v_r ->> 'kept')::int = 1 and v_n = 1, v_r::text);

  begin
    perform pg_temp.act_as(v_inst2);
    v_r := public.delete_batch(v_b2);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot delete my upload', false, v_r::text);
  exception when others then
    perform pg_temp.act_as_owner();
    select count(*) into v_n from public.items where batch_id = v_b2;
    perform pg_temp.ok('Other instructor cannot delete my upload', v_n = 3, sqlerrm);
  end;

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smokeup.%@example.invalid';
select test, result, detail from smoke_results order by n;
