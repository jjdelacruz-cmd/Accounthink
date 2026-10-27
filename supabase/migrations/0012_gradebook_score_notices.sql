-- 1) Gradebook: every exam's scores of a course, per section (for the Excel download).
-- 2) Score-change notices: whenever a submitted attempt's score changes (an instructor or checker scored
--    an answer by hand, or the exam was re-graded), the student gets an in-app notice, and an email
--    (digest, sent by the hourly job once changes have settled) if they allow emails.

-- ---------------------------------------------------------------------------
-- Gradebook
-- ---------------------------------------------------------------------------
create or replace function public.course_gradebook(p_course_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exam uuid;
begin
  if not (public.owns_course(p_course_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  -- Everyone whose time ran out is graded first, so the sheet is complete.
  for v_exam in select id from public.exams where course_id = p_course_id and status <> 'draft' loop
    perform public.finalize_expired_for_exam(v_exam);
  end loop;

  return jsonb_build_object(
    'course', (select jsonb_build_object('code', c.code, 'title', c.title) from public.courses c where c.id = p_course_id),
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'kind', e.kind, 'status', e.status, 'opens_at', e.opens_at,
        'passing_percent', e.passing_percent,
        'max', (select coalesce(sum(i.points), 0) from public.exam_items ei
                join public.items i on i.id = ei.item_id where ei.exam_id = e.id),
        'section_ids', (select coalesce(jsonb_agg(es.section_id), '[]'::jsonb)
                        from public.exam_sections es where es.exam_id = e.id)
      ) order by coalesce(e.opens_at, e.created_at), e.created_at)
      from public.exams e where e.course_id = p_course_id and e.status <> 'draft'
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
      from public.sections s where s.course_id = p_course_id
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', p.id, 'full_name', p.full_name, 'student_no', p.student_no,
        'section_id', s.id, 'section_name', s.name,
        'scores', coalesce((
          select jsonb_object_agg(a.exam_id::text, jsonb_build_object(
            'score', a.score, 'max', a.max_score, 'submitted', a.submitted_at is not null,
            'pending', case when a.submitted_at is not null then public.attempt_pending(a.id) else 0 end))
          from public.attempts a
          join public.exams e on e.id = a.exam_id and e.course_id = p_course_id and e.status <> 'draft'
          where a.student_id = p.id
        ), '{}'::jsonb)
      ) order by s.name, p.full_name)
      from public.sections s
      join public.section_members m on m.section_id = s.id
      join public.profiles p on p.id = m.student_id
      where s.course_id = p_course_id
    ), '[]'::jsonb)
  );
end $$;
revoke execute on function public.course_gradebook(uuid) from public, anon;
grant  execute on function public.course_gradebook(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Score changes
-- ---------------------------------------------------------------------------
create table if not exists public.score_changes (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts (id) on delete cascade,
  old_score   numeric(8,2),
  new_score   numeric(8,2),
  max_score   numeric(8,2),
  reason      text not null default 'manual',   -- 'manual' (scored by hand) | 'regrade'
  changed_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,                      -- the student dismissed the in-app notice
  emailed_at  timestamptz                       -- included in an email (or skipped)
);
create index if not exists score_changes_attempt_idx on public.score_changes (attempt_id, created_at);
-- Nobody reads this table directly; the functions below are the only way in.
alter table public.score_changes enable row level security;
revoke all on public.score_changes from anon, authenticated;

create or replace function public.log_score_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only changes after submission count (finalizing an attempt sets its first score).
  if old.submitted_at is not null and new.submitted_at is not null and new.score is distinct from old.score then
    insert into public.score_changes (attempt_id, old_score, new_score, max_score, reason, changed_by)
    values (new.id, old.score, new.score, new.max_score,
            coalesce(nullif(current_setting('app.score_reason', true), ''), 'manual'), auth.uid());
  end if;
  return null;
end $$;
drop trigger if exists attempts_score_change on public.attempts;
create trigger attempts_score_change after update of score on public.attempts
  for each row execute function public.log_score_change();

-- Scoring by hand now also says whether the student will be told.
create or replace function public.set_response_score(p_attempt_id uuid, p_item_id uuid, p_points numeric,
                                                     p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_attempt public.attempts;
  v_item public.items;
  v_key jsonb;
  v_old numeric;
  v_comment text := nullif(btrim(left(coalesce(p_comment, ''), 2000)), '');
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Not allowed';
  end if;
  v_old := v_attempt.score;
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

  perform set_config('app.score_reason', 'manual', true);
  update public.attempts a
     set score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
   where a.id = p_attempt_id
  returning * into v_attempt;
  perform set_config('app.score_reason', '', true);

  return jsonb_build_object('score', v_attempt.score, 'max_score', v_attempt.max_score,
                            'pending', public.attempt_pending(p_attempt_id),
                            -- true when the student will be told: the score really changed and they can see scores
                            'notify', v_attempt.score is distinct from v_old
                                      and coalesce((select show_score from public.exams where id = v_attempt.exam_id), false));
end $$;

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

  perform set_config('app.score_reason', 'regrade', true);
  update public.attempts a set
    max_score = (select coalesce(sum(i.points), 0) from public.items i where i.id = any (a.item_order)),
    score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
  where a.exam_id = p_exam_id and a.submitted_at is not null;
  get diagnostics v_n = row_count;
  perform set_config('app.score_reason', '', true);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Student: unread score notices (one line per exam: first old score -> current score)
-- ---------------------------------------------------------------------------
create or replace function public.my_score_updates()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'attempt_id', a.id, 'exam_id', e.id, 'exam_title', e.title, 'course_code', c.code,
      'old_score', g.first_old, 'new_score', a.score, 'max_score', a.max_score,
      'by_hand', g.any_manual, 'at', g.last_at) as x
    from (select sc.attempt_id,
                 (array_agg(sc.old_score order by sc.id))[1] as first_old,
                 bool_or(sc.reason = 'manual') as any_manual,
                 max(sc.created_at) as last_at
          from public.score_changes sc where sc.seen_at is null group by sc.attempt_id) g
    join public.attempts a on a.id = g.attempt_id and a.student_id = auth.uid()
    join public.exams e on e.id = a.exam_id and e.show_score
    join public.courses c on c.id = e.course_id
    where g.first_old is distinct from a.score
  ) t
