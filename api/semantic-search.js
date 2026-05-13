// api/semantic-search.js
// Natural-language candidate search across the user's RLS-scoped pool.
//
// Body: { query: string, limit?: number, projectId?: string, roleId?: string }
// Returns: { matches: [{ id, name, score, reason }], scanned: number, model: string }
//
// Approach: pull a candidate corpus (resume excerpts + role/project + AI summary
// + tags), shrink each row to a few hundred chars, send to Claude with a
// structured-output tool that ranks candidates by fit to the user's query.
//
// Uses a USER-SCOPED Supabase client so the search respects RLS - the bot only
// sees what the caller can see.
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_CANDIDATES_TO_RANK = 60;
const RESUME_EXCERPT_CHARS = 1200;

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

const stripHtml = (s) =>
  String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const RANK_TOOL = {
  name: 'submit_ranked_matches',
  description: 'Return the candidates that best match the user query, ranked best-first. Include only the strongest matches (typically 5-15). Skip candidates that do not match.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        description: 'Best matches in descending order. Empty array if nothing matches.',
        items: {
          type: 'object',
          properties: {
            candidate_index: {
              type: 'number',
              description: 'The 0-based index of the candidate in the input list. Required so the server can map the result back.',
            },
            score: {
              type: 'number',
              description: 'Match score 0-100 against the query specifically (not overall hireability).',
            },
            reason: {
              type: 'string',
              description: 'One short sentence (≤ 25 words) citing the concrete evidence from the resume / metadata that matches the query.',
            },
          },
          required: ['candidate_index', 'score', 'reason'],
        },
      },
    },
    required: ['matches'],
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
      return;
    }
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!url || !anon || !accessToken) {
      res.status(500).json({ error: 'Server is missing Supabase env config.' });
      return;
    }

    const { query, limit = 12, projectId, roleId } = req.body || {};
    if (!query || !String(query).trim()) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const lim = Math.max(1, Math.min(30, Number(limit) || 12));

    // User-scoped client → search respects the caller's RLS view.
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // `roles!inner` makes the join required so `roles.project_id` filter
    // narrows the outer rows (not just the embedded payload).
    const select = `
      id, full_name, email, current_stage_key, status, ai_score, ai_analysis,
      resume_text, source, tags, created_at,
      role:roles!inner ( id, title, level, project_id, project:hiring_projects ( id, name ) )
    `;
    let q = sb.from('candidates').select(select)
      .order('created_at', { ascending: false })
      .limit(MAX_CANDIDATES_TO_RANK);
    if (roleId)    q = q.eq('role_id', roleId);
    if (projectId) q = q.eq('roles.project_id', projectId);

    const { data: cands, error } = await q;
    if (error) {
      res.status(500).json({ error: 'Failed to fetch candidates: ' + error.message });
      return;
    }
    const rows = cands || [];

    if (rows.length === 0) {
      res.status(200).json({ matches: [], scanned: 0, model: DEFAULT_MODEL });
      return;
    }

    // Build a compact corpus.
    const corpus = rows.map((c, idx) => {
      const resumeExcerpt = c.resume_text
        ? String(c.resume_text).slice(0, RESUME_EXCERPT_CHARS)
        : '(no resume - LinkedIn or manual entry)';
      const aiSummary = c.ai_analysis?.summary ? `AI summary: ${c.ai_analysis.summary}` : '';
      const tagLine = (c.tags || []).length ? `Tags: ${(c.tags || []).join(', ')}` : '';
      return [
        `### Candidate #${idx} - ${c.full_name || 'Unnamed'}`,
        `Role: ${c.role?.title || 'Unknown'} (${c.role?.level || 'level n/a'})`,
        `Project: ${c.role?.project?.name || 'Unknown'}`,
        `Stage: ${STAGE_LABELS[c.current_stage_key] || c.current_stage_key} · Status: ${c.status}`,
        typeof c.ai_score === 'number' ? `AI score: ${c.ai_score}` : null,
        aiSummary,
        tagLine,
        `Resume excerpt:\n${resumeExcerpt}`,
      ].filter(Boolean).join('\n');
    }).join('\n\n---\n\n');

    const sys = `You are a hiring assistant performing a semantic search over a recruiter's candidate pool.

You will receive:
- A user query (free text - could describe a skill, domain, level, project type, or a hybrid).
- A list of candidates with their resume excerpts, role/project metadata, and AI summary if available.

Your job: return the candidates that best match the QUERY (not their overall hireability). Rank by query-fit only.

Rules:
- Return at most ${lim} matches.
- Skip candidates with weak or speculative matches - empty matches array is a valid answer.
- The "reason" must cite concrete evidence (a tech, a company, a project, years of experience). Keep it ≤ 25 words.
- score is 0-100, calibrated against THIS query: 90+ = strong direct match, 70-89 = good match, 50-69 = partial match, <50 = weak.
- Use the candidate_index field to identify the candidate. Do not invent indices.

You MUST respond by calling submit_ranked_matches.`;

    const userMsg = `Query: """${String(query).trim()}"""

Candidates (${rows.length}):

${corpus}

Rank the candidates by fit to the query. Call submit_ranked_matches with the top ${lim} matches (or fewer if not all are good fits).`;

    const rsp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 2000,
        system: sys,
        tools: [RANK_TOOL],
        tool_choice: { type: 'tool', name: 'submit_ranked_matches' },
        messages: [{ role: 'user', content: userMsg }],
        temperature: 0.2,
      }),
    });

    if (!rsp.ok) {
      let msg = `Anthropic error ${rsp.status}`;
      try { const err = await rsp.json(); msg += `: ${err?.error?.message || JSON.stringify(err)}`; } catch { /* ignore */ }
      res.status(500).json({ error: msg });
      return;
    }

    const data = await rsp.json();
    const tool = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_ranked_matches');
    const matches = Array.isArray(tool?.input?.matches) ? tool.input.matches : [];

    const out = matches
      .map((m) => {
        const c = rows[m.candidate_index];
        if (!c) return null;
        return {
          id: c.id,
          name: c.full_name,
          role: c.role?.title || null,
          project: c.role?.project?.name || null,
          stage: STAGE_LABELS[c.current_stage_key] || c.current_stage_key,
          status: c.status,
          score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))),
          reason: String(m.reason || '').slice(0, 240),
        };
      })
      .filter(Boolean)
      .slice(0, lim);

    res.status(200).json({ matches: out, scanned: rows.length, model: DEFAULT_MODEL });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
