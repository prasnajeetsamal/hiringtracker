# Slate — Hiring Tracker (Claude notes)

A focused hiring tracker. Sibling to ResumeScreener at `../resumescreener`. **Reuse, don't reinvent.**

## Status snapshot

- **v0.1** — auth, projects, roles, JD textarea, app shell. Shipped.
- **v0.5 + v1.0** — full hiring loop, AI scoring, feedback, comments, calendar (availability only, no booking), email, daily cron. Shipped.
- **People** — invite users via Supabase admin API, change roles, team-availability calendar, all-interviews view. Shipped.
- **Multi-role candidate consideration** — clone candidate to another role, sibling-list on detail page. Shipped.
- **In-app AI assistant** — Claude with tool-use over the user's RLS-scoped data, floating bottom-right on every page. Shipped.
- **Admin-only deletes** — single consolidated endpoint for candidate / role / project hard-delete with cascading cleanup of comments + storage. Shipped.

Live at https://trackerhiring.vercel.app. Repo at https://github.com/prasnajeetsamal/hiringtracker.

## Architectural rules

- **Frontend**: Vite + React 18 + **JavaScript** (no TypeScript). Tailwind CSS, dark theme baked into `src/index.css`.
- **Routing**: `react-router-dom` v6, BrowserRouter, defined in `src/components/layout/AppShell.jsx`. The chat FAB lives at the AppShell level so it persists across routes.
- **Server state**: `@tanstack/react-query`. Client in `src/lib/queryClient.js`. Default `staleTime: 30s`, `retry: 1`, no window-focus refetch. **Always invalidate the right query keys on mutation** — many widgets share `['candidates-all']` and `['dashboard']`.
- **Backend**: Vercel serverless functions in `api/*.js`. Node 20 runtime. **Only real HTTP endpoints belong in `api/`** — shared server helpers go in `lib/` at the repo root (Vercel will not expose them as routes).
- **Hobby-plan function limit**: max **12** functions per deployment. We're at the cap; consolidate before adding new endpoints. The first casualty was the three split delete endpoints → one `admin-delete` dispatching on `entityType`.
- **Auth**: Supabase Auth. Browser uses anon key; server (`api/*`) uses `requireAuth` from `lib/auth.js` to verify the bearer token. Trusted server writes use the **service-role client** in `lib/supabase-admin.js` (bypasses RLS — gate it with explicit checks first).
- **DB**: Supabase Postgres. Schema in `supabase/migrations/` (run via dashboard SQL editor in numeric order).
- **Storage**: Supabase Storage. Two private buckets — `resumes` and `jds`. Auto-created on first upload via `lib/storage.js#ensureBuckets()`.
- **AI**: Anthropic Claude (`claude-sonnet-4-5`) via direct `fetch` (no SDK). **Always use tool-use for structured output** (evaluator) or domain queries (chatbot). Extended thinking is on by default for evaluator-style tasks.
- **Email**: Resend via `lib/email.js`. **Falls back to a no-op if `RESEND_API_KEY` is not set** so dev keeps working. Every send is logged in `email_log`.
- **Cron**: Vercel Cron. Registered in `vercel.json`. Handler verifies an optional `CRON_SECRET` if set.

## Migrations and what they do

| File | Purpose |
|---|---|
| `0001_init.sql` | All tables + indexes. `auth.users` insert trigger auto-creates `profiles` row. |
| `0002_rls.sql` | RLS on. Permissive policies (any authenticated user) — used in v0.1. |
| `0003_seed_templates.sql` | Seeds 3 system JD templates (Senior SWE, PM, Senior DS). |
| `0004_v05_v10.sql` | **Tightens RLS** to project-membership-based, adds helper functions (`is_admin`, `is_project_member`, `is_project_manager`), project-owner-as-manager trigger (with backfill), candidate→pipeline-rows trigger, audit-log triggers. |
| `0005_admin_people.sql` | Lets admin / project managers update other profiles' role + name (RLS belt-and-suspenders for direct browser writes; server endpoints also gate). Indexes on `availability_slots(starts_at)` for the team-calendar range query. |
| `0006_fix_rls_recursion.sql` | **Fixes infinite recursion** between candidates and candidate_pipeline policies. Wraps cross-table EXISTS checks in `security definer` functions (`user_assigned_to_candidate`, `user_member_of_candidates_project`, `user_member_of_pipelines_project`, `user_assigned_to_pipeline`, `user_can_see_candidate_via_project`, `user_can_see_role_via_project`). All cross-table policies now use these helpers. |

