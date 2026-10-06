-- 1) Essay questions and manual checking.
--    - New item type 'essay' (key: {"guide": "what a good answer covers"}, may be empty).
--    - Essays are never auto-graded: a non-blank essay stays "to check" (points_awarded is null)
--      until the instructor scores it. A blank essay gets 0.
--    - The instructor can set the score of any identification / enumeration / essay answer by hand,
--      with an optional comment for the student. Hand-set scores survive re-grading.
-- 2) Camera monitoring (optional per exam). Runs on the student's phone only: no picture or video
--    is stored or sent. Only warnings are logged (no face, looking away, another face, camera off).

alter type public.item_type add value if not exists 'essay';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.responses add column if not exists manual     boolean not null default false;
alter table public.responses add column if not exists checked_by uuid references public.profiles (id) on delete set null;
alter table public.responses add column if not exists checked_at timestamptz;
alter table public.responses add column if not exists comment    text;

alter table public.exams add column if not exists require_camera boolean not null default false;
grant select (require_camera) on public.exams to authenticated;

alter table public.integrity_events drop constraint if exists integrity_events_kind_check;
alter table public.integrity_events add constraint integrity_events_kind_check check (kind in (
  'left_app', 'returned', 'copy', 'cut', 'paste', 'context_menu', 'print_key',
  'device_changed', 'session_takeover', 'code_failed',
  'cam_no_face', 'cam_away', 'cam_multi', 'cam_off'));

