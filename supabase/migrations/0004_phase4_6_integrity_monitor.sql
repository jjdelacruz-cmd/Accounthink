-- Phases 4–6: randomization, anti-cheating (sessions, device, integrity events,
-- rotating access code, leave limit) and the instructor's live monitor.
--
-- Every student call now carries a session token issued by claim_attempt().
-- Opening the exam on another device/tab issues a new token and the old one stops working.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.exams add column if not exists require_access_code boolean not null default false;
alter table public.exams add column if not exists access_secret uuid not null default gen_random_uuid();
alter table public.exams add column if not exists leave_limit int;
do $$ begin
  alter table public.exams add constraint exams_leave_limit_range check (leave_limit between 1 and 50);
exception when duplicate_object then null; end $$;

alter table public.attempts add column if not exists session_token uuid;
alter table public.attempts add column if not exists device_hash text;
alter table public.attempts add column if not exists device_info jsonb;
alter table public.attempts add column if not exists last_seen_at timestamptz;
alter table public.attempts add column if not exists end_reason text;

-- access_secret must never reach students: they read exams through RLS.
revoke select (access_secret) on public.exams from anon, authenticated;
-- Column-level revoke only bites when table-level select is also column-scoped:
revoke select on public.exams from anon, authenticated;
grant select (id, course_id, title, kind, instructions, time_limit_minutes, opens_at, closes_at, status,
              shuffle_items, shuffle_choices, show_score, created_by, created_at, updated_at,
              require_access_code, leave_limit)
  on public.exams to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity events
-- ---------------------------------------------------------------------------
create table if not exists public.integrity_events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts (id) on delete cascade,
  kind        text not null check (kind in (
                'left_app', 'returned', 'copy', 'cut', 'paste', 'context_menu', 'print_key',
                'device_changed', 'session_takeover', 'code_failed')),
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists integrity_events_attempt_idx on public.integrity_events (attempt_id, created_at);

alter table public.integrity_events enable row level security;
drop policy if exists integrity_events_select on public.integrity_events;
create policy integrity_events_select on public.integrity_events for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.attempts a where a.id = attempt_id and public.owns_exam(a.exam_id))
  );

-- ---------------------------------------------------------------------------
-- Rotating access code: 6 digits from the exam secret and the current minute.
-- ---------------------------------------------------------------------------
create or replace function public.access_code_at(p_secret uuid, p_window bigint)
returns text language sql immutable set search_path = '' as $$
  select lpad((abs(('x' || substr(md5(p_secret::text || ':' || p_window::text), 1, 8))::bit(32)::int) % 1000000)::text, 6, '0')
$$;
revoke execute on function public.access_code_at(uuid, bigint) from public, anon, authenticated;

