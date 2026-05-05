// lib/supabase-admin.js
// Service-role Supabase client for trusted server-side writes that need to
// bypass RLS (e.g. profile creation, cross-table mutations, AI-driven updates).
// Never import from src/ — this file is server-only.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client = null;

export function supabaseAdmin() {
  if (_client) return _client;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin client requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