-- ---------------------------------------------------------------------------
-- Grading: essays wait for the instructor.
-- ---------------------------------------------------------------------------
create or replace function public.grade_response(p_type public.item_type, p_points numeric, p_key jsonb, p_answer jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  v_expected jsonb := p_key -> 'answers';
  v_given text[];
  v_used boolean[];
  v_hits int := 0;
  v_slots int;
  i int;
  j int;
begin
  if p_answer is null then
    return 0;
  end if;

  if p_type::text = 'essay' then
    -- null = waiting for the instructor to check it
    return case when btrim(coalesce(p_answer ->> 'text', '')) = '' then 0 end;
  end if;

  if p_type::text = 'mcq' then
    return case when p_answer ->> 'choice' = p_key ->> 'correct' then p_points else 0 end;
  end if;

  if p_type::text = 'identification' then
    return case when exists (
      select 1 from jsonb_array_elements_text(p_key -> 'accepted') a
      where public.normalize_answer(a) = public.normalize_answer(p_answer ->> 'text')
        and public.normalize_answer(p_answer ->> 'text') <> ''
    ) then p_points else 0 end;
  end if;

  -- enumeration: each expected slot can be matched once; points scale by hits.
  v_slots := jsonb_array_length(v_expected);
  select array_agg(public.normalize_answer(x) order by ord)
    into v_given
    from jsonb_array_elements_text(coalesce(p_answer -> 'items', '[]'::jsonb)) with ordinality t(x, ord);
  if v_given is null or v_slots = 0 then
    return 0;
  end if;
  v_used := array_fill(false, array[v_slots]);

  for i in 1 .. array_length(v_given, 1) loop
    continue when v_given[i] = '';
    if coalesce((p_key ->> 'any_order')::boolean, true) then
      for j in 1 .. v_slots loop
        if not v_used[j] and exists (
          select 1 from jsonb_array_elements_text(v_expected -> (j - 1)) alt
          where public.normalize_answer(alt) = v_given[i]
        ) then
          v_used[j] := true;
          v_hits := v_hits + 1;
          exit;
        end if;
      end loop;
    elsif i <= v_slots and exists (
      select 1 from jsonb_array_elements_text(v_expected -> (i - 1)) alt
      where public.normalize_answer(alt) = v_given[i]
    ) then
      v_hits := v_hits + 1;
    end if;
  end loop;

  return round(p_points * v_hits / v_slots, 2);
end $$;

-- Re-grade keeps scores the instructor set by hand.
create or replace function public.regrade_exam(p_exam_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  perform public.require_exam_owner(p_exam_id);

  update public.responses r
     set points_awarded = public.grade_response(i.type, i.points, k.answer, r.answer)
    from public.attempts a, public.items i, public.item_keys k
   where r.attempt_id = a.id and a.exam_id = p_exam_id and a.submitted_at is not null
     and i.id = r.item_id and k.item_id = i.id and not r.manual;

  update public.attempts a set
    max_score = (select coalesce(sum(i.points), 0) from public.items i where i.id = any (a.item_order)),
    score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
  where a.exam_id = p_exam_id and a.submitted_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- How many answers in an attempt still wait for the instructor.
create or replace function public.attempt_pending(p_attempt_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.responses r
  join public.attempts a on a.id = r.attempt_id
  where r.attempt_id = p_attempt_id and a.submitted_at is not null and r.points_awarded is null
$$;
revoke execute on function public.attempt_pending(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student: essays can be long.
-- ---------------------------------------------------------------------------
create or replace function public.save_response(p_attempt_id uuid, p_token uuid, p_index int, p_answer jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
  v_item_id uuid;
  v_type text;
begin
  if p_index is null or p_index < 0 or p_index >= array_length(v_attempt.item_order, 1) then
    raise exception 'No such question';
  end if;
  v_item_id := v_attempt.item_order[p_index + 1];
  select type::text into v_type from public.items where id = v_item_id;
  if pg_column_size(p_answer) > (case when v_type = 'essay' then 40000 else 4000 end) then
    raise exception 'Answer is too long';
  end if;

  p_answer := case v_type
    when 'mcq' then jsonb_build_object('choice', p_answer ->> 'choice')
    when 'identification' then jsonb_build_object('text', left(p_answer ->> 'text', 500))
    when 'essay' then jsonb_build_object('text', left(p_answer ->> 'text', 10000))
    else jsonb_build_object('items', coalesce(p_answer -> 'items', '[]'::jsonb))
  end;

  insert into public.responses (attempt_id, item_id, answer, saved_at)
  values (p_attempt_id, v_item_id, p_answer, now())
  on conflict (attempt_id, item_id) do update set answer = excluded.answer, saved_at = excluded.saved_at;
  return now();
end $$;

-- ---------------------------------------------------------------------------
-- Instructor: set (or clear) a score by hand.
--   p_points null = go back to the automatic score.
-- ---------------------------------------------------------------------------
create or replace function public.set_response_score(p_attempt_id uuid, p_item_id uuid, p_points numeric,
                                                     p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_item public.items;
  v_key jsonb;
  v_comment text := nullif(btrim(left(coalesce(p_comment, ''), 2000)), '');
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Not allowed';
  end if;
  perform public.require_exam_owner(v_attempt.exam_id);
  if v_attempt.submitted_at is null then
    raise exception 'The student hasn''t submitted yet';
  end if;
  if not (p_item_id = any (v_attempt.item_order)) then
    raise exception 'That question isn''t in this attempt';
  end if;
  select * into v_item from public.items where id = p_item_id;
  if v_item.type::text = 'mcq' then
    raise exception 'Multiple-choice answers are graded by the key';
  end if;
  if p_points is not null and (p_points < 0 or p_points > v_item.points) then
    raise exception 'Score must be from 0 to %', v_item.points;
  end if;

  if p_points is null then
    select answer into v_key from public.item_keys where item_id = p_item_id;
    update public.responses r set
      manual = false,
      points_awarded = public.grade_response(v_item.type, v_item.points, v_key, r.answer),
      checked_by = null, checked_at = null, comment = v_comment
    where r.attempt_id = p_attempt_id and r.item_id = p_item_id;
  else
    insert into public.responses (attempt_id, item_id, answer, saved_at, points_awarded, manual,
                                  checked_by, checked_at, comment)
    values (p_attempt_id, p_item_id, '{}'::jsonb, now(), round(p_points, 2), true, auth.uid(), now(), v_comment)
    on conflict (attempt_id, item_id) do update set
      points_awarded = excluded.points_awarded, manual = true,
      checked_by = excluded.checked_by, checked_at = excluded.checked_at, comment = excluded.comment;
  end if;

  update public.attempts a
     set score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
   where a.id = p_attempt_id
  returning * into v_attempt;

  return jsonb_build_object('score', v_attempt.score, 'max_score', v_attempt.max_score,
                            'pending', public.attempt_pending(p_attempt_id));
end $$;

-- Questions that can be checked by hand, with how many answers wait for checking.
create or replace function public.exam_check_summary(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_owner(p_exam_id);
  perform public.finalize_expired_for_exam(p_exam_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'position', ei.position,
      'item_id', i.id,
      'type', i.type,
      'stem', i.stem,
      'points', i.points,
      'answered', (select count(*) from public.responses r join public.attempts a on a.id = r.attempt_id
                   where a.exam_id = p_exam_id and a.submitted_at is not null and r.item_id = i.id
                     and public.is_answered(r.answer)),
      'pending', (select count(*) from public.responses r join public.attempts a on a.id = r.attempt_id
                  where a.exam_id = p_exam_id and a.submitted_at is not null and r.item_id = i.id
                    and r.points_awarded is null),
      'checked', (select count(*) from public.responses r join public.attempts a on a.id = r.attempt_id
                  where a.exam_id = p_exam_id and a.submitted_at is not null and r.item_id = i.id and r.manual)
    ) order by ei.position)
    from public.exam_items ei
    join public.items i on i.id = ei.item_id
    where ei.exam_id = p_exam_id and i.type::text <> 'mcq'
  ), '[]'::jsonb);
end $$;

-- Every submitted answer to one question, unchecked ones first.
create or replace function public.exam_check_item(p_exam_id uuid, p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items;
begin
  perform public.require_exam_owner(p_exam_id);
  select i.* into v_item from public.items i
    join public.exam_items ei on ei.item_id = i.id and ei.exam_id = p_exam_id
   where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'That question isn''t in this exam';
  end if;
  return jsonb_build_object(
    'item', jsonb_build_object('item_id', v_item.id, 'type', v_item.type, 'stem', v_item.stem,
                               'points', v_item.points,
                               'key', (select answer from public.item_keys where item_id = v_item.id)),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attempt_id', a.id,
        'full_name', p.full_name,
        'student_no', p.student_no,
        'answer', r.answer,
        'points_awarded', case when r.attempt_id is null then 0 else r.points_awarded end,
        'manual', coalesce(r.manual, false),
        'comment', r.comment
      ) order by (r.attempt_id is not null and r.points_awarded is null) desc, p.full_name)
      from public.attempts a
      join public.profiles p on p.id = a.student_id
      left join public.responses r on r.attempt_id = a.id and r.item_id = v_item.id
      where a.exam_id = p_exam_id and a.submitted_at is not null and v_item.id = any (a.item_order)
    ), '[]'::jsonb)
  );
end $$;

-- Per-student review now shows hand-set scores and comments.
create or replace function public.attempt_review(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_student public.profiles;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Not allowed';
  end if;
  perform public.require_exam_owner(v_attempt.exam_id);
  select * into v_student from public.profiles where id = v_attempt.student_id;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt.id, 'exam_id', v_attempt.exam_id,
      'started_at', v_attempt.started_at, 'submitted_at', v_attempt.submitted_at,
      'end_reason', v_attempt.end_reason, 'score', v_attempt.score, 'max_score', v_attempt.max_score,
      'pending', public.attempt_pending(v_attempt.id),
      'device', v_attempt.device_info ->> 'label'),
    'student', jsonb_build_object('full_name', v_student.full_name, 'student_no', v_student.student_no,
                                  'email', v_student.email),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'index', t.ord,
        'item_id', i.id,
        'type', i.type,
        'stem', i.stem,
        'points', i.points,
        'choices', case when i.type::text = 'mcq' then coalesce((
            select jsonb_agg(c order by o.ord2)
            from jsonb_array_elements_text(v_attempt.choice_orders -> i.id::text) with ordinality o(k, ord2)
            join jsonb_array_elements(i.choices) c on c ->> 'key' = o.k), i.choices) end,
        'key', k.answer,
        'answer', r.answer,
        'points_awarded', r.points_awarded,
        'manual', coalesce(r.manual, false),
        'comment', r.comment
      ) order by t.ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.items i on i.id = t.item_id
      left join public.item_keys k on k.item_id = i.id
      left join public.responses r on r.attempt_id = v_attempt.id and r.item_id = i.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Student feedback: pending answers and the instructor's comments.
