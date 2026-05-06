// api/delete-project.js
// ADMIN-ONLY. Hard-deletes a project and everything attached to it.
//
// Cascades via FK:
//   - project_members
//   - roles -> candidates -> candidate_pipeline -> feedback / assignments / scheduled
//
// Manual cleanup:
//   - comments (polymorphic) where entity_type='role' (for any role in project)
//                        or entity_type='candidate' (for any candidate of those roles)
//   - storage objects: JDs of every role + resumes of every candidate
//
// Body: { projectId }
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
    const { projectId } = req.body || {};
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    if (me?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete projects.' });
      return;
    }

    const { data: project, error: pErr } = await sb
      .from('hiring_projects')
      .select('id')
      .eq('id', projectId)
      .single();
    if (pErr || !project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const { data: roles } = await sb.from('roles').select('id, jd_file_id').eq('project_id', projectId);
    const roleIds = (roles || []).map((r) => r.id);
    const jdFileIds = (roles || []).map((r) => r.jd_file_id).filter(Boolean);

    let candidateIds = [];
    let resumeFileIds = [];
    if (roleIds.length) {
      const { data: candidates } = await sb
        .from('candidates')
        .select('id, resume_file_id')
        .in('role_id', roleIds);
      candidateIds = (candidates || []).map((c) => c.id);
      resumeFileIds = (candidates || []).map((c) => c.resume_file_id).filter(Boolean);
    }

    // 1. Comments cleanup
    if (candidateIds.length) {
      await sb.from('comments').delete().eq('entity_type', 'candidate').in('entity_id', candidateIds);
    }
    if (roleIds.length) {
      await sb.from('comments').delete().eq('entity_type', 'role').in('entity_id', roleIds);
    }

    // 2. Storage cleanup
    const fileIdsToDelete = [...resumeFileIds, ...jdFileIds];
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

    // 3. Delete the project (cascades through everything)
    const { error: dErr } = await sb.from('hiring_projects').delete().eq('id', projectId);
    if (dErr) {
      res.status(500).json({ error: 'Delete failed: ' + dErr.message });
      return;
    }

    res.status(200).json({
      ok: true,
      projectId,
      rolesRemoved: roleIds.length,
      candidatesRemoved: candidateIds.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
