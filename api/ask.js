// api/ask.js
// In-app chatbot. Claude with tool-use that lets it query the user's data
// (candidates, roles, projects, pipeline) and answer questions like
// "what stage is Aanya Verma in?" or "how many candidates are at HM Review?".
//
// Queries go through a user-scoped Supabase client so the bot's view of
// the data matches what RLS lets the caller see.
//
// Body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }
// Returns: { reply: string }
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_TOOL_LOOPS = 5;

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

const TOOLS = [
  {
    name: 'search_candidates',
    description: 'Search candidates by name (case-insensitive partial), email, role title, or project name. Returns up to 25 matches with current stage, status, role, project, and AI score (if any).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search. Empty string to list recent candidates.' },
        status: { type: 'string', enum: ['active', 'rejected', 'hired', 'withdrew', 'any'], description: 'Filter by candidate status. Default: any.' },
        stage_key: { type: 'string', description: 'Filter by current pipeline stage key (e.g. hm_review, technical_interview).' },
        limit: { type: 'number', description: 'Max results 1-50. Default 25.' },
      },
    },
  },
  {
    name: 'get_candidate_detail',
    description: 'Get full detail for one candidate by ID, including their pipeline timeline (every stage with state and dates) and AI evaluation if scored.',
    input_schema: {
      type: 'object',
      properties: { candidate_id: { type: 'string', description: 'UUID of the candidate.' } },
      required: ['candidate_id'],
    },
  },
  {
    name: 'list_projects_and_roles',
    description: 'List all hiring projects and their roles with the number of active candidates on each role.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pipeline_summary',
    description: 'Aggregate counts: total candidates by stage, by status, recent additions. Useful for "how many candidates are at X stage" type questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_feedback_summary',
    description: 'List interviewer feedback rows. Use for questions about decisions, missing feedback, or interviewer recommendations. Supports filtering by candidate, role, recommendation, or "missing only" (assignments where no feedback has been submitted).',
    input_schema: {
      type: 'object',
      properties: {
        candidate_id: { type: 'string', description: 'UUID of a specific candidate.' },
        role_id: { type: 'string', description: 'UUID of a specific role.' },
        recommendation: {
          type: 'string',
          enum: ['strong_hire', 'hire', 'no_hire', 'strong_no_hire'],
          description: 'Filter to one recommendation value.',
        },
        missing_only: {
          type: 'boolean',
          description: 'If true, returns assignments where the interviewer has NOT yet submitted feedback (pending list). Default false.',
        },
        limit: { type: 'number', description: 'Max rows 1-50. Default 25.' },
      },
    },
  },
  {
    name: 'search_comments',
    description: 'Search comments and @mentions across candidates, roles, and pipeline stages. Use for "what was said about X", "show me my mentions", "comments by Y".',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['candidate', 'role', 'pipeline', 'feedback'],
          description: 'Restrict to comments on a specific entity type.',
        },
        entity_id: { type: 'string', description: 'UUID of the entity (use together with entity_type).' },
        mentions_user_id: { type: 'string', description: 'UUID of a profile - returns comments that @-mention them.' },
        keyword: { type: 'string', description: 'Plain text fragment to match in the comment body.' },
        limit: { type: 'number', description: 'Max rows 1-50. Default 20.' },
      },
    },
  },
  {
    name: 'check_availability',
    description: 'List interviewer availability slots in a time range. Use for "who is free Tuesday afternoon?", "show me open slots this week", "is X available on Friday?".',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 timestamp (UTC). Lower bound for slot starts_at.' },
        to: { type: 'string', description: 'ISO 8601 timestamp (UTC). Upper bound for slot starts_at.' },
        interviewer_id: { type: 'string', description: 'Optional: limit to one interviewer by profile UUID.' },
        status: {
          type: 'string',
          enum: ['open', 'booked', 'blocked', 'any'],
          description: 'Slot status filter. Default "open".',
        },
        limit: { type: 'number', description: 'Max rows 1-100. Default 40.' },
      },
      required: ['from', 'to'],
    },
  },
];

// ─── tool implementations ─────────────────────────────────────────────

