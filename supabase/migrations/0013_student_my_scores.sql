-- Accounthink 0013: the student's "My scores" tab.
-- One call returns every exam assigned to the signed-in student (published or closed) with their own result.
-- The score is null when the instructor has not released scores (show_score off), exactly like the exam page.

create or replace function public.my_scores()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'course_code', x ->> 'sort_at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'exam_id', e.id,
      'title', e.title,
      'kind', e.kind,
      'status', e.status,
      'course_id', c.id,
      'course_code', c.code,
      'course_title', c.title,
      'section_name', s.name,
      'sort_at', coalesce(a.submitted_at, e.opens_at, e.created_at),
      'attempt_id', a.id,
      'started', a.id is not null,
      'submitted_at', a.submitted_at,
      'end_reason', a.end_reason,
      'released', e.show_score,
      'score', case when e.show_score and a.submitted_at is not null then a.score end,
      'max_score', case when e.show_score and a.submitted_at is not null then a.max_score end,
      'pending', case when a.submitted_at is not null then public.attempt_pending(a.id) else 0 end
    ) as x
    from public.exams e
    join public.courses c on c.id = e.course_id
    join lateral (
      select sec.id, sec.name
        from public.exam_sections es
        join public.section_members m on m.section_id = es.section_id and m.student_id = auth.uid()
        join public.sections sec on sec.id = es.section_id
       where es.exam_id = e.id
       order by sec.name limit 1
    ) s on true
    left join public.attempts a on a.exam_id = e.id and a.student_id = auth.uid()
    where e.status <> 'draft'
  ) t
$$;

revoke execute on function public.my_scores() from public, anon;
grant  execute on function public.my_scores() to authenticated;
