-- Phase 8: bulk import. Saves many items in one transaction: all or nothing.
-- Runs as the caller (security invoker) through save_item(), so the same RLS,
-- ownership and answer-key checks apply to every item.

create or replace function public.save_items(p_course_id uuid, p_items jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_n int := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be a list';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Import at most 500 items at a time';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    begin
      perform public.save_item(
        (v_item - 'answer' - 'id') || jsonb_build_object('course_id', p_course_id),
        v_item -> 'answer');
    exception when others then
      raise exception 'Item % of %: %', v_n, jsonb_array_length(p_items), sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

revoke execute on function public.save_items(uuid, jsonb) from public, anon;
grant  execute on function public.save_items(uuid, jsonb) to authenticated;
