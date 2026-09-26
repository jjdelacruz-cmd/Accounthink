-- Phase 2: item bank (MC / identification / enumeration), answer keys, exams.
-- Answer keys live in item_keys, readable only by the course's instructor (and admin).
-- Students never read items/keys directly; Phase 3 serves questions through functions.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.item_type as enum ('mcq', 'identification', 'enumeration');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.item_difficulty as enum ('easy', 'average', 'difficult');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exam_status as enum ('draft', 'published', 'closed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Items + keys
-- ---------------------------------------------------------------------------
-- choices (mcq only): [{"key":"A","text":"..."}, ...]
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  type         public.item_type not null,
  stem         text not null check (length(trim(stem)) > 0),
  choices      jsonb,
  topic        text,
  difficulty   public.item_difficulty not null default 'average',
  points       numeric(6,2) not null default 1 check (points > 0),
  explanation  text,
  archived     boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint items_mcq_has_choices check (
    type <> 'mcq' or coalesce(
      case when jsonb_typeof(choices) = 'array' then jsonb_array_length(choices) >= 2 end, false)
  )
);
create index if not exists items_course_idx on public.items (course_id) where not archived;

-- answer (by type):
--   mcq:            {"correct":"B"}
--   identification: {"accepted":["Going concern","Going concern assumption"]}
--   enumeration:    {"answers":[["Cash","Cash on hand"],["Receivables"]], "any_order":true}
create table if not exists public.item_keys (
  item_id  uuid primary key references public.items (id) on delete cascade,
  answer   jsonb not null
);

-- ---------------------------------------------------------------------------
-- Exams
-- ---------------------------------------------------------------------------
create table if not exists public.exams (
  id                  uuid primary key default gen_random_uuid(),
  course_id           uuid not null references public.courses (id) on delete cascade,
  title               text not null check (length(trim(title)) > 0),
  kind                text not null default 'quiz'
                        check (kind in ('quiz', 'prelim', 'midterm', 'final', 'other')),
  instructions        text,
  time_limit_minutes  int check (time_limit_minutes between 1 and 600),
  opens_at            timestamptz,
  closes_at           timestamptz,
  status              public.exam_status not null default 'draft',
  shuffle_items       boolean not null default true,
  shuffle_choices     boolean not null default true,
  show_score          boolean not null default true,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exams_window_valid check (opens_at is null or closes_at is null or closes_at > opens_at)
);
create index if not exists exams_course_idx on public.exams (course_id);

create table if not exists public.exam_items (
  exam_id   uuid not null references public.exams (id) on delete cascade,
  item_id   uuid not null references public.items (id) on delete cascade,
  position  int not null default 0,
  primary key (exam_id, item_id)
);
create index if not exists exam_items_item_idx on public.exam_items (item_id);

create table if not exists public.exam_sections (
  exam_id     uuid not null references public.exams (id) on delete cascade,
  section_id  uuid not null references public.sections (id) on delete cascade,
  primary key (exam_id, section_id)
);
create index if not exists exam_sections_section_idx on public.exam_sections (section_id);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();
drop trigger if exists exams_touch on public.exams;
create trigger exams_touch before update on public.exams
  for each row execute function public.touch_updated_at();

-- An exam may only use items and sections from its own course.
create or replace function public.check_exam_item_course()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select course_id from public.items where id = new.item_id)
     is distinct from (select course_id from public.exams where id = new.exam_id) then
    raise exception 'Item belongs to a different course';
  end if;
  return new;
end $$;

drop trigger if exists exam_items_same_course on public.exam_items;
create trigger exam_items_same_course before insert or update on public.exam_items
  for each row execute function public.check_exam_item_course();

create or replace function public.check_exam_section_course()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select course_id from public.sections where id = new.section_id)
     is distinct from (select course_id from public.exams where id = new.exam_id) then
    raise exception 'Section belongs to a different course';
  end if;
  return new;
end $$;

drop trigger if exists exam_sections_same_course on public.exam_sections;
create trigger exam_sections_same_course before insert or update on public.exam_sections
  for each row execute function public.check_exam_section_course();

-- Items are locked once an exam leaves draft (students may already be taking it).
create or replace function public.check_exam_items_editable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The courses join lets a whole-course delete cascade through.
  if exists (
    select 1 from public.exams e join public.courses c on c.id = e.course_id
    where e.id = coalesce(new.exam_id, old.exam_id) and e.status <> 'draft'
  ) then
    raise exception 'Move the exam back to draft before changing its items';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists exam_items_editable on public.exam_items;
create trigger exam_items_editable before insert or update or delete on public.exam_items
  for each row execute function public.check_exam_items_editable();

-- An item in a live (non-draft) exam can't be deleted on its own; archive it instead.
-- Deleting the whole course is still allowed (the course row is gone by then).
create or replace function public.guard_item_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.courses where id = old.course_id)
     and exists (
       select 1 from public.exam_items ei join public.exams e on e.id = ei.exam_id
       where ei.item_id = old.id and e.status <> 'draft'
     ) then
    raise exception 'This item is in a published exam. Archive it instead.';
  end if;
  return old;
end $$;

drop trigger if exists items_guard_delete on public.items;
create trigger items_guard_delete before delete on public.items
  for each row execute function public.guard_item_delete();

-- Publishing requires items, sections, and a time limit.
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
  return new;
end $$;

