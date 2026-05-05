// api/score-candidate.js
// Inputs: { candidateId, roleId } — server resolves JD and resume text from DB
// and writes ai_score + ai_analysis back onto the candidate row.
// Adapted from ResumeScreener's api/score.js — same EVAL_TOOL schema and rubric.
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_INPUT_CHARS = 12000;

const truncate = (s, n) => {
  const str = String(s || '');
  return str.length <= n ? str : str.slice(0, n) + '\n[...truncated for length...]';
};

const clamp01 = (n) => {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const stripHtml = (html) =>
  String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const EVAL_TOOL = {
  name: 'submit_evaluation',
  description: 'Submit a structured, evidence-backed evaluation of the candidate against the job description.',
  input_schema: {
    type: 'object',
    properties: {
      overallScore: { type: 'number', description: 'Overall fit score, 0-100.' },
      jdMatchScore: { type: 'number', description: 'Holistic alignment with the JD, 0-100.' },
      summary: { type: 'string', description: '1-2 sentence verdict.' },
      detailedAnalysis: { type: 'string', description: '150-300 word holistic analysis. Plain prose, no markdown.' },
      selectionReasons: {
        type: 'array',
        description: 'Concrete reasons this candidate IS a fit, with evidence. Empty if rejecting.',
        items: { type: 'string' },
      },
      rejectionReasons: {
        type: 'array',
        description: 'Concrete reasons this candidate is NOT a fit, with evidence. Empty if hiring.',
        items: { type: 'string' },
      },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      extractedInfo: {
        type: 'object',
        properties: {
          experience: { type: 'number', description: 'Total years of relevant professional experience.' },
          location: { type: 'string' },
          education: { type: 'string', description: 'high school | diploma | bachelors | masters | phd | Unknown' },
          keySkills: { type: 'array', items: { type: 'string' } },
        },
        required: ['experience', 'location', 'education', 'keySkills'],
      },
      recommendation: { type: 'string', enum: ['HIRE', 'CONSIDER', 'REJECT'] },
    },
    required: ['overallScore', 'jdMatchScore', 'summary', 'detailedAnalysis', 'selectionReasons', 'rejectionReasons', 'strengths', 'weaknesses', 'extractedInfo', 'recommendation'],
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
    const { candidateId, roleId } = req.body || {};
    if (!candidateId || !roleId) {
      res.status(400).json({ error: 'candidateId and roleId are required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
      return;
    }

    const sb = supabaseAdmin();

    const { data: candidate, error: cErr } = await sb
      .from('candidates')
      .select('id, full_name, resume_text, linkedin_url, source')
      .eq('id', candidateId)
      .single();
    if (cErr || !candidate) {
      res.status(404).json({ error: 'Candidate not found' });
      return;
    }
    if (!candidate.resume_text || !candidate.resume_text.trim()) {
      res.status(400).json({ error: 'Candidate has no resume text. AI scoring needs an uploaded resume.' });
      return;
    }

    const { data: role, error: rErr } = await sb
      .from('roles')
      .select('id, title, jd_html')
      .eq('id', roleId)
      .single();
    if (rErr || !role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    if (!role.jd_html || !stripHtml(role.jd_html)) {
      res.status(400).json({ error: 'Role has no JD. Please add a JD before scoring.' });
      return;
    }

    const jd = stripHtml(role.jd_html);
    const resumeText = candidate.resume_text;

    const sys = `You are an expert technical recruiter evaluating one candidate against one job. You are precise, evidence-based, skeptical, and never invent facts.

EVALUATION PROCESS — follow this order:
A) FACT EXTRACTION: education, total years of *relevant professional* experience, location, key skills — strictly from the resume.
B) SCORING: apply the rubric. Penalize hard for missing requirements. Don't reward unverified claims.
C) RECOMMENDATION: HIRE / CONSIDER / REJECT.

GROUND RULES:
1. Use ONLY facts present in the resume text. Otherwise mark "Unknown".
2. Years of experience = total full years of relevant professional experience (sum non-overlapping date ranges; "Present" = today). Internships and academic projects do NOT count.
3. SEMANTIC equivalence is required, not literal keyword overlap.
4. ANTI-BIAS GUARDRAILS — do NOT give credit when a skill appears only in a "Skills" list, only in a course title, or via vague phrases like "exposure to", "familiar with".
5. Education hierarchy (low → high): high school, diploma, bachelors, masters, phd. Always normalize.

RUBRIC (overallScore, 0-100):
- 90-100  Outstanding fit with measurable impact.
- 75-89   Strong fit; gaps only in nice-to-haves.
- 60-74   Moderate; some gaps in important areas.
- 40-59   Weak; missing important requirements.
- 0-39    Poor or wrong domain entirely.

DETAILED ANALYSIS (150-300 words, plain prose, no markdown): cover domain match, experience level, technical depth with concrete evidence, evidence of impact, alignment with key responsibilities, red flags. Be specific to THIS resume — never generic.

SELECTION REASONS (3-6 if HIRE/CONSIDER): each must reference concrete evidence (companies, projects, scale, years).
REJECTION REASONS (2-5 if REJECT): evidence-grounded gaps.

You MUST respond by calling the "submit_evaluation" tool. Do not respond with plain text.`;

    const user = `JOB DESCRIPTION (role: ${role.title}):
"""
${truncate(jd, MAX_INPUT_CHARS)}
"""

CANDIDATE RESUME (${candidate.full_name || 'unknown'}):
"""
${truncate(resumeText, MAX_INPUT_CHARS)}
"""

Evaluate the candidate now and call submit_evaluation with your structured result.`;

    const useThinking = String(process.env.CLAUDE_THINKING || 'on').toLowerCase() !== 'off';
    const thinkingBudget = Number(process.env.CLAUDE_THINKING_BUDGET || 3000);

    const body = {
      model: DEFAULT_MODEL,
      max_tokens: useThinking ? Math.max(8000, thinkingBudget + 4000) : 4000,
      system: sys,
      tools: [EVAL_TOOL],
      messages: [{ role: 'user', content: user }],
      ...(useThinking
        ? { temperature: 1, thinking: { type: 'enabled', budget_tokens: thinkingBudget }, tool_choice: { type: 'auto' } }
        : { temperature: 0.1, tool_choice: { type: 'tool', name: 'submit_evaluation' } }),
    };

    const rsp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!rsp.ok) {
      let msg = `Anthropic error ${rsp.status}`;
      try {
        const err = await rsp.json();
        msg += `: ${err?.error?.message || JSON.stringify(err)}`;
      } catch {
        try { msg += `: ${await rsp.text()}`; } catch { /* ignore */ }
      }
      res.status(500).json({ error: msg });
      return;
    }

    const data = await rsp.json();
    const toolBlock = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_evaluation');
    const out = toolBlock?.input;
    if (!out || typeof out !== 'object') {
      res.status(500).json({ error: 'Claude did not return a structured evaluation', raw: data });
      return;
    }

    out.overallScore = clamp01(Number(out.overallScore || 0));
    out.jdMatchScore = clamp01(Number(out.jdMatchScore || 0));
    out.strengths = Array.isArray(out.strengths) ? out.strengths : [];
    out.weaknesses = Array.isArray(out.weaknesses) ? out.weaknesses : [];
    out.extractedInfo = out.extractedInfo || {};
    out.model = DEFAULT_MODEL;

    const { error: uErr } = await sb
      .from('candidates')
      .update({ ai_score: out.overallScore, ai_analysis: out })
      .eq('id', candidateId);
    if (uErr) {
      res.status(500).json({ error: 'AI scored OK but failed to save: ' + uErr.message, analysis: out });
      return;
    }

    res.status(200).json({ ai_score: out.overallScore, ai_analysis: out });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
