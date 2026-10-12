-- 1) Checker accounts: a separate role that can only score answers (identification, enumeration,
--    essay) of exams an instructor assigned to them, and only exams that have been taken.
-- 2) Student photo/avatar (small JPEG stored with the profile).
-- 3) Messages between a student and their instructors. Student-to-student is not possible.
-- 4) Announcements and email: instructor announcements, "new exam" and "exam tomorrow" emails.
--    Students can turn emails off in Account.

alter type public.user_role add value if not exists 'checker';

-- ---------------------------------------------------------------------------
-- Profile: avatar + email preference
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar text;
alter table public.profiles add column if not exists email_notifications boolean not null default true;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_check
    check (avatar is null or (length(avatar) <= 40000 and avatar like 'data:image/jpeg;base64,%'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Checkers
-- ---------------------------------------------------------------------------
create table if not exists public.exam_checkers (
  exam_id     uuid not null references public.exams (id) on delete cascade,
  checker_id  uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (exam_id, checker_id)
);
alter table public.exam_checkers enable row level security;
drop policy if exists exam_checkers_select on public.exam_checkers;
create policy exam_checkers_select on public.exam_checkers for select to authenticated
  using (checker_id = auth.uid() or public.owns_exam(exam_id) or public.is_admin());
-- No write policies: assigning goes through assign_checker() / remove_checker().

create or replace function public.require_exam_checker(p_exam_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()
          or exists (select 1 from public.exam_checkers where exam_id = p_exam_id and checker_id = auth.uid())) then
    raise exception 'Not allowed';
  end if;
end $$;
revoke execute on function public.require_exam_checker(uuid) from public, anon, authenticated;

create or replace function public.assign_checker(p_exam_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  perform public.require_exam_owner(p_exam_id);
  select * into v_p from public.profiles where lower(email) = lower(btrim(coalesce(p_email, '')));
  if v_p.id is null or v_p.role::text <> 'checker' then
    raise exception 'No checker account with that email. Ask the admin to set that account''s role to checker (Manage users).';
  end if;
  insert into public.exam_checkers (exam_id, checker_id, assigned_by)
  values (p_exam_id, v_p.id, auth.uid())
  on conflict do nothing;
  return jsonb_build_object('checker_id', v_p.id, 'full_name', v_p.full_name);
end $$;

create or replace function public.remove_checker(p_exam_id uuid, p_checker_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_owner(p_exam_id);
  delete from public.exam_checkers where exam_id = p_exam_id and checker_id = p_checker_id;
end $$;

create or replace function public.exam_checkers_list(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_owner(p_exam_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('checker_id', p.id, 'full_name', p.full_name, 'email', p.email)
                     order by p.full_name)
    from public.exam_checkers ec join public.profiles p on p.id = ec.checker_id
    where ec.exam_id = p_exam_id
  ), '[]'::jsonb);
end $$;

-- Finalizing timed-out attempts is also allowed for an exam's assigned checkers (they open exams to check).
create or replace function public.finalize_expired_for_exam(p_exam_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()
          or exists (select 1 from public.exam_checkers where exam_id = p_exam_id and checker_id = auth.uid())) then
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

-- The checker's dashboard: assigned exams that have at least one submission. Nothing else.
create or replace function public.my_checking_exams()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exam uuid;
begin
  for v_exam in select exam_id from public.exam_checkers where checker_id = auth.uid() loop
    perform public.finalize_expired_for_exam(v_exam);
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'course_code', c.code,
      'course_title', c.title,
      'instructor', i.full_name,
      'submitted', s.n,
      'pending', (select count(*) from public.responses r join public.attempts a on a.id = r.attempt_id
                  where a.exam_id = e.id and a.submitted_at is not null and r.points_awarded is null)
    ) order by e.created_at desc)
    from public.exam_checkers ec
    join public.exams e on e.id = ec.exam_id
    join public.courses c on c.id = e.course_id
    join public.profiles i on i.id = c.instructor_id
    cross join lateral (select count(*) as n from public.attempts a
                        where a.exam_id = e.id and a.submitted_at is not null) s
    where ec.checker_id = auth.uid() and s.n > 0
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Checking functions: instructors, admins and assigned checkers
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
  perform public.require_exam_checker(v_attempt.exam_id);
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

create or replace function public.exam_check_summary(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_checker(p_exam_id);
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

create or replace function public.exam_check_item(p_exam_id uuid, p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items;
begin
  perform public.require_exam_checker(p_exam_id);
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
        'comment', r.comment,
        'checked_by_name', (select full_name from public.profiles where id = r.checked_by)
      ) order by (r.attempt_id is not null and r.points_awarded is null) desc, p.full_name)
      from public.attempts a
      join public.profiles p on p.id = a.student_id
      left join public.responses r on r.attempt_id = a.id and r.item_id = v_item.id
      where a.exam_id = p_exam_id and a.submitted_at is not null and v_item.id = any (a.item_order)
    ), '[]'::jsonb)
  );
