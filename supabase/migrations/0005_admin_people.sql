-- 0005_admin_people.sql
-- People-management features:
--   * admin / hiring_manager can update other profiles' role + full_name
--   * helpful index on availability_slots.starts_at for the team-calendar query
--
-- Server endpoints (api/invite-user, api/update-user-role) use the service-role
-- client + permission check, so this RLS is mostly belt-and-suspenders for any
-- direct browser writes.

create or replace function public.is_any_project_manager(uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.project_members pm where pm.user_id = uid and pm.role_in_project = 'manager'
  );
$$;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self_or_admin on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.is_admin(auth.uid())
    or public.is_any_project_manager(auth.uid())
  )
  with check (
    id = auth.uid()
    or public.is_admin(auth.uid())
    or public.is_any_project_manager(auth.uid())
  );

create index if not exists availability_slots_interviewer_starts_idx
  on public.availability_slots(interviewer_id, starts_at);

create index if not exists availability_slots_starts_idx
  on public.availability_slots(starts_at);
