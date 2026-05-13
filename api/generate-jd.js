// api/generate-jd.js
// Claude-backed job-description writer. Takes the role metadata plus a short
// prompt describing the role and returns clean structured JD HTML that the
// Tiptap editor renders verbatim.
//
// Body: { title, level?, work_mode?, city?, state?, country?, prompt? }
// Returns: { jd_html }
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const JD_TOOL = {
  name: 'submit_jd',
  description: 'Submit a structured job-description.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '1-2 sentence positioning of the role / team / outcome. Plain prose, no markdown.',
      },
      responsibilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Day-to-day responsibilities, 5-8 concise bullets. Each ≤ 25 words.',
      },
      mustHave: {
        type: 'array',
        items: { type: 'string' },
        description: 'Hard requirements (years of experience, specific skills, formal credentials). 4-7 bullets.',
      },
      niceToHave: {
        type: 'array',
        items: { type: 'string' },
        description: 'Preferred but not blocking. 2-5 bullets. Empty if nothing applies.',
      },
      whatYoullLearn: {
        type: 'array',
        items: { type: 'string' },
        description: 'Growth / impact bullets the candidate gets from this role. 2-4 bullets.',
      },
      logistics: {
        type: 'string',
        description: 'One short paragraph covering location / work mode / level. Plain prose.',
      },
    },
    required: ['summary', 'responsibilities', 'mustHave', 'niceToHave', 'whatYoullLearn', 'logistics'],
  },
};

const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderHtml(out) {
  const ul = (arr) => `<ul>${(arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
  const block = (heading, body) => `<h2>${heading}</h2>${body}`;
  const parts = [];
  if (out.summary)              parts.push(block('About the role', `<p>${escapeHtml(out.summary)}</p>`));
  if (out.responsibilities?.length) parts.push(block("What you'll do", ul(out.responsibilities)));
  if (out.mustHave?.length)     parts.push(block("What we're looking for", ul(out.mustHave)));
  if (out.niceToHave?.length)   parts.push(block('Nice to have', ul(out.niceToHave)));
  if (out.whatYoullLearn?.length) parts.push(block("What you'll get out of it", ul(out.whatYoullLearn)));
  if (out.logistics)            parts.push(block('Logistics', `<p>${escapeHtml(out.logistics)}</p>`));
  return parts.join('\n');
}

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
      res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
      return;
    }
    const { title, level, work_mode, city, state, country, prompt } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'title is required to generate a JD.' });
      return;
    }
    const location = [city, state, country].filter(Boolean).join(', ');

    const sys = `You write internal job descriptions for a hiring team. Aim for clarity, specificity, and zero corporate fluff. Reference real day-to-day activities, calibrate seniority against the level, and keep each bullet under 25 words.

You MUST respond by calling the submit_jd tool. Do not respond with plain text.`;

    const user = `Role title: ${title}
Level: ${level || 'unspecified'}
Work mode: ${work_mode || 'unspecified'}
Location: ${location || 'unspecified'}
${prompt ? `Hiring-manager notes (use these as the primary signal for what this role actually needs):\n"""${String(prompt).trim()}"""` : 'No extra context - produce a balanced JD calibrated to the title + level.'}

Draft the JD now and call submit_jd.`;

    const rsp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 2500,
        system: sys,
        tools: [JD_TOOL],
        tool_choice: { type: 'tool', name: 'submit_jd' },
        messages: [{ role: 'user', content: user }],
        temperature: 0.4,
      }),
    });

    if (!rsp.ok) {
      let msg = `Anthropic error ${rsp.status}`;
      try { const err = await rsp.json(); msg += `: ${err?.error?.message || JSON.stringify(err)}`; } catch { /* ignore */ }
      res.status(500).json({ error: msg });
      return;
    }
    const data = await rsp.json();
    const tool = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_jd');
    if (!tool?.input) {
      res.status(500).json({ error: 'Claude did not return a structured JD.' });
      return;
    }
    res.status(200).json({ jd_html: renderHtml(tool.input), raw: tool.input });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
