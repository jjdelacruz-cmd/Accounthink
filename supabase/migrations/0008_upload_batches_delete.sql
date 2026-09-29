-- Uploads (import batches) and deleting questions.
-- Each import becomes a named batch; items remember which batch they came from.
-- Deleting skips items used in a published/closed exam (they must stay for results);
-- those can be archived instead.

create table if not exists public.item_batches (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  label       text not null check (length(trim(label)) > 0),
  source      text not null default 'word' check (source in ('word', 'sheet')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists item_batches_course_idx on public.item_batches (course_id, created_at desc);

alter table public.items add column if not exists batch_id uuid references public.item_batches (id) on delete set null;
create index if not exists items_batch_idx on public.items (batch_id);

alter table public.item_batches enable row level security;
drop policy if exists item_batches_all on public.item_batches;
create policy item_batches_all on public.item_batches for all to authenticated
  using (public.owns_course(course_id) or public.is_admin())
  with check (public.owns_course(course_id) or public.is_admin());

-- An item may only belong to a batch of its own course.
create or replace function public.check_item_batch_course()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.batch_id is not null
     and (select course_id from public.item_batches where id = new.batch_id) is distinct from new.course_id then
    raise exception 'Upload belongs to a different course';
  end if;
  return new;
end $$;
drop trigger if exists items_batch_same_course on public.items;
create trigger items_batch_same_course before insert or update of batch_id, course_id on public.items
  for each row execute function public.check_item_batch_course();

-- ---------------------------------------------------------------------------
-- Import: same as before, plus a named batch. Returns the batch id.
-- ---------------------------------------------------------------------------
drop function if exists public.save_items(uuid, jsonb);
create or replace function public.save_items(p_course_id uuid, p_items jsonb, p_label text default null,
                                             p_source text default 'word')
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_n int := 0;
  v_batch uuid;
  v_id uuid;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be a list';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing to import';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Import at most 500 items at a time';
  end if;

  insert into public.item_batches (course_id, label, source, created_by)
  values (p_course_id,
          coalesce(nullif(left(btrim(p_label), 120), ''), 'Upload ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM')),
          coalesce(p_source, 'word'),
          auth.uid())
  returning id into v_batch;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    begin
      v_id := public.save_item(
        (v_item - 'answer' - 'id') || jsonb_build_object('course_id', p_course_id),
        v_item -> 'answer');
      update public.items set batch_id = v_batch where id = v_id;
    exception when others then
      raise exception 'Item % of %: %', v_n, jsonb_array_length(p_items), sqlerrm;
    end;
  end loop;
  return v_batch;
end $$;
revoke execute on function public.save_items(uuid, jsonb, text, text) from public, anon;
grant  execute on function public.save_items(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Delete questions. Runs as the caller (RLS: own course only).
-- Returns {"deleted": n, "kept": n} where kept = in a published/closed exam.
-- ---------------------------------------------------------------------------
create or replace function public.delete_items(p_item_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_deleted int := 0;
  v_kept int := 0;
begin
  if coalesce(array_length(p_item_ids, 1), 0) > 1000 then
    raise exception 'Delete at most 1000 questions at a time';
  end if;
  foreach v_id in array coalesce(p_item_ids, '{}') loop
    begin
      delete from public.items where id = v_id;
      if found then
        v_deleted := v_deleted + 1;
      end if;
    exception when others then
      -- guard_item_delete(): used in a live exam. Leave it.
      v_kept := v_kept + 1;
    end;
  end loop;
  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;
revoke execute on function public.delete_items(uuid[]) from public, anon;
grant  execute on function public.delete_items(uuid[]) to authenticated;

-- Delete a whole upload: its questions (except those in live exams), then the
-- batch itself if nothing is left in it.
create or replace function public.delete_batch(p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
  v_result jsonb;
begin
  if not exists (select 1 from public.item_batches where id = p_batch_id) then
    raise exception 'Upload not found';
  end if;
  select coalesce(array_agg(id), '{}') into v_ids from public.items where batch_id = p_batch_id;
  v_result := public.delete_items(v_ids);
  if not exists (select 1 from public.items where batch_id = p_batch_id) then
    delete from public.item_batches where id = p_batch_id;
  end if;
  return v_result;
end $$;
revoke execute on function public.delete_batch(uuid) from public, anon;
grant  execute on function public.delete_batch(uuid) to authenticated;
