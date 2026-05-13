-- 0009_stage_comments_and_mentions.sql
-- Two related additions to enable richer feedback collaboration:
--
-- A) Stage-scoped comments - extend `comments.entity_type` to include
--    'pipeline' so each pipeline stage row gets its own discussion thread.
-- B) @mentions - track mentioned profile ids on a comment so we can email
--    them and render the mention as a chip in the UI.

-- ─── A. Allow 'pipeline' as an entity_type ───────────────────────────

alter table public.comments
  drop constraint if exists comments_entity_type_check;
alter table public.comments
  add constraint comments_entity_type_check
  check (entity_type in ('candidate','role','feedback','pipeline'));

-- ─── B. Mentions column ──────────────────────────────────────────────

alter table public.comments
  add column if not exists mentions uuid[];

-- Helpful index for "comments that mention me" queries.
create index if not exists comments_mentions_gin_idx
  on public.comments using gin (mentions);

-- ─── RLS for pipeline-scoped comments ────────────────────────────────

create or replace function public.user_can_see_pipeline_via_project(p_id uuid, uid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from public.candidate_pipeline cp
    join public.candidates c on c.id = cp.candidate_id
    join public.roles r on r.id = c.role_id
    where cp.id = p_id and public.is_project_member(r.project_id, uid)
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
    or (
      entity_type = 'pipeline'
      and public.user_can_see_pipeline_via_project(entity_id, auth.uid())
    )
  );
