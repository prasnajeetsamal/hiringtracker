-- 0006_fix_rls_recursion.sql
-- Fix infinite recursion between candidates and candidate_pipeline RLS policies.
--
-- Original problem (introduced in 0004):
--   candidates_select_member  -> references candidate_pipeline (interviewer-assigned check)
--   pipeline_select_member    -> references candidates (project-member check)
-- When Postgres evaluates either policy it tries to evaluate the other,
-- and ERRORs out with "infinite recursion detected in policy" before
-- short-circuiting on admin or other simpler conditions.
--
-- Fix: move the cross-table EXISTS checks into security-definer helper
-- functions. Inside a security-definer function RLS does NOT apply, so
-- the cycle is broken.

-- ─── helpers ──────────────────────────────────────────────────────────

create or replace function public.user_assigned_to_candidate(candidate uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from public.candidate_pipeline cp
    join public.interviewer_assignments ia on ia.pipeline_id = cp.id
    where cp.candidate_id = candidate and ia.interviewer_id = uid
  );
$$;

create or replace function public.user_member_of_candidates_project(candidate uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.candidates c
    join public.roles r on r.id = c.role_id
    where c.id = candidate and public.is_project_member(r.project_id, uid)
  );
$$;

create or replace function public.user_member_of_pipelines_project(pipeline uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.candidate_pipeline cp
    join public.candidates c on c.id = cp.candidate_id
    join public.roles r on r.id = c.role_id
    where cp.id = pipeline and public.is_project_member(r.project_id, uid)
  );
$$;

create or replace function public.user_assigned_to_pipeline(pipeline uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.interviewer_assignments ia
    where ia.pipeline_id = pipeline and ia.interviewer_id = uid
  );
$$;

-- ─── candidates ───────────────────────────────────────────────────────

drop policy if exists candidates_select_member on public.candidates;
create policy candidates_select_member on public.candidates
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.roles r
      where r.id = candidates.role_id
        and public.is_project_member(r.project_id, auth.uid())
    )
    or public.user_assigned_to_candidate(id, auth.uid())
  );

drop policy if exists candidates_write_member on public.candidates;
create policy candidates_write_member on public.candidates
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.roles r
      where r.id = candidates.role_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  )
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.roles r
      where r.id = candidates.role_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  );

-- ─── candidate_pipeline ───────────────────────────────────────────────

drop policy if exists pipeline_select_member on public.candidate_pipeline;
create policy pipeline_select_member on public.candidate_pipeline
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.user_member_of_candidates_project(candidate_id, auth.uid())
    or public.user_assigned_to_pipeline(id, auth.uid())
  );

drop policy if exists pipeline_write_member on public.candidate_pipeline;
create policy pipeline_write_member on public.candidate_pipeline
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or public.user_member_of_candidates_project(candidate_id, auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or public.user_member_of_candidates_project(candidate_id, auth.uid())
  );

-- ─── interviewer_assignments ──────────────────────────────────────────
-- Same recursion risk: this policy joined candidate_pipeline + candidates
-- + roles inline. Replace the join chain with the helper function.

drop policy if exists assignments_select_self_or_member on public.interviewer_assignments;
create policy assignments_select_self_or_member on public.interviewer_assignments
  for select to authenticated
  using (
    interviewer_id = auth.uid()
    or public.is_admin(auth.uid())
    or public.user_member_of_pipelines_project(pipeline_id, auth.uid())
  );

drop policy if exists assignments_write_member on public.interviewer_assignments;
create policy assignments_write_member on public.interviewer_assignments
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or public.user_member_of_pipelines_project(pipeline_id, auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or public.user_member_of_pipelines_project(pipeline_id, auth.uid())
  );

-- ─── feedback ─────────────────────────────────────────────────────────
-- Same pattern as assignments.

drop policy if exists feedback_select_member_or_self on public.feedback;
create policy feedback_select_member_or_self on public.feedback
  for select to authenticated
  using (
    interviewer_id = auth.uid()
    or public.is_admin(auth.uid())
    or public.user_member_of_pipelines_project(pipeline_id, auth.uid())
  );

-- ─── comments ─────────────────────────────────────────────────────────
-- The candidate-comments check joined candidates + roles inline. Wrap it.

create or replace function public.user_can_see_candidate_via_project(candidate uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.candidates c
    join public.roles r on r.id = c.role_id
    where c.id = candidate and public.is_project_member(r.project_id, uid)
  );
$$;

create or replace function public.user_can_see_role_via_project(role_id uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.roles r
    where r.id = role_id and public.is_project_member(r.project_id, uid)
  );
$$;

drop policy if exists comments_select_member on public.comments;
create policy comments_select_member on public.comments
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      entity_type = 'candidate'
      and public.user_can_see_candidate_via_project(entity_id, auth.uid())
    )
    or (
      entity_type = 'role'
      and public.user_can_see_role_via_project(entity_id, auth.uid())
    )
  );