end $$;

-- Per-student review (instructor): adds who scored an answer and the student's photo.
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
    'student', jsonb_build_object('id', v_student.id, 'full_name', v_student.full_name,
                                  'student_no', v_student.student_no, 'email', v_student.email,
                                  'avatar', v_student.avatar),
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
        'comment', r.comment,
        'checked_by_name', (select full_name from public.profiles where id = r.checked_by)
      ) order by t.ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.items i on i.id = t.item_id
      left join public.item_keys k on k.item_id = i.id
      left join public.responses r on r.attempt_id = v_attempt.id and r.item_id = i.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Messages (student <-> their instructor only)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_inbox_idx on public.messages (recipient_id, read_at);
alter table public.messages enable row level security;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
revoke insert, update, delete on public.messages from authenticated, anon;

-- True only when one of the two teaches a course the other is enrolled in.
create or replace function public.can_message(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.section_members m
    join public.sections s on s.id = m.section_id
    join public.courses c on c.id = s.course_id
    where (m.student_id = p_a and c.instructor_id = p_b) or (m.student_id = p_b and c.instructor_id = p_a)
  )
$$;
revoke execute on function public.can_message(uuid, uuid) from public, anon;
grant  execute on function public.can_message(uuid, uuid) to authenticated;

create or replace function public.send_message(p_to uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Messages can be up to 2,000 characters';
  end if;
  if not public.can_message(auth.uid(), p_to) then
    raise exception 'You can only message your own instructors and students.';
  end if;
  if (select count(*) from public.messages where sender_id = auth.uid()
        and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'You are sending messages too fast. Wait a few minutes.';
  end if;
  insert into public.messages (sender_id, recipient_id, body) values (auth.uid(), p_to, v_body)
  returning id into v_id;
  return v_id;
end $$;

-- Conversations, newest first.
create or replace function public.my_inbox()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'last_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'other_id', o.other, 'full_name', p.full_name, 'avatar', p.avatar, 'role', p.role,
      'last_body', m.body, 'last_at', m.created_at, 'last_mine', m.sender_id = auth.uid(),
      'unread', (select count(*) from public.messages u
                 where u.sender_id = o.other and u.recipient_id = auth.uid() and u.read_at is null)
    ) as x
    from (select distinct case when sender_id = auth.uid() then recipient_id else sender_id end as other
          from public.messages where sender_id = auth.uid() or recipient_id = auth.uid()) o
    join public.profiles p on p.id = o.other
    cross join lateral (
      select * from public.messages mm
      where (mm.sender_id = auth.uid() and mm.recipient_id = o.other)
         or (mm.sender_id = o.other and mm.recipient_id = auth.uid())
      order by mm.created_at desc, mm.id desc limit 1) m
  ) t
$$;

-- One conversation (oldest first, last 200). Opening it marks the other person's messages as read.
create or replace function public.message_thread(p_other uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_other;
  if v_p.id is null then
    raise exception 'User not found';
  end if;
  if not public.can_message(auth.uid(), p_other)
     and not exists (select 1 from public.messages
                     where (sender_id = auth.uid() and recipient_id = p_other)
                        or (sender_id = p_other and recipient_id = auth.uid())) then
    raise exception 'Not allowed';
  end if;
  update public.messages set read_at = now()
   where sender_id = p_other and recipient_id = auth.uid() and read_at is null;
  return jsonb_build_object(
    'other', jsonb_build_object('id', v_p.id, 'full_name', v_p.full_name, 'avatar', v_p.avatar, 'role', v_p.role,
                                'can_reply', public.can_message(auth.uid(), p_other)),
    'me', auth.uid(),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_id = auth.uid(), 'body', m.body,
                                          'created_at', m.created_at) order by m.id)
      from (select * from public.messages
            where (sender_id = auth.uid() and recipient_id = p_other)
               or (sender_id = p_other and recipient_id = auth.uid())
            order by id desc limit 200) m
    ), '[]'::jsonb)
  );
