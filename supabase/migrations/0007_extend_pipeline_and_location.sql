-- 0007_extend_pipeline_and_location.sql
-- Two unrelated additions bundled into one migration:
--
-- A) Pipeline stages - add `joined_fractal` and `rejected_offer` after the
--    existing `offer` stage. The 7-stage pipeline becomes 9 stages.
-- B) Role location refactor - break `roles.location` (free text) into
--    structured `work_mode` + `city` + `state` + `country` columns.
--    Existing `location` stays as a deprecated free-text field for back-
--    compat; new code reads/writes the structured fields.

-- ─── A. Pipeline stages ──────────────────────────────────────────────

-- 1) Update the candidates.current_stage_key check (none today - column has no
--    explicit constraint, only a default). Pipeline stage_key has none either.
--    The trigger that auto-creates pipeline rows defaults to a hard-coded list,
--    so we only need to update the trigger.

create or replace function public.create_pipeline_for_candidate()
returns trigger language plpgsql security definer as $$
declare
  cfg jsonb;
  default_keys text[] := array[
    'resume_submitted','hm_review','technical_written',
    'technical_interview','problem_solving','case_study','offer',
    'joined_fractal','rejected_offer'
  ];
  k text;
  enabled boolean;
  ord int := 0;
begin
  select stage_config into cfg from public.roles where id = new.role_id;
  if cfg is null or jsonb_array_length(cfg) = 0 then
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

-- Backfill existing candidates that don't yet have rows for the new stages.
-- For each candidate, insert any missing stage rows in 'pending' state.
do $$
declare
  c_id uuid;
  ord int;
begin
  for c_id in select id from public.candidates loop
    -- Find the highest existing stage_order for this candidate
    select coalesce(max(stage_order), 0) into ord
    from public.candidate_pipeline where candidate_id = c_id;

    if not exists (
      select 1 from public.candidate_pipeline
      where candidate_id = c_id and stage_key = 'joined_fractal'
    ) then
      insert into public.candidate_pipeline (candidate_id, stage_key, stage_order, state)
      values (c_id, 'joined_fractal', ord + 1, 'pending')
      on conflict do nothing;
      ord := ord + 1;
    end if;

    if not exists (
      select 1 from public.candidate_pipeline
      where candidate_id = c_id and stage_key = 'rejected_offer'
    ) then
      insert into public.candidate_pipeline (candidate_id, stage_key, stage_order, state)
      values (c_id, 'rejected_offer', ord + 1, 'pending')
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ─── B. Role location refactor ───────────────────────────────────────

alter table public.roles
  add column if not exists work_mode text
    check (work_mode in ('remote','office','hybrid')),
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text;

-- Best-effort backfill of city from the legacy `location` text. We do
-- nothing fancy - copy the trimmed string into city if it's set and city
-- is null. Users will refine via the UI.
update public.roles
  set city = trim(location)
  where city is null
    and location is not null
    and length(trim(location)) > 0;

-- Note: we deliberately leave `roles.location` in place. New code writes
-- to the structured columns and reads them with a fallback to `location`
-- so existing data still renders correctly while everyone migrates.
