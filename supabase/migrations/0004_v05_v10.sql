-- 0004_v05_v10.sql
-- v0.5 + v1.0 schema additions:
--   * helper functions for project membership (used by RLS)
--   * tightened RLS policies (project-membership-based)
--   * trigger to auto-add project owner as a 'manager' member
--   * generic audit-log triggers on hot tables
--   * trigger to auto-generate candidate_pipeline rows when a candidate is created

-- ─── helpers used by RLS ──────────────────────────────────────────────

create or replace function public.is_admin(uid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

create or replace function public.is_project_member(project uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = project and pm.user_id = uid
  ) or exists (
    select 1 from public.hiring_projects hp
    where hp.id = project and hp.owner_id = uid
  );
$$;

create or replace function public.is_project_manager(project uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = project and pm.user_id = uid
      and pm.role_in_project in ('manager')
  ) or exists (
    select 1 from public.hiring_projects hp
    where hp.id = project and hp.owner_id = uid
  );
$$;

-- Auto-add the project owner as a 'manager' member when the project is created.
create or replace function public.add_owner_as_member()
returns trigger language plpgsql security definer as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id, role_in_project)
    values (new.id, new.owner_id, 'manager')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists hiring_projects_owner_member on public.hiring_projects;
create trigger hiring_projects_owner_member
  after insert on public.hiring_projects
  for each row execute function public.add_owner_as_member();

-- Backfill existing rows so RLS doesn't lock the user out of v0.1 data.
insert into public.project_members (project_id, user_id, role_in_project)
select id, owner_id, 'manager'
from public.hiring_projects
where owner_id is not null
on conflict do nothing;

-- ─── tighten RLS ──────────────────────────────────────────────────────

drop policy if exists hiring_projects_select_auth on public.hiring_projects;
drop policy if exists hiring_projects_insert_self on public.hiring_projects;
drop policy if exists hiring_projects_update_owner on public.hiring_projects;

create policy hiring_projects_select_member on public.hiring_projects
  for select to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_member(id, auth.uid()));

create policy hiring_projects_insert_self on public.hiring_projects
  for insert to authenticated with check (owner_id = auth.uid());

create policy hiring_projects_update_manager on public.hiring_projects
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_manager(id, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.is_project_manager(id, auth.uid()));

drop policy if exists project_members_select_auth on public.project_members;
create policy project_members_select_member on public.project_members
  for select to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_member(project_id, auth.uid()));

create policy project_members_insert_manager on public.project_members
  for insert to authenticated
  with check (public.is_admin(auth.uid()) or public.is_project_manager(project_id, auth.uid()));

create policy project_members_update_manager on public.project_members
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_manager(project_id, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.is_project_manager(project_id, auth.uid()));

create policy project_members_delete_manager on public.project_members
  for delete to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_manager(project_id, auth.uid()));

drop policy if exists roles_all_auth on public.roles;
create policy roles_select_member on public.roles
  for select to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_member(project_id, auth.uid()));
create policy roles_write_member on public.roles
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.is_project_member(project_id, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.is_project_member(project_id, auth.uid()));

drop policy if exists candidates_all_auth on public.candidates;
create policy candidates_select_member on public.candidates
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.roles r
               where r.id = candidates.role_id
                 and public.is_project_member(r.project_id, auth.uid()))
    or exists (
      select 1
      from public.candidate_pipeline cp
      join public.interviewer_assignments ia on ia.pipeline_id = cp.id
      where cp.candidate_id = candidates.id and ia.interviewer_id = auth.uid()
    )
  );
create policy candidates_write_member on public.candidates
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.roles r
               where r.id = candidates.role_id
                 and public.is_project_member(r.project_id, auth.uid()))
  )
  with check (
    public.is_admin(auth.uid())
    or exists (select 1 from public.roles r
               where r.id = candidates.role_id
                 and public.is_project_member(r.project_id, auth.uid()))
  );

drop policy if exists candidate_pipeline_all_auth on public.candidate_pipeline;
create policy pipeline_select_member on public.candidate_pipeline
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidates c
      join public.roles r on r.id = c.role_id
      where c.id = candidate_pipeline.candidate_id
        and public.is_project_member(r.project_id, auth.uid())
    )
    or exists (
      select 1 from public.interviewer_assignments ia
      where ia.pipeline_id = candidate_pipeline.id and ia.interviewer_id = auth.uid()
    )
  );
create policy pipeline_write_member on public.candidate_pipeline
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidates c
      join public.roles r on r.id = c.role_id
      where c.id = candidate_pipeline.candidate_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  )
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidates c
      join public.roles r on r.id = c.role_id
      where c.id = candidate_pipeline.candidate_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  );

drop policy if exists interviewer_assignments_select_auth on public.interviewer_assignments;
create policy assignments_select_self_or_member on public.interviewer_assignments
  for select to authenticated
  using (
    interviewer_id = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidate_pipeline cp
      join public.candidates c on c.id = cp.candidate_id
      join public.roles r on r.id = c.role_id
      where cp.id = interviewer_assignments.pipeline_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  );
