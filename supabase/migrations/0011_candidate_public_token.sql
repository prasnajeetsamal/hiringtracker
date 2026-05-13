-- 0011_candidate_public_token.sql
-- Every candidate gets a non-guessable public token that gates a self-serve
-- status page (api/public-status reads candidate context by token without
-- requiring a Slate login). The token IS the auth - possession grants read
-- access to a deliberately narrow subset of fields.

alter table public.candidates
  add column if not exists public_token uuid default gen_random_uuid();

-- Backfill any existing rows whose default didn't apply (e.g. pre-existing
-- candidates from before this migration ran).
update public.candidates
  set public_token = gen_random_uuid()
  where public_token is null;

-- Now lock the column down. Unique so no two candidates share a token;
-- not null so we can rely on it being present in the endpoint.
alter table public.candidates
  alter column public_token set not null;

create unique index if not exists candidates_public_token_idx
  on public.candidates (public_token);

-- No RLS policy added here on purpose - the public endpoint uses the
-- service-role client to look up by token, and returns only the safe
-- field subset. Direct browser reads of candidates.public_token continue
-- to require the existing RLS membership checks.
