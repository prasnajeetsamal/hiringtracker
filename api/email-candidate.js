// api/email-candidate.js
// Sends a transactional email TO the candidate (not the hiring team). Used
// from the EmailCandidateDialog on the candidate detail page.
//
// Body shapes:
//   { candidateId, template: 'custom',           subject, body_html }
//   { candidateId, template: 'interview',        stageLabel?, schedulerUrl?, message? }
//   { candidateId, template: 'resume_request',   message? }
//   { candidateId, template: 'rejection',        kindNote? }
//   { candidateId, template: 'offer',            offerSummary? }
//
// Auth: must be an admin OR a member of the candidate's project (RLS-checked
// via the user-scoped client read).
//
// Resend pre-req: the FROM domain must be verified for delivery to external
// addresses. In dev with no RESEND_API_KEY, the underlying send() noops and
// still writes an email_log row.
export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import {
  emailCandidateCustom,
  emailCandidateInterview,
  emailCandidateResumeRequest,
  emailCandidateRejection,
  emailCandidateOffer,
} from '../lib/email.js';

const VALID_TEMPLATES = new Set(['custom', 'interview', 'resume_request', 'rejection', 'offer']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const { candidateId, template, subject, body_html, stageLabel, schedulerUrl, message, kindNote, offerSummary } = req.body || {};
    if (!candidateId) {
      res.status(400).json({ error: 'candidateId is required' });
      return;
    }
    if (!template || !VALID_TEMPLATES.has(template)) {
      res.status(400).json({ error: `template must be one of: ${[...VALID_TEMPLATES].join(', ')}` });
      return;
    }

    // ── Permission check: user-scoped read of the candidate. If RLS denies,
    // they're not a member of the project and can't email this candidate.
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const accessToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!url || !anon || !accessToken) {
      res.status(500).json({ error: 'Server is missing Supabase env config.' });
      return;
    }
    const userSb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: visible, error: visErr } = await userSb
      .from('candidates')
      .select('id')
      .eq('id', candidateId)
      .maybeSingle();
    if (visErr || !visible) {
      res.status(403).json({ error: 'You do not have access to email this candidate.' });
      return;
    }

    // ── Service-role pull for the rest (need email + role title even if the
    // user-scoped client doesn't see joined columns).
    const admin = supabaseAdmin();
    const { data: candidate } = await admin
      .from('candidates')
      .select('id, full_name, email, role:roles ( title )')
      .eq('id', candidateId)
      .single();
    if (!candidate?.email) {
      res.status(400).json({ error: 'Candidate has no email address on file.' });
      return;
    }

    const { data: senderProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', callerId)
      .single();
    const fromName = senderProfile?.full_name || null;

    let result;
    const common = { to: candidate.email, candidateName: candidate.full_name, candidateId, roleTitle: candidate.role?.title || null };

    if (template === 'custom') {
      if (!subject || !body_html) {
        res.status(400).json({ error: 'subject and body_html are required for the custom template.' });
        return;
      }
      result = await emailCandidateCustom({ ...common, subject, bodyHtml: body_html, fromName });
    } else if (template === 'interview') {
      result = await emailCandidateInterview({ ...common, stageLabel, schedulerUrl, message });
    } else if (template === 'resume_request') {
      result = await emailCandidateResumeRequest({ ...common, message });
    } else if (template === 'rejection') {
      result = await emailCandidateRejection({ ...common, kindNote });
    } else if (template === 'offer') {
      result = await emailCandidateOffer({ ...common, offerSummary });
    }

    if (result?.error) {
      res.status(500).json({ error: 'Send failed: ' + (result.error.message || 'unknown') });
      return;
    }
    res.status(200).json({ sent: !result?.skipped, skipped: !!result?.skipped, to: candidate.email });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
