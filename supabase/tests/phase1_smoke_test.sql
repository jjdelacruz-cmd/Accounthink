-- Phase 1 smoke test. Paste into Supabase SQL Editor and Run.
-- Creates throwaway users, tests RLS as each role, then deletes everything it made.

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
  v_admin uuid := gen_random_uuid();
  v_inst  uuid := gen_random_uuid();
  v_inst2 uuid := gen_random_uuid();
  v_s1    uuid := gen_random_uuid();
  v_s2    uuid := gen_random_uuid();
  v_course uuid;
  v_section uuid;
  v_code text;
  v_n int;
  v_txt text;
begin
  -- Act as a signed-in user for the statements that follow.

  -- Setup: five users (sign-up metadata tries to claim admin; must be ignored).
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_admin, 'smoke.admin@example.invalid', '{"full_name":"Smoke Admin","role":"admin"}'),
    (v_inst,  'smoke.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke.inst2@example.invalid', '{"full_name":"Smoke Instructor 2"}'),
    (v_s1,    'smoke.s1@example.invalid',    '{"full_name":"Smoke, Student 1","student_no":"0001"}'),
    (v_s2,    'smoke.s2@example.invalid',    '{"full_name":"Smoke, Student 2"}');

  select count(*) into v_n from public.profiles where id in (v_admin, v_inst, v_inst2, v_s1, v_s2) and role = 'student';
  perform pg_temp.ok('Sign-up creates a profile for every user, always as student', v_n = 5, v_n || ' of 5');

  select student_no into v_txt from public.profiles where id = v_s1;
  perform pg_temp.ok('Student number saved from sign-up', v_txt = '0001', v_txt);

  update public.profiles set role = 'admin' where id = v_admin;
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);

  -- Student cannot self-promote.
  begin
    perform pg_temp.act_as(v_s1);
    update public.profiles set role = 'instructor' where id = v_s1;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot make themselves instructor', false, 'update succeeded');
  exception when others then
    perform pg_temp.ok('Student cannot make themselves instructor', true, sqlerrm);
  end;

  -- Student cannot create a course.
  begin
    perform pg_temp.act_as(v_s1);
    insert into public.courses (instructor_id, code, title) values (v_s1, 'HACK', 'Hack');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot create a course', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Student cannot create a course', true, sqlerrm);
  end;

  -- Instructor creates course + section.
  begin
    perform pg_temp.act_as(v_inst);
    insert into public.courses (instructor_id, code, title) values (v_inst, 'SMOKE101', 'Smoke Test Course') returning id into v_course;
    insert into public.sections (course_id, name) values (v_course, 'SMOKE-1') returning id, join_code into v_section, v_code;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor can create a course and section', true, 'join code ' || v_code);
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor can create a course and section', false, sqlerrm);
    raise exception 'Cannot continue without a section: %', sqlerrm;
  end;

  perform pg_temp.ok('Join code is 6 characters, no look-alike letters', v_code ~ '^[A-HJKMNP-Z2-9]{6}$', v_code);

  -- Instructor cannot create a course for someone else.
  begin
    perform pg_temp.act_as(v_inst);
    insert into public.courses (instructor_id, code, title) values (v_inst2, 'X', 'X');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor cannot create a course in another instructor''s name', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Instructor cannot create a course in another instructor''s name', true, sqlerrm);
  end;

  -- Other instructor sees nothing and cannot add a section.
  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.courses where id = v_course;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Other instructor cannot see the course', v_n = 0, 'saw ' || v_n);
  begin
    perform pg_temp.act_as(v_inst2);
    insert into public.sections (course_id, name) values (v_course, 'HACK');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot add a section to it', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Other instructor cannot add a section to it', true, sqlerrm);
  end;

  -- Student before joining.
  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.sections where id = v_section;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot see a section before joining', v_n = 0, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_s1);
    insert into public.section_members (section_id, student_id) values (v_section, v_s1);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot add themselves without a code', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Student cannot add themselves without a code', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_s1);
    perform public.join_section('ZZZZZZ');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Wrong join code is rejected', false, 'join succeeded');
  exception when others then
    perform pg_temp.ok('Wrong join code is rejected', sqlerrm = 'No section found for that code', sqlerrm);
  end;

  -- Join with correct code typed in lowercase with spaces.
  begin
    perform pg_temp.act_as(v_s1);
    perform public.join_section('  ' || lower(v_code) || ' ');
    select count(*) into v_n from public.sections where id = v_section;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student joins with correct code (lowercase OK) and now sees the section', v_n = 1, 'saw ' || v_n);
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student joins with correct code (lowercase OK) and now sees the section', false, sqlerrm);
  end;

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.profiles;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student sees only their own profile', v_n = 1, 'saw ' || v_n);

  perform pg_temp.act_as(v_inst);
  select count(*) into v_n from public.profiles where id in (v_s1, v_s2);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Instructor sees enrolled student only (S1 yes, S2 no)', v_n = 1, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_inst);
    perform public.join_section(v_code);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor cannot join a section as a student', false, 'join succeeded');
  exception when others then
    perform pg_temp.ok('Instructor cannot join a section as a student', true, sqlerrm);
  end;

  -- Close joining; S2 blocked.
  perform pg_temp.act_as(v_inst);
  update public.sections set join_open = false where id = v_section;
  perform pg_temp.act_as_owner();
  begin
    perform pg_temp.act_as(v_s2);
    perform public.join_section(v_code);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Closed section rejects new students', false, 'join succeeded');
  exception when others then
    perform pg_temp.ok('Closed section rejects new students', sqlerrm = 'This section is closed for joining', sqlerrm);
  end;

  -- Admin.
  perform pg_temp.act_as(v_admin);
  select count(*) into v_n from public.profiles where id in (v_admin, v_inst, v_inst2, v_s1, v_s2);
  update public.profiles set role = 'instructor' where id = v_s2;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Admin sees all users', v_n = 5, 'saw ' || v_n || ' of 5');
  select role::text into v_txt from public.profiles where id = v_s2;
  perform pg_temp.ok('Admin can promote a student to instructor', v_txt = 'instructor', v_txt);

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

-- Cleanup (cascades to profiles, courses, sections, memberships).
delete from auth.users where email like 'smoke.%@example.invalid';
select test, result, detail from smoke_results order by n;
