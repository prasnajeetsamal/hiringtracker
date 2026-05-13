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
    <div style="margin-top:24px;font-size:11px;color:#64748b;">Slate - internal hiring tracker. If this email was unexpected, ignore it.</div>
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
    to, subject: `Feedback pending - ${candidateName}`,
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
    `<li style="margin-bottom:6px;"><a href="${APP_URL}/candidates/${i.id}" style="color:#a5b4fc;">${i.full_name || 'Unknown'}</a> - ${i.stage} for ${i.days} days</li>`
  ).join('');
  const html = layout(
    'Stale candidates need attention',
    `These candidates have not advanced recently:<ul style="margin-top:10px;padding-left:18px;">${rows}</ul>`,
    APP_URL, 'Open Slate'
  );
  return send({
    to, subject: `${items.length} stale candidate${items.length === 1 ? '' : 's'} - Slate`,
    html, text: items.map(i => `${i.full_name} - ${i.stage} (${i.days}d)`).join('\n'),
    template: 'stale_digest',
    payload: { count: items.length },
  });
}

export async function emailMention({ to, mentionerName, snippet, candidateName, candidateId, stageLabel }) {
  const url = candidateId ? `${APP_URL}/candidates/${candidateId}` : APP_URL;
  const where = stageLabel
    ? `in the <em>${stageLabel}</em> round`
    : candidateName
    ? `on <strong>${candidateName}</strong>'s profile`
    : '';
  const html = layout(
    `${mentionerName} mentioned you on Slate`,
    `${mentionerName} mentioned you ${where}.<br><br><blockquote style="margin:0;padding-left:12px;border-left:2px solid #475569;color:#cbd5e1;">${snippet}</blockquote>`,
    url, 'View comment'
  );
  return send({
    to, subject: `${mentionerName} mentioned you - ${candidateName || 'Slate'}`,
    html, text: `${mentionerName} mentioned you: ${snippet}\n\n${url}`,
    template: 'mention',
    payload: { candidateId, stageLabel },
  });
}

// Sends the freshly-rendered HTML report inline. Recipient downloads the
// attachment to view offline (the body is a short cover note).
export async function emailScheduledReport({ to, scheduleName, scopeLabel, html, attachmentFilename }) {
  const cover = layout(
    `Slate report - ${scheduleName}`,
    `Your scheduled report <strong>${scheduleName}</strong>${scopeLabel ? ` (${scopeLabel})` : ''} is attached as a self-contained HTML file. Open it in any browser - no Slate login required.`,
    APP_URL, 'Open Slate'
  );
  const c = client();
  if (!c) {
    // eslint-disable-next-line no-console
    console.log(`[email noop] scheduled_report -> ${to} :: ${scheduleName}`);
    await logEmail({ to, template: 'scheduled_report', payload: { scheduleName, scopeLabel }, status: 'skipped_no_key' });
    return { skipped: true };
  }
  try {
    const { data, error } = await c.emails.send({
      from: FROM,
      to,
      subject: `Slate report - ${scheduleName}`,
      html: cover,
      text: `Your scheduled report ${scheduleName} is attached.\n\n${APP_URL}`,
      attachments: [
        {
          filename: attachmentFilename || `slate-report-${new Date().toISOString().slice(0, 10)}.html`,
          content: Buffer.from(html, 'utf8').toString('base64'),
        },
      ],
    });
    if (error) {
      await logEmail({ to, template: 'scheduled_report', payload: { scheduleName }, status: 'error: ' + (error.message || 'unknown') });
      return { error };
    }
    await logEmail({ to, template: 'scheduled_report', payload: { scheduleName, scopeLabel }, status: 'sent', providerId: data?.id });
    return { id: data?.id };
  } catch (e) {
    await logEmail({ to, template: 'scheduled_report', payload: { scheduleName }, status: 'exception: ' + e.message });
    return { error: e };
  }
}

// ─── Candidate-facing transactional emails ───────────────────────────
// Distinct from the internal `emailRejection` etc. (which notify the hiring
// team). These go to the CANDIDATE so the sender / wording / tone changes.
// Verify your Resend sender domain before using these in production - the
// default `onboarding@resend.dev` only delivers back to the Resend account
// owner.

// Free-form candidate email. Subject + body are user-authored in the composer
// modal. The endpoint that sends this records the candidateId in the payload
// so the candidate-detail page can render an "Emails sent" history.
export async function emailCandidateCustom({ to, candidateName, subject, bodyHtml, fromName, candidateId, template }) {
  const heading = subject || `Message from ${fromName || 'the hiring team'}`;
  const html = layout(heading, bodyHtml || '', null, null);
  return send({
    to,
    subject: subject || `Hello from Slate`,
    html,
    text: bodyHtml ? bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
    template: template || 'candidate_custom',
    payload: { candidateId, candidateName, subject },
  });
}