async function searchCandidates(sb, { query = '', status = 'any', stage_key, limit = 25 }) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 25));
  let q = sb.from('candidates').select(`
    id, full_name, email, current_stage_key, status, ai_score, source, created_at,
    role:roles ( id, title, project:hiring_projects ( id, name ) )
  `).limit(lim).order('created_at', { ascending: false });

  if (status !== 'any') q = q.eq('status', status);
  if (stage_key) q = q.eq('current_stage_key', stage_key);

  const { data, error } = await q;
  if (error) return { error: error.message };

  let rows = data || [];
  if (query && query.trim()) {
    const needle = query.toLowerCase();
    rows = rows.filter((r) => {
      const hay = [r.full_name, r.email, r.role?.title, r.role?.project?.name]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

  return rows.map((r) => ({
    // `display_link` is the EXACT markdown a model should put in a reply
    // when referring to this candidate. Use it verbatim.
    display_link: `[${r.full_name || 'Unnamed'}](candidate://${r.id})`,
    name: r.full_name,
    email: r.email,
    stage: STAGE_LABELS[r.current_stage_key] || r.current_stage_key,
    status: r.status,
    role: r.role?.title || null,
    project: r.role?.project?.name || null,
    ai_score: r.ai_score,
    source: r.source,
    // Internal id last so models are less tempted to print it.
    _id_for_link: r.id,
  }));
}

async function getCandidateDetail(sb, candidateId) {
  const { data: c, error } = await sb
    .from('candidates')
    .select(`
      id, full_name, email, phone, linkedin_url, current_stage_key, status, ai_score, ai_analysis,
      source, created_at, updated_at,
      role:roles ( id, title, project:hiring_projects ( id, name ) )
    `)
    .eq('id', candidateId)
    .single();
  if (error || !c) return { error: 'Candidate not found' };

  const { data: pipe } = await sb
    .from('candidate_pipeline')
    .select('stage_key, stage_order, state, started_at, completed_at')
    .eq('candidate_id', candidateId)
    .order('stage_order');

  return {
    display_link: `[${c.full_name || 'Unnamed'}](candidate://${c.id})`,
    name: c.full_name,
    email: c.email,
    phone: c.phone,
    linkedin: c.linkedin_url,
    role: c.role?.title || null,
    project: c.role?.project?.name || null,
    current_stage: STAGE_LABELS[c.current_stage_key] || c.current_stage_key,
    status: c.status,
    ai_score: c.ai_score,
    ai_recommendation: c.ai_analysis?.recommendation || null,
    ai_summary: c.ai_analysis?.summary || null,
    pipeline: (pipe || []).map((p) => ({
      stage: STAGE_LABELS[p.stage_key] || p.stage_key,
      state: p.state,
      started_at: p.started_at,
      completed_at: p.completed_at,
    })),
    source: c.source,
    created_at: c.created_at,
    updated_at: c.updated_at,
    _id_for_link: c.id,
  };
}

async function listProjectsAndRoles(sb) {
  const [{ data: projects }, { data: roles }, { data: candidates }] = await Promise.all([
    sb.from('hiring_projects').select('id, name, status').eq('status', 'active'),
    sb.from('roles').select('id, title, project_id, level, location, status'),
    sb.from('candidates').select('id, role_id, status'),
  ]);

  const candCountByRole = {};
  (candidates || []).forEach((c) => {
    if (c.status !== 'active' || !c.role_id) return;
    candCountByRole[c.role_id] = (candCountByRole[c.role_id] || 0) + 1;
  });

  return (projects || []).map((p) => ({
    project: p.name,
    project_id: p.id,
    roles: (roles || []).filter((r) => r.project_id === p.id).map((r) => ({
      title: r.title,
      level: r.level,
      location: r.location,
      status: r.status,
      active_candidates: candCountByRole[r.id] || 0,
    })),
  }));
}

async function pipelineSummary(sb) {
  const { data: candidates } = await sb
    .from('candidates')
    .select('current_stage_key, status, created_at');
  const byStage = {};
  const byStatus = {};
  let last7Days = 0;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  (candidates || []).forEach((c) => {
    if (c.status === 'active') {
      const k = STAGE_LABELS[c.current_stage_key] || c.current_stage_key;
      byStage[k] = (byStage[k] || 0) + 1;
    }
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (new Date(c.created_at).getTime() >= cutoff) last7Days += 1;
  });
  return {
    total_candidates: (candidates || []).length,
    active_by_stage: byStage,
    by_status: byStatus,
    added_last_7_days: last7Days,
  };
}

async function getFeedbackSummary(sb, { candidate_id, role_id, recommendation, missing_only = false, limit = 25 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 25));

  // First narrow pipeline rows by candidate/role if given - we always need pipeline ids to scope feedback / assignments.
  let pipeQ = sb.from('candidate_pipeline').select(`
    id, stage_key, state, candidate_id,
    candidate:candidates ( id, full_name, role_id, role:roles ( id, title, project:hiring_projects ( id, name ) ) )
  `);
  if (candidate_id) pipeQ = pipeQ.eq('candidate_id', candidate_id);
  if (role_id)      pipeQ = pipeQ.eq('candidates.role_id', role_id);
  const { data: pipeRows, error: pipeErr } = await pipeQ;
  if (pipeErr) return { error: pipeErr.message };
  let pipelines = (pipeRows || []).filter((p) => p.candidate);
  if (role_id) pipelines = pipelines.filter((p) => p.candidate?.role_id === role_id);
  if (pipelines.length === 0) return { rows: [], total: 0 };
  const pipelineIds = pipelines.map((p) => p.id);
  const pipeById = Object.fromEntries(pipelines.map((p) => [p.id, p]));

  if (missing_only) {
    // Assignments for these pipeline rows, then exclude those that have feedback.
    const { data: assigns } = await sb
      .from('interviewer_assignments')
      .select('id, pipeline_id, interviewer_id, interviewer:profiles!interviewer_assignments_interviewer_id_fkey ( id, full_name, email )')
      .in('pipeline_id', pipelineIds);
    const { data: fb } = await sb
      .from('feedback')
      .select('pipeline_id, interviewer_id')
      .in('pipeline_id', pipelineIds);
    const submitted = new Set((fb || []).map((f) => `${f.pipeline_id}|${f.interviewer_id}`));
    const pending = (assigns || []).filter((a) => !submitted.has(`${a.pipeline_id}|${a.interviewer_id}`));
    return {
      rows: pending.slice(0, lim).map((a) => {
        const p = pipeById[a.pipeline_id];
        return {
          interviewer: a.interviewer?.full_name || a.interviewer?.email || 'Unknown',
          interviewer_email: a.interviewer?.email || null,
          stage: STAGE_LABELS[p?.stage_key] || p?.stage_key,
          display_link: p?.candidate ? `[${p.candidate.full_name || 'Unnamed'}](candidate://${p.candidate.id})` : null,
          candidate_name: p?.candidate?.full_name || null,
          role: p?.candidate?.role?.title || null,
          project: p?.candidate?.role?.project?.name || null,
        };
      }),
      total: pending.length,
    };
  }

  let fbQ = sb.from('feedback')
    .select('id, recommendation, rating, submitted_at, pipeline_id, interviewer:profiles!feedback_interviewer_id_fkey ( id, full_name, email )')
    .in('pipeline_id', pipelineIds)
    .order('submitted_at', { ascending: false })
    .limit(lim);
  if (recommendation) fbQ = fbQ.eq('recommendation', recommendation);
  const { data: fb, error: fbErr } = await fbQ;
  if (fbErr) return { error: fbErr.message };

  return {
    rows: (fb || []).map((f) => {
      const p = pipeById[f.pipeline_id];
      return {
        interviewer: f.interviewer?.full_name || f.interviewer?.email || 'Unknown',
        recommendation: f.recommendation,
        rating: f.rating,
        submitted_at: f.submitted_at,
        stage: STAGE_LABELS[p?.stage_key] || p?.stage_key,
        display_link: p?.candidate ? `[${p.candidate.full_name || 'Unnamed'}](candidate://${p.candidate.id})` : null,
        candidate_name: p?.candidate?.full_name || null,
        role: p?.candidate?.role?.title || null,
        project: p?.candidate?.role?.project?.name || null,
      };
    }),
    total: (fb || []).length,
  };
}

async function searchComments(sb, { entity_type, entity_id, mentions_user_id, keyword, limit = 20 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  let q = sb.from('comments')
    .select('id, body_html, entity_type, entity_id, mentions, created_at, author:profiles!comments_author_id_fkey ( id, full_name, email )')
    .order('created_at', { ascending: false })
    .limit(Math.max(lim, 80)); // pull more then keyword-filter client-side
  if (entity_type) q = q.eq('entity_type', entity_type);
  if (entity_id)   q = q.eq('entity_id', entity_id);
  if (mentions_user_id) q = q.contains('mentions', [mentions_user_id]);
  const { data, error } = await q;
  if (error) return { error: error.message };

  let rows = data || [];
  if (keyword && keyword.trim()) {
    const needle = keyword.toLowerCase();
    rows = rows.filter((r) => String(r.body_html || '').toLowerCase().includes(needle));
  }
  rows = rows.slice(0, lim);

  // Resolve pipeline -> candidate links so the bot can render a clickable link for stage-scoped comments.
  const pipelineEntityIds = rows.filter((r) => r.entity_type === 'pipeline').map((r) => r.entity_id);
  let pipelineToCandidate = {};
  if (pipelineEntityIds.length) {
    const { data: pipeRows } = await sb
      .from('candidate_pipeline')
      .select('id, candidate_id, stage_key, candidate:candidates ( id, full_name )')
      .in('id', pipelineEntityIds);
    pipelineToCandidate = Object.fromEntries((pipeRows || []).map((p) => [p.id, p]));
  }

  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    rows: rows.map((r) => {
      let display_link = null;
      let stage = null;
      if (r.entity_type === 'candidate') {
        display_link = `[Open candidate](candidate://${r.entity_id})`;
      } else if (r.entity_type === 'pipeline') {
        const p = pipelineToCandidate[r.entity_id];
        if (p?.candidate) {
          display_link = `[${p.candidate.full_name || 'Unnamed'}](candidate://${p.candidate.id})`;
          stage = STAGE_LABELS[p.stage_key] || p.stage_key;
        }
      }
      return {
        snippet: stripHtml(r.body_html).slice(0, 240),
        author: r.author?.full_name || r.author?.email || 'Unknown',
        created_at: r.created_at,
        entity_type: r.entity_type,
        stage,
        display_link,
      };
    }),
    total: rows.length,
  };
}

async function checkAvailability(sb, { from, to, interviewer_id, status = 'open', limit = 40 } = {}) {
  if (!from || !to) return { error: 'from and to (ISO 8601) are required' };
  const lim = Math.min(100, Math.max(1, Number(limit) || 40));
  let q = sb.from('availability_slots')
    .select('id, starts_at, ends_at, status, recurrence, interviewer:profiles!availability_slots_interviewer_id_fkey ( id, full_name, email )')
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at', { ascending: true })
    .limit(lim);
  if (interviewer_id) q = q.eq('interviewer_id', interviewer_id);
  if (status && status !== 'any') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { error: error.message };
  return {
    rows: (data || []).map((s) => ({
      interviewer: s.interviewer?.full_name || s.interviewer?.email || 'Unknown',
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status,
      recurrence: s.recurrence,
    })),
    total: (data || []).length,
  };
}

async function executeTool(sb, name, input) {
  try {
    if (name === 'search_candidates')       return await searchCandidates(sb, input || {});
    if (name === 'get_candidate_detail')    return await getCandidateDetail(sb, input?.candidate_id);
    if (name === 'list_projects_and_roles') return await listProjectsAndRoles(sb);
    if (name === 'pipeline_summary')        return await pipelineSummary(sb);
    if (name === 'get_feedback_summary')    return await getFeedbackSummary(sb, input || {});
    if (name === 'search_comments')         return await searchComments(sb, input || {});
    if (name === 'check_availability')      return await checkAvailability(sb, input || {});
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: e.message || 'Tool execution failed' };
  }
}

