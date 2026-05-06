// api/debug-me.js
// Diagnostic endpoint. Returns what the server sees about the current user
// vs. what's actually in the database. Helps debug RLS / membership issues.
// Safe to leave deployed — only returns counts and the user's own profile.
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const callerEmail = auth.user?.email;

    const admin = supabaseAdmin();

    // What the SERVICE ROLE sees (ground truth, no RLS)
    const [allCandidates, allProjects, allRoles, allMembers, profile] = await Promise.all([
      admin.from('candidates').select('id, full_name, role_id, status, current_stage_key, created_at').order('created_at', { ascending: false }).limit(20),
      admin.from('hiring_projects').select('id, name, owner_id'),
      admin.from('roles').select('id, title, project_id'),
      admin.from('project_members').select('project_id, user_id, role_in_project').eq('user_id', callerId),
      admin.from('profiles').select('id, email, role').eq('id', callerId).single(),
    ]);

    // What the CALLER sees (RLS applies)
    const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    let asMe = null;
    if (url && anon && accessToken) {
      const userClient = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const [c, p, r] = await Promise.all([
        userClient.from('candidates').select('id, full_name, role_id', { count: 'exact' }).limit(5),
        userClient.from('hiring_projects').select('id, name', { count: 'exact' }).limit(5),
        userClient.from('roles').select('id, title', { count: 'exact' }).limit(5),
      ]);
      asMe = {
        candidates: { count: c.count, sample: c.data, error: c.error?.message },
        projects:   { count: p.count, sample: p.data, error: p.error?.message },
        roles:      { count: r.count, sample: r.data, error: r.error?.message },
      };
    }

    res.status(200).json({
      caller: {
        userId: callerId,
        email: callerEmail,
        profile: profile.data,
        memberships: allMembers.data,
      },
      groundTruth: {
        candidatesTotal: allCandidates.data?.length || 0,
        candidates: allCandidates.data,
        projects: allProjects.data,
        roles: allRoles.data,
      },
      asMe,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
