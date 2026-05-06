// api/delete-candidate.js
// Hard-deletes a candidate, plus the cascading rows that don't auto-cascade
// via FK constraints:
//   - comments where entity_type='candidate' (polymorphic FK, no cascade)
//   - resume file from files table + the underlying object in Supabase Storage
//
// FK-cascaded automatically (no manual cleanup needed):
//   - candidate_pipeline rows
//   - interviewer_assignments via pipeline
//   - feedback via pipeline
//   - scheduled_interviews via pipeline
//
// Body: { candidateId }
// Permission: ADMIN ONLY. Project members can reject candidates (soft) but
// only admins can hard-delete.
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
    const { candidateId } = req.body || {};
    if (!candidateId) {
      res.status(400).json({ error: 'candidateId is required' });
      return;
    }

    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    // Permission check: admin only.
    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    if (me?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete candidates.' });
      return;
    }

    const { data: candidate, error: cErr } = await sb
      .from('candidates')
      .select('id, role_id, resume_file_id')
      .eq('id', candidateId)
      .single();
    if (cErr || !candidate) {
      res.status(404).json({ error: 'Candidate not found' });
      return;
    }

    // 1. Delete polymorphic comments
    await sb.from('comments').delete().eq('entity_type', 'candidate').eq('entity_id', candidateId);

    // 2. Clean up the resume file (storage object + files row)
    if (candidate.resume_file_id) {
      const { data: fileRow } = await sb
        .from('files')
        .select('bucket, path')
        .eq('id', candidate.resume_file_id)
        .single();
      if (fileRow?.bucket && fileRow?.path) {
        await sb.storage.from(fileRow.bucket).remove([fileRow.path]);
      }
      await sb.from('files').delete().eq('id', candidate.resume_file_id);
    }

    // 3. Delete the candidate (cascades to pipeline, feedback, assignments,
    //    scheduled interviews via FK on delete cascade)
    const { error: dErr } = await sb.from('candidates').delete().eq('id', candidateId);
    if (dErr) {
      res.status(500).json({ error: 'Delete failed: ' + dErr.message });
      return;
    }

    res.status(200).json({ ok: true, candidateId });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
