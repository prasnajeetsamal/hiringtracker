// api/public-status.js
// PUBLIC, NO-AUTH endpoint that powers the candidate self-serve status page
// at /c/:token. Possession of the token is the authentication mechanism.
//
// Request:
//   GET  /api/public-status?token=<uuid>
//   POST /api/public-status  body: { token: <uuid> }
//
// Response: a deliberately narrow subset of candidate data.
//   {
//     candidate: { first_name, role_title, project_name, applied_at },
//     timeline: [{ stage_key, label, what_to_expect, state, started_at, completed_at }],
//     current_stage: { stage_key, label, what_to_expect } | null,
//     status: 'active' | 'hired' | 'rejected' | 'withdrew',
//   }
//
// We expose NOTHING that recruiters would want to keep internal:
//   - no ai_score, ai_analysis, feedback, comments, mentions
//   - no interviewer assignments or names
//   - no other candidates
//   - no contact info beyond the candidate's first name
export const config = { runtime: 'nodejs' };

import { supabaseAdmin } from '../lib/supabase-admin.js';

const STAGE_LABELS = {
  resume_submitted: 'Application received',
  hm_review: 'Hiring manager review',
  technical_written: 'Technical assessment',
  technical_interview: 'Technical interview',
  problem_solving: 'Problem-solving round',
  case_study: 'Case study',
  offer: 'Offer',
  joined_fractal: 'Joined',
  rejected_offer: 'Offer declined',
};

const DEFAULT_WHAT_TO_EXPECT = {
  resume_submitted: 'Your application has been received. The hiring manager will review your resume shortly.',
  hm_review: 'The hiring manager is reviewing your background to decide whether to move forward.',
  technical_written: 'A take-home or proctored written exercise to assess technical fundamentals.',
  technical_interview: 'A live technical interview covering depth in your primary area.',
  problem_solving: 'An open-ended problem-solving session to evaluate reasoning and approach.',
  case_study: 'A scenario-based case study, typically with a short prep period and a panel discussion.',
  offer: 'An offer has been extended. We are awaiting your decision.',
  joined_fractal: 'You have joined the team - welcome aboard!',
  rejected_offer: 'The offer was declined.',
};

const isUuid = (s) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(s || ''));

export default async function handler(req, res) {
  // Accept the token via query string OR JSON body. Both work; the page
  // currently uses GET with a query param.
  const token = req.method === 'GET'
    ? (req.query?.token || '')
    : (req.body?.token || '');

  if (!isUuid(token)) {
    res.status(400).json({ error: 'Invalid or missing token.' });
    return;
  }

  try {
    const sb = supabaseAdmin();
    const { data: candidate, error } = await sb
      .from('candidates')
      .select(`
        id, full_name, status, current_stage_key, created_at,
        role:roles ( title, stage_config, project:hiring_projects ( name ) )
      `)
      .eq('public_token', token)
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: 'Lookup failed.' });
      return;
    }
    if (!candidate) {
      res.status(404).json({ error: 'No matching application found. The link may be invalid or expired.' });
      return;
    }

    const { data: pipeline } = await sb
      .from('candidate_pipeline')
      .select('stage_key, stage_order, state, started_at, completed_at')
      .eq('candidate_id', candidate.id)
      .order('stage_order');

    // Build the per-stage timeline. Use role.stage_config to filter to enabled
    // stages + pick up custom "what to expect" copy; fall back to defaults.
    const stageConfig = Array.isArray(candidate.role?.stage_config) ? candidate.role.stage_config : [];
    const cfgByKey = Object.fromEntries(stageConfig.map((c) => [c.stage_key, c]));
    const pipelineByKey = Object.fromEntries((pipeline || []).map((p) => [p.stage_key, p]));

    const allKeys = Object.keys(STAGE_LABELS);
    const timeline = allKeys
      .filter((k) => {
        // Hide stages explicitly disabled for this role; show all others.
        const cfg = cfgByKey[k];
        if (cfg && cfg.enabled === false) return false;
        return true;
      })
      .map((k) => {
        const p = pipelineByKey[k];
        return {
          stage_key: k,
          label: STAGE_LABELS[k] || k,
          what_to_expect: cfgByKey[k]?.what_to_expect || DEFAULT_WHAT_TO_EXPECT[k] || '',
          state: p?.state || 'pending',
          started_at: p?.started_at || null,
          // Only expose completed dates - never share decided_by / interviewer ids.
          completed_at: p?.completed_at || null,
        };
      });

    const currentKey = candidate.current_stage_key;
    const current = timeline.find((s) => s.stage_key === currentKey) || null;

    const firstName = (candidate.full_name || '').split(/\s+/)[0] || 'there';

    res.status(200).json({
      candidate: {
        first_name: firstName,
        role_title: candidate.role?.title || null,
        project_name: candidate.role?.project?.name || null,
        applied_at: candidate.created_at,
      },
      timeline,
      current_stage: current,
      status: candidate.status,
    });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error.' });
  }
}