// Template 1 - interview invite. Hiring manager picks the stage + adds an
// optional message; this fills in the salutation and a calendar tagline.
export async function emailCandidateInterview({ to, candidateName, roleTitle, stageLabel, schedulerUrl, message, candidateId }) {
  const cta = schedulerUrl ? schedulerUrl : null;
  const body = `
    <p>Hi ${candidateName?.split(/\s+/)[0] || 'there'},</p>
    <p>Thanks for your continued interest in the <strong>${roleTitle || 'role'}</strong>. We'd like to invite you to the <strong>${stageLabel || 'next'}</strong> round.</p>
    ${message ? `<p>${message}</p>` : ''}
    ${cta ? `<p>Please pick a time that works for you using the link below.</p>` : `<p>We'll follow up shortly with timing.</p>`}
  `;
  const html = layout(`Interview invitation - ${roleTitle || 'next round'}`, body, cta, 'Choose a time');
  return send({
    to,
    subject: `Interview invitation - ${roleTitle || stageLabel || 'next round'}`,
    html,
    text: `Hi ${candidateName?.split(/\s+/)[0] || 'there'}, we'd like to invite you to the ${stageLabel || 'next'} round for ${roleTitle || 'the role'}.${message ? ' ' + message : ''}${cta ? '\n\n' + cta : ''}`,
    template: 'candidate_interview',
    payload: { candidateId, candidateName, roleTitle, stageLabel },
  });
}

// Template 2 - resume request (when LinkedIn-only candidate needs a proper
// resume before we can score / move them forward).
export async function emailCandidateResumeRequest({ to, candidateName, roleTitle, message, candidateId }) {
  const body = `
    <p>Hi ${candidateName?.split(/\s+/)[0] || 'there'},</p>
    <p>Thanks for applying to the <strong>${roleTitle || 'role'}</strong>. To move forward, could you share an updated resume (PDF or DOCX)?</p>
    ${message ? `<p>${message}</p>` : ''}
    <p>Reply to this email with the file attached and we'll take it from there.</p>
  `;
  const html = layout(`Could you share your resume?`, body, null, null);
  return send({
    to,
    subject: `Resume request - ${roleTitle || 'application'}`,
    html,
    text: `Hi ${candidateName?.split(/\s+/)[0] || 'there'}, could you share an updated resume for the ${roleTitle || 'role'}?${message ? ' ' + message : ''}`,
    template: 'candidate_resume_request',
    payload: { candidateId, candidateName, roleTitle },
  });
}

// Template 3 - rejection. Kept deliberately short + kind.
export async function emailCandidateRejection({ to, candidateName, roleTitle, kindNote, candidateId }) {
  const body = `
    <p>Hi ${candidateName?.split(/\s+/)[0] || 'there'},</p>
    <p>Thanks again for your time interviewing for the <strong>${roleTitle || 'role'}</strong>. After careful consideration, we've decided to move forward with other candidates.</p>
    ${kindNote ? `<p>${kindNote}</p>` : ''}
    <p>We genuinely appreciate the effort you put into the process and wish you all the best.</p>
  `;
  const html = layout(`Update on your application`, body, null, null);
  return send({
    to,
    subject: `Update on your application - ${roleTitle || 'Slate'}`,
    html,
    text: `Hi ${candidateName?.split(/\s+/)[0] || 'there'}, thanks for your time. We've decided to move forward with other candidates.${kindNote ? ' ' + kindNote : ''}`,
    template: 'candidate_rejection',
    payload: { candidateId, candidateName, roleTitle },
  });
}

// Template 4 - offer.
export async function emailCandidateOffer({ to, candidateName, roleTitle, offerSummary, candidateId }) {
  const body = `
    <p>Hi ${candidateName?.split(/\s+/)[0] || 'there'},</p>
    <p>We're thrilled to extend an offer for the <strong>${roleTitle || 'role'}</strong>.</p>
    ${offerSummary ? `<p>${offerSummary}</p>` : '<p>Detailed terms will follow in a separate email.</p>'}
    <p>Let us know if you have any questions - we're excited about the possibility of working together.</p>
  `;
  const html = layout(`Offer - ${roleTitle || 'Slate'}`, body, null, null);
  return send({
    to,
    subject: `Offer - ${roleTitle || 'Slate'}`,
    html,
    text: `Hi ${candidateName?.split(/\s+/)[0] || 'there'}, we're thrilled to offer you the ${roleTitle || 'role'}.${offerSummary ? ' ' + offerSummary : ''}`,
    template: 'candidate_offer',
    payload: { candidateId, candidateName, roleTitle },
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
    to, subject: `Rejected - ${candidateName}`,
    html, text: `${candidateName} rejected at ${stageLabel}: ${url}`,
    template: 'rejection',
    payload: { candidateId, stageLabel },
  });
}
