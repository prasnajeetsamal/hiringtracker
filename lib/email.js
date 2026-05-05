// lib/email.js
// Resend client + templated transactional senders.
// Falls back to a no-op (console.log) when RESEND_API_KEY is not set, so
// the app stays functional in dev without email delivery.

import { Resend } from 'resend';
import { supabaseAdmin } from './supabase-admin.js';

const FROM = process.env.EMAIL_FROM || 'Slate <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || 'http://localhost:4001').replace(/\/$/, '');

let _resend = null;
function client() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function logEmail({ to, template, payload, status, providerId }) {
  try {
    await supabaseAdmin().from('email_log').insert({
      to_email: to,
      template,
      payload,
      status,
      provider_id: providerId,
    });
  } catch (_) { /* best-effort */ }
}

async function send({ to, subject, html, text, template, payload }) {
  const c = client();
  if (!c) {
    // eslint-disable-next-line no-console
    console.log(`[email noop] ${template} -> ${to} :: ${subject}`);
    await logEmail({ to, template, payload, status: 'skipped_no_key' });
    return { skipped: true };
  }
  try {
    const { data, error } = await c.emails.send({
      from: FROM,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      await logEmail({ to, template, payload, status: 'error: ' + (error.message || 'unknown') });
      return { error };
    }
    await logEmail({ to, template, payload, status: 'sent', providerId: data?.id });
    return { id: data?.id };
  } catch (e) {
    await logEmail({ to, template, payload, status: 'exception: ' + e.message });
    return { error: e };
  }
}

const layout = (title, body, ctaUrl, ctaText) => `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;">
    <div style="font-size:18px;font-weight:600;background:linear-gradient(120deg,#818cf8,#c084fc,#f472b6);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:8px;">Slate</div>
    <h1 style="font-size:20px;color:#f1f5f9;margin:0 0 12px 0;">${title}</h1>
    <div style="font-size:14px;line-height:1.55;color:#cbd5e1;">${body}</div>
    ${ctaUrl ? `<div style="margin-top:20px;"><a href="${ctaUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:linear-gradient(90deg,#6366f1,#a855f7,#ec4899);color:#fff;text-decoration:none;font-weight:600;font-size:14px;">${ctaText || 'Open Slate'}</a></div>` : ''}
    <div style="margin-top:24px;font-size:11px;color:#64748b;">Slate — internal hiring tracker. If this email was unexpected, ignore it.</div>
  </div>
</body></html>`;

export async function emailFeedbackReminder({ to, candidateName, stageLabel, candidateId }) {
  const url = `${APP_URL}/candidates/${candidateId}`;
  const html = layout(
    'Pending interview feedback',
    `You have outstanding feedback to submit for <strong>${candidateName}</strong> in the <em>${stageLabel}</em> round.`,
    url, 'Submit feedback'
  );
  return send({
    to, subject: `Feedback pending — ${candidateName}`,
    html, text: `Submit feedback at ${url}`,
    template: 'feedback_reminder',
    payload: { candidateId, stageLabel },
  });
}

export async function emailStageChange({ to, candidateName, fromStage, toStage, candidateId }) {
  const url = `${APP_URL}/candidates/${candidateId}`;
  const html = layout(
    `Candidate moved to ${toStage}`,
    `<strong>${candidateName}</strong> advanced from <em>${fromStage}</em> to <strong>${toStage}</strong>.`,
    url, 'View candidate'
  );
  return send({
    to, subject: `${candidateName} → ${toStage}`,
    html, text: `${candidateName} moved to ${toStage}: ${url}`,
    template: 'stage_change',
    payload: { candidateId, fromStage, toStage },
  });
}

export async function emailStaleDigest({ to, items }) {
  const rows = items.map(i =>
    `<li style="margin-bottom:6px;"><a href="${APP_URL}/candidates/${i.id}" style="color:#a5b4fc;">${i.full_name || 'Unknown'}</a> — ${i.stage} for ${i.days} days</li>`
  ).join('');
  const html = layout(
    'Stale candidates need attention',
    `These candidates have not advanced recently:<ul style="margin-top:10px;padding-left:18px;">${rows}</ul>`,
    APP_URL, 'Open Slate'
  );
  return send({
    to, subject: `${items.length} stale candidate${items.length === 1 ? '' : 's'} — Slate`,
    html, text: items.map(i => `${i.full_name} — ${i.stage} (${i.days}d)`).join('\n'),
    template: 'stale_digest',
    payload: { count: items.length },
  });
}

export async function emailRejection({ to, candidateName, stageLabel, candidateId }) {
  const url = `${APP_URL}/candidates/${candidateId}`;
  const html = layout(
    'Candidate rejected',
    `<strong>${candidateName}</strong> has been rejected at the <em>${stageLabel}</em> round.`,
    url, 'View candidate'
  );
  return send({
    to, subject: `Rejected — ${candidateName}`,
    html, text: `${candidateName} rejected at ${stageLabel}: ${url}`,
    template: 'rejection',
    payload: { candidateId, stageLabel },
  });
}