end $$;

-- People I may start a conversation with: my instructors (students) / my students (instructors).
create or replace function public.my_contacts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'full_name'), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', 'instructor',
                              'detail', string_agg(distinct c.code, ', ')) as x
    from public.section_members m
    join public.sections s on s.id = m.section_id
    join public.courses c on c.id = s.course_id
    join public.profiles p on p.id = c.instructor_id
    where m.student_id = auth.uid() and p.id <> auth.uid()
    group by p.id, p.full_name
    union all
    select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', 'student',
                              'detail', concat_ws(' · ', nullif(p.student_no, ''), string_agg(distinct c.code || ' ' || s.name, ', '))) as x
    from public.courses c
    join public.sections s on s.course_id = c.id
    join public.section_members m on m.section_id = s.id
    join public.profiles p on p.id = m.student_id
    where c.instructor_id = auth.uid() and p.id <> auth.uid()
    group by p.id, p.full_name, p.student_no
  ) t
$$;

create or replace function public.unread_messages()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.messages where recipient_id = auth.uid() and read_at is null
$$;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 150),
  body          text not null check (length(btrim(body)) between 1 and 5000),
  section_ids   uuid[],              -- null = every section of the course
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz,
  emailed_count int
);
create index if not exists announcements_course_idx on public.announcements (course_id, created_at desc);

create or replace function public.sees_announcement(p_course uuid, p_sections uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.section_members m join public.sections s on s.id = m.section_id
    where m.student_id = auth.uid() and s.course_id = p_course
      and (p_sections is null or s.id = any (p_sections)))
$$;

alter table public.announcements enable row level security;
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (public.owns_course(course_id) or public.is_admin() or public.sees_announcement(course_id, section_ids));
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.owns_course(course_id) and created_by = auth.uid());
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.owns_course(course_id) or public.is_admin());
-- Sections must belong to the course.
create or replace function public.check_announcement_sections()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.section_ids is not null and exists (
       select 1 from unnest(new.section_ids) sid
       where not exists (select 1 from public.sections s where s.id = sid and s.course_id = new.course_id)) then
    raise exception 'A selected section is not part of this course';
  end if;
  return new;
end $$;
drop trigger if exists announcements_check on public.announcements;
create trigger announcements_check before insert or update on public.announcements
  for each row execute function public.check_announcement_sections();

-- ---------------------------------------------------------------------------
-- Email: who to send to, and bookkeeping
-- ---------------------------------------------------------------------------
alter table public.exams add column if not exists email_students boolean not null default true;
alter table public.exams add column if not exists notified_at timestamptz;  -- "new exam" email sent
alter table public.exams add column if not exists reminded_at timestamptz;  -- "opens soon" email sent
grant select (email_students) on public.exams to authenticated;