When adding a migration: **always include RLS for any new table in the same migration**. Backfill existing data if you're tightening policies. **Never reference another table directly inside an RLS policy if that other table's policy references back** — wrap in a `security definer` function instead.

Demo seed: `supabase/demo/seed_demo_data.sql` — idempotent, tags rows with `tags @> ['demo']` for easy bulk-delete.

## API endpoints (current — 11 of 12)

| Endpoint | Purpose |
|---|---|
| `api/extract` | Multipart → text (PDF/DOCX/TXT). Used for ad-hoc previews. |
| `api/upload-resume` | Multipart → Storage → parse text → candidate row (creates or updates). |
| `api/upload-jd` | Multipart → Storage → **rich HTML extraction** (mammoth `convertToHtml` for DOCX, heuristic bullets/headings for PDF/TXT) → role row. |
| `api/create-candidate` | Server-side candidate insert for LinkedIn / manual flows (avoids RLS membership edge cases). |
| `api/clone-candidate` | "Consider for another role" — copies profile + resume to a new candidate row in a target role; AI score / status / stage start fresh. Avoids duplicates by email match. |
| `api/admin-delete` | **Admin-only** consolidated delete. Body `{ entityType: 'candidate' | 'role' | 'project', id }`. Handles cascading comments + storage cleanup. |
| `api/score-candidate` | Body `{ candidateId, roleId }`. Claude evaluator (port of ResumeScreener `score.js`). Writes `ai_score` + `ai_analysis` JSON to candidates. |
| `api/summarize-feedback` | Body `{ candidateId }`. Claude synthesizes all interviewer feedback into a structured committee brief. |
| `api/ask` | **In-app chatbot.** Claude with tool-use (`search_candidates`, `get_candidate_detail`, `list_projects_and_roles`, `pipeline_summary`). Queries through a USER-SCOPED Supabase client so the bot only sees what the caller's RLS allows. Returns `display_link` per candidate so the model copies clickable links verbatim instead of exposing UUIDs. Loops up to 5 tool-call rounds. |
| `api/invite-user` | Admin / hiring-manager invites a user via `supabase.auth.admin.inviteUserByEmail`. If SMTP isn't configured, falls back to `admin.generateLink` and surfaces the URL for manual sharing. |
| `api/update-user-role` | **Admin-only** change of another user's role. |
| `api/cron-stale-candidates` | Daily Vercel cron. Finds candidates not updated in `STALE_CANDIDATE_DAYS` and emails project managers a digest. |

Every handler **must** `await requireAuth(req, res)` first (cron handler verifies `CRON_SECRET` instead).

## File map (non-obvious bits)

