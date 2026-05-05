# Slate — Hiring Tracker

A focused hiring tracker for managing requisitions, candidates, interview pipelines, feedback, and interviewer availability. Sibling project to ResumeScreener — same stack, same auth conventions.

## Status

**v0.1 — walking skeleton.** What works today:

- Supabase auth (sign up, sign in, sign out, password reset).
- Sidebar + dark-theme app shell, all routes wired.
- Hiring Projects: list and create.
- Project detail: list and create roles.
- Role detail: edit title, SR number, level, location, JD (textarea).
- JD Templates page: lists system templates seeded by SQL.
- Settings: edit own profile (full name, role, timezone).
- `/api/extract` ports ResumeScreener's PDF/DOCX/TXT extraction.

Coming in v0.5 / v1.0 (per the plan): rich-text JD editor, candidate upload + LinkedIn flow, full pipeline UI, interviewer assignments, feedback, availability calendar, AI scoring, AI feedback summarizer, comments, CSV export, Resend email notifications, stale-candidate cron.

## Stack

- Vite 5 + React 18 + JavaScript
- Tailwind CSS 3 (dark theme)
- react-router-dom v6, @tanstack/react-query v5
- @supabase/supabase-js (browser + service-role server client)
- Vercel serverless (Node 20) for `api/*`
- Anthropic Claude (port from ResumeScreener) for AI features
- pdf-parse + mammoth + busboy for file extraction

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Provision a Supabase project** at https://supabase.com.

3. **Run migrations** — paste each file in `supabase/migrations/` into the Supabase SQL Editor in order:

   - `0001_init.sql` — tables, indexes, profile auto-create trigger
   - `0002_rls.sql` — RLS policies (permissive for v0.1)
   - `0003_seed_templates.sql` — system JD templates

4. **Copy env**

   ```bash
   cp .env.example .env
   ```

   Fill in:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Settings → API)
   - `SUPABASE_URL` (same as `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → service_role)
   - `ANTHROPIC_API_KEY` (only needed for v0.5+ AI features)

5. **Disable email confirmation in dev** (Supabase Dashboard → Authentication → Providers → Email → uncheck "Confirm email"). For prod, leave it on.

6. **Run**

   ```bash
   npm run dev
   ```

   Visit http://localhost:4001.

7. **Promote yourself to admin** (one-time, via Supabase SQL editor):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

## Layout

```
api/                    Vercel serverless endpoints
lib/                    Server-side helpers (auth, parse-file, supabase-admin)
src/
  components/           UI components (auth, layout, common, etc.)
  pages/                Route pages
  lib/                  Browser-side helpers (supabase, AuthContext, api, pipeline, permissions, queryClient)
supabase/migrations/    SQL migrations (run via dashboard SQL editor)
```

Strict rule (carried from ResumeScreener): only real endpoints in `api/`. Shared server helpers go in `lib/`.

## Reusable patterns from ResumeScreener

- `lib/auth.js` — JWT verification (HS256 + JWKS asymmetric).
- `src/lib/supabase.js`, `src/lib/AuthContext.jsx`, `src/components/auth/AuthScreen.jsx`, `src/components/layout/UserMenu.jsx` — auth UX.
- `lib/parse-file.js` — multipart streaming + PDF/DOCX/TXT extraction (split out of `api/extract.js`).
- `src/lib/api.js` — centralized fetch with bearer token.

## Roadmap

See [the plan](./CLAUDE.md) for the full v0.5 / v1.0 / deferred breakdown.