create policy assignments_write_member on public.interviewer_assignments
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidate_pipeline cp
      join public.candidates c on c.id = cp.candidate_id
      join public.roles r on r.id = c.role_id
      where cp.id = interviewer_assignments.pipeline_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  )
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidate_pipeline cp
      join public.candidates c on c.id = cp.candidate_id
      join public.roles r on r.id = c.role_id
      where cp.id = interviewer_assignments.pipeline_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  );

-- feedback select for project members + own; insert/update only for self if assigned
drop policy if exists feedback_select_auth on public.feedback;
drop policy if exists feedback_write_self on public.feedback;
create policy feedback_select_member_or_self on public.feedback
  for select to authenticated
  using (
    interviewer_id = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1 from public.candidate_pipeline cp
      join public.candidates c on c.id = cp.candidate_id
      join public.roles r on r.id = c.role_id
      where cp.id = feedback.pipeline_id
        and public.is_project_member(r.project_id, auth.uid())
    )
  );
create policy feedback_write_self on public.feedback
  for all to authenticated
  using (interviewer_id = auth.uid())
  with check (
    interviewer_id = auth.uid()
    and exists (
      select 1 from public.interviewer_assignments ia
      where ia.pipeline_id = feedback.pipeline_id and ia.interviewer_id = auth.uid()
    )
  );

-- comments: read for project members of the candidate's project; write self
drop policy if exists comments_select_auth on public.comments;
drop policy if exists comments_write_self on public.comments;
create policy comments_select_member on public.comments
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      entity_type = 'candidate' and exists (
        select 1 from public.candidates c
        join public.roles r on r.id = c.role_id
        where c.id = comments.entity_id
          and public.is_project_member(r.project_id, auth.uid())
      )
    )
    or (
      entity_type = 'role' and exists (
        select 1 from public.roles r
        where r.id = comments.entity_id
          and public.is_project_member(r.project_id, auth.uid())
      )
    )
  );
create policy comments_insert_self on public.comments
  for insert to authenticated
  with check (author_id = auth.uid());
create policy comments_delete_self on public.comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin(auth.uid()));

-- files: read for authenticated; insert by uploader self
drop policy if exists files_select_auth on public.files;
create policy files_select_auth on public.files
  for select to authenticated using (true);
create policy files_insert_self on public.files
  for insert to authenticated with check (uploaded_by = auth.uid());

-- ─── candidate_pipeline auto-creation on candidate insert ─────────────
-- When a new candidate is created, generate one pipeline row per stage
-- using the role's stage_config (or defaults).

create or replace function public.create_pipeline_for_candidate()
returns trigger language plpgsql security definer as $$
declare
  cfg jsonb;
  default_keys text[] := array[
    'resume_submitted','hm_review','technical_written',
    'technical_interview','problem_solving','case_study','offer'
  ];
  k text;
  enabled boolean;
  ord int := 0;
begin
  select stage_config into cfg from public.roles where id = new.role_id;
  if cfg is null or jsonb_array_length(cfg) = 0 then
    -- fallback: all stages enabled
    foreach k in array default_keys loop
      ord := ord + 1;
      insert into public.candidate_pipeline (candidate_id, stage_key, stage_order, state)
      values (new.id, k, ord, case when k = new.current_stage_key then 'in_progress' else 'pending' end)
      on conflict do nothing;
    end loop;
  else
    foreach k in array default_keys loop
      ord := ord + 1;
      enabled := coalesce(
        (select (item->>'enabled')::boolean from jsonb_array_elements(cfg) item where item->>'stage_key' = k limit 1),
        true
      );
      insert into public.candidate_pipeline (candidate_id, stage_key, stage_order, state)
      values (
        new.id,
        k,
        ord,
        case
          when not enabled then 'skipped'
          when k = new.current_stage_key then 'in_progress'
          else 'pending'
        end
      )
      on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists candidates_create_pipeline on public.candidates;
create trigger candidates_create_pipeline
  after insert on public.candidates
  for each row execute function public.create_pipeline_for_candidate();

-- ─── audit-log triggers on key tables ─────────────────────────────────
create or replace function public.audit_row()
returns trigger language plpgsql security definer as $$
declare
  actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, after)
    values (actor, 'insert', TG_TABLE_NAME, new.id, to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (actor, 'update', TG_TABLE_NAME, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before)
    values (actor, 'delete', TG_TABLE_NAME, old.id, to_jsonb(old));
    return old;
  end if;
  return null;
end $$;

drop trigger if exists audit_candidates on public.candidates;
create trigger audit_candidates
  after insert or update or delete on public.candidates
  for each row execute function public.audit_row();

drop trigger if exists audit_pipeline on public.candidate_pipeline;
create trigger audit_pipeline
  after update on public.candidate_pipeline
  for each row execute function public.audit_row();

drop trigger if exists audit_feedback on public.feedback;
create trigger audit_feedback
  after insert or update on public.feedback
  for each row execute function public.audit_row();
