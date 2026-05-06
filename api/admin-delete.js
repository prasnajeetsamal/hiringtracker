// api/admin-delete.js
// ADMIN-ONLY consolidated delete endpoint. Handles candidate / role / project
// deletions in one function so we stay under Vercel's Hobby-plan function
// limit (12).
//
// Body: { entityType: 'candidate' | 'role' | 'project', id: <uuid> }
//
// Cascades:
//   * candidate -> pipeline / feedback / assignments / scheduled (via FK)
//   * role      -> candidates -> ...
//   * project   -> roles      -> candidates -> ...
//
// Manual cleanup (not FK-cascaded):
//   * polymorphic comments (entity_type='candidate' or 'role')
//   * resume + JD files in storage
//   * `files` rows for those storage objects

export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ALLOWED_TYPES = new Set(['candidate', 'role', 'project']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const { entityType, id } = req.body || {};
    if (!ALLOWED_TYPES.has(entityType)) {
      res.status(400).json({ error: 'entityType must be candidate, role, or project.' });
      return;
    }
    if (!id) {
      res.status(400).json({ error: 'id is required.' });
      return;
    }

    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { data: me } = await sb.from('profiles').select('role').eq('id', callerId).single();
    if (me?.role !== 'admin') {
      res.status(403).json({ error: `Only admins can delete ${entityType}s.` });
      return;
    }

    if (entityType === 'candidate') {
      const result = await deleteCandidate(sb, id);
      res.status(result.error ? 500 : (result.notFound ? 404 : 200)).json(result);
      return;
    }
    if (entityType === 'role') {
      const result = await deleteRole(sb, id);
      res.status(result.error ? 500 : (result.notFound ? 404 : 200)).json(result);
      return;
    }
    if (entityType === 'project') {
      const result = await deleteProject(sb, id);
      res.status(result.error ? 500 : (result.notFound ? 404 : 200)).json(result);
      return;
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

async function removeFiles(sb, fileIds) {
  if (!fileIds.length) return;
  const { data: fileRows } = await sb
    .from('files')
    .select('id, bucket, path')
    .in('id', fileIds);
  const byBucket = {};
  (fileRows || []).forEach((f) => {
    if (!f.bucket || !f.path) return;
    (byBucket[f.bucket] ||= []).push(f.path);
  });
  for (const [bucket, paths] of Object.entries(byBucket)) {
    await sb.storage.from(bucket).remove(paths);
  }
  await sb.from('files').delete().in('id', fileIds);
}

async function deleteCandidate(sb, id) {
  const { data: candidate, error } = await sb
    .from('candidates')
    .select('id, resume_file_id')
    .eq('id', id)
    .single();
  if (error || !candidate) return { notFound: true, error: 'Candidate not found' };

  await sb.from('comments').delete().eq('entity_type', 'candidate').eq('entity_id', id);
  if (candidate.resume_file_id) await removeFiles(sb, [candidate.resume_file_id]);

  const { error: dErr } = await sb.from('candidates').delete().eq('id', id);
  if (dErr) return { error: 'Delete failed: ' + dErr.message };
  return { ok: true, candidateId: id };
}

async function deleteRole(sb, id) {
  const { data: role, error } = await sb
    .from('roles')
    .select('id, jd_file_id')
    .eq('id', id)
    .single();
  if (error || !role) return { notFound: true, error: 'Role not found' };

  const { data: candidates } = await sb
    .from('candidates')
    .select('id, resume_file_id')
    .eq('role_id', id);
  const candidateIds = (candidates || []).map((c) => c.id);
  const fileIds = [
    ...(candidates || []).map((c) => c.resume_file_id).filter(Boolean),
    ...(role.jd_file_id ? [role.jd_file_id] : []),
  ];

  if (candidateIds.length) {
    await sb.from('comments').delete().eq('entity_type', 'candidate').in('entity_id', candidateIds);
  }
  await sb.from('comments').delete().eq('entity_type', 'role').eq('entity_id', id);
  await removeFiles(sb, fileIds);

  const { error: dErr } = await sb.from('roles').delete().eq('id', id);
  if (dErr) return { error: 'Delete failed: ' + dErr.message };
  return { ok: true, roleId: id, candidatesRemoved: candidateIds.length };
}

async function deleteProject(sb, id) {
  const { data: project, error } = await sb
    .from('hiring_projects')
    .select('id')
    .eq('id', id)
    .single();
  if (error || !project) return { notFound: true, error: 'Project not found' };

  const { data: roles } = await sb.from('roles').select('id, jd_file_id').eq('project_id', id);
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

  if (candidateIds.length) {
    await sb.from('comments').delete().eq('entity_type', 'candidate').in('entity_id', candidateIds);
  }
  if (roleIds.length) {
    await sb.from('comments').delete().eq('entity_type', 'role').in('entity_id', roleIds);
  }
  await removeFiles(sb, [...resumeFileIds, ...jdFileIds]);

  const { error: dErr } = await sb.from('hiring_projects').delete().eq('id', id);
  if (dErr) return { error: 'Delete failed: ' + dErr.message };
  return { ok: true, projectId: id, rolesRemoved: roleIds.length, candidatesRemoved: candidateIds.length };
}