- `lib/auth.js` — JWT verifier (HS256 + JWKS). Honours `REQUIRE_AUTH=false` for dev.
- `lib/supabase-admin.js` — service-role client factory. Server-only. **Never import from `src/`.**
- `lib/parse-file.js` — busboy + pdf-parse + mammoth. Two extractors: `extractText()` (used by score/upload-resume) and **`extractHtml()`** (used by upload-jd; DOCX uses `mammoth.convertToHtml`, PDF/TXT uses a heuristic text→HTML converter that detects bullet markers `• ‣ ◦ ▪ ■ - * –` and numbered lists `1. / 1) / (1)`). Light HTML sanitization strips `<script>`/`<style>` and `on*` attrs.
- `lib/storage.js` — `ensureBuckets()` is idempotent and lazy (creates `resumes` + `jds` on first upload).
- `lib/email.js` — `emailFeedbackReminder`, `emailStageChange`, `emailRejection`, `emailStaleDigest`. All log to `email_log`.
- `src/lib/pipeline.js` — single source of truth for stage keys, labels, defaults. **Do not redefine stages anywhere else.**
- `src/lib/permissions.js` — client-side affordance helpers. Server still enforces in RLS / handlers.
- `src/lib/useIsAdmin.js` — hook that checks `profiles.role === 'admin'`. Use to gate destructive UI affordances.
- `src/lib/api.js` — centralized fetch with bearer token. One function per `api/*` endpoint.

## Pages

