// api/cron-stale-candidates.js
// Daily Vercel cron entry. Identifies active candidates whose pipeline hasn't
// moved in N days and emails the project manager(s) a digest.
//
// Triggered by Vercel Cron (configured in vercel.json). Vercel attaches an
// Authorization: Bearer <CRON_SECRET> header — we verify against env var
// CRON_SECRET if set; otherwise we accept any caller (dev convenience).
export const config = { runtime: 'nodejs' };

import { supabaseAdmin } from '../lib/supabase-admin.js';
import { emailStaleDigest } from '../lib/email.js';

const STALE_DAYS = Number(process.env.STALE_CANDIDATE_DAYS || 7);
const STAGE_LABELS = {
  resume_submitted: 'Resume Submitted',
  hm_review: 'HM Review',
  technical_written: 'Technical Written',
  technical_interview: 'Technical Interview',
  problem_solving: 'Problem Solving',
  case_study: 'Case Study',
  offer: 'Offer',
};

export default async function handler(req, res) {
  // Vercel cron uses GET. Allow GET + POST.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== expected) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  try {
    const sb = supabaseAdmin();
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error } = await sb
      .from('candidates')
      .select('id, full_name, current_stage_key, role_id, updated_at')
      .eq('status', 'active')
      .lt('updated_at', cutoff);
    if (error) throw new Error('Query candidates failed: ' + error.message);

    if (!candidates?.length) {
      res.status(200).json({ stale: 0, message: 'No stale candidates' });
      return;
    }

    // Group candidates by project, then by manager email
    const roleIds = [...new Set(candidates.map((c) => c.role_id))];
    const { data: roles } = await sb
      .from('roles')
      .select('id, project_id')
      .in('id', roleIds);
    const roleToProject = Object.fromEntries((roles || []).map((r) => [r.id, r.project_id]));

    const projectIds = [...new Set(Object.values(roleToProject))];
    const { data: members } = await sb
      .from('project_members')
      .select('project_id, user_id, role_in_project')
      .in('project_id', projectIds.length ? projectIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('role_in_project', 'manager');

    const userIds = [...new Set((members || []).map((m) => m.user_id))];
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
    const profileById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

    // For each manager, collect their stale candidates
    const byManager = new Map();
    for (const c of candidates) {
      const projectId = roleToProject[c.role_id];
      const projectManagers = (members || [])
        .filter((m) => m.project_id === projectId)
        .map((m) => profileById[m.user_id])
        .filter(Boolean);
      for (const m of projectManagers) {
        if (!m.email) continue;
        if (!byManager.has(m.email)) byManager.set(m.email, []);
        byManager.get(m.email).push({
          id: c.id,
          full_name: c.full_name,
          stage: STAGE_LABELS[c.current_stage_key] || c.current_stage_key,
          days: Math.floor((Date.now() - new Date(c.updated_at).getTime()) / (24 * 60 * 60 * 1000)),
        });
      }
    }

    let sent = 0;
    for (const [email, items] of byManager) {
      await emailStaleDigest({ to: email, items });
      sent += 1;
    }

    res.status(200).json({ stale: candidates.length, digests_sent: sent });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
