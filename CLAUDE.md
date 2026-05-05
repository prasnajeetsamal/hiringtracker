# Slate — Hiring Tracker (Claude notes)

A focused hiring tracker. Sibling to ResumeScreener at `../resumescreener`. **Reuse, don't reinvent.**

## Status snapshot

- **v0.1** — walking skeleton (auth, projects, roles, JD textarea). Shipped.
- **v0.5 + v1.0** — full hiring loop, AI scoring, feedback, comments, calendar (availability only), email, cron. Shipped.
- **Skipped on purpose** — schedule-interview booking flow + `.ics` export. The calendar marks availability only; no booking.
- **Deferred** — offer tracking, audit-log viewer UI, diversity dashboard, candidate self-service, in-app permission management UI.

Live at https://trackerhiring.vercel.app. Repo at https://github.com/prasnajeetsamal/hiringtracker.

## Architectural rules

- **Frontend**: Vite + React 18 + **JavaScript** (no TypeScript). Tailwind CSS, dark theme baked into `src/index.css`.
- **Routing**: `react-router-dom` v6, BrowserRouter, defined in `src/components/layout/AppShell.jsx`.
- **Server state**: `@tanstack/react-query`. Client in `src/lib/queryClient.js`. Default `staleTime: 30s`, `retry: 1`, no window-focus refetch. Always invalidate the right query keys on mutation.
- **Backend**: Vercel serverless functions in `api/*.js`. Node 20 runtime. **Only real HTTP endpoints belong in `api/`.** Shared server helpers go in `lib/` at the repo root (Vercel will not expose them as routes).
- **Auth**: Supabase Auth. Browser uses anon key; server (`api/*`) uses `requireAuth` from `lib/auth.js` to verify the bearer token. **Trusted server writes use the service-role client in `lib/supabase-admin.js`** (bypasses RLS — gate it with explicit checks first).
- **DB**: Supabase Postgres. Schema in `supabase/migrations/` (run via dashboard SQL editor in numeric order).
- **Storage**: Supabase Storage. Two private buckets — `resumes` and `jds`. **Auto-created on first upload via `lib/storage.js#ensureBuckets()`** — no manual provisioning step.
- **AI**: Anthropic Claude (`claude-sonnet-4-5`) via direct `fetch` (no SDK), same pattern as ResumeScreener. **Always use tool-use for structured output.** Extended thinking is on by default for evaluator-style tasks (set `CLAUDE_THINKING=off` to disable).
- **Email**: Resend via `lib/email.js`. **Falls back to a no-op if `RESEND_API_KEY` is not set** so dev keeps working. Every send is logged in `email_log`.
- **Cron**: Vercel Cron. Registered in `vercel.json`. The handler verifies an optional `CRON_SECRET` bearer token if set.

## File map (non-obvious bits)

- `lib/auth.js` — JWT verifier (HS256 + JWKS asymmetric). Also honours `REQUIRE_AUTH=false` for dev.
- `lib/supabase-admin.js` — service-role client factory. Server-only. **Never import from `src/`.**
- `lib/parse-file.js` — busboy + pdf-parse + mammoth. Shared by `api/extract.js`, `api/upload-resume.js`, `api/upload-jd.js`. 20 MB / 20 files / request limit.
- `lib/storage.js` — Storage helpers. `ensureBuckets()` is idempotent and lazy.
- `lib/email.js` — `emailFeedbackReminder`, `emailStageChange`, `emailRejection`, `emailStaleDigest`. All log to `email_log`.
- `src/lib/pipeline.js` — single source of truth for stage keys, labels, defaults. **Do not redefine stages anywhere else.**
- `src/lib/permissions.js` — client-side affordance helpers. Server still enforces in RLS / handlers.
- `src/lib/api.js` — centralized fetch with bearer token. One function per `api/*` endpoint.

## Migrations and what they do

| File | Purpose |
|---|---|
| `0001_init.sql` | All tables + indexes. `auth.users` insert trigger auto-creates `profiles` row. |
| `0002_rls.sql` | RLS on. **Permissive** policies (any authenticated user) — used in v0.1. |
| `0003_seed_templates.sql` | Seeds 3 system JD templates (Senior SWE, PM, Senior DS). |
| `0004_v05_v10.sql` | Tightens RLS to **project-membership-based**, adds helper functions (`is_admin`, `is_project_member`, `is_project_manager`), adds project-owner-as-manager trigger (with backfill), auto-pipeline-rows-on-candidate-insert trigger, audit-log triggers on candidates / pipeline / feedback. |

When adding a migration: **always include RLS for any new table in the same migration**. Backfill existing data if you're tightening policies.

## API endpoints (current)