| Path | Component | Notes |
|---|---|---|
| `/` | DashboardPage | Hero + KPIs + visual funnel + top scores + activity. **Has Project + Role filters** that scope every widget. Empty-state shows seed-SQL CTA for admins. |
| `/projects` | ProjectsPage | Card grid with role + active-candidate counts. |
| `/projects/:projectId` | ProjectDetailPage | Roles grid (with status pill + active-candidate count). Admin gets Delete project button. |
| `/projects/:projectId/roles/:roleId` | RoleDetailPage | Tiptap JD editor, JD upload (rich HTML), JD template picker, stage customizer, embedded pipeline kanban. **Add candidate is NOT here** — it lives on `/candidates`. |
| `/candidates` | CandidatesPage | Filtered table (search / status / stage / project / role). **Add candidate** dialog with searchable role picker. CSV export, admin-only delete per row. |
| `/candidates/:candidateId` | CandidateDetailPage | AI evaluation, pipeline timeline with per-stage interviewer assignment + feedback form, all-feedback timeline + AI committee brief, comments, sibling-candidate list ("Also considered as"), Consider-for-another-role action, admin-only delete. |
| `/calendar` | CalendarPage | Two tabs: "My availability" (drag-to-create slots) + "Team availability" (everyone's slots, color-coded with chip-legend filter). |
| `/my-interviews` | MyInterviewsPage | Two tabs: "Mine" (assignments + pending feedback) + "All" (org-wide assignments table). |
| `/jd-templates` | JDTemplatesPage | System + personal templates. |
| `/people` | PeoplePage | Admin/manager-only via Sidebar. Lists all profiles, invite-by-email dialog, admin can change others' roles inline. |
| `/settings` | SettingsPage | Self-edit profile (name, role for self in v1, timezone). |

## Shared UI primitives (`src/components/common/`)

- `Card` — gradient-bordered container.
- `Button` — variants: primary (gradient), secondary, ghost, danger.
- `Modal` — escape-to-close, backdrop-blur.
- `ConfirmDialog` — danger-tone confirm wrapper around Modal.
- `EmptyState` — icon + title + description + optional action.
- `Spinner` — small inline loading.
- `Skeleton` / `SkeletonRows` / `SkeletonGrid` — shimmer loaders (use these instead of Spinner for grid/list pages).
- `FileDrop` — drag-or-click file picker.
- `PageHeader` — breadcrumb + title + subtitle + actions.
- **`FilterBar` + `FilterSearch` + `FilterSelect`** — consistent filter row across pages. `FilterSelect` highlights when active (vs. its `defaultValue` or first option). `FilterBar` shows an "active count" + Clear-all pill.

## Pipeline state machine

`src/lib/pipeline.js` is the single source of truth. Default order:

`resume_submitted → hm_review → technical_written → technical_interview → problem_solving → case_study → offer`

- Per-role overrides: `roles.stage_config` as `[{stage_key, enabled, what_to_expect}]`.
- Per-candidate overrides: set `candidate_pipeline.state` directly to `skipped`.
- Pipeline rows are auto-created by the `candidates_create_pipeline` trigger on candidate insert (one row per stage, respecting `stage_config`).
- **Advance / reject / skip is client-side** — multiple updates done sequentially via the Supabase client. If atomicity becomes an issue, lift to an `api/transition-candidate.js` endpoint (counts toward the 12-function limit).

## Permissions

Two layers, always:

1. **RLS** in Postgres for direct browser reads/writes (post-0004 it's project-membership-based).
2. **`requireAuth` + permission checks** in API handlers for trusted writes; service-role client used only after the gate.

Roles: `admin`, `hiring_manager`, `hiring_team`, `interviewer`. The 0004 trigger auto-adds project owners as `manager` members.

**Destructive actions are admin-only** — `api/admin-delete` always checks `profiles.role === 'admin'`; the corresponding UI buttons are gated by `useIsAdmin()`. `api/update-user-role` is also admin-only. Inviting users requires admin OR project manager.

## When adding features

- **New endpoint** → drop in `api/*.js`. Always `await requireAuth(req, res)` first. Add a wrapper in `src/lib/api.js`. **Watch the function count** — Hobby-plan limit is 12; consolidate before adding.
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
- LinkedIn scraping. We store the URL only — **no AI scoring for LinkedIn-only candidates** (the UI disables the button).
- Schedule-interview booking flow + `.ics` export. Calendar is for marking availability only (this is intentional, per user request — don't re-introduce booking without explicit asks).

## Style

- Comments only when **why** is non-obvious. No what-comments.
- No backwards-compat shims for in-progress code.
- Match ResumeScreener visual language: dark theme, gradient borders, indigo→violet→pink accents, `lucide-react` icons.
- JD content (Tiptap output / read-only HTML) uses the `.jd-content` (editor) and `.jd-prose` (read-only) classes from `src/index.css` — don't add `@tailwindcss/typography`.
- React-big-calendar dark-theme overrides also live in `src/index.css`. Don't import the calendar's default light CSS in any other place than `AvailabilityCalendar.jsx`.
- Loading states: prefer `Skeleton` over `Spinner` for grid/list pages.

## Chatbot details (`api/ask.js` + `ChatWidget`)

- The bot uses a USER-SCOPED Supabase client built per-request from the caller's bearer token, so RLS naturally narrows what it can see.
- Each candidate-returning tool ships a `display_link` field formatted exactly as `[Name](candidate://<id>)`. The system prompt instructs the model to copy this verbatim — never construct the link from the raw id, never print the id elsewhere. The renderer also has a defensive `sanitizeOrphanCandidateUrls()` pass that strips any bare `candidate://...` outside a markdown link.
- AI score is **excluded from default chat responses** — only included when the user explicitly asks about scoring.
- Conversation history persists in `localStorage` (key: `slate.chat.messages`, capped at 30 messages). Clear-history button in the panel header (shown only when there's history) wipes both state and storage with a confirm.

## Ship checklist (before marking a feature done)

1. `npm run build` succeeds.
2. RLS policies updated if a new table; backfill if tightening.
3. `.env.example` updated if a new env var.
4. README updated if a setup step changed.
5. `requireAuth` on every new `api/*.js` (or `CRON_SECRET` check for cron handlers).
6. Permission check at the UI affordance layer too — don't rely on RLS alone.
7. React Query: every mutation invalidates the right query keys, no orphan caches.
8. Toasts on every mutation success/error path.
9. Function count check: `ls api/*.js | wc -l` should be ≤ 12.

## Deploy notes

- Vercel project: `trackerhiring` under `prasnajeet-samals-projects`.
- Production env vars are **sensitive by default** on Vercel — `vercel env pull` returns them as empty strings even when set. Trust the "Added" confirmation, not pull output.
- `VITE_*` vars are inlined at build time. After changing them, **redeploy** (`vercel --prod`) — not picked up by env-only changes.
- Auto-deploy on push to `main` is configured via Vercel's GitHub integration.
- Hobby-plan limit: **12 serverless functions per deployment**. Currently at 11. Consolidate before adding endpoints.
