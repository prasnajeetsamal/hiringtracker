# Slate - Hiring Tracker (Claude notes)

A focused hiring tracker. Sibling to ResumeScreener at `../resumescreener`. **Reuse, don't reinvent.**

> **Product context (load-bearing):** Slate is being built as the user's company's intended **replacement for Workday + manual hiring processes**. The user plans to pitch it internally and have the hiring team adopt it. Treat features as **production-grade**, not experiments - edge cases, polish, and reliability matter. Avoid changes that compromise reliability.

## Status snapshot

- **v0.1** - auth, projects, roles, JD textarea, app shell. Shipped.
- **v0.5 + v1.0** - full hiring loop, AI scoring, feedback, comments, calendar (availability only, no booking), email, daily cron. Shipped.
- **People** - invite users via Supabase admin API, change roles, team-availability calendar, all-interviews view. Shipped.
- **Multi-role candidate consideration** - clone candidate to another role, sibling-list on detail page. Shipped.
- **In-app AI assistant** - Claude with tool-use over the user's RLS-scoped data, floating bottom-right on every page. Shipped.
- **Admin-only deletes** - single consolidated endpoint for candidate / role / project hard-delete with cascading cleanup of comments + storage. Shipped.
- **Bulk resume screening** - multi-file upload + auto-score against the JD (parallel client-side fan-out, concurrency=3). Shipped.
- **Reports page** - hiring performance summary, scoped by project/role, with CSV export, print/PDF, and shareable URL. Shipped.
- **Resume formatter** - `ResumeView` component renders the candidate's parsed resume with detected headings / bullets / contact-info chips / role lines. Shipped.
- **Sidebar UX** - UserMenu docked at sidebar bottom (popover opens up); items grouped into "Hiring" and "Tools" sections; **pending-feedback badge** on the Interviews item. Shipped.
- **Filter UX** - custom dark-themed popover (no native `<select>`), pill triggers showing the selected value inline with one-click clear ✕, autosearch when an option list exceeds 8. Shipped.
- **9-stage pipeline** - added `joined_fractal` and `rejected_offer` after `offer`. Schema-backed by migration `0007`. Shipped.
- **Role location** - `work_mode` (remote/office/hybrid) + `city` / `state` / `country` columns. Legacy `location` text retained as fallback. Shipped.
- **Side-panel projects UX** - `/projects` is a full-width project grid; clicking a card opens a sticky right-side panel with that project's roles. Project list stays visible - click another card to swap, X (or Esc) to close. Shipped.
- **JD templates CRUD** - anyone can create/edit personal templates; system templates remain admin-only. Shipped.
- **Tags on candidates** - UI for adding/filtering/displaying. Schema's `tags text[]` exposed via `TagsEditor` primitive. Shipped.
- **Archive flows** - projects archive to `status='archived'`, roles to `status='closed'`. UI toggles visibility; both can be restored. Shipped.
- **Pipeline timeline UX** - current stage is expanded by default; all other stages collapse to a one-line summary with state icon + chevron. Click to expand. Per-stage discussion thread (`entity_type='pipeline'`) embedded in each stage. Shipped.
- **Semantic candidate search** - `/api/semantic-search` ranks candidates against a free-text query (Claude with structured-output tool over the user's RLS-scoped pool). UI is a "Smart search" dialog launched from the Candidates page header. Shipped.
- **Stage-scoped comments + @mentions** - schema migration `0009` extends `comments.entity_type` to allow `'pipeline'` and adds `comments.mentions uuid[]`. `CommentThread` has `@`-typeahead, mentions render as `.mention` chips inside `.jd-prose`. Dashboard has an "@ Mentions of you" inbox card. Shipped.
- **Admin-users consolidation** - `api/invite-user.js` + `api/update-user-role.js` merged into `api/admin-users.js` (dispatch on `action`). Frees one Hobby-plan slot for the new semantic-search endpoint. Shipped.
- **Dashboard ↔ Reports separation** - Dashboard is now strictly operational ("what needs my attention now"): KPIs, funnel, stale, roles needing attention, activity, mentions inbox. Top-AI-scores card moved out of Dashboard; the analytical surface (top scorers, source breakdown, time-to-X medians, conversion %) lives on `/reports`. AI-score histogram removed entirely (was noise). Shipped.
- **Atomic stage transitions** - pipeline advance/reject/skip now go through `api/transition-candidate` in one server hop, replacing the 3-write client dance so a partial failure can't leave the pipeline half-flipped. Shipped.
- **AI-generated JDs** - `api/generate-jd` (Claude structured-output) drafts a JD from the role's metadata + a short hiring-manager prompt; "Generate with AI" button in RoleDetailPage drops the HTML into the Tiptap editor for review. Shipped.
- **@mention email notifications** - `api/notify-mention` + `lib/email.js#emailMention` fire a Resend email to every profile in a comment's `mentions[]` array. Best-effort, fires after the comment insert; UI is never blocked on delivery. Shipped.
- **Reports - print/PDF + HTML report** - print stylesheet rewritten to keep colors (gradients, accent chips, stage bars) by setting `print-color-adjust: exact`. New "HTML report" action downloads a self-contained, beautifully styled report file (no Slate login required to view). Shipped.
- **Typography** - global preference: ASCII hyphen `-` everywhere (no em-dash `—` or en-dash `–`). UI strings, comments, AI prompts, docs, SQL comments. Memory entry pins this preference for future sessions.
- **Collapsible feedback** - "Your feedback" section on each pipeline stage card collapses by default once submitted, showing a one-line summary (recommendation + rating + date). Click to re-expand and edit. Auto-expanded when no feedback exists yet. Shipped.
- **Tags layout fix** - `TagsEditor` and the candidate-detail sidebar were missing `min-w-0` on flex containers, causing chips to overflow on lg viewports. Added it; input min-width reduced to 80px with `flex-1`. Shipped.
- **Dashboard restructure** - top-right card slot is now "Roles needing attention" (the highest-information operational card); "@ Mentions of you" demoted to the bottom row. KPI rescope: "My pending feedback" → org-wide "Pending feedback" (joins `interviewer_assignments` + `feedback`; respects active candidates + non-skipped pipeline rows). The Sidebar pending-feedback badge is still per-user, so personal triage isn't lost. Shipped.
- **Chatbot tool expansion** - `api/ask.js` gained three new tools: `get_feedback_summary` (with `missing_only` for overdue checks), `search_comments` (entity/mention/keyword filters), `check_availability` (interviewer slots). System prompt extended with routing rules + a citation requirement; temperature 0.2 → 0.35. No schema changes. Shipped.
- **HTML export everywhere** - shared shell at `lib/htmlExport.js` (server-safe; no `document`) with a thin client wrapper at `src/lib/htmlExport.js` adding `downloadHtmlFile`. Reports, Candidate detail, Role detail, and JD template preview each have an HTML report button that downloads a self-contained styled file. Shipped.
- **Reports - pixel-perfect PDF + chart picker** - new lazy-loaded `src/lib/pdfExport.js` (html2canvas + jsPDF, ~592 KB chunk that only loads on click). Single unified "Export" button on `/reports` opens a modal where the user picks destination (PDF / HTML / Print / CSV) and which sections to include (KPIs, stages, times, sources, top scorers). Sections are marked with `data-section` attributes; the helper hides deselected nodes during capture. Shipped.
- **Scheduled report delivery** - migration `0010` adds `scheduled_reports` table (cadence: daily/weekly/monthly; section whitelist; recipient list; project/role scope). `api/cron-scheduled-reports` runs hourly, builds the HTML server-side via `lib/htmlExport.js`, and dispatches via Resend as a `.html` attachment. New `/scheduled-reports` admin page (admin + hiring_manager only) for create/pause/delete. Shipped.
- **Email candidates from the app** - `api/email-candidate` accepts a project-member's bearer token, sends the candidate a Resend email, and logs to `email_log` with `payload.candidateId` for audit. New `EmailCandidateDialog` composer on the candidate detail page with 5 templates (free-form, interview invite, resume request, polite rejection, offer) - each template seeds sane defaults the user can edit before sending. Sidebar "Emails sent" card on the candidate page shows the last 10 logged emails. Needs verified Resend sender domain in `EMAIL_FROM` before reaching real candidates. Shipped.
- **Feedback workflow polish** - `FeedbackForm` now auto-saves drafts to `localStorage` (key per `pipeline_id+interviewer_id`), restores them on return, and offers keyboard shortcuts: `1`-`5` for rating, `S`/`H`/`N`/`X` for Strong Hire / Hire / No Hire / Strong No Hire. Shortcuts ignore events while the user is typing in the notes textarea. A small amber banner surfaces when a draft was restored, with a one-click "Discard" affordance. Shipped.

Live at https://trackerhiring.vercel.app. Repo at https://github.com/prasnajeetsamal/hiringtracker.

## Architectural rules

- **Frontend**: Vite + React 18 + **JavaScript** (no TypeScript). Tailwind CSS, dark theme baked into `src/index.css`.
- **Routing**: `react-router-dom` v6, BrowserRouter, defined in `src/components/layout/AppShell.jsx`. The chat FAB lives at the AppShell level so it persists across routes.
- **Server state**: `@tanstack/react-query`. Client in `src/lib/queryClient.js`. Default `staleTime: 30s`, `retry: 1`, no window-focus refetch. **Always invalidate the right query keys on mutation** - many widgets share `['candidates-all']` and `['dashboard']`.
- **Backend**: Vercel serverless functions in `api/*.js`. Node 20 runtime. **Only real HTTP endpoints belong in `api/`** - shared server helpers go in `lib/` at the repo root (Vercel will not expose them as routes).
- **Vercel plan**: Pro. Function count is **not** a constraint anymore - add new `api/*.js` files freely. Historical context: when we were on Hobby (12-function cap) we consolidated three delete endpoints into `admin-delete` (dispatch on `entityType`) and `invite-user` + `update-user-role` into `admin-users` (dispatch on `action`). Those consolidations stay because they're cleaner, not because we need the slots back.
- **Auth**: Supabase Auth. Browser uses anon key; server (`api/*`) uses `requireAuth` from `lib/auth.js` to verify the bearer token. Trusted server writes use the **service-role client** in `lib/supabase-admin.js` (bypasses RLS - gate it with explicit checks first).
- **DB**: Supabase Postgres. Schema in `supabase/migrations/` (run via dashboard SQL editor in numeric order).
- **Storage**: Supabase Storage. Two private buckets - `resumes` and `jds`. Auto-created on first upload via `lib/storage.js#ensureBuckets()`.
- **AI**: Anthropic Claude (`claude-sonnet-4-5`) via direct `fetch` (no SDK). **Always use tool-use for structured output** (evaluator) or domain queries (chatbot). Extended thinking is on by default for evaluator-style tasks.
- **Email**: Transport-agnostic `lib/email.js`. Priority: **(1) Gmail SMTP** via `nodemailer` if `GMAIL_USER` + `GMAIL_APP_PASSWORD` are set (lets you send from any Gmail address with no DNS work, ~500/day limit); **(2) Resend** HTTP API if `RESEND_API_KEY` is set (needs a verified sender domain in `EMAIL_FROM` to reach external recipients); **(3) no-op** in dev. `email_log.status` is suffixed with the transport (`sent[smtp]` / `sent[resend]` / `skipped_no_key`).
- **Cron**: Vercel Cron. Registered in `vercel.json`. Handler verifies an optional `CRON_SECRET` if set.

## Migrations and what they do

| File | Purpose |
|---|---|
| `0001_init.sql` | All tables + indexes. `auth.users` insert trigger auto-creates `profiles` row. |
| `0002_rls.sql` | RLS on. Permissive policies (any authenticated user) - used in v0.1. |
| `0003_seed_templates.sql` | Seeds 3 system JD templates (Senior SWE, PM, Senior DS). |
| `0004_v05_v10.sql` | **Tightens RLS** to project-membership-based, adds helper functions (`is_admin`, `is_project_member`, `is_project_manager`), project-owner-as-manager trigger (with backfill), candidate→pipeline-rows trigger, audit-log triggers. |
| `0005_admin_people.sql` | Lets admin / project managers update other profiles' role + name (RLS belt-and-suspenders for direct browser writes; server endpoints also gate). Indexes on `availability_slots(starts_at)` for the team-calendar range query. |
| `0006_fix_rls_recursion.sql` | **Fixes infinite recursion** between candidates and candidate_pipeline policies. Wraps cross-table EXISTS checks in `security definer` functions (`user_assigned_to_candidate`, `user_member_of_candidates_project`, `user_member_of_pipelines_project`, `user_assigned_to_pipeline`, `user_can_see_candidate_via_project`, `user_can_see_role_via_project`). All cross-table policies now use these helpers. |
| `0007_extend_pipeline_and_location.sql` | **Adds 2 new pipeline stages** (`joined_fractal`, `rejected_offer`) after `offer`. Updates `create_pipeline_for_candidate` trigger; backfills existing candidates with the new stage rows in `pending`. **Adds structured location columns** to `roles`: `work_mode` (remote/office/hybrid), `city`, `state`, `country`. Best-effort backfill of `city` from legacy `location`; legacy column retained for back-compat. |
| `0008_jd_templates_and_misc.sql` | Splits the admin-only JD-template write policy: any authenticated user can now create/edit/delete **personal** (`is_system=false`) templates; system templates remain admin-only. Adds GIN index on `candidates.tags`. |
| `0009_stage_comments_and_mentions.sql` | Extends `comments.entity_type` to allow `'pipeline'` (so each stage row has its own discussion thread) and adds `comments.mentions uuid[]` (set of mentioned profile ids; backed by GIN index). Adds `user_can_see_pipeline_via_project` security-definer helper and updates the `comments_select_member` RLS policy to use it for pipeline-scoped reads. |
| `0010_scheduled_reports.sql` | Adds `scheduled_reports` table: cadence (`daily`/`weekly`/`monthly`) + `day_of_week` / `day_of_month` / `hour` (UTC), optional `project_id` + `role_id` scope, `sections text[]` whitelist, `recipients text[]`. RLS lets admins manage all; project managers manage their own project's schedules. Personal schedules (no project) are visible to creator. The cron handler bypasses via service role. |

When adding a migration: **always include RLS for any new table in the same migration**. Backfill existing data if you're tightening policies. **Never reference another table directly inside an RLS policy if that other table's policy references back** - wrap in a `security definer` function instead.

Demo seed: `supabase/demo/seed_demo_data.sql` - idempotent, tags rows with `tags @> ['demo']` for easy bulk-delete.

## API endpoints

| Endpoint | Purpose |
|---|---|
| `api/extract` | Multipart → text (PDF/DOCX/TXT). Used for ad-hoc previews. |
| `api/upload-resume` | Multipart → Storage → parse text → candidate row (creates or updates). |
| `api/upload-jd` | Multipart → Storage → **rich HTML extraction** (mammoth `convertToHtml` for DOCX, heuristic bullets/headings for PDF/TXT) → role row. |
| `api/generate-jd` | Body `{ title, level?, work_mode?, city?, state?, country?, prompt? }`. Claude with structured-output tool drafts a JD (summary / responsibilities / must-have / nice-to-have / what-you'll-learn / logistics) and returns `{ jd_html, raw }`. Wired into RoleDetailPage as the "Generate with AI" button next to "Use template" / "Upload". |
| `api/create-candidate` | Server-side candidate insert for LinkedIn / manual flows (avoids RLS membership edge cases). |
| `api/clone-candidate` | "Consider for another role" - copies profile + resume to a new candidate row in a target role; AI score / status / stage start fresh. Avoids duplicates by email match. |
| `api/admin-delete` | **Admin-only** consolidated delete. Body `{ entityType: 'candidate' | 'role' | 'project', id }`. Handles cascading comments + storage cleanup. |
| `api/admin-users` | **Consolidated user-admin endpoint.** Body `{ action: 'invite' \| 'update_role', ... }`. `invite` is admin-or-manager (with email/fullName/role), `update_role` is admin-only. |
| `api/transition-candidate` | Body `{ candidateId, action: 'advance' \| 'reject' \| 'skip' }`. Atomic server-side stage transition: marks the current pipeline row passed/failed/skipped, flips the next row to in_progress, and updates `candidates.current_stage_key` / `status` in one server hop. Uses a user-scoped Supabase client so RLS still gates the writes. Replaces the previous 3-step client-side dance. |
| `api/score-candidate` | Body `{ candidateId, roleId }`. Claude evaluator (port of ResumeScreener `score.js`). Writes `ai_score` + `ai_analysis` JSON to candidates. |
| `api/summarize-feedback` | Body `{ candidateId }`. Claude synthesizes all interviewer feedback into a structured committee brief. |
| `api/semantic-search` | Body `{ query, limit?, projectId?, roleId? }`. Claude ranks the user's RLS-scoped candidates against a natural-language query and returns `{ matches: [{id, name, score, reason}], scanned, model }`. Uses a USER-SCOPED Supabase client so it respects the caller's project membership. Caps at 60 candidates ranked per call to keep tokens bounded. |
| `api/notify-mention` | Body `{ commentId }`. Reads the comment's `mentions[]` array, resolves each profile email via the service-role client, and dispatches a templated email via `lib/email.js#emailMention`. Only the comment author may trigger notifications for their own comment. Fired best-effort from `CommentThread` after a successful insert (failures are swallowed so the UX isn't blocked by email delivery). |
| `api/ask` | **In-app chatbot.** Claude with tool-use (`search_candidates`, `get_candidate_detail`, `list_projects_and_roles`, `pipeline_summary`). Queries through a USER-SCOPED Supabase client so the bot only sees what the caller's RLS allows. Returns `display_link` per candidate so the model copies clickable links verbatim instead of exposing UUIDs. Loops up to 5 tool-call rounds. |
| `api/cron-stale-candidates` | Daily Vercel cron. Finds candidates not updated in `STALE_CANDIDATE_DAYS` and emails project managers a digest. |
| `api/cron-scheduled-reports` | Hourly Vercel cron. Reads `scheduled_reports` where cadence + day-of-week/month + hour matches the current UTC time, builds the report HTML server-side (using `lib/htmlExport.js` and a server-side aggregation that mirrors `useReportData`), and emails each recipient via `lib/email.js#emailScheduledReport` with the HTML attached. Sets `last_sent_at` to de-dupe within 23 h. |
| `api/email-candidate` | Body `{ candidateId, template: 'custom'\|'interview'\|'resume_request'\|'rejection'\|'offer', ... }`. Verifies the caller can see the candidate via RLS (user-scoped client), pulls the candidate's email + role title via service role, and dispatches the matching `lib/email.js` template. Each send is logged to `email_log` with `payload.candidateId` for the candidate-detail "Emails sent" card. Resend sender domain must be verified in `EMAIL_FROM` before this works for real candidates. |

Every handler **must** `await requireAuth(req, res)` first (cron handler verifies `CRON_SECRET` instead).

## File map (non-obvious bits)

- `lib/auth.js` - JWT verifier (HS256 + JWKS). Honours `REQUIRE_AUTH=false` for dev.
- `lib/supabase-admin.js` - service-role client factory. Server-only. **Never import from `src/`.**
- `lib/parse-file.js` - busboy + pdf-parse + mammoth. Two extractors: `extractText()` (used by score/upload-resume) and **`extractHtml()`** (used by upload-jd; DOCX uses `mammoth.convertToHtml`, PDF/TXT uses a heuristic text→HTML converter that detects bullet markers `• ‣ ◦ ▪ ■ - * -` and numbered lists `1. / 1) / (1)`). Light HTML sanitization strips `<script>`/`<style>` and `on*` attrs.
- `lib/storage.js` - `ensureBuckets()` is idempotent and lazy (creates `resumes` + `jds` on first upload).
- `lib/email.js` - `emailFeedbackReminder`, `emailStageChange`, `emailRejection`, `emailStaleDigest`. All log to `email_log`.
- `src/lib/pipeline.js` - single source of truth for stage keys, labels, defaults. **Do not redefine stages anywhere else.**
- `src/lib/permissions.js` - client-side affordance helpers. Server still enforces in RLS / handlers.
- `src/lib/useIsAdmin.js` - hook that checks `profiles.role === 'admin'`. Use to gate destructive UI affordances.
- `src/lib/api.js` - centralized fetch with bearer token. One function per `api/*` endpoint.

## Pages

| Path | Component | Notes |
|---|---|---|
| `/` | DashboardPage | Hero + KPIs + visual funnel + top scores + activity. **Has Project + Role filters** that scope every widget. Empty-state shows seed-SQL CTA for admins. |
| `/projects` | ProjectsPage | **Full-width responsive grid** of project cards (auto-fill, 280px min). Cards show status pill + role count + active-candidate count. "Show archived" toggle in header. **No detail panel by default.** |
| `/projects/:projectId` | ProjectsPage | Same component - grid stays visible (squeezes to 220px-min cards on the left half), and a **sticky right-side panel** opens showing the selected project's roles + actions (New role / Archive-Restore / Delete). Click another card to swap; **X or Escape** closes back to `/projects`. The panel is a `Card padding={false}` with sticky-top header inside its own scroll context. |
| `/projects/:projectId/roles/:roleId` | RoleDetailPage | Tiptap JD editor, JD upload (rich HTML), JD template picker, stage customizer, embedded pipeline kanban. **Uses `LocationFields`** (work_mode + city/state/country). Archive / Reopen action via `roles.status='closed'`. **Add candidate is NOT here** - it lives on `/candidates`. |
| `/candidates` | CandidatesPage | Filtered table (search / status / stage / project / role / **tag**). **Add candidate** dialog supports MULTI-FILE upload + auto-score-against-JD (concurrency=3, per-row progress). CSV export, admin-only delete per row. |
| `/candidates/:candidateId` | CandidateDetailPage | **Pending-feedback banner** at the top when the viewer is assigned to the candidate's current stage with no feedback. **Collapsible AI evaluation** card - collapsed by default once scored, with a one-line summary header (score + recommendation + chevron). Pipeline timeline with **per-stage Skip / Reject / Advance quick-actions inline on the active stage**, per-stage interviewer assignment + feedback form, all-feedback timeline + AI committee brief, comments, sibling-candidate list ("Also considered as"), Consider-for-another-role action, **Tags card** in sidebar, admin-only delete. **Resume rendered via `ResumeView`** (heuristic formatting), not raw `<pre>`. |
| `/calendar` | CalendarPage | Two tabs: "My availability" (drag-to-create slots) + "Team availability" (everyone's slots, color-coded with chip-legend filter). |
| `/my-interviews` | MyInterviewsPage | Two tabs: "Mine" (assignments + pending feedback) + "All" (org-wide assignments table). |
| `/reports` | ReportsPage | Hiring performance summary scoped by project/role. KPIs, pipeline stage breakdown (active/passed/rejected/skipped per stage with reach + pass-through %), AI score histogram, time-to-hire/reject medians, source breakdown, top scorers. **Filters baked into URL** so the link is shareable. Actions: Share link (copies URL), Print/PDF (uses `@media print` stylesheet), Export CSV. |
| `/jd-templates` | JDTemplatesPage | Full CRUD. **+ New template** button opens a modal with the Tiptap editor + name/category. Click any card to preview. Edit/Delete on each card. System templates can only be created/edited by admins (RLS in `0008`); personal templates by anyone. |
| `/people` | PeoplePage | Admin/manager-only via Sidebar. Lists all profiles, invite-by-email dialog, admin can change others' roles inline. |
| `/settings` | SettingsPage | Self-edit profile (name, role for self in v1, timezone). |

Sidebar items are grouped into two sections - **HIRING** (Dashboard, Hiring Projects, Candidates, Reports) and **TOOLS** (Calendar, Interviews, JD Templates, +People for admin/manager/hiring_team). UserMenu lives at the **bottom of the sidebar** as an expanded row (popover opens upwards). On mobile the sidebar is hidden, so a thin `md:hidden` header carries UserMenu. The Interviews item shows a **rose-toned count badge** when the user has pending feedback (poll every 60s).

**Important routing note:** `/projects` and `/projects/:projectId` render the **same `ProjectsPage` component**; layout switches based on `useParams().projectId` (no projectId = full grid, projectId = grid + side panel). The old standalone `ProjectDetailPage.jsx` was removed.

## Shared UI primitives (`src/components/common/`)

- `Card` - gradient-bordered container.
- `Button` - variants: primary (gradient), secondary, ghost, danger.
- `Modal` - escape-to-close, backdrop-blur.
- `ConfirmDialog` - danger-tone confirm wrapper around Modal.
- `EmptyState` - icon + title + description + optional action.
- `Spinner` - small inline loading.
- `Skeleton` / `SkeletonRows` / `SkeletonGrid` - shimmer loaders (use these instead of Spinner for grid/list pages).
- `FileDrop` - drag-or-click file picker. Pass `multiple` for the bulk-upload mode (CandidateImportDialog uses this for resume screening).
- `PageHeader` - breadcrumb + title + subtitle + actions.
- **`FilterBar` + `FilterSearch` + `FilterSelect`** - consistent filter row. `FilterSelect` is a **fully custom dark-themed dropdown** (no native `<select>`); pill trigger shows the selected value inline with a one-click ✕ to clear; auto-search inside the popover when options > 8. `FilterBar` shows an "active count" + Clear-all pill. Pass `icon` to FilterSelect for a leading icon.
- **`LocationFields`** - work-mode toggle (Remote / Office / Hybrid) + city / state / country inputs. Used in role create + edit forms. Companion `formatLocation({work_mode, city, state, country, location})` helper renders the structured value as a single string anywhere a role's place is displayed; falls back to legacy `roles.location` text if the structured fields are empty.

## Page-specific components

- `src/components/candidates/ResumeView.jsx` - heuristic formatter for resume_text. Detects name line, contact info (email/phone/LinkedIn/URL → clickable chips), ALL-CAPS section headings, bullet items (`-`, `*`, `•`, `‣`, `◦`, `▪`, `■`, etc.), and "Company - Title  Date" role lines. Falls back to paragraph rendering with line breaks preserved.
- `src/components/candidates/CandidateImportDialog.jsx` - three-tab dialog (Upload / LinkedIn / Manual). Upload tab supports **multi-file** with an auto-screen-against-JD checkbox (default on). Per-row live status: Uploading → Queued → Scoring with Claude → Scored XX/100. Concurrency capped at 3. Refreshes candidate queries before AND after scoring.
- `src/components/candidates/TagsEditor.jsx` - chip-style tag editor. Enter or comma commits a tag (kebab-cased), Backspace removes the last. Optional `suggestions` prop populates a "common tags" hint row.
- `src/components/dashboard/HeroCard.jsx` / `PipelineFunnel.jsx` / `Sparkline.jsx` / `ScoreGauge.jsx` - dashboard-only widgets.
- `src/components/reports/StageBreakdown.jsx` - gradient stage bars with active / passed / rejected / skipped slices.
- `src/components/reports/ScoreHistogram.jsx` - 10-bucket AI score distribution (rose → amber → emerald gradient).

## Pipeline state machine

`src/lib/pipeline.js` is the single source of truth. **9 stages, default order:**

`resume_submitted → hm_review → technical_written → technical_interview → problem_solving → case_study → offer → joined_fractal → rejected_offer`

- `joined_fractal` and `rejected_offer` are post-offer outcome stages (added in migration `0007`). They live AFTER `offer` and represent the candidate's final disposition.
- Per-role overrides: `roles.stage_config` as `[{stage_key, enabled, what_to_expect}]`. The customizer in `RoleDetailPage` lets a manager toggle stages off and edit "what to expect".
- Per-candidate overrides: set `candidate_pipeline.state` directly to `skipped`.
- Pipeline rows are auto-created by the `candidates_create_pipeline` trigger on candidate insert (one row per stage, respecting `stage_config`). The trigger lives in `0007` (replaces the 7-stage version from `0004`).
- **Advance / reject / skip is client-side** - multiple updates done sequentially via the Supabase client. The CandidateDetailPage timeline now exposes per-stage Skip / Reject / Advance quick-actions inline on the active stage. If atomicity becomes an issue, lift to an `api/transition-candidate.js` endpoint (counts toward the 12-function limit).
- **Server-side STAGE_LABELS maps** in `api/cron-stale-candidates.js`, `api/summarize-feedback.js`, and `api/ask.js` mirror `STAGES` from `pipeline.js`. Whenever you add or rename a stage, update **all three** server-side maps as well as `pipeline.js`.

## Permissions

Two layers, always:

1. **RLS** in Postgres for direct browser reads/writes (post-0004 it's project-membership-based).
2. **`requireAuth` + permission checks** in API handlers for trusted writes; service-role client used only after the gate.

Roles: `admin`, `hiring_manager`, `hiring_team`, `interviewer`. The 0004 trigger auto-adds project owners as `manager` members.

**Destructive actions are admin-only** - `api/admin-delete` always checks `profiles.role === 'admin'`; the corresponding UI buttons are gated by `useIsAdmin()`. `api/admin-users` enforces its own gates per `action` (admin-only for `update_role`, admin-or-manager for `invite`).

## When adding features

- **New endpoint** → drop in `api/*.js`. Always `await requireAuth(req, res)` first. Add a wrapper in `src/lib/api.js`. **Watch the function count** - Hobby-plan limit is 12; consolidate before adding.
- **Shared server helper** → `lib/*.js` (NOT `api/`).
- **New page** → `src/pages/*.jsx` and add to `AppShell.jsx` + `Sidebar.jsx`.
- **New table** → new migration file `000N_*.sql`. Include RLS in the same migration. Backfill if tightening. Wrap any cross-table check in `security definer` to avoid recursion.
- **New filter on a page** → use `<FilterBar>` + `<FilterSearch>` + `<FilterSelect>` from `src/components/common/FilterBar.jsx` for visual consistency.
- **New AI feature** → adapt the tool-use pattern from `api/score-candidate.js` (structured output) or `api/ask.js` (multi-turn tool-call loop). Always tool-use. Always `requireAuth` first.
- **New email** → add a templated sender in `lib/email.js`. Use the existing `layout()` helper for consistent styling.
- **New stage** → don't. The 7-stage pipeline is encoded in many places (DB trigger default keys, `src/lib/pipeline.js`, the `candidate_pipeline.stage_key` enum-like check).

## Out of scope (firmly)

- Multi-tenant org isolation. App is single-org.
- Candidate-facing logins. Internal-only.
- LinkedIn scraping. We store the URL only - **no AI scoring for LinkedIn-only candidates** (the UI disables the button).
- Schedule-interview booking flow + `.ics` export. Calendar is for marking availability only (this is intentional, per user request - don't re-introduce booking without explicit asks).

## Style

- Comments only when **why** is non-obvious. No what-comments.
- No backwards-compat shims for in-progress code.
- Match ResumeScreener visual language: dark theme, gradient borders, indigo→violet→pink accents, `lucide-react` icons.
- JD content (Tiptap output / read-only HTML) uses the `.jd-content` (editor) and `.jd-prose` (read-only) classes from `src/index.css` - don't add `@tailwindcss/typography`.
- React-big-calendar dark-theme overrides also live in `src/index.css`. Don't import the calendar's default light CSS in any other place than `AvailabilityCalendar.jsx`.
- Loading states: prefer `Skeleton` over `Spinner` for grid/list pages.
- Print styles in `src/index.css` (`@media print`) hide chrome (sidebar, FAB, action buttons) and flatten cards to white - used by the Reports page's "Print / PDF" action. New chrome-y elements should add a print-hiding rule when relevant.
- For new filter rows: use `<FilterBar>` with `<FilterSearch>` + `<FilterSelect>` rather than rolling your own selects; consistent visual + dark-themed dropdown.

## AI scoring details (`api/score-candidate.js`)

This is the most important AI surface in the app - the user expects high accuracy because hiring decisions hinge on it. Things to know:

- The endpoint sends Claude **structured JD HTML** converted to text-with-structure (preserves `## headings` and `- bullets`) rather than flat-stripped text. Claude reads the JD's hierarchy.
- **Role context** (title, level, work_mode, location) is injected directly into the system prompt so seniority and location-fit are calibrated.
- Claude is asked to **identify the 4-8 most important requirements from the JD itself** and classify each as `must` / `preferred` / `nice` - no manual rubric needed per role.
- Larger thinking budget (`CLAUDE_THINKING_BUDGET=5000` default) - accuracy matters more than speed.
- **Post-processing safety net** runs after Claude returns:
  - 1 must missing → score capped at **70**; 2+ → capped at **50** + recommendation forced to **REJECT**.
  - **Level-keyword-based experience floor** (`junior` / `mid` / `senior` / `principal`). Below the floor: −15. Way above the senior cap: −5.
  - Location penalty of −5 when work_mode is office/hybrid and the candidate's resume location clearly doesn't match.
- `ai_analysis.context` block records role metadata + detected expectations + must-misses count for audit / debugging.
- For LinkedIn-only candidates (`resume_text` is null), the endpoint returns 400 - AI scoring is **resume-required by design** (locked decision).

When changing the scoring logic, be mindful: the user's company will trust this. Don't loosen the safety net without a clear reason.

## Chatbot details (`api/ask.js` + `ChatWidget`)

- The bot uses a USER-SCOPED Supabase client built per-request from the caller's bearer token, so RLS naturally narrows what it can see.
- Each candidate-returning tool ships a `display_link` field formatted exactly as `[Name](candidate://<id>)`. The system prompt instructs the model to copy this verbatim - never construct the link from the raw id, never print the id elsewhere. The renderer also has a defensive `sanitizeOrphanCandidateUrls()` pass that strips any bare `candidate://...` outside a markdown link.
- AI score is **excluded from default chat responses** - only included when the user explicitly asks about scoring.
- Conversation history persists in `localStorage` (key: `slate.chat.messages`, capped at 30 messages). Clear-history button in the panel header (shown only when there's history) wipes both state and storage with a confirm.

## Ship checklist (before marking a feature done)

1. `npm run build` succeeds.
2. RLS policies updated if a new table; backfill if tightening.
3. `.env.example` updated if a new env var.
4. README updated if a setup step changed.
5. `requireAuth` on every new `api/*.js` (or `CRON_SECRET` check for cron handlers).
6. Permission check at the UI affordance layer too - don't rely on RLS alone.
7. React Query: every mutation invalidates the right query keys, no orphan caches.
8. Toasts on every mutation success/error path.
9. Function count check: `ls api/*.js | wc -l` should be ≤ 12.

## Deploy notes

- Vercel project: `trackerhiring` under `prasnajeet-samals-projects`.
- Production env vars are **sensitive by default** on Vercel - `vercel env pull` returns them as empty strings even when set. Trust the "Added" confirmation, not pull output.
- `VITE_*` vars are inlined at build time. After changing them, **redeploy** (`vercel --prod`) - not picked up by env-only changes.
- Auto-deploy on push to `main` is configured via Vercel's GitHub integration.
- Hobby-plan limit: **12 serverless functions per deployment**. Currently at 11. Consolidate before adding endpoints.
