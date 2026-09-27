-- Password reset without email: an instructor sets a temporary password for a
-- student in their sections; an admin for any non-admin. The user can then
-- change it on their Account page.

create or replace function public.reset_user_password(p_user_id uuid, p_new_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if length(coalesce(p_new_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'User not found';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Change your own password on the Account page';
  end if;
  if public.is_admin() then
    if v_role = 'admin' then
      raise exception 'An admin''s password can only be changed by that admin';
    end if;
  elsif not (public.my_role() = 'instructor' and v_role = 'student' and public.teaches_student(p_user_id)) then
    raise exception 'You can only reset passwords of students in your sections';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  -- Sign them out everywhere so only the new password works from now on.
  delete from auth.sessions where user_id = p_user_id;
end $$;

revoke execute on function public.reset_user_password(uuid, text) from public, anon;
grant  execute on function public.reset_user_password(uuid, text) to authenticated;