create or replace function public.access_code_ok(p_exam_id uuid, p_code text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_window bigint := floor(extract(epoch from now()) / 60);
begin
  select access_secret into v_secret from public.exams where id = p_exam_id;
  -- Accept this minute's code and the previous one (for slow typers).
  return btrim(coalesce(p_code, '')) in (public.access_code_at(v_secret, v_window), public.access_code_at(v_secret, v_window - 1));
end $$;
revoke execute on function public.access_code_ok(uuid, text) from public, anon, authenticated;

-- Instructor: the code to show the class right now.
create or replace function public.current_access_code(p_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret uuid;
  v_epoch numeric := extract(epoch from now());
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  select access_secret into v_secret from public.exams where id = p_exam_id;
  return jsonb_build_object(
    'code', public.access_code_at(v_secret, floor(v_epoch / 60)::bigint),
    'seconds_left', 60 - floor(v_epoch)::bigint % 60
  );
end $$;

-- ---------------------------------------------------------------------------
-- Finalize (now records why the attempt ended)
-- ---------------------------------------------------------------------------
drop function if exists public.finalize_attempt(uuid);
create or replace function public.finalize_attempt(p_attempt_id uuid, p_reason text default null)
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
    end_reason = coalesce(p_reason,
      case when now() > a.deadline_at then 'timeout'
           when (select status from public.exams where id = a.exam_id) = 'closed' then 'closed'
           else 'student' end),
    session_token = null,
    max_score = (select coalesce(sum(i.points), 0) from public.items i where i.id = any (a.item_order)),
    score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
  where a.id = p_attempt_id;
end $$;
revoke execute on function public.finalize_attempt(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Start: access code + randomization
-- ---------------------------------------------------------------------------
drop function if exists public.start_attempt(uuid);
create or replace function public.start_attempt(p_exam_id uuid, p_code text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exams;
  v_attempt public.attempts;
  v_order uuid[];
  v_choice_orders jsonb;
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
    return v_attempt.id;  -- resume (claim_attempt checks the code if the device changed)
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
  if v_exam.require_access_code and not public.access_code_ok(p_exam_id, p_code) then
    raise exception 'Wrong or expired access code';
  end if;

  -- Question order: shuffled per student, or the instructor's order.
  if v_exam.shuffle_items then
    select array_agg(item_id order by random()) into v_order from public.exam_items where exam_id = p_exam_id;
  else
    select array_agg(item_id order by position, item_id) into v_order from public.exam_items where exam_id = p_exam_id;
  end if;

  -- Choice order per MC item; "all/none/both/neither of the above" stays last.
  if v_exam.shuffle_choices then
    select coalesce(jsonb_object_agg(i.id::text, (
             select jsonb_agg(c ->> 'key' order by (c ->> 'text') ~* '^\s*(all|none|both|neither) of the above', random())
             from jsonb_array_elements(i.choices) c)), '{}'::jsonb)
      into v_choice_orders
      from public.exam_items ei join public.items i on i.id = ei.item_id
     where ei.exam_id = p_exam_id and i.type = 'mcq';
  end if;

  insert into public.attempts (exam_id, student_id, deadline_at, item_order, choice_orders)
  values (
    p_exam_id,
    auth.uid(),
    least(now() + make_interval(mins => v_exam.time_limit_minutes), coalesce(v_exam.closes_at, 'infinity')),
    v_order,
    coalesce(v_choice_orders, '{}'::jsonb)
  )
  on conflict (exam_id, student_id) do nothing
  returning * into v_attempt;

  if v_attempt.id is null then  -- lost a race with a double-tap; use the existing row
    select * into v_attempt from public.attempts where exam_id = p_exam_id and student_id = auth.uid();
  end if;
  return v_attempt.id;
end $$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
-- Opens (or takes over) the attempt on this device and returns a session token.
-- Result: {"token": ...} or {"needs_code": true}. p_prev_token is the token this
-- browser tab already held (page reload): reclaiming with it is not flagged.
drop function if exists public.claim_attempt(uuid, jsonb, text);
create or replace function public.claim_attempt(p_attempt_id uuid, p_device jsonb, p_code text default null,
                                                p_prev_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_exam public.exams;
  v_hash text := left(p_device ->> 'hash', 128);
  v_token uuid := gen_random_uuid();
  v_device_changed boolean;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = auth.uid() for update;
  if v_attempt.id is null then
    raise exception 'Attempt not found';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'This exam has been submitted';
  end if;
  select * into v_exam from public.exams where id = v_attempt.exam_id;
  if now() > v_attempt.deadline_at + public.attempt_grace() or v_exam.status = 'closed' then
    raise exception 'Time is up';
  end if;

  v_device_changed := v_attempt.device_hash is not null and v_attempt.device_hash is distinct from v_hash;

  if v_device_changed and v_exam.require_access_code and not public.access_code_ok(v_exam.id, p_code) then
    if p_code is not null then
      insert into public.integrity_events (attempt_id, kind, detail)
      values (p_attempt_id, 'code_failed', jsonb_build_object('device', p_device ->> 'label'));
    end if;
    return jsonb_build_object('needs_code', true);
  end if;

  if v_device_changed then
    insert into public.integrity_events (attempt_id, kind, detail)
    values (p_attempt_id, 'device_changed',
            jsonb_build_object('from', v_attempt.device_info ->> 'label', 'to', p_device ->> 'label'));
  elsif v_attempt.session_token is not null
        and v_attempt.session_token is distinct from p_prev_token
        and v_attempt.last_seen_at > now() - interval '45 seconds' then
    -- Same device, but another tab/window was active moments ago.
    insert into public.integrity_events (attempt_id, kind, detail)
    values (p_attempt_id, 'session_takeover', jsonb_build_object('device', p_device ->> 'label'));
  end if;

  update public.attempts set
    session_token = v_token,
    device_hash = coalesce(v_hash, device_hash),
    device_info = jsonb_build_object('label', left(p_device ->> 'label', 200), 'hash', v_hash),
    last_seen_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('token', v_token);
end $$;

-- The caller's in-progress attempt, checked against the session token.
drop function if exists public.my_open_attempt(uuid);
create or replace function public.my_open_attempt(p_attempt_id uuid, p_token uuid)
returns public.attempts language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
begin
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
  if v_attempt.session_token is distinct from p_token then
    raise exception 'This exam was opened on another device';
  end if;
  update public.attempts set last_seen_at = now() where id = p_attempt_id;
  return v_attempt;
end $$;
revoke execute on function public.my_open_attempt(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student API (token versions; old signatures are dropped so they can't bypass it)
-- ---------------------------------------------------------------------------
drop function if exists public.attempt_state(uuid);
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

drop function if exists public.attempt_question(uuid, int);
create or replace function public.attempt_question(p_attempt_id uuid, p_token uuid, p_index int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
  v_item_id uuid;
  v_item public.items;
  v_choices jsonb;
  v_order jsonb;
begin
  if p_index is null or p_index < 0 or p_index >= coalesce(array_length(v_attempt.item_order, 1), 0) then
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

drop function if exists public.save_response(uuid, int, jsonb);
create or replace function public.save_response(p_attempt_id uuid, p_token uuid, p_index int, p_answer jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
  v_item_id uuid;
  v_type public.item_type;
begin
  if p_index is null or p_index < 0 or p_index >= array_length(v_attempt.item_order, 1) then
    raise exception 'No such question';
  end if;
  if pg_column_size(p_answer) > 4000 then
    raise exception 'Answer is too long';
  end if;
  v_item_id := v_attempt.item_order[p_index + 1];
  select type into v_type from public.items where id = v_item_id;

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

-- Heartbeat: keeps "online" status fresh and delivers deadline extensions.
create or replace function public.attempt_ping(p_attempt_id uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts := public.my_open_attempt(p_attempt_id, p_token);
begin
  return jsonb_build_object('deadline_at', v_attempt.deadline_at, 'server_now', now());
end $$;

-- Batch of integrity events from the exam screen. Returns {"ended": true} if the
-- leave limit was reached and the attempt was submitted.
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
     where e ->> 'kind' in ('left_app', 'returned', 'copy', 'cut', 'paste', 'context_menu', 'print_key')
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

drop function if exists public.submit_attempt(uuid);
create or replace function public.submit_attempt(p_attempt_id uuid, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_show boolean;
  v_expired boolean;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id and student_id = auth.uid();
  if v_attempt.id is null then
    raise exception 'Attempt not found';
  end if;
  v_expired := now() > v_attempt.deadline_at + public.attempt_grace()
               or (select status from public.exams where id = v_attempt.exam_id) = 'closed';
  -- A live attempt can only be submitted from the device holding it.
  if v_attempt.submitted_at is null and not v_expired and v_attempt.session_token is distinct from p_token then
    raise exception 'This exam was opened on another device';
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

-- Landing page info (adds access-code flag and leave limit).
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
      'max_score', case when v_exam.show_score then v_attempt.max_score end
    ) end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Instructor: live monitor + controls
-- ---------------------------------------------------------------------------
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
      'require_access_code', v_exam.require_access_code, 'leave_limit', v_exam.leave_limit),
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
          'last_seen_at', a.last_seen_at,
          'device', a.device_info ->> 'label',
          'answered', (select count(*) from public.responses x where x.attempt_id = a.id and public.is_answered(x.answer)),
          'leaves', (select count(*) from public.integrity_events e where e.attempt_id = a.id and e.kind = 'left_app'),
          'away_seconds', (select coalesce(sum((e.detail ->> 'away_seconds')::numeric), 0)::int
                           from public.integrity_events e where e.attempt_id = a.id and e.kind = 'returned'),
          'copy_paste', (select count(*) from public.integrity_events e
                         where e.attempt_id = a.id and e.kind in ('copy', 'cut', 'paste', 'context_menu', 'print_key')),
          'device_flags', (select count(*) from public.integrity_events e
                           where e.attempt_id = a.id and e.kind in ('device_changed', 'session_takeover', 'code_failed'))
        ) end
      ) order by p.full_name)
      from roster r
      join public.profiles p on p.id = r.student_id
      left join public.attempts a on a.exam_id = p_exam_id and a.student_id = r.student_id
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.extend_attempt(p_attempt_id uuid, p_minutes int)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null or not (public.owns_exam(v_attempt.exam_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'This attempt is already submitted';
  end if;
  if p_minutes not between 1 and 120 then
    raise exception 'Add between 1 and 120 minutes';
  end if;
  update public.attempts
     set deadline_at = greatest(deadline_at, now()) + make_interval(mins => p_minutes)
   where id = p_attempt_id
  returning deadline_at into v_attempt.deadline_at;
  return v_attempt.deadline_at;
end $$;

create or replace function public.end_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_exam uuid;
begin
  select exam_id into v_exam from public.attempts where id = p_attempt_id;
  if v_exam is null or not (public.owns_exam(v_exam) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  perform public.finalize_attempt(p_attempt_id, 'instructor');
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.start_attempt(uuid, text)                  from public, anon;
revoke execute on function public.claim_attempt(uuid, jsonb, text, uuid)     from public, anon;
revoke execute on function public.attempt_state(uuid, uuid)                  from public, anon;
revoke execute on function public.attempt_question(uuid, uuid, int)          from public, anon;
revoke execute on function public.save_response(uuid, uuid, int, jsonb)      from public, anon;
revoke execute on function public.attempt_ping(uuid, uuid)                   from public, anon;
revoke execute on function public.log_integrity_events(uuid, uuid, jsonb)    from public, anon;
revoke execute on function public.submit_attempt(uuid, uuid)                 from public, anon;
revoke execute on function public.current_access_code(uuid)                  from public, anon;
revoke execute on function public.exam_monitor(uuid)                         from public, anon;
revoke execute on function public.extend_attempt(uuid, int)                  from public, anon;
revoke execute on function public.end_attempt(uuid)                          from public, anon;
grant  execute on function public.start_attempt(uuid, text)                  to authenticated;
grant  execute on function public.claim_attempt(uuid, jsonb, text, uuid)     to authenticated;
grant  execute on function public.attempt_state(uuid, uuid)                  to authenticated;
grant  execute on function public.attempt_question(uuid, uuid, int)          to authenticated;
grant  execute on function public.save_response(uuid, uuid, int, jsonb)      to authenticated;
grant  execute on function public.attempt_ping(uuid, uuid)                   to authenticated;
grant  execute on function public.log_integrity_events(uuid, uuid, jsonb)    to authenticated;
grant  execute on function public.submit_attempt(uuid, uuid)                 to authenticated;
grant  execute on function public.current_access_code(uuid)                  to authenticated;
grant  execute on function public.exam_monitor(uuid)                         to authenticated;
grant  execute on function public.extend_attempt(uuid, int)                  to authenticated;
grant  execute on function public.end_attempt(uuid)                          to authenticated;