create or replace function public.announcement_recipients(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id;
  if v_a.id is null or not (public.owns_course(v_a.course_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  return (
    select jsonb_build_object(
      'students', count(*),
      'opted_out', count(*) filter (where not coalesce(email_notifications, true)),
      'emails', coalesce(jsonb_agg(email) filter (where email is not null and email_notifications), '[]'::jsonb))
    from (select distinct p.id, p.email, p.email_notifications
          from public.sections s
          join public.section_members m on m.section_id = s.id
          join public.profiles p on p.id = m.student_id
          where s.course_id = v_a.course_id and (v_a.section_ids is null or s.id = any (v_a.section_ids))) r
  );
end $$;

create or replace function public.mark_announcement_emailed(p_id uuid, p_count int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.announcements set emailed_at = now(), emailed_count = p_count
   where id = p_id and (public.owns_course(course_id) or public.is_admin());
end $$;

create or replace function public.exam_recipients(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_owner(p_exam_id);
  return (
    select jsonb_build_object(
      'students', count(*),
      'opted_out', count(*) filter (where not coalesce(email_notifications, true)),
      'emails', coalesce(jsonb_agg(email) filter (where email is not null and email_notifications), '[]'::jsonb))
    from (select distinct p.id, p.email, p.email_notifications
          from public.exam_sections es
          join public.section_members m on m.section_id = es.section_id
          join public.profiles p on p.id = m.student_id
          where es.exam_id = p_exam_id) r
  );
end $$;

create or replace function public.mark_exam_notified(p_exam_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_exam_owner(p_exam_id);
  update public.exams set notified_at = now() where id = p_exam_id;
end $$;

-- Settings only the database functions can read (no one can select them through the API).
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- Called by the hourly job (netlify/functions/reminders.mjs -> /api/cron/reminders).
-- Needs the secret stored in app_settings ('cron_secret'). Returns exams opening within 24 hours that
-- haven't had a reminder, with the students' emails, and marks them reminded.
create or replace function public.claim_exam_reminders(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
  v_ids uuid[];
begin
  select value into v_secret from public.app_settings where key = 'cron_secret';
  if v_secret is null or length(v_secret) < 12 or p_secret is distinct from v_secret then
    raise exception 'Not allowed';
  end if;
  with due as (
    update public.exams e set reminded_at = now()
    where e.status = 'published' and e.email_students and e.reminded_at is null
      and e.opens_at is not null and e.opens_at > now() and e.opens_at <= now() + interval '24 hours'
      and (e.notified_at is null or e.notified_at < e.opens_at - interval '24 hours')
    returning e.id
  )
  select array_agg(id) into v_ids from due;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'exam_id', d.id, 'title', d.title, 'course_code', c.code, 'course_title', c.title,
      'opens_at', d.opens_at, 'closes_at', d.closes_at, 'time_limit_minutes', d.time_limit_minutes,
      'emails', (select coalesce(jsonb_agg(distinct p.email), '[]'::jsonb)
                 from public.exam_sections es
                 join public.section_members m on m.section_id = es.section_id
                 join public.profiles p on p.id = m.student_id
                 where es.exam_id = d.id and p.email is not null and p.email_notifications)))
    from public.exams d join public.courses c on c.id = d.course_id
    where d.id = any (coalesce(v_ids, '{}'))
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.assign_checker(uuid, text)                      from public, anon;
revoke execute on function public.remove_checker(uuid, uuid)                      from public, anon;
revoke execute on function public.exam_checkers_list(uuid)                        from public, anon;
revoke execute on function public.my_checking_exams()                             from public, anon;
revoke execute on function public.set_response_score(uuid, uuid, numeric, text)   from public, anon;
revoke execute on function public.exam_check_summary(uuid)                        from public, anon;
revoke execute on function public.exam_check_item(uuid, uuid)                     from public, anon;
revoke execute on function public.attempt_review(uuid)                            from public, anon;
revoke execute on function public.send_message(uuid, text)                        from public, anon;
revoke execute on function public.my_inbox()                                      from public, anon;
revoke execute on function public.message_thread(uuid)                            from public, anon;
revoke execute on function public.my_contacts()                                   from public, anon;
revoke execute on function public.unread_messages()                               from public, anon;
revoke execute on function public.sees_announcement(uuid, uuid[])                 from public, anon;
revoke execute on function public.announcement_recipients(uuid)                   from public, anon;
revoke execute on function public.mark_announcement_emailed(uuid, int)            from public, anon;
revoke execute on function public.exam_recipients(uuid)                           from public, anon;
revoke execute on function public.mark_exam_notified(uuid)                        from public, anon;
revoke execute on function public.claim_exam_reminders(text)                      from public;
grant  execute on function public.assign_checker(uuid, text)                      to authenticated;
grant  execute on function public.remove_checker(uuid, uuid)                      to authenticated;
grant  execute on function public.exam_checkers_list(uuid)                        to authenticated;
grant  execute on function public.my_checking_exams()                             to authenticated;
grant  execute on function public.set_response_score(uuid, uuid, numeric, text)   to authenticated;
grant  execute on function public.exam_check_summary(uuid)                        to authenticated;
grant  execute on function public.exam_check_item(uuid, uuid)                     to authenticated;
grant  execute on function public.attempt_review(uuid)                            to authenticated;
grant  execute on function public.send_message(uuid, text)                        to authenticated;
grant  execute on function public.my_inbox()                                      to authenticated;
grant  execute on function public.message_thread(uuid)                            to authenticated;
grant  execute on function public.my_contacts()                                   to authenticated;
grant  execute on function public.unread_messages()                               to authenticated;
grant  execute on function public.sees_announcement(uuid, uuid[])                 to authenticated;
grant  execute on function public.announcement_recipients(uuid)                   to authenticated;
grant  execute on function public.mark_announcement_emailed(uuid, int)            to authenticated;
grant  execute on function public.exam_recipients(uuid)                           to authenticated;
grant  execute on function public.mark_exam_notified(uuid)                        to authenticated;
-- The hourly job has no signed-in user: it calls this with the anon key and the secret.
grant  execute on function public.claim_exam_reminders(text)                      to anon, authenticated;
