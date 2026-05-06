// api/clone-candidate.js
// "Consider this candidate for another role." Creates a new candidate row
// in the target role with the source candidate's profile fields copied:
//   - full_name, email, phone, linkedin_url
//   - resume_text and resume_file_id (so AI scoring works on the new role
//     without re-uploading)
//
// Intentionally does NOT copy:
//   - ai_score / ai_analysis (those are JD-specific; user should re-score
//     against the new role's JD)
//   - tags
//   - current_stage_key / status (start fresh at resume_submitted, active)
//
// Permission: admin OR member of the TARGET role's project.
//
// Body: { candidateId, targetRoleId }
// Returns: { candidate }
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const { candidateId, targetRoleId } = req.body || {};
    if (!candidateId || !targetRoleId) {
      res.status(400).json({ error: 'candidateId and targetRoleId are required' });
      return;
    }

    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { data: source, error: sErr } = await sb
      .from('candidates')
      .select('id, full_name, email, phone, linkedin_url, resume_text, resume_file_id, source, role_id')
      .eq('id', candidateId)
      .single();
    if (sErr || !source) {
      res.status(404).json({ error: 'Source candidate not found' });
      return;
    }

    const { data: targetRole, error: rErr } = await sb
      .from('roles')
      .select('id, project_id')
      .eq('id', targetRoleId)
      .single();
    if (rErr || !targetRole) {
      res.status(404).json({ error: 'Target role not found' });
      return;
    }

    if (source.role_id === targetRoleId) {
      res.status(400).json({ error: 'This candidate is already on that role.' });
      return;
    }

    // Permission: admin OR member of the target project.
    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    const isAdmin = me?.role === 'admin';
    if (!isAdmin) {
      const { data: ownerCheck } = await sb
        .from('hiring_projects')
        .select('id')
        .eq('id', targetRole.project_id)
        .eq('owner_id', callerId)
        .maybeSingle();
      let allowed = !!ownerCheck;
      if (!allowed) {
        const { data: memberCheck } = await sb
          .from('project_members')
          .select('user_id')
          .eq('project_id', targetRole.project_id)
          .eq('user_id', callerId)
          .maybeSingle();
        allowed = !!memberCheck;
      }
      if (!allowed) {
        res.status(403).json({ error: 'You are not a member of the target project.' });
        return;
      }
    }

    // Avoid duplicate consideration on the same role for the same person
    // (matched by email when we have one).
    if (source.email) {
      const { data: existing } = await sb
        .from('candidates')
        .select('id')
        .eq('role_id', targetRoleId)
        .eq('email', source.email)
        .maybeSingle();
      if (existing) {
        res.status(409).json({ error: 'A candidate with this email already exists on the target role.' });
        return;
      }
    }

    const { data: cloned, error: cErr } = await sb
      .from('candidates')
      .insert({
        role_id: targetRoleId,
        full_name: source.full_name,
        email: source.email,
        phone: source.phone,
        linkedin_url: source.linkedin_url,
        resume_text: source.resume_text,
        resume_file_id: source.resume_file_id,
        source: source.source || 'manual',
      })
      .select()
      .single();
    if (cErr) {
      res.status(500).json({ error: 'Clone failed: ' + cErr.message });
      return;
    }

    res.status(200).json({ candidate: cloned });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
