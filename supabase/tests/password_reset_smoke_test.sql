-- Password reset smoke test. Paste into Supabase SQL Editor and Run (after 0007).
-- Creates throwaway users and deletes everything it made.

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
create or replace function pg_temp.try_reset(p_as uuid, p_user uuid, p_pw text) returns text language plpgsql as $f$
begin
  perform pg_temp.act_as(p_as);
  perform public.reset_user_password(p_user, p_pw);
  perform pg_temp.act_as_owner();
  return 'ok';
exception when others then
  perform pg_temp.act_as_owner();
  return sqlerrm;
end $f$;

do $test$
declare
  v_abort_ctx text;
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_inst  uuid := gen_random_uuid();
  v_inst2 uuid := gen_random_uuid();
  v_s1    uuid := gen_random_uuid();   -- in v_inst's section
  v_s2    uuid := gen_random_uuid();   -- not in any of v_inst's sections
  v_course uuid; v_sec uuid;
  v_r text; v_ok boolean; v_n int;
begin
  insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
    (v_admin,  'smokepw.admin@example.invalid',  '{"full_name":"Admin"}', 'x'),
    (v_admin2, 'smokepw.admin2@example.invalid', '{"full_name":"Admin 2"}', 'x'),
    (v_inst,   'smokepw.inst@example.invalid',   '{"full_name":"Instructor"}', 'x'),
    (v_inst2,  'smokepw.inst2@example.invalid',  '{"full_name":"Instructor 2"}', 'x'),
    (v_s1,     'smokepw.s1@example.invalid',     '{"full_name":"Student 1"}', 'x'),
    (v_s2,     'smokepw.s2@example.invalid',     '{"full_name":"Student 2"}', 'x');
  update public.profiles set role = 'admin' where id in (v_admin, v_admin2);
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);
  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMKPW', 'Smoke') returning id into v_course;
  insert into public.sections (course_id, name) values (v_course, 'PW-1') returning id into v_sec;
  insert into public.section_members values (v_sec, v_s1);

  v_r := pg_temp.try_reset(v_inst, v_s1, 'temp-pass-123');
  select encrypted_password = extensions.crypt('temp-pass-123', encrypted_password) into v_ok from auth.users where id = v_s1;
  perform pg_temp.ok('Instructor resets own student''s password (new password works)', v_r = 'ok' and v_ok, v_r);

  v_r := pg_temp.try_reset(v_inst, v_s1, 'short');
  perform pg_temp.ok('Password under 8 characters is refused', v_r like '%8 characters%', v_r);

  v_r := pg_temp.try_reset(v_inst, v_s2, 'temp-pass-123');
  perform pg_temp.ok('Instructor cannot reset a student outside their sections', v_r like 'You can only%', v_r);

  v_r := pg_temp.try_reset(v_inst, v_inst2, 'temp-pass-123');
  perform pg_temp.ok('Instructor cannot reset another instructor', v_r like 'You can only%', v_r);

  v_r := pg_temp.try_reset(v_inst2, v_s1, 'temp-pass-123');
  perform pg_temp.ok('Other instructor cannot reset my student', v_r like 'You can only%', v_r);

  v_r := pg_temp.try_reset(v_s1, v_s2, 'temp-pass-123');
  perform pg_temp.ok('Student cannot reset anyone', v_r like 'You can only%', v_r);

  v_r := pg_temp.try_reset(v_s1, v_s1, 'temp-pass-123');
  perform pg_temp.ok('Nobody resets themselves here (use Account)', v_r like 'Change your own%', v_r);

  v_r := pg_temp.try_reset(v_admin, v_s2, 'admin-reset-1');
  v_n := (select count(*) from auth.users where id = v_s2 and encrypted_password = extensions.crypt('admin-reset-1', encrypted_password));
  perform pg_temp.ok('Admin resets any student', v_r = 'ok' and v_n = 1, v_r);

  v_r := pg_temp.try_reset(v_admin, v_inst2, 'admin-reset-1');
  perform pg_temp.ok('Admin resets an instructor', v_r = 'ok', v_r);

  v_r := pg_temp.try_reset(v_admin, v_admin2, 'admin-reset-1');
  perform pg_temp.ok('Admin cannot reset another admin', v_r like 'An admin%', v_r);

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

delete from auth.users where email like 'smokepw.%@example.invalid';
select test, result, detail from smoke_results order by n;