-- ---------------------------------------------------------------------------
create or replace function public.my_exam_feedback(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exams;
  v_attempt public.attempts;
  v_closed boolean;
  v_keys boolean;
begin
  if not public.exam_assigned_to_me(p_exam_id) then
    raise exception 'Exam not found';
  end if;
  select * into v_exam from public.exams where id = p_exam_id;
  select * into v_attempt from public.attempts where exam_id = p_exam_id and student_id = auth.uid();

  if v_attempt.id is null or v_attempt.submitted_at is null then
    return jsonb_build_object('status', 'not_submitted');
  end if;
  if v_exam.feedback = 'off' then
    return jsonb_build_object('status', 'off');
  end if;
  v_closed := v_exam.status = 'closed' or (v_exam.closes_at is not null and v_exam.closes_at <= now());
  if v_exam.feedback_after_close and not v_closed then
    return jsonb_build_object('status', 'after_close', 'closes_at', v_exam.closes_at);
  end if;
  v_keys := v_exam.feedback = 'answers';

  return jsonb_build_object(
    'status', 'ready',
    'show_answers', v_keys,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'index', t.ord,
        'type', i.type,
        'stem', i.stem,
        'points', i.points,
        -- null = still being checked
        'points_awarded', case when r.attempt_id is null then 0 else r.points_awarded end,
        'answer', r.answer,
        'comment', r.comment,
        'choices', case when i.type::text = 'mcq' then (
            select jsonb_agg(jsonb_build_object(
                     'key', c ->> 'key', 'text', c ->> 'text',
                     'is_key', case when v_keys then (c ->> 'key') = (k.answer ->> 'correct') end)
                   order by coalesce(o.ord2, cc.ord3))
            from jsonb_array_elements(i.choices) with ordinality cc(c, ord3)
            left join jsonb_array_elements_text(v_attempt.choice_orders -> i.id::text) with ordinality o(k, ord2)
              on o.k = cc.c ->> 'key') end,
        'key', case when v_keys and i.type::text <> 'mcq' then k.answer end
      ) order by t.ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.items i on i.id = t.item_id
      left join public.item_keys k on k.item_id = i.id
      left join public.responses r on r.attempt_id = v_attempt.id and r.item_id = i.id
    ), '[]'::jsonb)
  );
