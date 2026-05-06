// api/create-candidate.js
// Creates a candidate (LinkedIn-only or manual flow). Resume-upload flow
// is handled by api/upload-resume.js.
//
// Uses the service-role client + an explicit project-membership check, which
// avoids any RLS surprises if the caller's project_members backfill missed.
//
// Body: { roleId, fullName?, email?, phone?, linkedinUrl?, source }
// Returns: { candidate }
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ALLOWED_SOURCES = ['linkedin', 'manual', 'referral', 'uploaded'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { roleId, fullName, email, phone, linkedinUrl, source } = req.body || {};
    if (!roleId) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }
    if (!ALLOWED_SOURCES.includes(source)) {
      res.status(400).json({ error: 'Invalid source' });
      return;
    }

    // Resolve role -> project, then verify caller is admin or member.
    const { data: role, error: rErr } = await sb
      .from('roles')
      .select('id, project_id')
      .eq('id', roleId)
      .single();
    if (rErr || !role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    const isAdmin = me?.role === 'admin';

    if (!isAdmin) {
      const { data: ownerCheck } = await sb
        .from('hiring_projects')
        .select('id')
        .eq('id', role.project_id)
        .eq('owner_id', callerId)
        .maybeSingle();

      let allowed = !!ownerCheck;
      if (!allowed) {
        const { data: memberCheck } = await sb
          .from('project_members')
          .select('user_id')
          .eq('project_id', role.project_id)
          .eq('user_id', callerId)
          .maybeSingle();
        allowed = !!memberCheck;
      }

      if (!allowed) {
        res.status(403).json({ error: 'You are not a member of this project.' });
        return;
      }
    }

    const { data: candidate, error: cErr } = await sb
      .from('candidates')
      .insert({
        role_id: roleId,
        full_name: (fullName || '').trim() || 'Unnamed candidate',
        email: (email || '').trim() || null,
        phone: (phone || '').trim() || null,
        linkedin_url: (linkedinUrl || '').trim() || null,
        source,
      })
      .select()
      .single();
    if (cErr) {
      res.status(500).json({ error: 'Failed to create candidate: ' + cErr.message });
      return;
    }

    res.status(200).json({ candidate });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
