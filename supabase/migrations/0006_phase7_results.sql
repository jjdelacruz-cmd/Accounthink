-- Phase 7: results, item analysis, per-student review, re-grading.
-- All functions are for the exam's instructor (or an admin) only.

alter table public.exams add column if not exists passing_percent numeric(5,2);
do $$ begin
  alter table public.exams add constraint exams_passing_range check (passing_percent between 0 and 100);
exception when duplicate_object then null; end $$;
-- Column-level select grant (0004) must include new columns.
grant select (passing_percent) on public.exams to authenticated;

create or replace function public.require_exam_owner(p_exam_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.owns_exam(p_exam_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
end $$;
revoke execute on function public.require_exam_owner(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item analysis
-- p (difficulty index) = average share of the item's points earned, over submitted
--   attempts (blank = 0).
-- D (discrimination) = p among the top 27% total scores minus p among the bottom 27%.
-- ---------------------------------------------------------------------------
create or replace function public.exam_item_analysis(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
  v_group int;
begin
  perform public.require_exam_owner(p_exam_id);
  perform public.finalize_expired_for_exam(p_exam_id);

  select count(*) into v_n from public.attempts where exam_id = p_exam_id and submitted_at is not null;
  v_group := greatest(1, round(v_n * 0.27));

  return jsonb_build_object(
    'submitted', v_n,
    'group_size', case when v_n >= 4 then v_group else 0 end,
    'items', coalesce((
      with sub as (
        select a.id, a.score,
               row_number() over (order by a.score desc, a.submitted_at) as rank_hi,
               row_number() over (order by a.score asc, a.submitted_at) as rank_lo
        from public.attempts a
        where a.exam_id = p_exam_id and a.submitted_at is not null
      ),
      per as (
        select ei.position, i.id as item_id, i.type, i.stem, i.choices, i.points, k.answer as key,
               s.id as attempt_id, s.rank_hi, s.rank_lo,
               r.answer,
               coalesce(r.points_awarded, 0) / nullif(i.points, 0) as share
        from public.exam_items ei
        join public.items i on i.id = ei.item_id
        left join public.item_keys k on k.item_id = i.id
        cross join sub s
        left join public.responses r on r.attempt_id = s.id and r.item_id = i.id
        where ei.exam_id = p_exam_id
      )
      select jsonb_agg(x order by (x ->> 'position')::int)
      from (
        select jsonb_build_object(
          'position', ei.position,
          'item_id', i.id,
          'type', i.type,
          'stem', i.stem,
          'choices', i.choices,
          'points', i.points,
          'key', k.answer,
          'p', (select round(avg(share), 4) from per where per.item_id = i.id),
          'n_full', (select count(*) from per where per.item_id = i.id and share >= 1),
          'n_blank', (select count(*) from per where per.item_id = i.id and not coalesce(public.is_answered(per.answer), false)),
          'd', case when v_n >= 4 then round(
                 (select avg(share) from per where per.item_id = i.id and rank_hi <= v_group)
               - (select avg(share) from per where per.item_id = i.id and rank_lo <= v_group), 4) end,
          -- MC: how many picked each choice.
          'choice_counts', case when i.type = 'mcq' then (
              select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (
                select per.answer ->> 'choice' as c, count(*) as n from per
                where per.item_id = i.id and nullif(per.answer ->> 'choice', '') is not null
                group by 1) t) end,
          -- Identification: most common wrong answers (to spot acceptable wordings).
          'wrong_answers', case when i.type = 'identification' then (
              select coalesce(jsonb_agg(jsonb_build_object('text', t, 'n', n) order by n desc, t), '[]'::jsonb) from (
                select min(btrim(per.answer ->> 'text')) as t, count(*) as n from per
                where per.item_id = i.id and share < 1 and btrim(coalesce(per.answer ->> 'text', '')) <> ''
                group by public.normalize_answer(per.answer ->> 'text')
                order by count(*) desc limit 8) w) end
        ) as x
        from public.exam_items ei
        join public.items i on i.id = ei.item_id
        left join public.item_keys k on k.item_id = i.id
        where ei.exam_id = p_exam_id
      ) q
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- One student's answers, in the order they saw them, with the key.
-- ---------------------------------------------------------------------------
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
        'choices', case when i.type = 'mcq' then coalesce((
            select jsonb_agg(c order by o.ord2)
            from jsonb_array_elements_text(v_attempt.choice_orders -> i.id::text) with ordinality o(k, ord2)
            join jsonb_array_elements(i.choices) c on c ->> 'key' = o.k), i.choices) end,
        'key', k.answer,
        'answer', r.answer,
        'points_awarded', r.points_awarded
      ) order by t.ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.items i on i.id = t.item_id
      left join public.item_keys k on k.item_id = i.id
      left join public.responses r on r.attempt_id = v_attempt.id and r.item_id = i.id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Re-grade every submitted attempt with the current keys and points.
-- ---------------------------------------------------------------------------
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
     and i.id = r.item_id and k.item_id = i.id;

  update public.attempts a set
    max_score = (select coalesce(sum(i.points), 0) from public.items i where i.id = any (a.item_order)),
    score = (select coalesce(sum(r.points_awarded), 0) from public.responses r where r.attempt_id = a.id)
  where a.exam_id = p_exam_id and a.submitted_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Add an accepted wording to an identification key (from item analysis).
create or replace function public.accept_identification_answer(p_item_id uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items;
begin
  select * into v_item from public.items where id = p_item_id;
  if v_item.id is null or not (public.owns_course(v_item.course_id) or public.is_admin()) then
    raise exception 'Not allowed';
  end if;
  if v_item.type <> 'identification' then
    raise exception 'Only identification items have accepted wordings';
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    raise exception 'Empty answer';
  end if;
  update public.item_keys
     set answer = jsonb_set(answer, '{accepted}', (answer -> 'accepted') || to_jsonb(btrim(p_text)))
   where item_id = p_item_id
     and not exists (select 1 from jsonb_array_elements_text(answer -> 'accepted') a
                     where public.normalize_answer(a) = public.normalize_answer(p_text));
end $$;

revoke execute on function public.exam_item_analysis(uuid)                 from public, anon;
revoke execute on function public.attempt_review(uuid)                     from public, anon;
revoke execute on function public.regrade_exam(uuid)                       from public, anon;
revoke execute on function public.accept_identification_answer(uuid, text) from public, anon;
grant  execute on function public.exam_item_analysis(uuid)                 to authenticated;
grant  execute on function public.attempt_review(uuid)                     to authenticated;
grant  execute on function public.regrade_exam(uuid)                       to authenticated;
grant  execute on function public.accept_identification_answer(uuid, text) to authenticated;
