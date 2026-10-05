-- Feedback for students after they submit: which questions they got right or wrong,
-- and optionally the correct answers.
--   feedback:             'off' | 'marks' (right/wrong only) | 'answers' (right/wrong + correct answers)
--   feedback_after_close: true  = shown only once the exam is closed (so finished students can't
--                                 pass answers to classmates still taking it)
--                         false = shown right after submitting

alter table public.exams add column if not exists feedback text not null default 'answers';
alter table public.exams add column if not exists feedback_after_close boolean not null default true;
do $$ begin
  alter table public.exams add constraint exams_feedback_check check (feedback in ('off', 'marks', 'answers'));
exception when duplicate_object then null; end $$;

grant select (feedback, feedback_after_close) on public.exams to authenticated;

-- ---------------------------------------------------------------------------
-- The student's own submitted attempt, question by question.
-- Never reveals keys unless feedback = 'answers' and it has been released.
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
        'points_awarded', coalesce(r.points_awarded, 0),
        'answer', r.answer,
        -- choices in the order this student saw them; is_key only when answers are shown
        'choices', case when i.type = 'mcq' then (
            select jsonb_agg(jsonb_build_object(
                     'key', c ->> 'key', 'text', c ->> 'text',
                     'is_key', case when v_keys then (c ->> 'key') = (k.answer ->> 'correct') end)
                   order by coalesce(o.ord2, cc.ord3))
            from jsonb_array_elements(i.choices) with ordinality cc(c, ord3)
            left join jsonb_array_elements_text(v_attempt.choice_orders -> i.id::text) with ordinality o(k, ord2)
              on o.k = cc.c ->> 'key') end,
        'key', case when v_keys and i.type <> 'mcq' then k.answer end
      ) order by t.ord)
      from unnest(v_attempt.item_order) with ordinality t(item_id, ord)
      join public.items i on i.id = t.item_id
      left join public.item_keys k on k.item_id = i.id
      left join public.responses r on r.attempt_id = v_attempt.id and r.item_id = i.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.my_exam_feedback(uuid) from public, anon;
grant  execute on function public.my_exam_feedback(uuid) to authenticated;
