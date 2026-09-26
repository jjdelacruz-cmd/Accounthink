-- Phase 2 smoke test. Paste into Supabase SQL Editor and Run (after running migration 0002).
-- Creates throwaway users/course/items/exam, tests RLS and rules, then deletes everything it made.

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
  v_course uuid;
  v_course2 uuid;
  v_sec uuid;
  v_sec_other uuid;
  v_mcq uuid;
  v_ident uuid;
  v_enum uuid;
  v_foreign_item uuid;
  v_exam uuid;
  v_n int;
  v_txt text;
begin

  -- Setup
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_inst,  'smoke2.inst@example.invalid',  '{"full_name":"Smoke Instructor"}'),
    (v_inst2, 'smoke2.inst2@example.invalid', '{"full_name":"Smoke Instructor 2"}'),
    (v_s1,    'smoke2.s1@example.invalid',    '{"full_name":"Smoke, Student 1"}'),
    (v_s2,    'smoke2.s2@example.invalid',    '{"full_name":"Smoke, Student 2"}');
  update public.profiles set role = 'instructor' where id in (v_inst, v_inst2);

  insert into public.courses (instructor_id, code, title) values (v_inst, 'SMK201', 'Smoke Course') returning id into v_course;
  insert into public.courses (instructor_id, code, title) values (v_inst2, 'SMK999', 'Other Course') returning id into v_course2;
  insert into public.sections (course_id, name) values (v_course, 'SMK-A') returning id into v_sec;
  insert into public.sections (course_id, name) values (v_course2, 'SMK-Z') returning id into v_sec_other;
  insert into public.section_members values (v_sec, v_s1);

  -- 1. Instructor saves items of each type via save_item (RLS applies).
  begin
    perform pg_temp.act_as(v_inst);
    v_mcq := public.save_item(
      jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Which is an asset?',
        'choices', '[{"key":"A","text":"Cash"},{"key":"B","text":"Revenue"},{"key":"C","text":"Expense"}]'::jsonb,
        'topic', 'Basics', 'difficulty', 'easy', 'points', 1),
      '{"correct":"A"}');
    v_ident := public.save_item(
      jsonb_build_object('course_id', v_course, 'type', 'identification', 'stem', 'Assumption that the entity will continue.',
        'topic', 'Basics', 'difficulty', 'average', 'points', 2),
      '{"accepted":["Going concern"]}');
    v_enum := public.save_item(
      jsonb_build_object('course_id', v_course, 'type', 'enumeration', 'stem', 'Give two current assets.',
        'difficulty', 'difficult', 'points', 2),
      '{"answers":[["Cash"],["Receivables"]],"any_order":true}');
    perform pg_temp.act_as_owner();
    select count(*) into v_n from public.item_keys where item_id in (v_mcq, v_ident, v_enum);
    perform pg_temp.ok('Instructor saves MC, identification, enumeration items with keys', v_n = 3, v_n || ' keys');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Instructor saves MC, identification, enumeration items with keys', false, sqlerrm);
    raise exception 'Cannot continue: %', sqlerrm;
  end;

  -- 2. Editing an item updates it and its key.
  perform pg_temp.act_as(v_inst);
  perform public.save_item(
    jsonb_build_object('id', v_ident, 'course_id', v_course, 'type', 'identification',
      'stem', 'Assumption that the entity will continue operating.', 'difficulty', 'average', 'points', 2),
    '{"accepted":["Going concern","Going concern assumption"]}');
  perform pg_temp.act_as_owner();
  select jsonb_array_length(answer -> 'accepted') into v_n from public.item_keys where item_id = v_ident;
  perform pg_temp.ok('Editing an item updates its answer key', v_n = 2, v_n || ' accepted answers');

  -- 3. MC without choices rejected by the database.
  begin
    perform pg_temp.act_as(v_inst);
    perform public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Bad'), '{"correct":"A"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Multiple choice without choices is rejected', false, 'saved');
  exception when others then
    perform pg_temp.ok('Multiple choice without choices is rejected', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst);
    perform public.save_item(jsonb_build_object('course_id', v_course, 'type', 'mcq', 'stem', 'Bad key',
      'choices', '[{"key":"A","text":"x"},{"key":"B","text":"y"}]'::jsonb), '{"correct":"D"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Multiple choice whose answer is not a choice is rejected', false, 'saved');
  exception when others then
    perform pg_temp.ok('Multiple choice whose answer is not a choice is rejected', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst);
    perform public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification', 'stem', 'No key'),
      '{"accepted":[]}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Identification with no accepted answer is rejected', false, 'saved');
  exception when others then
    perform pg_temp.ok('Identification with no accepted answer is rejected', true, sqlerrm);
  end;

  -- 4. Other instructor: cannot see, edit, or add items to this course.
  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.items where course_id = v_course;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Other instructor cannot see the item bank', v_n = 0, 'saw ' || v_n);

  perform pg_temp.act_as(v_inst2);
  select count(*) into v_n from public.item_keys where item_id in (v_mcq, v_ident, v_enum);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Other instructor cannot read the answer keys', v_n = 0, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_inst2);
    perform public.save_item(jsonb_build_object('id', v_mcq, 'course_id', v_course, 'type', 'mcq', 'stem', 'Hacked',
      'choices', '[{"key":"A","text":"x"},{"key":"B","text":"y"}]'::jsonb), '{"correct":"B"}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot edit an item', false, 'edit succeeded');
  exception when others then
    perform pg_temp.ok('Other instructor cannot edit an item', true, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst2);
    perform public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification', 'stem', 'Injected'),
      '{"accepted":["x"]}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Other instructor cannot add items to the course', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Other instructor cannot add items to the course', true, sqlerrm);
  end;

  -- 5. Exam builder.
  perform pg_temp.act_as(v_inst);
  insert into public.exams (course_id, title, kind, created_by) values (v_course, 'Smoke Quiz', 'quiz', v_inst)
    returning id into v_exam;
  insert into public.exam_items (exam_id, item_id, position) values (v_exam, v_mcq, 1), (v_exam, v_ident, 2);
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Instructor creates an exam and adds items', true);

  -- Foreign item/section cannot be attached.
  perform pg_temp.act_as(v_inst2);
  v_foreign_item := public.save_item(jsonb_build_object('course_id', v_course2, 'type', 'identification', 'stem', 'Other'),
    '{"accepted":["x"]}');
  perform pg_temp.act_as_owner();
  begin
    insert into public.exam_items (exam_id, item_id) values (v_exam, v_foreign_item);
    perform pg_temp.ok('Item from another course cannot be added to the exam', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Item from another course cannot be added to the exam', true, sqlerrm);
  end;
  begin
    insert into public.exam_sections (exam_id, section_id) values (v_exam, v_sec_other);
    perform pg_temp.ok('Section from another course cannot be assigned', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Section from another course cannot be assigned', true, sqlerrm);
  end;

  -- 6. Publish rules.
  begin
    perform pg_temp.act_as(v_inst);
    update public.exams set status = 'published' where id = v_exam;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Cannot publish without a time limit and sections', false, 'published');
  exception when others then
    perform pg_temp.ok('Cannot publish without a time limit and sections', true, sqlerrm);
  end;

  -- Student sees nothing while draft.
  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.exams where id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot see a draft exam', v_n = 0, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_inst);
    update public.exams set time_limit_minutes = 30 where id = v_exam;
    insert into public.exam_sections (exam_id, section_id) values (v_exam, v_sec);
    update public.exams set status = 'published' where id = v_exam;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Publishes once time limit, items and section are set', true);
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Publishes once time limit, items and section are set', false, sqlerrm);
  end;

  begin
    perform pg_temp.act_as(v_inst);
    insert into public.exam_items (exam_id, item_id, position) values (v_exam, v_enum, 3);
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Items are locked while the exam is published', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Items are locked while the exam is published', true, sqlerrm);
  end;

  -- 7. Students: see the published exam only if assigned; never items or keys.
  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.exams where id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Enrolled student sees the published exam', v_n = 1, 'saw ' || v_n);

  perform pg_temp.act_as(v_s2);
  select count(*) into v_n from public.exams where id = v_exam;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student not in an assigned section cannot see it', v_n = 0, 'saw ' || v_n);

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.items;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot read items directly', v_n = 0, 'saw ' || v_n);

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.item_keys;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot read ANY answer key', v_n = 0, 'saw ' || v_n);

  perform pg_temp.act_as(v_s1);
  select count(*) into v_n from public.exam_items;
  perform pg_temp.act_as_owner();
  perform pg_temp.ok('Student cannot read the exam''s item list', v_n = 0, 'saw ' || v_n);

  begin
    perform pg_temp.act_as(v_s1);
    perform public.save_item(jsonb_build_object('course_id', v_course, 'type', 'identification', 'stem', 'x'),
      '{"accepted":["x"]}');
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Student cannot create items', false, 'insert succeeded');
  exception when others then
    perform pg_temp.ok('Student cannot create items', true, sqlerrm);
  end;

  perform pg_temp.act_as(v_s1);
  update public.exams set status = 'draft', title = 'hacked' where id = v_exam;
  perform pg_temp.act_as_owner();
  select title into v_txt from public.exams where id = v_exam;
  perform pg_temp.ok('Student cannot change an exam', v_txt = 'Smoke Quiz', v_txt);

  begin
    perform pg_temp.act_as(v_inst);
    delete from public.items where id = v_mcq;
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Item in a published exam cannot be deleted (archive instead)', false, 'deleted');
  exception when others then
    perform pg_temp.ok('Item in a published exam cannot be deleted (archive instead)', true, sqlerrm);
  end;

  -- 8. Back to draft unlocks items; deleting a course with a published exam still works.
  perform pg_temp.act_as(v_inst);
  update public.exams set status = 'draft' where id = v_exam;
  insert into public.exam_items (exam_id, item_id, position) values (v_exam, v_enum, 3);
  update public.exams set status = 'published' where id = v_exam;
  perform pg_temp.act_as_owner();
  select count(*) into v_n from public.exam_items where exam_id = v_exam;
  perform pg_temp.ok('Back to draft allows editing items, then republish', v_n = 3, v_n || ' items');

  begin
    perform pg_temp.act_as(v_inst);
    delete from public.courses where id = v_course;
    perform pg_temp.act_as_owner();
    select count(*) into v_n from public.items where course_id = v_course;
    perform pg_temp.ok('Deleting a course removes its items and exams cleanly', v_n = 0, v_n || ' items left');
  exception when others then
    perform pg_temp.act_as_owner();
    perform pg_temp.ok('Deleting a course removes its items and exams cleanly', false, sqlerrm);
  end;

  perform pg_temp.act_as_owner();
exception when others then
  get stacked diagnostics v_abort_ctx = pg_exception_context;
  perform pg_temp.act_as_owner();
  insert into smoke_results (test, result, detail)
  values ('Test run aborted', 'FAIL', sqlerrm || ' | at: ' || left(v_abort_ctx, 300));
end
$test$;

-- Cleanup (cascades to profiles, courses, sections, items, exams).
delete from auth.users where email like 'smoke2.%@example.invalid';
select test, result, detail from smoke_results order by n;
