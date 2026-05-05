-- 0001_init.sql
-- Slate — Hiring Tracker base schema (v0.1 walking skeleton).
-- Tables for the full v1 plan are scaffolded here but only the v0.1 ones
-- are actively populated by the UI yet.

create extension if not exists pgcrypto;

-- ─── generic updated_at trigger ───────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─── profiles (mirrors auth.users) ────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'interviewer'
    check (role in ('admin','hiring_manager','hiring_team','interviewer')),
  timezone text default 'UTC',
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists profiles_role_idx on public.profiles(role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── hiring_projects ──────────────────────────────────────────────────
create table if not exists public.hiring_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists hiring_projects_owner_idx on public.hiring_projects(owner_id);

create trigger hiring_projects_set_updated_at
  before update on public.hiring_projects
  for each row execute function set_updated_at();

-- ─── project_members (junction) ───────────────────────────────────────
create table if not exists public.project_members (
  project_id uuid not null references public.hiring_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_in_project text not null default 'member'
    check (role_in_project in ('manager','member','viewer')),
  created_at timestamptz default now(),
  primary key (project_id, user_id)
);

-- ─── roles ────────────────────────────────────────────────────────────
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.hiring_projects(id) on delete cascade,
  sr_number text,
  title text not null,
  location text,
  level text,
  hiring_manager_id uuid references public.profiles(id),
  jd_source text default 'inline' check (jd_source in ('uploaded','inline','from_template')),
  jd_html text,
  jd_file_id uuid,  -- forward-referenced; files table created later
  status text not null default 'open' check (status in ('open','on_hold','filled','closed')),
  stage_config jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists roles_project_idx on public.roles(project_id);
create index if not exists roles_status_idx on public.roles(status);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function set_updated_at();

-- ─── jd_templates ─────────────────────────────────────────────────────
create table if not exists public.jd_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'other'
    check (category in ('engineering','product','data','design','other')),
  body_html text not null,
  is_system boolean not null default false,
  created_at timestamptz default now()
);

-- ─── candidates ───────────────────────────────────────────────────────
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  linkedin_url text,
  resume_file_id uuid,
  resume_text text,
  source text default 'manual'
    check (source in ('uploaded','linkedin','referral','manual')),
  current_stage_key text default 'resume_submitted',
  status text not null default 'active'
    check (status in ('active','rejected','hired','withdrew')),
  ai_score int,
  ai_analysis jsonb,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists candidates_role_idx on public.candidates(role_id);
create index if not exists candidates_status_idx on public.candidates(status);

create trigger candidates_set_updated_at
  before update on public.candidates
  for each row execute function set_updated_at();

-- ─── candidate_pipeline (per-round-per-candidate state) ───────────────
create table if not exists public.candidate_pipeline (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  stage_key text not null,
  stage_order int not null,
  state text not null default 'pending'
    check (state in ('pending','in_progress','passed','failed','skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  decided_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (candidate_id, stage_key)
);
create index if not exists candidate_pipeline_candidate_idx on public.candidate_pipeline(candidate_id);

create trigger candidate_pipeline_set_updated_at
  before update on public.candidate_pipeline
  for each row execute function set_updated_at();

-- Tables below are scaffolded for v0.5 / v1.0 — empty in v0.1.

create table if not exists public.interviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.candidate_pipeline(id) on delete cascade,
  interviewer_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique (pipeline_id, interviewer_id)
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.candidate_pipeline(id) on delete cascade,
  interviewer_id uuid not null references public.profiles(id) on delete cascade,
  recommendation text check (recommendation in ('strong_hire','hire','no_hire','strong_no_hire')),
  rating int check (rating between 1 and 5),
  body_html text,
  submitted_at timestamptz default now(),
  unique (pipeline_id, interviewer_id)
);

create table if not exists public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  interviewer_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence text default 'none' check (recurrence in ('none','weekly')),
  recurrence_until date,
  status text default 'open' check (status in ('open','booked','blocked')),
  created_at timestamptz default now()
);

create table if not exists public.scheduled_interviews (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.candidate_pipeline(id) on delete cascade,
  interviewer_id uuid not null references public.profiles(id) on delete cascade,
  slot_id uuid references public.availability_slots(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_link text,
  status text default 'scheduled'
    check (status in ('scheduled','completed','cancelled','no_show')),
  created_at timestamptz default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('resumes','jds')),
  path text not null,
  original_name text,
  mime text,
  size_bytes int,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('candidate','role','feedback')),
  entity_id uuid not null,
  author_id uuid not null references public.profiles(id),
  body_html text not null,
  created_at timestamptz default now()
);
create index if not exists comments_entity_idx on public.comments(entity_type, entity_id);

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  payload jsonb,
  status text default 'sent',
  provider_id text,
  created_at timestamptz default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
);
