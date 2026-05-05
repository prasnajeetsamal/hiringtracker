# Slate — Hiring Tracker (Claude notes)

A focused hiring tracker. Sibling to ResumeScreener at `../resumescreener`. **Reuse, don't reinvent.**

## Architectural rules

- **Frontend**: Vite + React 18 + **JavaScript** (no TypeScript). Tailwind CSS, dark theme baked into `src/index.css`.
- **Routing**: react-router-dom v6, BrowserRouter, defined in `src/components/layout/AppShell.jsx`.
- **Server state**: `@tanstack/react-query`. The query client lives in `src/lib/queryClient.js`. Default `staleTime: 30s`, `retry: 1`, no window-focus refetch.
- **Backend**: Vercel serverless functions in `api/*.js`. Node 20 runtime. **Only real HTTP endpoints belong in `api/`.** Shared server helpers go in `lib/` at the repo root (Vercel will not expose them as routes).
- **Auth**: Supabase Auth. Browser uses anon key; server (`api/*`) uses `requireAuth` from `lib/auth.js` to verify the bearer token. Trusted server writes use the **service-role client** in `lib/supabase-admin.js` (bypasses RLS).
- **DB**: Supabase Postgres. Schema in `supabase/migrations/`. RLS is on, currently permissive for v0.1; to be tightened in v0.5 once project membership is wired.
- **Files**: Supabase Storage (`resumes` and `jds` buckets) — not yet provisioned in v0.1.
- **AI**: Anthropic Claude (`claude-sonnet-4-5`) via direct `fetch`, same pattern as ResumeScreener. Use tool-use for structured output.

## Pipeline state machine

`src/lib/pipeline.js` is the single source of truth for stage keys, default order, and the per-role `stage_config` shape. **Don't redefine stages elsewhere.** Default order:

`resume_submitted → hm_review → technical_written → technical_interview → problem_solving → case_study → offer`

Per-role overrides live on `roles.stage_config` (`[{stage_key, enabled, what_to_expect}]`). Per-candidate overrides set the `candidate_pipeline.state` directly to `skipped`.

## Permissions

Two layers of enforcement, always:

1. **RLS** in Postgres for direct browser reads/writes.
2. **`requireAuth` + `lib/permissions.js`** in API handlers for trusted writes.

Roles: `admin`, `hiring_manager`, `hiring_team`, `interviewer`. Interviewers can only submit feedback for assignments they have. They cannot advance/reject candidates.

## When adding features

- **New endpoint** → drop in `api/*.js`. Always `await requireAuth(req, res)` first.
- **Shared server helper** → `lib/*.js` (NOT `api/`).
- **New page** → `src/pages/*.jsx` and add to `AppShell.jsx`.
- **New table** → new migration file in `supabase/migrations/000N_*.sql`. Include RLS in the same migration.
- **AI feature** → adapt the EVAL_TOOL pattern from ResumeScreener's `score.js`. Always use tool-use for structured output. Always `requireAuth` first.

## Out of scope for v1

- Multi-tenant org isolation. App is single-org.
- Candidate-facing logins. Internal-only.
- LinkedIn scraping. We store the URL only — no AI scoring for LinkedIn-only candidates.

## Style

- Comments only when WHY is non-obvious. No what-comments.
- No backwards-compat shims for in-progress code.
- Match ResumeScreener visual language: dark theme, gradient borders, indigo→violet→pink accents, `lucide-react` icons.

## Ship checklist (before marking a feature done)

1. Type-check / lint clean (`npm run build` succeeds).
2. RLS policies updated if a new table.
3. `.env.example` updated if a new env var.
4. README updated if a setup step changed.
5. `requireAuth` on every new `api/*.js`.
6. Permission check at the UI affordance layer too (don't rely on RLS alone for UX).
