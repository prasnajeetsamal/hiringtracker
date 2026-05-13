// api/notify-mention.js
// Fires emails to anyone @-mentioned in a freshly-posted comment.
//
// Body: { commentId }
// Returns: { sent, skipped, recipients }
//
// We do this server-side (rather than on the comment-insert RLS path) so that:
//   * The author's bearer token is verified before we read mention recipients.
//   * The service-role client can read the mentioned users' email addresses
//     even if the author would not normally be allowed to read other profiles.
//   * Resend keys / SMTP stay server-only.
//
// The handler is intentionally idempotent on the client side - `CommentThread`
// fires this best-effort after a successful insert; failures are swallowed so
// the comment UX is never blocked by email delivery.
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { emailMention } from '../lib/email.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const { commentId } = req.body || {};
    if (!commentId) {
      res.status(400).json({ error: 'commentId is required' });
      return;
    }

    const sb = supabaseAdmin();

    const { data: comment, error: cErr } = await sb
      .from('comments')
      .select('id, author_id, entity_type, entity_id, body_html, mentions, created_at')
      .eq('id', commentId)
      .single();
    if (cErr || !comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    // Only the comment author can trigger notifications for their own comment.
    if (comment.author_id !== callerId) {
      res.status(403).json({ error: 'Only the comment author can dispatch its mention notifications.' });
      return;
    }
    const mentionIds = Array.isArray(comment.mentions) ? comment.mentions.filter(Boolean) : [];
    if (mentionIds.length === 0) {
      res.status(200).json({ sent: 0, skipped: 0, recipients: [] });
      return;
    }

    // Resolve the candidate context (and the stage label, if pipeline-scoped)
    // so the email subject / body has helpful framing.
    let candidateId = null;
    let stageLabel = null;
    if (comment.entity_type === 'candidate') {
      candidateId = comment.entity_id;
    } else if (comment.entity_type === 'pipeline') {
      const { data: row } = await sb
        .from('candidate_pipeline')
        .select('candidate_id, stage_key')
        .eq('id', comment.entity_id)
        .single();
      if (row) {
        candidateId = row.candidate_id;
        stageLabel = STAGE_LABELS[row.stage_key] || row.stage_key;
      }
    }

    let candidateName = null;
    if (candidateId) {
      const { data: c } = await sb
        .from('candidates')
        .select('full_name')
        .eq('id', candidateId)
        .single();
      candidateName = c?.full_name || null;
    }

    const { data: mentioner } = await sb
      .from('profiles')
      .select('full_name, email')
      .eq('id', callerId)
      .single();
    const mentionerName = mentioner?.full_name || mentioner?.email || 'A teammate';

    // Recipients - drop self-mentions and anyone without a usable email.
    const recipients = (await sb
      .from('profiles')
      .select('id, full_name, email')
      .in('id', mentionIds)
    ).data || [];
    const eligible = recipients.filter((r) => r.id !== callerId && r.email);

    // Truncate the snippet to something email-friendly.
    const snippet = stripHtml(comment.body_html).slice(0, 280);

    const results = await Promise.all(
      eligible.map((r) =>
        emailMention({
          to: r.email,
          mentionerName,
          snippet,
          candidateName,
          candidateId,
          stageLabel,
        }).catch((e) => ({ error: e?.message || 'send failed' }))
      )
    );
    const sent = results.filter((r) => r && !r.error && !r.skipped).length;
    const skipped = results.filter((r) => r?.skipped).length;

    res.status(200).json({
      sent,
      skipped,
      recipients: eligible.map((r) => ({ id: r.id, email: r.email })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
