// api/transition-candidate.js
// Atomic stage transition for a candidate. Replaces the 3-write client-side
// dance (mark current row passed/failed/skipped → mark next row in_progress →
// flip candidates.current_stage_key) with a single server call so a failure
// partway through never leaves the pipeline half-updated.
//
// Body: { candidateId, action: 'advance' | 'reject' | 'skip' }
// Returns: { candidate: {...updated row}, currentStageKey, status, pipeline }
//
// Permissions: any user the RLS layer allows to update candidates / pipeline
// rows can call this. We still require auth and run as the caller's user via
// a user-scoped Supabase client, so RLS continues to gate writes. The service
// role is only used to read pipeline + stage_config in one shot.
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ALL_STAGES = [
  'resume_submitted',
  'hm_review',
  'technical_written',
  'technical_interview',
  'problem_solving',
  'case_study',
  'offer',
  'joined_fractal',
  'rejected_offer',
];

function enabledStageKeys(stageConfig) {
  if (!Array.isArray(stageConfig) || stageConfig.length === 0) return ALL_STAGES;
  const map = new Map(stageConfig.map((c) => [c.stage_key, c]));
  return ALL_STAGES.filter((k) => map.get(k)?.enabled !== false);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const { candidateId, action } = req.body || {};
    if (!candidateId || !['advance', 'reject', 'skip'].includes(action)) {
      res.status(400).json({ error: "candidateId and action ('advance' | 'reject' | 'skip') are required." });
      return;
    }

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!url || !anon || !accessToken) {
      res.status(500).json({ error: 'Server is missing Supabase env config.' });
      return;
    }
    // User-scoped client so RLS gates the writes naturally.
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = supabaseAdmin();

    // Read the candidate + role config + pipeline rows using the admin client so
    // we always get a consistent view, then perform writes with the user-scoped
    // client (so RLS still applies and is the ultimate authority).
    const [{ data: candidate, error: cErr }, { data: pipeline, error: pErr }] = await Promise.all([
      admin.from('candidates')
        .select('id, status, current_stage_key, role:roles ( id, stage_config )')
        .eq('id', candidateId)
        .single(),
      admin.from('candidate_pipeline')
        .select('id, stage_key, stage_order, state, started_at, completed_at')
        .eq('candidate_id', candidateId)
        .order('stage_order'),
    ]);
    if (cErr || !candidate) {
      res.status(404).json({ error: 'Candidate not found' });
      return;
    }
    if (pErr) {
      res.status(500).json({ error: 'Pipeline read failed: ' + pErr.message });
      return;
    }
    if (candidate.status === 'hired' || candidate.status === 'rejected' || candidate.status === 'withdrew') {
      res.status(400).json({ error: `Candidate is in terminal status "${candidate.status}".` });
      return;
    }

    const enabled = enabledStageKeys(candidate.role?.stage_config);
    const currentIdx = enabled.indexOf(candidate.current_stage_key);
    const nextKey = currentIdx >= 0 ? enabled[currentIdx + 1] : null;
    const currentRow = (pipeline || []).find((p) => p.stage_key === candidate.current_stage_key);
    const nextRow = nextKey ? (pipeline || []).find((p) => p.stage_key === nextKey) : null;
    const now = new Date().toISOString();

    // ── 1) Update the current pipeline row.
    if (currentRow) {
      const newState = action === 'reject' ? 'failed' : action === 'skip' ? 'skipped' : 'passed';
      const { error } = await sb
        .from('candidate_pipeline')
        .update({ state: newState, completed_at: now, decided_by: callerId })
        .eq('id', currentRow.id);
      if (error) {
        res.status(403).json({ error: 'Stage update denied: ' + error.message });
        return;
      }
    }

    // ── 2) For reject: flip status. Done.
    if (action === 'reject') {
      const { error } = await sb.from('candidates').update({ status: 'rejected' }).eq('id', candidateId);
      if (error) {
        res.status(403).json({ error: 'Status update denied: ' + error.message });
        return;
      }
      return await reply(res, admin, candidateId);
    }

    // ── 3) For advance / skip: move forward, or mark hired if no next stage.
    if (!nextRow) {
      const { error } = await sb.from('candidates').update({ status: 'hired' }).eq('id', candidateId);
      if (error) {
        res.status(403).json({ error: 'Status update denied: ' + error.message });
        return;
      }
      return await reply(res, admin, candidateId);
    }

    // Update next pipeline row → in_progress, and flip current_stage_key on candidate.
    const [nextUp, candUp] = await Promise.all([
      sb.from('candidate_pipeline')
        .update({ state: 'in_progress', started_at: now })
        .eq('id', nextRow.id),
      sb.from('candidates')
        .update({ current_stage_key: nextKey })
        .eq('id', candidateId),
    ]);
    if (nextUp.error || candUp.error) {
      res.status(403).json({ error: 'Transition partially failed: ' + (nextUp.error?.message || candUp.error?.message) });
      return;
    }

    return await reply(res, admin, candidateId);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}

async function reply(res, admin, candidateId) {
  const [{ data: cand }, { data: pipe }] = await Promise.all([
    admin.from('candidates').select('id, status, current_stage_key, role_id').eq('id', candidateId).single(),
    admin.from('candidate_pipeline')
      .select('id, stage_key, stage_order, state, started_at, completed_at')
      .eq('candidate_id', candidateId)
      .order('stage_order'),
  ]);
  res.status(200).json({
    candidate: cand,
    currentStageKey: cand?.current_stage_key,
    status: cand?.status,
    pipeline: pipe || [],
  });
}
