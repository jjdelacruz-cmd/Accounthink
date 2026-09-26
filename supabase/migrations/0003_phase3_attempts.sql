-- Phase 3: student attempts, autosaved responses, server-side grading.
-- Students never write attempts/responses directly: every step goes through a
-- security-definer function that checks ownership, exam window and deadline.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.attempts (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null references public.exams (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz not null,
  submitted_at  timestamptz,
  item_order    uuid[] not null,          -- question order for this student
  choice_orders jsonb not null default '{}'::jsonb,  -- {item_id: ["C","A",...]} (Phase 4)
  score         numeric(8,2),
  max_score     numeric(8,2),
  unique (exam_id, student_id)            -- one attempt per student per exam
);
create index if not exists attempts_exam_idx on public.attempts (exam_id);
create index if not exists attempts_student_idx on public.attempts (student_id);

-- answer (by type): mcq {"choice":"B"} · identification {"text":"..."} · enumeration {"items":["..",".."]}
create table if not exists public.responses (
  attempt_id      uuid not null references public.attempts (id) on delete cascade,
  item_id         uuid not null references public.items (id) on delete cascade,
  answer          jsonb not null,
  saved_at        timestamptz not null default now(),
  points_awarded  numeric(8,2),
  primary key (attempt_id, item_id)
);

-- Seconds of network grace after the deadline for the last autosave / submit.
create or replace function public.attempt_grace() returns interval
language sql immutable set search_path = '' as $$ select interval '20 seconds' $$;

-- ---------------------------------------------------------------------------
-- Exams with attempts can't change items or go back to draft.
-- ---------------------------------------------------------------------------
create or replace function public.check_exam_items_editable()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_exam uuid := coalesce(new.exam_id, old.exam_id);
begin
  -- The courses join lets a whole-course delete cascade through.
  if exists (
    select 1 from public.exams e join public.courses c on c.id = e.course_id
    where e.id = v_exam and e.status <> 'draft'
  ) then
    raise exception 'Move the exam back to draft before changing its items';
  end if;
  if exists (
    select 1 from public.attempts a join public.exams e on e.id = a.exam_id
    join public.courses c on c.id = e.course_id where a.exam_id = v_exam
  ) then
    raise exception 'Students have already started this exam; its items can no longer change';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.check_exam_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if new.time_limit_minutes is null then
      raise exception 'Set a time limit before publishing';
    end if;
    if not exists (select 1 from public.exam_items where exam_id = new.id) then
      raise exception 'Add at least one item before publishing';
    end if;
    if not exists (select 1 from public.exam_sections where exam_id = new.id) then
      raise exception 'Assign at least one section before publishing';
    end if;
  end if;
  if new.status = 'draft' and old.status <> 'draft'
     and exists (select 1 from public.attempts where exam_id = new.id) then
    raise exception 'Students have already started this exam; it can be closed or reopened but not moved back to draft';
  end if;
  return new;
end $$;

-- Whether a saved answer actually has content (a cleared box doesn't count).
create or replace function public.is_answered(p_answer jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(btrim(p_answer ->> 'choice'), '') is not null
    or nullif(btrim(p_answer ->> 'text'), '') is not null
    or exists (select 1 from jsonb_array_elements_text(
                 case when jsonb_typeof(p_answer -> 'items') = 'array' then p_answer -> 'items' else '[]'::jsonb end) x
               where btrim(x) <> ''),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Grading
-- ---------------------------------------------------------------------------
-- Same rules as normalizeAnswer() in src/lib/items.ts.
create or replace function public.normalize_answer(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           btrim(regexp_replace(lower(normalize(coalesce(p, ''), NFKC)), '\s+', ' ', 'g')),
           '[.,;:!?]+$', '')
$$;

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

  if p_type = 'mcq' then
    return case when p_answer ->> 'choice' = p_key ->> 'correct' then p_points else 0 end;
  end if;

  if p_type = 'identification' then
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

-- Grade and finalize one attempt (internal).
create or replace function public.finalize_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.submitted_at is not null then
    return;
  end if;

  update public.responses r
     set points_awarded = public.grade_response(i.type, i.points, k.answer, r.answer)
    from public.items i
    join public.item_keys k on k.item_id = i.id
   where r.attempt_id = p_attempt_id and i.id = r.item_id;

  update public.attempts a set
    submitted_at = least(now(), a.deadline_at + public.attempt_grace()),
    max_score = (select coalesce(sum(i.points), 0) from public.items i where i.id = any (a.item_order)),
    score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
  where a.id = p_attempt_id;
end $$;
revoke execute on function public.finalize_attempt(uuid) from public, anon, authenticated;

-- Finalize this caller's attempts whose time ran out (called on page loads).
create or replace function public.finalize_my_expired_attempts()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select a.id from public.attempts a
    join public.exams e on e.id = a.exam_id
    where a.student_id = auth.uid() and a.submitted_at is null
      and (a.deadline_at + public.attempt_grace() < now() or e.status = 'closed')
  loop
    perform public.finalize_attempt(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Student API
-- ---------------------------------------------------------------------------
-- What the exam landing page needs, without anything secret.
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
    'is_open', v_exam.status = 'published'
               and (v_exam.opens_at is null or v_exam.opens_at <= now())
               and (v_exam.closes_at is null or v_exam.closes_at > now()),
    'server_now', now(),
    'attempt', case when v_attempt.id is null then null else jsonb_build_object(
      'id', v_attempt.id,
      'started_at', v_attempt.started_at,
      'deadline_at', v_attempt.deadline_at,
      'submitted_at', v_attempt.submitted_at,
      'score', case when v_exam.show_score then v_attempt.score end,
      'max_score', case when v_exam.show_score then v_attempt.max_score end
    ) end
  );
end $$;

-- Start (or resume) the caller's attempt. Returns the attempt id.
create or replace function public.start_attempt(p_exam_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exams;
  v_attempt public.attempts;
  v_order uuid[];
begin
  if auth.uid() is null or public.my_role() <> 'student' then
    raise exception 'Only students can take exams';
  end if;
  if not public.exam_assigned_to_me(p_exam_id) then
    raise exception 'Exam not found';
  end if;

  perform public.finalize_my_expired_attempts();
  select * into v_attempt from public.attempts where exam_id = p_exam_id and student_id = auth.uid();
  if v_attempt.id is not null then
    if v_attempt.submitted_at is not null then
      raise exception 'You have already submitted this exam';
    end if;
    return v_attempt.id;  -- resume
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam.status <> 'published' then
    raise exception 'This exam is not open';
  end if;
  if v_exam.opens_at is not null and now() < v_exam.opens_at then
    raise exception 'This exam has not opened yet';
  end if;
  if v_exam.closes_at is not null and now() >= v_exam.closes_at then
    raise exception 'This exam is already closed';
  end if;

  select array_agg(item_id order by position, item_id) into v_order
    from public.exam_items where exam_id = p_exam_id;

  insert into public.attempts (exam_id, student_id, deadline_at, item_order)
  values (
    p_exam_id,
    auth.uid(),
    least(now() + make_interval(mins => v_exam.time_limit_minutes), coalesce(v_exam.closes_at, 'infinity')),
    v_order
  )
  on conflict (exam_id, student_id) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then  -- lost a race with a double-tap; use the existing row
    select * into v_attempt from public.attempts where exam_id = p_exam_id and student_id = auth.uid();
  end if;
  return v_attempt.id;
end $$;

-- Loads the caller's in-progress attempt, or raises.
create or replace function public.my_open_attempt(p_attempt_id uuid)
returns public.attempts language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
begin
  -- No finalizing here: a raised error would roll it back. Expired attempts are
  -- finalized by student_exam_info(), submit_attempt() and finalize_expired_for_exam().
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = auth.uid();
  if v_attempt.id is null then
    raise exception 'Attempt not found';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'This exam has been submitted';
  end if;
  if now() > v_attempt.deadline_at + public.attempt_grace()
     or (select status from public.exams where id = v_attempt.exam_id) = 'closed' then
    raise exception 'Time is up';
  end if;
  return v_attempt;
end $$;
revoke execute on function public.my_open_attempt(uuid) from public, anon, authenticated;

-- Overview for the exam screen: timing and which questions are answered.
create or replace function public.attempt_state(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id);
  v_exam public.exams;
begin
  select * into v_exam from public.exams where id = v_attempt.exam_id;
  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'exam_id', v_exam.id,
    'title', v_exam.title,
    'deadline_at', v_attempt.deadline_at,
    'server_now', now(),
    'total', coalesce(array_length(v_attempt.item_order, 1), 0),
    'answered', coalesce((
      select jsonb_agg(ord - 1 order by ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.responses r on r.attempt_id = v_attempt.id and r.item_id = t.item_id
      where public.is_answered(r.answer)
    ), '[]'::jsonb)
  );
end $$;

-- One question (0-based index), without its key, plus the caller's saved answer.
create or replace function public.attempt_question(p_attempt_id uuid, p_index int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id);
  v_item_id uuid;
  v_item public.items;
  v_choices jsonb;
  v_order jsonb;
begin
  if p_index < 0 or p_index >= coalesce(array_length(v_attempt.item_order, 1), 0) then
    raise exception 'No such question';
  end if;
  v_item_id := v_attempt.item_order[p_index + 1];
  select * into v_item from public.items where id = v_item_id;

  v_choices := v_item.choices;
  v_order := v_attempt.choice_orders -> v_item_id::text;
  if v_item.type = 'mcq' and v_order is not null then
    select jsonb_agg(c order by o.ord) into v_choices
      from jsonb_array_elements_text(v_order) with ordinality o(k, ord)
      join jsonb_array_elements(v_item.choices) c on c ->> 'key' = o.k;
  end if;

  return jsonb_build_object(
    'index', p_index,
    'total', array_length(v_attempt.item_order, 1),
    'type', v_item.type,
    'stem', v_item.stem,
    'points', v_item.points,
    'choices', case when v_item.type = 'mcq' then v_choices end,
    'slots', case when v_item.type = 'enumeration'
                  then (select jsonb_array_length(answer -> 'answers') from public.item_keys where item_id = v_item_id) end,
    'answer', (select answer from public.responses where attempt_id = p_attempt_id and item_id = v_item_id)
  );
end $$;

-- Autosave one answer. Allowed until the deadline (plus a short network grace).
create or replace function public.save_response(p_attempt_id uuid, p_index int, p_answer jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id);
  v_item_id uuid;
  v_type public.item_type;
begin
  if p_index < 0 or p_index >= array_length(v_attempt.item_order, 1) then
    raise exception 'No such question';
  end if;
  if pg_column_size(p_answer) > 4000 then
    raise exception 'Answer is too long';
  end if;
  v_item_id := v_attempt.item_order[p_index + 1];
  select type into v_type from public.items where id = v_item_id;

  -- Keep only the field that belongs to this question type.
  p_answer := case v_type
    when 'mcq' then jsonb_build_object('choice', p_answer ->> 'choice')
    when 'identification' then jsonb_build_object('text', left(p_answer ->> 'text', 500))
    else jsonb_build_object('items', coalesce(p_answer -> 'items', '[]'::jsonb))
  end;

  insert into public.responses (attempt_id, item_id, answer, saved_at)
  values (p_attempt_id, v_item_id, p_answer, now())
  on conflict (attempt_id, item_id) do update set answer = excluded.answer, saved_at = excluded.saved_at;
  return now();
end $$;

-- Submit: grade on the server and return what the student may see.
create or replace function public.submit_attempt(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_show boolean;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = auth.uid();
  if v_attempt.id is null then
    raise exception 'Attempt not found';
  end if;
  perform public.finalize_attempt(p_attempt_id);

  select * into v_attempt from public.attempts where id = p_attempt_id;
  select show_score into v_show from public.exams where id = v_attempt.exam_id;
  return jsonb_build_object(
    'exam_id', v_attempt.exam_id,
    'submitted_at', v_attempt.submitted_at,
    'score', case when v_show then v_attempt.score end,
    'max_score', case when v_show then v_attempt.max_score end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Instructor: finalize everyone's expired attempts for an exam (results pages).
-- ---------------------------------------------------------------------------
create or replace function public.finalize_expired_for_exam(p_exam_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  for r in
    select a.id from public.attempts a join public.exams e on e.id = a.exam_id
    where a.exam_id = p_exam_id and a.submitted_at is null
      and (a.deadline_at + public.attempt_grace() < now() or e.status = 'closed')
  loop
    perform public.finalize_attempt(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions + RLS
-- ---------------------------------------------------------------------------
revoke execute on function public.student_exam_info(uuid)           from public, anon;
revoke execute on function public.start_attempt(uuid)               from public, anon;
revoke execute on function public.attempt_state(uuid)               from public, anon;
revoke execute on function public.attempt_question(uuid, int)       from public, anon;
revoke execute on function public.save_response(uuid, int, jsonb)   from public, anon;
revoke execute on function public.submit_attempt(uuid)              from public, anon;
revoke execute on function public.finalize_my_expired_attempts()    from public, anon;
revoke execute on function public.finalize_expired_for_exam(uuid)   from public, anon;
grant  execute on function public.student_exam_info(uuid)           to authenticated;
grant  execute on function public.start_attempt(uuid)               to authenticated;
grant  execute on function public.attempt_state(uuid)               to authenticated;
grant  execute on function public.attempt_question(uuid, int)       to authenticated;
grant  execute on function public.save_response(uuid, int, jsonb)   to authenticated;
grant  execute on function public.submit_attempt(uuid)              to authenticated;
grant  execute on function public.finalize_my_expired_attempts()    to authenticated;
grant  execute on function public.finalize_expired_for_exam(uuid)   to authenticated;

alter table public.attempts  enable row level security;
alter table public.responses enable row level security;

-- Read-only via RLS; all writes go through the functions above.
-- Students do NOT get a select policy on attempts/responses: points_awarded and
-- scores would leak when show_score is off. They use student_exam_info() instead.
drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts for select to authenticated
  using (public.owns_exam(exam_id) or public.is_admin());

drop policy if exists responses_select on public.responses;
create policy responses_select on public.responses for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.attempts a where a.id = attempt_id and public.owns_exam(a.exam_id))
  );
