-- Phase 8 smoke test: bulk import. Paste into Supabase SQL Editor and Run (needs migrations up to 0008).
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
  v_course uuid;
  v_n int;
  v_good jsonb := '[
    {"type":"mcq","stem":"Which is an asset?","choices":[{"key":"A","text":"Revenue"},{"key":"B","text":"Cash"}],
     "topic":"Basics","difficulty":"easy","points":1,"answer":{"correct":"B"}},
    {"type":"identification","stem":"Continuing entity assumption.","difficulty":"average","points":2,
     "answer":{"accepted":["Going concern"]}},
    {"type":"enumeration","stem":"Give two current assets.","difficulty":"difficult","points":2,
     "answer":{"answers":[["Cash"],["Receivables"]],"any_order":true}}
  ]';
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smoke8.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke8.inst2@example.invalid', '{"full_name":"Other Instructor"}'),
    (v_s1,    'smoke8.s1@example.invalid',    '{"full_name":"Smoke, S1"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMK800', 'Smoke') returning id into v_course;

  perform pg_temp.act_as(v_inst);
  perform public.save_items(v_course, v_good, 'Smoke upload');
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.items i join public.item_keys k on k.item_id = i.id where i.course_id = v_course;
  perform pg_temp.ok('Instructor imports 3 items with answer keys', v_n = 3, v_n || ' items');

  -- One bad item (MC answer not a choice) rolls back the whole batch.
  begin
    perform pg_temp.act_as(v_inst);
    perform public.save_items(v_course, v_good || '[{"type":"mcq","stem":"Bad","choices":[{"key":"A","text":"x"},{"key":"B","text":"y"}],"answer":{"correct":"E"}}]'::jsonb);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('A bad item stops the import with its number', false, 'imported');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('A bad item stops the import with its number', sqlerrm like 'Item 4 of 4:%', sqlerrm);
  end;
  select count(*) into v_n from public.items where course_id = v_course;
  perform pg_temp.ok('Nothing is half-imported after a failure', v_n = 3, v_n || ' items (expected 3)');

  begin
    perform pg_temp.act_as(v_inst2);
    perform public.save_items(v_course, v_good);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot import into my course', false, 'imported');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot import into my course', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_s1);
    perform public.save_items(v_course, v_good);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot import items', false, 'imported');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot import items', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst);
    perform public.save_items(v_course, (select jsonb_agg(v_good -> 0) from generate_series(1, 501)));
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('More than 500 items at once is refused', false, 'imported');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('More than 500 items at once is refused', sqlerrm like '%500%', sqlerrm);
  end;

  -- An "id" in the payload must not overwrite an existing item.
  perform pg_temp.act_as(v_inst);
  perform public.save_items(v_course, jsonb_build_array(
    (v_good -> 1) || jsonb_build_object('id', (select id from public.items where course_id = v_course limit 1), 'stem', 'Imported copy')));
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.items where course_id = v_course;
  perform pg_temp.ok('Import always adds new items (never overwrites)', v_n = 4, v_n || ' items');

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smoke8.%@example.invalid';
select test, result, detail from smoke_results order by n;
