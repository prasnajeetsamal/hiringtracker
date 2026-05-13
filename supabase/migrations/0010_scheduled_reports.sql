-- 0010_scheduled_reports.sql
-- Scheduled hiring-report delivery. An admin (or project manager for a
-- project-scoped schedule) configures a cadence + recipients + which sections
-- of the report to include. A daily cron handler dispatches the email.

create table if not exists public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cadence text not null check (cadence in ('daily','weekly','monthly')),
  day_of_week int check (day_of_week between 0 and 6),       -- 0=Sun, used for weekly
  day_of_month int check (day_of_month between 1 and 28),    -- used for monthly
  hour int not null default 8 check (hour between 0 and 23), -- UTC hour
  project_id uuid references public.hiring_projects(id) on delete cascade,
  role_id uuid references public.roles(id) on delete cascade,
  sections text[] not null default array['kpis','stages','times','sources','topscorers'],
  recipients text[] not null,
  format text not null check (format in ('html')) default 'html',
  created_by uuid references public.profiles(id),
  active boolean default true,
  last_sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists scheduled_reports_active_idx
  on public.scheduled_reports (active, hour)
  where active = true;

-- ─── RLS ─────────────────────────────────────────────────────────────

alter table public.scheduled_reports enable row level security;

-- Read: admins see all; project members see their project's schedules.
drop policy if exists scheduled_reports_select on public.scheduled_reports;
create policy scheduled_reports_select on public.scheduled_reports
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (project_id is not null and public.is_project_member(project_id, auth.uid()))
    or (project_id is null and created_by = auth.uid())
  );

-- Write: admins always; project managers for their own project schedules.
drop policy if exists scheduled_reports_write on public.scheduled_reports;
create policy scheduled_reports_write on public.scheduled_reports
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or (project_id is not null and public.is_project_manager(project_id, auth.uid()))
  )
  with check (
    public.is_admin(auth.uid())
    or (project_id is not null and public.is_project_manager(project_id, auth.uid()))
  );
