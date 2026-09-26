-- Phase 1: profiles + roles, courses, sections, section membership.
-- Every table has RLS on. Students join sections only through join_section().

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('student', 'instructor', 'admin');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  student_no  text,
  role        public.user_role not null default 'student',
  created_at  timestamptz not null default now()
);

create table if not exists public.courses (
  id             uuid primary key default gen_random_uuid(),
  instructor_id  uuid not null references public.profiles (id) on delete cascade,
  code           text not null,
  title          text not null,
  created_at     timestamptz not null default now()
);
create index if not exists courses_instructor_idx on public.courses (instructor_id);

-- 6-char join code without look-alike characters (0/O, 1/I/L).
create or replace function public.gen_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6);
$$;

create table if not exists public.sections (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  name         text not null,
  school_year  text,
  semester     text,
  join_code    text not null unique default public.gen_join_code(),
  join_open    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists sections_course_idx on public.sections (course_id);

create table if not exists public.section_members (
  section_id  uuid not null references public.sections (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (section_id, student_id)
);
create index if not exists section_members_student_idx on public.section_members (student_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.owns_course(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from public.courses where id = p_course_id and instructor_id = auth.uid()) $$;

create or replace function public.owns_section(p_section_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sections s
    join public.courses c on c.id = s.course_id
    where s.id = p_section_id and c.instructor_id = auth.uid()
  )
$$;

create or replace function public.is_section_member(p_section_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from public.section_members where section_id = p_section_id and student_id = auth.uid()) $$;

create or replace function public.teaches_student(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.section_members m
    join public.sections s on s.id = m.section_id
    join public.courses c on c.id = s.course_id
    where m.student_id = p_student_id and c.instructor_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile. Role is ALWAYS student; admins promote instructors.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, student_no)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'student_no', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Block role changes by anyone but an admin (or the service role / SQL editor).
create or replace function public.guard_role_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------------------------------------------------------------------------
-- Student joins a section by code (the only way to insert a membership).
-- ---------------------------------------------------------------------------
create or replace function public.join_section(p_code text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_section public.sections;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if public.my_role() <> 'student' then
    raise exception 'Only students can join a section';
  end if;

  select * into v_section from public.sections
  where join_code = upper(trim(p_code));

  if v_section.id is null then
    raise exception 'No section found for that code';
  end if;
  if not v_section.join_open then
    raise exception 'This section is closed for joining';
  end if;

  insert into public.section_members (section_id, student_id)
  values (v_section.id, auth.uid())
  on conflict do nothing;

  return v_section.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.courses         enable row level security;
alter table public.sections        enable row level security;
alter table public.section_members enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.teaches_student(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- courses
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated
  using (
    instructor_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.sections s where s.course_id = courses.id and public.is_section_member(s.id))
  );

drop policy if exists courses_insert on public.courses;
create policy courses_insert on public.courses for insert to authenticated
  with check (instructor_id = auth.uid() and public.my_role() in ('instructor', 'admin'));

drop policy if exists courses_update on public.courses;
create policy courses_update on public.courses for update to authenticated
  using (instructor_id = auth.uid() or public.is_admin())
  with check (instructor_id = auth.uid() or public.is_admin());

drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses for delete to authenticated
  using (instructor_id = auth.uid() or public.is_admin());

-- sections
drop policy if exists sections_select on public.sections;
create policy sections_select on public.sections for select to authenticated
  using (public.owns_course(course_id) or public.is_admin() or public.is_section_member(id));

drop policy if exists sections_insert on public.sections;
create policy sections_insert on public.sections for insert to authenticated
  with check (public.owns_course(course_id));

drop policy if exists sections_update on public.sections;
create policy sections_update on public.sections for update to authenticated
  using (public.owns_course(course_id) or public.is_admin())
  with check (public.owns_course(course_id) or public.is_admin());

drop policy if exists sections_delete on public.sections;
create policy sections_delete on public.sections for delete to authenticated
  using (public.owns_course(course_id) or public.is_admin());

-- section_members (no insert policy: joining goes through join_section())
drop policy if exists members_select on public.section_members;
create policy members_select on public.section_members for select to authenticated
  using (student_id = auth.uid() or public.owns_section(section_id) or public.is_admin());

drop policy if exists members_delete on public.section_members;
create policy members_delete on public.section_members for delete to authenticated
  using (public.owns_section(section_id) or public.is_admin());

-- Lock down function execution to signed-in users.
revoke execute on function public.join_section(text) from public, anon;
grant  execute on function public.join_section(text) to authenticated;
