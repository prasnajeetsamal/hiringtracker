// src/lib/queryHelpers.js
// Small Supabase query helpers that gracefully handle "column does not exist"
// errors so the app keeps working when a migration hasn't been applied yet.
//
// Slate's roles table grew new structured-location columns in migration 0007
// (`work_mode`, `city`, `state`, `country`). If a Supabase project hasn't yet
// run 0007, queries that select those columns return error code "42703".
// `selectRolesWithFallback` first tries the new shape and, on the specific
// missing-column error, transparently retries with the legacy shape.

const NEW_ROLE_COLS = 'id, project_id, sr_number, title, level, status, jd_html, jd_source, stage_config, location, work_mode, city, state, country, created_at';
const LEGACY_ROLE_COLS = 'id, project_id, sr_number, title, level, status, jd_html, jd_source, stage_config, location, created_at';

const NEW_ROLE_LIST_COLS = 'id, sr_number, title, level, status, location, work_mode, city, state, country, created_at';
const LEGACY_ROLE_LIST_COLS = 'id, sr_number, title, level, status, location, created_at';

const isMissingColumn = (err) =>
  err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''));

/** Pad a legacy role row with null structured-location fields. */
function padLegacyRole(r) {
  return { ...r, work_mode: null, city: null, state: null, country: null };
}

/**
 * Apply a list of `(builder) => builder` modifiers to a Supabase select chain.
 * Helpful so we can reuse the same filters/orders for both the primary and
 * fallback queries.
 */
function applyMods(builder, mods) {
  let b = builder;
  for (const m of mods) b = m(b);
  return b;
}

/**
 * Fetch a single role row by id with full columns, falling back to legacy
 * columns if the structured-location columns don't exist yet.
 *
 *   const role = await fetchRoleById(supabase, roleId);
 */
export async function fetchRoleById(supabase, roleId) {
  let { data, error } = await supabase.from('roles').select(NEW_ROLE_COLS).eq('id', roleId).single();
  if (error && isMissingColumn(error)) {
    const r = await supabase.from('roles').select(LEGACY_ROLE_COLS).eq('id', roleId).single();
    if (r.error) throw r.error;
    return padLegacyRole(r.data);
  }
  if (error) throw error;
  return data;
}

/**
 * Fetch a list of roles with optional builder modifiers (for filters / order).
 *
 *   const roles = await fetchRoles(supabase, [
 *     b => b.eq('project_id', projectId),
 *     b => b.order('created_at', { ascending: false }),
 *   ]);
 */
export async function fetchRoles(supabase, mods = []) {
  let { data, error } = await applyMods(supabase.from('roles').select(NEW_ROLE_LIST_COLS), mods);
  if (error && isMissingColumn(error)) {
    const r = await applyMods(supabase.from('roles').select(LEGACY_ROLE_LIST_COLS), mods);
    if (r.error) throw r.error;
    return (r.data || []).map(padLegacyRole);
  }
  if (error) throw error;
  return data || [];
}

const NEW_LOC_KEYS = ['work_mode', 'city', 'state', 'country'];

function stripNewLocationKeys(payload) {
  const out = { ...payload };
  for (const k of NEW_LOC_KEYS) delete out[k];
  return out;
}

/**
 * Insert a role, retrying without the structured-location columns if they
 * don't exist yet in the target Supabase project (migration 0007 not run).
 */
export async function insertRole(supabase, payload) {
  let { data, error } = await supabase.from('roles').insert(payload).select().single();
  if (error && isMissingColumn(error)) {
    const stripped = stripNewLocationKeys(payload);
    const r = await supabase.from('roles').insert(stripped).select().single();
    if (r.error) throw r.error;
    return padLegacyRole(r.data);
  }
  if (error) throw error;
  return data;
}

/**
 * Update a role by id with the same fallback behaviour as insertRole.
 */
export async function updateRole(supabase, roleId, patch) {
  let { error } = await supabase.from('roles').update(patch).eq('id', roleId);
  if (error && isMissingColumn(error)) {
    const stripped = stripNewLocationKeys(patch);
    const r = await supabase.from('roles').update(stripped).eq('id', roleId);
    if (r.error) throw r.error;
    return { schemaWasLegacy: true };
  }
  if (error) throw error;
  return { schemaWasLegacy: false };
}