$$;

create or replace function public.dismiss_score_updates()
returns void language sql security definer set search_path = '' as $$
  update public.score_changes set seen_at = now()
   where seen_at is null
     and attempt_id in (select id from public.attempts where student_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Email digest, called by the hourly job with the shared secret. A student's changes are sent once,
-- after nothing changed for 10 minutes (so fixing a mis-click doesn't send two emails). At most 40
-- students per run; the rest go out next hour.
-- ---------------------------------------------------------------------------
create or replace function public.claim_score_update_emails(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
  v_groups jsonb;
begin
  select value into v_secret from public.app_settings where key = 'cron_secret';
  if v_secret is null or length(v_secret) < 12 or p_secret is distinct from v_secret then
    raise exception 'Not allowed';
  end if;

  with settled as (
    select attempt_id from public.score_changes
    where emailed_at is null
    group by attempt_id
    having max(created_at) < now() - interval '10 minutes'
    order by max(created_at)
    limit 40
  ),
  upd as (
    update public.score_changes sc set emailed_at = now()
    where sc.emailed_at is null and sc.attempt_id in (select attempt_id from settled)
    returning sc.attempt_id, sc.id, sc.old_score, sc.reason
  )
  select coalesce(jsonb_agg(jsonb_build_object('attempt_id', g.attempt_id, 'first_old', g.first_old, 'by_hand', g.by_hand)), '[]'::jsonb)
    into v_groups
  from (select attempt_id, (array_agg(old_score order by id))[1] as first_old, bool_or(reason = 'manual') as by_hand
        from upd group by attempt_id) g;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'email', p.email, 'name', p.full_name, 'exam_title', e.title, 'course_code', c.code,
      'old_score', g.first_old, 'new_score', a.score, 'max_score', a.max_score, 'by_hand', g.by_hand))
    from jsonb_to_recordset(v_groups) as g(attempt_id uuid, first_old numeric, by_hand boolean)
    join public.attempts a on a.id = g.attempt_id
    join public.exams e on e.id = a.exam_id and e.show_score
    join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = a.student_id
    where p.email is not null and p.email_notifications and g.first_old is distinct from a.score
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.set_response_score(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.regrade_exam(uuid)                            from public, anon;
revoke execute on function public.my_score_updates()                            from public, anon;
revoke execute on function public.dismiss_score_updates()                       from public, anon;
revoke execute on function public.claim_score_update_emails(text)               from public;
grant  execute on function public.set_response_score(uuid, uuid, numeric, text) to authenticated;
grant  execute on function public.regrade_exam(uuid)                            to authenticated;
grant  execute on function public.my_score_updates()                            to authenticated;
grant  execute on function public.dismiss_score_updates()                       to authenticated;
grant  execute on function public.claim_score_update_emails(text)               to anon, authenticated;