| Endpoint | Purpose |
|---|---|
| `api/extract` | Multipart → text (PDF/DOCX/TXT). Used for ad-hoc previews. |
| `api/upload-resume` | Multipart → Storage → parse → candidate row. Creates files row. |
| `api/upload-jd` | Multipart → Storage → parse → role row. Sets `jd_source='uploaded'`. |
| `api/score-candidate` | Body `{candidateId, roleId}`. Claude evaluator (port of ResumeScreener `score.js`). Writes `ai_score` + `ai_analysis` JSON to candidates. |
| `api/summarize-feedback` | Body `{candidateId}`. Claude synthesizes all interviewer feedback into a structured committee brief. Writes to `candidates.ai_analysis.committee_brief`. |
| `api/cron-stale-candidates` | Daily Vercel cron. Finds candidates not updated in `STALE_CANDIDATE_DAYS` and emails project managers a digest. |

Every handler **must** `await requireAuth(req, res)` first (cron handler verifies `CRON_SECRET` instead).

## Pipeline state machine

`src/lib/pipeline.js` is the single source of truth. Default order:

`resume_submitted → hm_review → technical_written → technical_interview → problem_solving → case_study → offer`

- Per-role overrides live on `roles.stage_config` as `[{stage_key, enabled, what_to_expect}]`.
- Per-candidate overrides set `candidate_pipeline.state` directly (e.g. to `skipped`).
- Pipeline rows are auto-created by the `candidates_create_pipeline` trigger on candidate insert (one row per stage, respecting `stage_config`).
- **Advance / reject / skip** is currently client-side — multiple updates done sequentially via the Supabase client. If we ever need atomicity, lift to an `api/transition-candidate.js` endpoint.

## Permissions

Two layers of enforcement, always:

1. **RLS** in Postgres for direct browser reads/writes (post-0004 it's project-membership-based).
2. **`requireAuth` + permission helpers** in API handlers for trusted writes; service-role client used only after the gate.

Roles: `admin`, `hiring_manager`, `hiring_team`, `interviewer`. The trigger from 0004 auto-adds the project owner as a `manager` member of `project_members` — so creating a project gives you full control over it regardless of `profiles.role`. Interviewers can only submit feedback for rounds they're assigned to. **Schedule-interview booking is intentionally not built.**

## When adding features

- **New endpoint** → drop in `api/*.js`. Always `await requireAuth(req, res)` first. Add a wrapper in `src/lib/api.js`.
- **Shared server helper** → `lib/*.js` (NOT `api/`, or Vercel will expose it as a route).
- **New page** → `src/pages/*.jsx` and add to `AppShell.jsx`.
- **New table** → new migration file `000N_*.sql`. Include RLS in the same migration. Backfill if tightening.
- **AI feature** → adapt the tool-use pattern from `api/score-candidate.js`. Always tool-use for structured output. Always `requireAuth` first.
- **New email** → add a templated sender in `lib/email.js`. Use the existing `layout()` helper for consistent styling.
- **New stage** → don't. The 7-stage pipeline is encoded in many places (DB trigger default keys, `src/lib/pipeline.js`, the `candidate_pipeline.stage_key` enum-like check). If you genuinely need a new stage, update DB defaults + `pipeline.js` together.

## Out of scope (firmly)

- Multi-tenant org isolation. App is single-org.
- Candidate-facing logins. Internal-only.
- LinkedIn scraping. We store the URL only — **no AI scoring for LinkedIn-only candidates** (the UI disables the button).
- Schedule-interview booking flow + `.ics` export. Calendar is for marking availability only.

## Style

- Comments only when **why** is non-obvious. No what-comments.
- No backwards-compat shims for in-progress code.
- Match ResumeScreener visual language: dark theme, gradient borders, indigo→violet→pink accents, `lucide-react` icons.
- JD content (Tiptap output / read-only HTML) uses the `.jd-content` (editor) and `.jd-prose` (read-only) classes from `src/index.css` — don't add `@tailwindcss/typography`.
- React-big-calendar dark theme overrides also live in `src/index.css`. Don't import the calendar's default light CSS in any other place than `AvailabilityCalendar.jsx`.

## Ship checklist (before marking a feature done)

1. `npm run build` succeeds (no TS, but Vite still type-checks JSX/ES syntax).
2. RLS policies updated if a new table; backfill if tightening.
3. `.env.example` updated if a new env var.
4. README updated if a setup step changed.
5. `requireAuth` on every new `api/*.js` (or `CRON_SECRET` check for cron handlers).
6. Permission check at the UI affordance layer too (don't rely on RLS alone for UX — it just produces empty results / opaque errors).
7. React Query: every mutation invalidates the right query keys, no orphan caches.
8. Toasts on every mutation success/error path.

## Deploy notes

- Vercel project: `trackerhiring` under `prasnajeet-samals-projects`.
- Production env vars are **sensitive by default** on Vercel — `vercel env pull` returns them as empty strings even when set. Trust the "Added" confirmation, not pull output.
- `VITE_*` vars are inlined at build time. After changing them, **redeploy** (`vercel --prod`) or push a commit. They are NOT picked up by env-only changes.
- Auto-deploy on push to `main` is configured via Vercel's GitHub integration.
