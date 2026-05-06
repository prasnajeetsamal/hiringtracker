// api/delete-role.js
// ADMIN-ONLY. Hard-deletes a role and everything attached to it.
//
// Cascades automatically via FK on delete cascade:
//   - candidates of this role
//     - candidate_pipeline rows
//       - feedback / interviewer_assignments / scheduled_interviews
//
// Manual cleanup (no FK cascade):
//   - polymorphic comments where entity_type in ('role','candidate')
//   - JD file in storage + the files row
//   - resume files for all candidates being deleted
//
// Body: { roleId }
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
    const { roleId } = req.body || {};
    if (!roleId) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }

    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    if (me?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete roles.' });
      return;
    }

    const { data: role, error: rErr } = await sb
      .from('roles')
      .select('id, jd_file_id')
      .eq('id', roleId)
      .single();
    if (rErr || !role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    // Collect candidates and their resume files (so we can clean storage too)
    const { data: candidatesOfRole } = await sb
      .from('candidates')
      .select('id, resume_file_id')
      .eq('role_id', roleId);
    const candidateIds = (candidatesOfRole || []).map((c) => c.id);
    const resumeFileIds = (candidatesOfRole || [])
      .map((c) => c.resume_file_id)
      .filter(Boolean);

    // 1. Delete role + candidate comments (polymorphic, no cascade)
    if (candidateIds.length) {
      await sb.from('comments').delete().eq('entity_type', 'candidate').in('entity_id', candidateIds);
    }
    await sb.from('comments').delete().eq('entity_type', 'role').eq('entity_id', roleId);

    // 2. Storage cleanup — JD + all resume files
    const fileIdsToDelete = [...resumeFileIds, ...(role.jd_file_id ? [role.jd_file_id] : [])];
    if (fileIdsToDelete.length) {
      const { data: fileRows } = await sb
        .from('files')
        .select('id, bucket, path')
        .in('id', fileIdsToDelete);
      const byBucket = {};
      (fileRows || []).forEach((f) => {
        if (!f.bucket || !f.path) return;
        (byBucket[f.bucket] ||= []).push(f.path);
      });
      for (const [bucket, paths] of Object.entries(byBucket)) {
        await sb.storage.from(bucket).remove(paths);
      }
      await sb.from('files').delete().in('id', fileIdsToDelete);
    }

    // 3. Delete the role (cascades to candidates -> pipeline -> feedback etc.)
    const { error: dErr } = await sb.from('roles').delete().eq('id', roleId);
    if (dErr) {
      res.status(500).json({ error: 'Delete failed: ' + dErr.message });
      return;
    }

    res.status(200).json({ ok: true, roleId, candidatesRemoved: candidateIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