end $$;

-- Landing page info: adds answers still being checked, and the camera requirement.
create or replace function public.student_exam_info(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exams;
  v_attempt public.attempts;
  v_count int;
begin
  if not public.exam_assigned_to_me(p_exam_id) then
    raise exception 'Exam not found';
  end if;
  perform public.finalize_my_expired_attempts();

  select * into v_exam from public.exams where id = p_exam_id;
  select * into v_attempt from public.attempts where exam_id = p_exam_id and student_id = auth.uid();
  select count(*) into v_count from public.exam_items where exam_id = p_exam_id;

  return jsonb_build_object(
    'id', v_exam.id,
    'title', v_exam.title,
    'kind', v_exam.kind,
    'instructions', v_exam.instructions,
    'time_limit_minutes', v_exam.time_limit_minutes,
    'opens_at', v_exam.opens_at,
    'closes_at', v_exam.closes_at,
    'status', v_exam.status,
    'item_count', v_count,
    'require_access_code', v_exam.require_access_code,
    'require_camera', v_exam.require_camera,
    'leave_limit', v_exam.leave_limit,
    'is_open', v_exam.status = 'published'
               and (v_exam.opens_at is null or v_exam.opens_at <= now())
               and (v_exam.closes_at is null or v_exam.closes_at > now()),
    'server_now', now(),
    'attempt', case when v_attempt.id is null then null else jsonb_build_object(
      'id', v_attempt.id,
      'started_at', v_attempt.started_at,
      'deadline_at', v_attempt.deadline_at,
      'submitted_at', v_attempt.submitted_at,
      'end_reason', v_attempt.end_reason,
      'score', case when v_exam.show_score then v_attempt.score end,
      'max_score', case when v_exam.show_score then v_attempt.max_score end,
      'pending', public.attempt_pending(v_attempt.id)
    ) end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Camera: the exam screen needs to know, and accepts the camera warnings.
-- ---------------------------------------------------------------------------
create or replace function public.attempt_state(p_attempt_id uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
  v_exam public.exams;
  v_me public.profiles;
  v_leaves int;
begin
  select * into v_exam from public.exams where id = v_attempt.exam_id;
  select * into v_me from public.profiles where id = auth.uid();
  select count(*) into v_leaves from public.integrity_events where attempt_id = p_attempt_id and kind = 'left_app';
  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'exam_id', v_exam.id,
    'title', v_exam.title,
    'deadline_at', v_attempt.deadline_at,
    'server_now', now(),
    'total', coalesce(array_length(v_attempt.item_order, 1), 0),
    'leave_count', v_leaves,
    'leave_limit', v_exam.leave_limit,
    'require_camera', v_exam.require_camera,
    'student_name', v_me.full_name,
    'student_no', v_me.student_no,
    'answered', coalesce((
      select jsonb_agg(ord - 1 order by ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.responses r on r.attempt_id = v_attempt.id and r.item_id = t.item_id
      where public.is_answered(r.answer)
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.log_integrity_events(p_attempt_id uuid, p_token uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
  v_limit int;
  v_leaves int;
  v_existing int;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'Bad events';
  end if;
  select count(*) into v_existing from public.integrity_events where attempt_id = p_attempt_id;
  if v_existing < 1000 then
    insert into public.integrity_events (attempt_id, kind, detail)
    select p_attempt_id, e ->> 'kind', e -> 'detail'
      from jsonb_array_elements(p_events) with ordinality t(e, ord)
     where e ->> 'kind' in ('left_app', 'returned', 'copy', 'cut', 'paste', 'context_menu', 'print_key',
                            'cam_no_face', 'cam_away', 'cam_multi', 'cam_off')
       and pg_column_size(e) < 1000
       and ord <= 50;
  end if;

  select leave_limit into v_limit from public.exams where id = v_attempt.exam_id;
  if v_limit is not null then
    select count(*) into v_leaves from public.integrity_events where attempt_id = p_attempt_id and kind = 'left_app';
    if v_leaves >= v_limit then
      perform public.finalize_attempt(p_attempt_id, 'leave_limit');
      return jsonb_build_object('ended', true);
    end if;
  end if;
  return jsonb_build_object('ended', false);
end $$;

-- Live monitor: camera warnings and answers waiting to be checked.
create or replace function public.exam_monitor(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exams;
  v_total int;
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  perform public.finalize_expired_for_exam(p_exam_id);
  select * into v_exam from public.exams where id = p_exam_id;
  select count(*) into v_total from public.exam_items where exam_id = p_exam_id;

  return jsonb_build_object(
    'server_now', now(),
    'exam', jsonb_build_object(
      'id', v_exam.id, 'title', v_exam.title, 'status', v_exam.status,
      'time_limit_minutes', v_exam.time_limit_minutes, 'total_items', v_total,
      'require_access_code', v_exam.require_access_code, 'leave_limit', v_exam.leave_limit,
      'require_camera', v_exam.require_camera),
    'students', coalesce((
      with roster as (
        select m.student_id, min(s.name) as section
        from public.exam_sections es
        join public.sections s on s.id = es.section_id
        join public.section_members m on m.section_id = es.section_id
        where es.exam_id = p_exam_id
        group by m.student_id
        union
        select a.student_id, null from public.attempts a
        where a.exam_id = p_exam_id
          and not exists (select 1 from public.exam_sections es join public.section_members m
                          on m.section_id = es.section_id where es.exam_id = p_exam_id and m.student_id = a.student_id)
      )
      select jsonb_agg(jsonb_build_object(
        'student_id', p.id,
        'full_name', p.full_name,
        'student_no', p.student_no,
        'section', r.section,
        'attempt', case when a.id is null then null else jsonb_build_object(
          'id', a.id,
          'started_at', a.started_at,
          'deadline_at', a.deadline_at,
          'submitted_at', a.submitted_at,
          'end_reason', a.end_reason,
          'score', a.score,
          'max_score', a.max_score,
          'pending', public.attempt_pending(a.id),
          'last_seen_at', a.last_seen_at,
          'device', a.device_info ->> 'label',
          'answered', (select count(*) from public.responses x where x.attempt_id = a.id and public.is_answered(x.answer)),
          'leaves', (select count(*) from public.integrity_events e where e.attempt_id = a.id and e.kind = 'left_app'),
          'away_seconds', (select coalesce(sum((e.detail ->> 'away_seconds')::numeric), 0)::int
                           from public.integrity_events e where e.attempt_id = a.id and e.kind = 'returned'),
          'copy_paste', (select count(*) from public.integrity_events e
                         where e.attempt_id = a.id and e.kind in ('copy', 'cut', 'paste', 'context_menu', 'print_key')),
          'device_flags', (select count(*) from public.integrity_events e
                           where e.attempt_id = a.id and e.kind in ('device_changed', 'session_takeover', 'code_failed')),
          -- Each warning logs a start event and an end event (with seconds); count the starts.
          'camera', (select count(*) from public.integrity_events e
                     where e.attempt_id = a.id and e.kind in ('cam_no_face', 'cam_away', 'cam_multi', 'cam_off')
                       and (e.detail ->> 'phase') is distinct from 'end'),
          'camera_seconds', (select coalesce(sum(least((e.detail ->> 'seconds')::numeric, 36000)), 0)::int
                             from public.integrity_events e
                             where e.attempt_id = a.id and e.kind in ('cam_no_face', 'cam_away', 'cam_multi', 'cam_off')
                               and jsonb_typeof(e.detail -> 'seconds') = 'number'),
          'camera_kinds', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
                             select e.kind, count(*) as n from public.integrity_events e
                             where e.attempt_id = a.id and e.kind like 'cam\_%'
                               and (e.detail ->> 'phase') is distinct from 'end' group by e.kind) c)
        ) end
      ) order by p.full_name)
      from roster r
      join public.profiles p on p.id = r.student_id
      left join public.attempts a on a.exam_id = p_exam_id and a.student_id = r.student_id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.set_response_score(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.exam_check_summary(uuid)                     from public, anon;
revoke execute on function public.exam_check_item(uuid, uuid)                  from public, anon;
grant  execute on function public.set_response_score(uuid, uuid, numeric, text) to authenticated;
grant  execute on function public.exam_check_summary(uuid)                     to authenticated;
grant  execute on function public.exam_check_item(uuid, uuid)                  to authenticated;
