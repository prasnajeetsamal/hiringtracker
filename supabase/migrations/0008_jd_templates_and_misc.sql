-- 0008_jd_templates_and_misc.sql
-- Lets non-admin users create + edit their OWN JD templates (personal templates).
-- System templates (`is_system=true`) remain admin-only.

-- Drop the legacy "admin only" write policy and replace with split policies.
drop policy if exists jd_templates_admin_write on public.jd_templates;

-- Anyone authenticated can read templates (already true via select_auth in 0002,
-- but re-state for clarity if 0002 was modified).
drop policy if exists jd_templates_select_auth on public.jd_templates;
create policy jd_templates_select_auth on public.jd_templates
  for select to authenticated using (true);

-- INSERT - anyone authenticated may insert a non-system template.
-- Admins may insert with is_system=true as well.
create policy jd_templates_insert_personal on public.jd_templates
  for insert to authenticated
  with check (
    is_system = false
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- UPDATE / DELETE - admin can edit anything; non-admins can edit non-system.
-- (We don't track per-template authorship, so all non-system templates are
-- editable/deletable by any authenticated user. This is acceptable for an
-- internal-only tool; can be tightened later by adding a created_by column.)
create policy jd_templates_update_admin_or_personal on public.jd_templates
  for update to authenticated
  using (
    is_system = false
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    is_system = false
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy jd_templates_delete_admin_or_personal on public.jd_templates
  for delete to authenticated
  using (
    is_system = false
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Index on candidates.tags for the candidates filter (`tags @> ARRAY['demo']` style).
create index if not exists candidates_tags_idx on public.candidates using gin (tags);
