// api/score-candidate.js
// Inputs: { candidateId, roleId } — server resolves JD and resume text from DB
// and writes ai_score + ai_analysis back onto the candidate row.
//
// Adapted from ResumeScreener's api/score.js, with extensions:
//   * Sends structured JD (HTML preserved) so Claude sees headings/bullets.
//   * Sends role metadata (level, work mode, location) so the model can
//     calibrate seniority and location-fit.
//   * Honours hard constraints: minimum_education, experience_range,
//     location_required (boost or penalize the score).
//   * Larger thinking budget for higher accuracy.
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_INPUT_CHARS = 16000;

// ─── helpers ──────────────────────────────────────────────────────────

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

// Light HTML → plain-with-structure: preserves headings + bullets as text.
function htmlToStructured(html) {
  let out = String(html || '');
  // Block boundaries
  out = out
    .replace(/<\/(p|h1|h2|h3|h4|h5|li|tr|div|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<h[1-6][^>]*>/gi, '\n## ')
    .replace(/<\/?(strong|b|em|i|u|span|div|p|ul|ol|tr|td|th|table|tbody|thead|blockquote)[^>]*>/gi, '');
  // Decode common entities
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Squash whitespace
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

const eduOrder = ['high school', 'diploma', 'bachelors', 'masters', 'phd'];
const normalizeEdu = (raw = '') => {
  const s = String(raw).toLowerCase().trim();
  if (!s || s === 'unknown') return 'unknown';
  if (s.includes('phd') || s.includes('doctor') || s.includes('d.phil')) return 'phd';
  if (s.includes('master') || s.includes('mba') || /\bm\.?s\.?c?\b/.test(s) || /\bm\.?eng\b/.test(s) || /\bm\.?phil\b/.test(s) || /\bm\.?a\.?\b/.test(s)) return 'masters';
  if (s.includes('bachelor') || /\bb\.?s\.?c?\b/.test(s) || /\bb\.?tech\b/.test(s) || /\bb\.?eng\b/.test(s) || /\bb\.?a\.?\b/.test(s)) return 'bachelors';
  if (s.includes('diploma') || s.includes('associate') || /\ba\.?s\.?\b/.test(s)) return 'diploma';
  if (s.includes('high school') || s.includes('secondary') || /\bhs\b/.test(s)) return 'high school';
  return 'unknown';
};
const eduRank = (lvl) => eduOrder.indexOf(normalizeEdu(lvl));

// Heuristic for experience floor based on role level keywords.
function expectedYearsFromLevel(level) {
  const s = String(level || '').toLowerCase();
  if (!s) return null;
  if (/(intern|trainee|graduate)/.test(s)) return { min: 0, max: 1 };
  if (/(junior|jr\b|associate|l\d|level\s*1|level\s*2|entry)/.test(s)) return { min: 0, max: 3 };
  if (/(mid|intermediate|swe ii|engineer ii)/.test(s)) return { min: 2, max: 5 };
  if (/(senior|sr\b|lead|principal|staff|architect|head|director|vp)/.test(s)) {
    if (/(principal|staff|architect|head|director|vp)/.test(s)) return { min: 8, max: 30 };
    return { min: 5, max: 30 };
  }
  return null;
}

// ─── Claude tool ──────────────────────────────────────────────────────

const EVAL_TOOL = {
  name: 'submit_evaluation',
  description: 'Submit a structured, evidence-backed evaluation of the candidate against the job description and role context.',
  input_schema: {
    type: 'object',
    properties: {
      overallScore: { type: 'number', description: 'Overall fit score, 0-100.' },
      jdMatchScore: { type: 'number', description: 'Holistic alignment with the JD, 0-100.' },
      summary: { type: 'string', description: '1-2 sentence verdict.' },
      detailedAnalysis: { type: 'string', description: '150-300 word holistic analysis. Plain prose, no markdown.' },
      selectionReasons: {
        type: 'array',
        description: 'Concrete reasons this candidate IS a fit, with evidence from the resume. Empty if rejecting.',
        items: { type: 'string' },
      },
      rejectionReasons: {
        type: 'array',
        description: 'Concrete reasons this candidate is NOT a fit, with evidence. Empty if hiring.',
        items: { type: 'string' },
      },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      requirementAnalysis: {
        type: 'array',
        description: 'One row per requirement extracted from the JD (must, preferred, or nice-to-have). The model SHOULD identify the most important 4-8 requirements from the JD itself.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            type: { type: 'string', enum: ['must', 'preferred', 'nice'] },
            match: { type: 'boolean' },
            confidence: { type: 'number', description: '0-100 — calibrate honestly' },
            reasoning: { type: 'string', description: 'Brief reasoning (≤ 25 words).' },
            evidence: { type: 'string', description: 'Short verbatim quote from the resume (≤ 25 words), or "" if none.' },
          },
          required: ['requirement', 'type', 'match', 'confidence', 'reasoning', 'evidence'],
        },
      },
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
    required: ['overallScore', 'jdMatchScore', 'summary', 'detailedAnalysis', 'selectionReasons', 'rejectionReasons', 'strengths', 'weaknesses', 'requirementAnalysis', 'extractedInfo', 'recommendation'],
  },
};

// ─── handler ──────────────────────────────────────────────────────────

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
      .select('id, title, level, work_mode, city, state, country, location, jd_html')
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

    const jdStructured = htmlToStructured(role.jd_html);
    const resumeText = candidate.resume_text;

    const roleLocation = [role.city, role.state, role.country].filter(Boolean).join(', ') || role.location || 'Unknown';
    const workMode = role.work_mode || 'unspecified';

    const sys = `You are an expert technical recruiter evaluating one candidate against one job. You are precise, evidence-based, skeptical, and never invent facts.

EVALUATION PROCESS — follow this order in your reasoning:
A) FACT EXTRACTION (from the resume only)
   - Education, total years of *relevant professional* experience, location, key skills.
   - For each fact, point to the line(s) in the resume that support it.

B) REQUIREMENT IDENTIFICATION (from the JD)
   - Identify the 4-8 most important requirements implied by the JD. Mark each as
     'must' (hard requirement, "X+ years of Y", "deep experience with Z", etc.),
     'preferred' (clearly favored), or 'nice' (mentioned as bonus / plus).

C) REQUIREMENT MATCHING (one pass per identified requirement)
   - Find the strongest evidence in the resume.
   - Mark match=true ONLY if the evidence shows real professional application —
     not a passing mention, not a coursework reference, not "familiar with".
   - Pull a verbatim ≤25-word quote into 'evidence'. Use "" only if truly nothing supports it.

D) SCORING
   - Apply the rubric below. Penalize hard for missing musts. Don't reward unverified claims.

E) RECOMMENDATION
   - Apply hard constraint rules before rubric thresholds.

GROUND RULES (strict):
1. Use ONLY facts present in the resume text. If something is not stated, set the field to 'Unknown' — do not assume.
2. Years of experience = total full years of relevant professional experience. Sum non-overlapping date ranges from the work history; 'Present' / 'Current' means today. Round DOWN. Internships and academic projects do NOT count.
3. SEMANTIC equivalence is required, not literal keyword overlap.
   - 'Led a team of 5' matches 'team leadership'.
   - 'Built data pipelines in Spark' matches 'big data engineering'.
   - Tech families count: 'PostgreSQL' matches 'SQL'; 'Next.js' matches 'React'.
4. ANTI-BIAS GUARDRAILS — do NOT give credit when:
   - A skill appears only in a 'Skills' list with no project/role evidence.
   - A skill appears only in a course title or single-sentence personal-project bullet.
   - The resume uses vague phrases like 'exposure to', 'familiar with', 'knowledge of'.
   In those cases mark match=false and explain why in 'reasoning'.
5. Education hierarchy (low → high): high school, diploma, bachelors, masters, phd. Always normalize.

ROLE CONTEXT (calibrate against these signals):
- Title: ${role.title}
- Level: ${role.level || 'unspecified'}
- Work mode: ${workMode} (remote / office / hybrid)
- Location: ${roleLocation}

If the level signals a senior role (Senior, Staff, Principal, Lead, Architect, Head),
set a high bar — multiple years of progressively responsible experience, evidence of
leading initiatives, mentoring, owning systems end-to-end.
If the level signals junior/intern, calibrate accordingly — strong fundamentals and
trajectory matter more than total years.

LOCATION FIT:
- If work mode is 'remote', do not penalize for location mismatch.
- If work mode is 'office' or 'hybrid' and the candidate's resume location clearly
  doesn't match the role location, surface this as a concern in 'weaknesses' but
  don't auto-reject — relocation is possible.

SCORING RUBRIC (overallScore, 0-100):
- 90-100  Outstanding fit. All musts met, most preferreds met, evidence of measurable impact (numbers, scale, outcomes).
- 75-89   Strong fit. All musts met; gaps only in nice-to-haves.
- 60-74   Moderate. Most musts met; some preferred gaps.
- 40-59   Weak. One or more musts missing.
- 0-39    Poor. Many musts missing or wrong domain entirely.

CONSTRAINTS THAT OVERRIDE RUBRIC:
- If a 'must' requirement is unmet → overallScore MUST NOT exceed 70.
- If two or more 'must' requirements are unmet → recommendation MUST be REJECT.

DETAILED ANALYSIS — REQUIRED:
Write 150-300 words of plain prose (no markdown, no bullets) explaining the holistic verdict. Cover, in this order:
  • Domain match (does the candidate's career line up with this role/industry?)
  • Experience level vs. the seniority signaled by the JD and role level
  • Technical depth on the most important skills, with concrete evidence
  • Evidence of measurable impact (numbers, scale, ownership, leadership)
  • Alignment with the role's key responsibilities
  • Red flags or notable gaps
Be specific to THIS resume — never generic. Refer to companies, technologies, and accomplishments by name when they appear.

SELECTION REASONS (3-6 if HIRE/CONSIDER):
Each must reference concrete evidence (companies, projects, scale, years).
GOOD: '8 years of distributed-systems work at Stripe and Cloudflare'
BAD: 'Strong technical background'

REJECTION REASONS (2-5 if REJECT):
Evidence-grounded gaps. GOOD: 'Below the 8-year minimum: resume shows ~4 years post-graduation'.

You MUST respond by calling the 'submit_evaluation' tool. Do not respond with plain text.`;

    const user = `JOB DESCRIPTION (preserved structure — ## are headings, - are bullets):
"""
${truncate(jdStructured, MAX_INPUT_CHARS)}
"""

CANDIDATE RESUME (${candidate.full_name || 'unknown'}):
"""
${truncate(resumeText, MAX_INPUT_CHARS)}
"""

Evaluate the candidate now and call submit_evaluation with your structured result.`;

    const useThinking = String(process.env.CLAUDE_THINKING || 'on').toLowerCase() !== 'off';
    const thinkingBudget = Number(process.env.CLAUDE_THINKING_BUDGET || 5000);

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
    out.requirementAnalysis = Array.isArray(out.requirementAnalysis) ? out.requirementAnalysis : [];
    out.extractedInfo = out.extractedInfo || {};

    // ─── post-processing safety net ────────────────────────────────────
    let score = out.overallScore;

    // Hard penalty when 2+ musts are missing.
    const mustMisses = out.requirementAnalysis.filter((r) => r?.type === 'must' && r?.match === false).length;
    if (mustMisses >= 1) score = Math.min(score, 70);
    if (mustMisses >= 2) score = Math.min(score, 50);

    // Experience floor based on the role's level keyword.
    const expBucket = expectedYearsFromLevel(role.level);
    const candYears = Number(out.extractedInfo.experience || 0);
    if (expBucket && candYears < expBucket.min) {
      score -= 15; // significant penalty for under-experienced
    }
    if (expBucket && candYears > expBucket.max + 5) {
      score -= 5; // mild penalty for over-experienced (might be unfit / over-qualified)
    }

    // Location penalty when not remote and clear mismatch.
    if (workMode !== 'remote' && roleLocation !== 'Unknown') {
      const candLoc = String(out.extractedInfo.location || '').toLowerCase();
      const wanted = roleLocation.toLowerCase();
      if (candLoc && wanted && !candLoc.includes(wanted.split(',')[0].trim()) && !wanted.includes(candLoc.split(',')[0].trim())) {
        score -= 5;
      }
    }

    score = clamp01(score);
    out.overallScore = score;

    // Re-derive recommendation if the post-processing changed the score band materially.
    if (mustMisses >= 2)               out.recommendation = 'REJECT';
    else if (score >= 78)              out.recommendation = 'HIRE';
    else if (score >= 58)              out.recommendation = 'CONSIDER';
    else                               out.recommendation = 'REJECT';

    out.context = {
      role: { title: role.title, level: role.level, workMode, location: roleLocation },
      level_expectations: expBucket,
      candidate_experience_years: candYears,
      must_requirements_missing: mustMisses,
    };
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
