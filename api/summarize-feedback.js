// api/summarize-feedback.js
// Aggregates all interviewer feedback for a candidate into a hiring-committee
// brief via Claude. Stores the result on the candidate row (ai_analysis.committee_brief).
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const stripHtml = (html) =>
  String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const STAGE_LABELS = {
  resume_submitted: 'Resume Submitted',
  hm_review: 'HM Review',
  technical_written: 'Technical Written',
  technical_interview: 'Technical Interview',
  problem_solving: 'Problem Solving',
  case_study: 'Case Study',
  offer: 'Offer',
  joined_fractal: 'Joined Fractal',
  rejected_offer: 'Rejected Offer',
};

const SUMMARY_TOOL = {
  name: 'submit_committee_brief',
  description: 'Submit a structured hiring-committee brief synthesizing all interviewer feedback.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '1-sentence overall verdict.' },
      consensus: { type: 'string', enum: ['strong_hire', 'hire', 'mixed', 'no_hire', 'strong_no_hire'] },
      themes: {
        type: 'array',
        description: 'Recurring strengths and concerns across interviewers (3-6 themes).',
        items: { type: 'string' },
      },
      strengths: { type: 'array', items: { type: 'string' }, description: 'Top 3-5 strengths the panel converged on.' },
      concerns: { type: 'array', items: { type: 'string' }, description: 'Top 2-4 concerns the panel raised.' },
      divergence: { type: 'string', description: 'Where interviewers disagreed and why. Empty string if consensus.' },
      recommendation: { type: 'string', description: '2-3 sentence committee recommendation, decisive.' },
    },
    required: ['headline', 'consensus', 'themes', 'strengths', 'concerns', 'divergence', 'recommendation'],
  },
};

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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
      return;
    }

    const sb = supabaseAdmin();

    const { data: candidate } = await sb
      .from('candidates')
      .select('id, full_name, role_id, ai_analysis')
      .eq('id', candidateId)
      .single();
    if (!candidate) {
      res.status(404).json({ error: 'Candidate not found' });
      return;
    }

    const { data: role } = await sb
      .from('roles')
      .select('id, title, jd_html')
      .eq('id', candidate.role_id)
      .single();

    // Pull all feedback joined to its pipeline + interviewer
    const { data: feedbackRows, error: fErr } = await sb
      .from('feedback')
      .select(`
        id, recommendation, rating, body_html, submitted_at,
        interviewer:profiles!feedback_interviewer_id_fkey ( id, full_name, email ),
        pipeline:candidate_pipeline ( stage_key )
      `)
      .eq('pipeline.candidate_id', candidateId);

    // The nested filter above won't restrict the parent rows reliably; do it the safe way.
    const { data: pipelines } = await sb
      .from('candidate_pipeline')
      .select('id')
      .eq('candidate_id', candidateId);
    const pipelineIds = (pipelines || []).map((p) => p.id);
    const { data: feedback, error: f2Err } = await sb
      .from('feedback')
      .select(`
        id, recommendation, rating, body_html, submitted_at, pipeline_id,
        interviewer:profiles!feedback_interviewer_id_fkey ( id, full_name, email ),
        pipeline:candidate_pipeline!feedback_pipeline_id_fkey ( id, stage_key )
      `)
      .in('pipeline_id', pipelineIds.length ? pipelineIds : ['00000000-0000-0000-0000-000000000000']);

    if (f2Err) {
      res.status(500).json({ error: 'Failed to load feedback: ' + f2Err.message });
      return;
    }
    if (!feedback?.length) {
      res.status(400).json({ error: 'No feedback submitted yet for this candidate.' });
      return;
    }

    const lines = feedback.map((f) => {
      const stage = STAGE_LABELS[f.pipeline?.stage_key] || f.pipeline?.stage_key || '?';
      const who = f.interviewer?.full_name || f.interviewer?.email || 'Interviewer';
      const rec = f.recommendation || '?';
      const rating = f.rating ? `${f.rating}/5` : '-';
      const notes = stripHtml(f.body_html) || '(no notes)';
      return `### ${stage} - ${who}\nRecommendation: ${rec.toUpperCase()} | Rating: ${rating}\nNotes: ${notes}`;
    }).join('\n\n');

    const sys = `You are summarizing a hiring committee panel's feedback for a single candidate. You are objective, balanced, and explicit about disagreements. You never invent things that interviewers did not say.

Your job: synthesize the feedback into a brief the committee chair can read in 30 seconds and make a decision.

Rules:
1. Pull recurring themes - what 2+ interviewers noted on either side.
2. Be honest about divergence: when interviewers disagreed, name it and quote the disagreement (in your own words; don't fabricate quotes).
3. Distinguish "what the candidate did well in interviews" from "what the candidate has done in their career" - only the former is in scope here.
4. Recommendation should be decisive (2-3 sentences) and tied to specific feedback, not generic.
5. If feedback is sparse or inconclusive, say so plainly - do not stretch.

You MUST call submit_committee_brief.`;

    const user = `ROLE: ${role?.title || 'Unknown role'}
CANDIDATE: ${candidate.full_name || 'Unknown'}

INTERVIEWER FEEDBACK:
${lines}

Synthesize the panel's view and call submit_committee_brief.`;

    const rsp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 3000,
        system: sys,
        tools: [SUMMARY_TOOL],
        messages: [{ role: 'user', content: user }],
        temperature: 0.2,
        tool_choice: { type: 'tool', name: 'submit_committee_brief' },
      }),
    });

    if (!rsp.ok) {
      let msg = `Anthropic error ${rsp.status}`;
      try {
        const err = await rsp.json();
        msg += `: ${err?.error?.message || JSON.stringify(err)}`;
      } catch { /* ignore */ }
      res.status(500).json({ error: msg });
      return;
    }

    const data = await rsp.json();
    const toolBlock = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_committee_brief');
    const brief = toolBlock?.input;
    if (!brief) {
      res.status(500).json({ error: 'Claude did not return a structured brief', raw: data });
      return;
    }

    const merged = { ...(candidate.ai_analysis || {}), committee_brief: { ...brief, generated_at: new Date().toISOString() } };
    await sb.from('candidates').update({ ai_analysis: merged }).eq('id', candidateId);

    res.status(200).json({ brief });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