// ─── handler ──────────────────────────────────────────────────────────

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

    // User-scoped Supabase client - bot only sees what the caller can see.
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!incoming.length) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    const system = `You are Slate's in-app assistant. Slate is a hiring tracker. You help internal users answer questions about projects, roles, candidates, and pipelines.

You have tools to query the live database. Always use them to ground answers in real data - never invent names, scores, or stages.

# Tool routing
- Specific candidate ("what stage is X in?") → search_candidates first, then get_candidate_detail if more is needed.
- Aggregates ("how many at HM Review?") → pipeline_summary.
- "What projects/roles do we have?" → list_projects_and_roles.
- Feedback / interviewer decisions ("whose feedback is missing?", "show me strong-hires this month", "what did the panel say about X?") → get_feedback_summary. Use missing_only=true for "pending / overdue / outstanding" feedback questions.
- Discussion / mentions ("what was said about X?", "show me my mentions", "comments on the PM role") → search_comments. For "my mentions" the caller's auth scope already filters; the tool returns comments the caller can see via RLS.
- Availability / scheduling ("who is free Tuesday afternoon?", "open slots this week", "is X available Friday?") → check_availability with explicit ISO timestamps you construct from today's date.

# Vocabulary
- Stages: Resume Submitted, HM Review, Technical Written, Technical Interview, Problem Solving, Case Study, Offer, Joined Fractal, Rejected Offer.
- Statuses: active, rejected, hired, withdrew.
- Recommendations: strong_hire, hire, no_hire, strong_no_hire.

# Citation
After answering, briefly cite which tool(s) you used and how many rows came back so the user knows the data is grounded. Format: a single trailing line in muted prose, e.g. *"(from 4 feedback rows)"* or *"(across 12 candidates)"*. Skip the citation for trivially small answers (1 candidate, single stage check).

# Response formatting (STRICT - read carefully)

## Candidate names - MUST be markdown links
Whenever you mention a candidate, copy the \`display_link\` field returned by the tool **VERBATIM**, character for character. It looks like \`[Name](candidate://<id>)\` and the UI converts it into a clickable button that hides the URL.

You **MUST NEVER** type the literal string \`candidate://\` or any UUID anywhere else in your message. The only acceptable place that string ever appears is inside the parentheses of a markdown link copied from \`display_link\`.

Wrong (raw URL or ID showing): \`Tara Sundaram (candidate://abc-123)\`
Wrong (no link): \`Tara Sundaram\`
Right: \`[Tara Sundaram](candidate://abc-123)\`

## Bullet character - MUST be hyphen + space
Use \`-\` (hyphen + space) at the start of every list item. **Do NOT use \`•\` or \`·\`** - those bullet glyphs do not render correctly in this app.

## Default information per candidate row
\`- [**Name**](candidate://<id>) - Role · Stage · status\`

Do **NOT** include AI score in the row unless the user explicitly asked about scoring (e.g. "top scorers", "AI evaluation", "highest scoring"). Most questions don't need it.

## Other rules
1. Be concise. Don't preface with "Sure!", "Great question!", or restate the user's question.
2. Use \`**bold**\` only for names and key numbers, not whole sentences.
3. Use markdown headings (\`## Heading\`) only if the answer has 2+ logical sections.
4. If the answer is a number, lead with the number on its own line, then a short clarifying sentence.
5. If the data doesn't support an answer, say so plainly - never speculate.
6. Sort lists sensibly (alphabetical, or by stage if the question is about progression).

# Examples (study these carefully)

User: "What stage is Aanya Verma in?"
You:
[**Aanya Verma**](candidate://abc-123) is at **Technical Interview** for *Senior Data Scientist* (Marcom Optimization RFP). Status: active.

User: "Who's at the Offer stage?"
You:
**5** candidates are currently at the Offer stage:

- [**Tara Sundaram**](candidate://1) - *Technical Writer* · Marcom Optimization RFP
- [**Anika Joshi**](candidate://2) - *Product Designer* · Marcom Optimization RFP
- [**Rohan Mehta**](candidate://3) - *Senior PM* · Marcom Optimization RFP
- [**Tanvi Rao**](candidate://4) - *Senior PM* · Marcom Optimization RFP
- [**Aditya Bose**](candidate://5) - *Senior PM* · Marcom Optimization RFP

User: "Show me top scorers" (NOTE: explicit score request, so include score)
You:
- [**Rohan Mehta**](candidate://r1) - *Senior PM* · score **94** · HM Review
- [**Saanvi Iyer**](candidate://r2) - *GenAI Architect* · score **91** · Technical Interview

User: "How many candidates at HM Review?"
You:
**12** active candidates are at HM Review across all projects.

Today's date is ${new Date().toISOString().slice(0, 10)}.`;

    // Convert incoming history to Claude format. Trust shape but coerce.
    const messages = incoming.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    let loops = 0;
    let assistantMessage = null;
    while (loops < MAX_TOOL_LOOPS) {
      loops += 1;
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
          system,
          tools: TOOLS,
          messages,
          temperature: 0.35,
        }),
      });

      if (!rsp.ok) {
        let msg = `Anthropic error ${rsp.status}`;
        try { const err = await rsp.json(); msg += `: ${err?.error?.message || JSON.stringify(err)}`; } catch { /* ignore */ }
        res.status(500).json({ error: msg });
        return;
      }

      const data = await rsp.json();
      const content = data.content || [];
      const toolUses = content.filter((b) => b.type === 'tool_use');

      if (toolUses.length === 0) {
        assistantMessage = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        break;
      }

      // Push the assistant's tool-use turn as-is (Claude requires the same structure back)
      messages.push({ role: 'assistant', content });

      // Execute every tool the model requested
      const toolResults = await Promise.all(
        toolUses.map(async (t) => {
          const result = await executeTool(sb, t.name, t.input);
          return {
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify(result).slice(0, 12000),
          };
        })
      );
      messages.push({ role: 'user', content: toolResults });
    }

    if (!assistantMessage) {
      assistantMessage = "I couldn't reach a final answer. Try rephrasing your question.";
    }

    res.status(200).json({ reply: assistantMessage });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