drop trigger if exists exams_publish_check on public.exams;
create trigger exams_publish_check before update on public.exams
  for each row execute function public.check_exam_publish();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.owns_exam(p_exam_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.exams e join public.courses c on c.id = e.course_id
    where e.id = p_exam_id and c.instructor_id = auth.uid()
  )
$$;

create or replace function public.owns_item(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i join public.courses c on c.id = i.course_id
    where i.id = p_item_id and c.instructor_id = auth.uid()
  )
$$;

-- Published exam assigned to one of the caller's sections.
create or replace function public.exam_assigned_to_me(p_exam_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.exams e
    join public.exam_sections es on es.exam_id = e.id
    join public.section_members m on m.section_id = es.section_id
    where e.id = p_exam_id and e.status <> 'draft' and m.student_id = auth.uid()
  )
$$;

-- Save item + key in one transaction. Runs as the caller, so RLS applies.
create or replace function public.save_item(p_item jsonb, p_answer jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid := nullif(p_item ->> 'id', '')::uuid;
  v_type text := p_item ->> 'type';
begin
  -- Answer key must match the item type.
  if v_type = 'mcq' and not coalesce(
       jsonb_typeof(p_item -> 'choices') = 'array'
       and exists (select 1 from jsonb_array_elements(p_item -> 'choices') c
                   where c ->> 'key' = p_answer ->> 'correct'), false) then
    raise exception 'The correct answer must be one of the choices';
  elsif v_type = 'identification' and not coalesce(
       jsonb_typeof(p_answer -> 'accepted') = 'array'
       and jsonb_array_length(p_answer -> 'accepted') >= 1, false) then
    raise exception 'Give at least one accepted answer';
  elsif v_type = 'enumeration' and not coalesce(
       jsonb_typeof(p_answer -> 'answers') = 'array'
       and jsonb_array_length(p_answer -> 'answers') >= 2, false) then
    raise exception 'An enumeration needs at least 2 answers';
  end if;

  if v_id is null then
    insert into public.items (course_id, type, stem, choices, topic, difficulty, points, explanation, created_by)
    values (
      (p_item ->> 'course_id')::uuid,
      (p_item ->> 'type')::public.item_type,
      p_item ->> 'stem',
      p_item -> 'choices',
      nullif(p_item ->> 'topic', ''),
      coalesce(nullif(p_item ->> 'difficulty', ''), 'average')::public.item_difficulty,
      coalesce((p_item ->> 'points')::numeric, 1),
      nullif(p_item ->> 'explanation', ''),
      auth.uid()
    )
    returning id into v_id;
    insert into public.item_keys (item_id, answer) values (v_id, p_answer);
  else
    update public.items set
      type        = (p_item ->> 'type')::public.item_type,
      stem        = p_item ->> 'stem',
      choices     = p_item -> 'choices',
      topic       = nullif(p_item ->> 'topic', ''),
      difficulty  = coalesce(nullif(p_item ->> 'difficulty', ''), 'average')::public.item_difficulty,
      points      = coalesce((p_item ->> 'points')::numeric, 1),
      explanation = nullif(p_item ->> 'explanation', '')
    where id = v_id;
    if not found then
      raise exception 'Item not found';
    end if;
    insert into public.item_keys (item_id, answer) values (v_id, p_answer)
    on conflict (item_id) do update set answer = excluded.answer;
  end if;
  return v_id;
end $$;

revoke execute on function public.save_item(jsonb, jsonb) from public, anon;
grant  execute on function public.save_item(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.items         enable row level security;
alter table public.item_keys     enable row level security;
alter table public.exams         enable row level security;
alter table public.exam_items    enable row level security;
alter table public.exam_sections enable row level security;

-- items: course owner (and admin) only. No student access at all.
drop policy if exists items_all on public.items;
create policy items_all on public.items for all to authenticated
  using (public.owns_course(course_id) or public.is_admin())
  with check (public.owns_course(course_id) or public.is_admin());

-- item_keys: course owner (and admin) only.
drop policy if exists item_keys_all on public.item_keys;
create policy item_keys_all on public.item_keys for all to authenticated
  using (public.owns_item(item_id) or public.is_admin())
  with check (public.owns_item(item_id) or public.is_admin());

-- exams: owner manages; students may see published exams assigned to them.
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
  using (public.owns_course(course_id) or public.is_admin() or public.exam_assigned_to_me(id));

drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams for insert to authenticated
  with check (public.owns_course(course_id));

drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams for update to authenticated
  using (public.owns_course(course_id) or public.is_admin())
  with check (public.owns_course(course_id) or public.is_admin());

drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams for delete to authenticated
  using (public.owns_course(course_id) or public.is_admin());

-- exam_items: owner only (students get questions via Phase 3 functions).
drop policy if exists exam_items_all on public.exam_items;
create policy exam_items_all on public.exam_items for all to authenticated
  using (public.owns_exam(exam_id) or public.is_admin())
  with check (public.owns_exam(exam_id) or public.is_admin());

-- exam_sections: owner manages; students see rows for their own sections.
drop policy if exists exam_sections_select on public.exam_sections;
create policy exam_sections_select on public.exam_sections for select to authenticated
  using (public.owns_exam(exam_id) or public.is_admin() or public.is_section_member(section_id));

drop policy if exists exam_sections_write on public.exam_sections;
create policy exam_sections_write on public.exam_sections for insert to authenticated
  with check (public.owns_exam(exam_id));

drop policy if exists exam_sections_delete on public.exam_sections;
create policy exam_sections_delete on public.exam_sections for delete to authenticated
  using (public.owns_exam(exam_id) or public.is_admin());
