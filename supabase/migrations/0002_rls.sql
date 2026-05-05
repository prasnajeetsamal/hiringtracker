-- 0002_rls.sql
-- Row-level security policies. Server-side trusted writes go through the
-- service-role client (lib/supabase-admin.js) which bypasses RLS.
--
-- v0.1 policy posture: permissive for authenticated users, so the walking
-- skeleton is usable end-to-end. Tightened in v0.5 once project_members
-- and per-project membership are wired up.

alter table public.profiles            enable row level security;
alter table public.hiring_projects     enable row level security;
alter table public.project_members     enable row level security;
alter table public.roles               enable row level security;
alter table public.jd_templates        enable row level security;
alter table public.candidates          enable row level security;
alter table public.candidate_pipeline  enable row level security;
alter table public.interviewer_assignments enable row level security;
alter table public.feedback            enable row level security;
alter table public.availability_slots  enable row level security;
alter table public.scheduled_interviews enable row level security;
alter table public.files               enable row level security;
alter table public.comments            enable row level security;
alter table public.email_log           enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: read all authenticated, write self only
create policy profiles_select_auth on public.profiles
  for select to authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- hiring_projects: any authenticated user can read all + create their own.
-- v0.5 will tighten to project membership.
create policy hiring_projects_select_auth on public.hiring_projects
  for select to authenticated using (true);
create policy hiring_projects_insert_self on public.hiring_projects
  for insert to authenticated with check (owner_id = auth.uid());
create policy hiring_projects_update_owner on public.hiring_projects
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- project_members: read for members; v0.5 wires this up properly
create policy project_members_select_auth on public.project_members
  for select to authenticated using (true);

-- roles, candidates, candidate_pipeline: authenticated full access for v0.1
-- (single-org, internal-only assumption). v0.5 tightens by project membership.
create policy roles_all_auth on public.roles
  for all to authenticated using (true) with check (true);
create policy candidates_all_auth on public.candidates
  for all to authenticated using (true) with check (true);
create policy candidate_pipeline_all_auth on public.candidate_pipeline
  for all to authenticated using (true) with check (true);

-- jd_templates: read for all authenticated, insert/update only for admins
create policy jd_templates_select_auth on public.jd_templates
  for select to authenticated using (true);
create policy jd_templates_admin_write on public.jd_templates
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- interviewer_assignments / feedback / availability / scheduled_interviews
create policy interviewer_assignments_select_auth on public.interviewer_assignments
  for select to authenticated using (true);
create policy feedback_select_auth on public.feedback
  for select to authenticated using (true);
create policy feedback_write_self on public.feedback
  for all to authenticated using (interviewer_id = auth.uid()) with check (interviewer_id = auth.uid());

create policy availability_select_auth on public.availability_slots
  for select to authenticated using (true);
create policy availability_write_self on public.availability_slots
  for all to authenticated using (interviewer_id = auth.uid()) with check (interviewer_id = auth.uid());

create policy scheduled_interviews_select_auth on public.scheduled_interviews
  for select to authenticated using (true);

-- files / comments / email_log / audit_log: server-trusted writes preferred
create policy files_select_auth on public.files
  for select to authenticated using (true);
create policy comments_select_auth on public.comments
  for select to authenticated using (true);
create policy comments_write_self on public.comments
  for insert to authenticated with check (author_id = auth.uid());

create policy email_log_select_auth on public.email_log
  for select to authenticated using (true);
create policy audit_log_select_auth on public.audit_log
  for select to authenticated using (true);
