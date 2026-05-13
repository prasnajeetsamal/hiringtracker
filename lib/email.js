// lib/email.js
// Transport-agnostic email senders + templated helpers.
//
// Transport selection (in priority order):
//   1. Gmail SMTP via nodemailer if GMAIL_USER + GMAIL_APP_PASSWORD are set.
//      Sends actually come FROM that Gmail address. Replies land in that
//      inbox naturally. Great for low-volume internal hiring tools.
//   2. Resend HTTP API if RESEND_API_KEY is set. Requires a verified sender
//      domain in EMAIL_FROM for delivery to external addresses.
//   3. No-op (console.log + email_log row tagged `skipped_no_key`) when
//      neither is configured. Keeps dev working without email creds.

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase-admin.js';

const FROM = process.env.EMAIL_FROM || 'Slate <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || 'http://localhost:4001').replace(/\/$/, '');

const hasSmtp = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const hasResend = () => !!process.env.RESEND_API_KEY;

let _resend = null;
function resendClient() {
  if (_resend) return _resend;
  if (!hasResend()) return null;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

let _smtp = null;
function smtpClient() {
  if (_smtp) return _smtp;
  if (!hasSmtp()) return null;
  _smtp = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  return _smtp;
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

// Internal: dispatch via Gmail SMTP. Attachments are expected to be an array
// of `{ filename, content }` where `content` is a string (utf-8) or Buffer.
async function sendViaSmtp({ to, subject, html, text, attachments }) {
  const transporter = smtpClient();
  // nodemailer happily takes strings or Buffers for attachment content.
  const info = await transporter.sendMail({
    from: FROM,
    to,
    subject,
    html,
    text,
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  return { id: info?.messageId };
}

// Internal: dispatch via Resend. Resend expects attachment `content` as a
// base64 string, so we re-encode here.
async function sendViaResend({ to, subject, html, text, attachments }) {
  const c = resendClient();
  const { data, error } = await c.emails.send({
    from: FROM,
    to,
    subject,
    html,
    text,
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(String(a.content), 'utf8').toString('base64'),
    })),
  });
  if (error) return { error };
  return { id: data?.id };
}

async function send({ to, subject, html, text, template, payload, attachments }) {
  // Priority: SMTP -> Resend -> noop. First configured wins.
  const transport = hasSmtp() ? 'smtp' : hasResend() ? 'resend' : 'noop';

  if (transport === 'noop') {
    // eslint-disable-next-line no-console
    console.log(`[email noop] ${template} -> ${to} :: ${subject}`);
    await logEmail({ to, template, payload, status: 'skipped_no_key' });
    return { skipped: true };
  }

  try {
    const result = transport === 'smtp'
      ? await sendViaSmtp({ to, subject, html, text, attachments })
      : await sendViaResend({ to, subject, html, text, attachments });

    if (result.error) {
      await logEmail({ to, template, payload, status: `error[${transport}]: ` + (result.error.message || 'unknown') });
      return { error: result.error };
    }
    await logEmail({ to, template, payload, status: `sent[${transport}]`, providerId: result.id });
    return { id: result.id };
  } catch (e) {
    await logEmail({ to, template, payload, status: `exception[${transport}]: ` + e.message });
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

// Sends the freshly-rendered HTML report as an attachment. Body is a short
// cover note; the recipient opens the attached file to view the report.
export async function emailScheduledReport({ to, scheduleName, scopeLabel, html, attachmentFilename }) {
  const cover = layout(
    `Slate report - ${scheduleName}`,
    `Your scheduled report <strong>${scheduleName}</strong>${scopeLabel ? ` (${scopeLabel})` : ''} is attached as a self-contained HTML file. Open it in any browser - no Slate login required.`,
    APP_URL, 'Open Slate'
  );
  return send({
    to,
    subject: `Slate report - ${scheduleName}`,
    html: cover,
    text: `Your scheduled report ${scheduleName} is attached.\n\n${APP_URL}`,
    template: 'scheduled_report',
    payload: { scheduleName, scopeLabel },
    attachments: [
      {
        filename: attachmentFilename || `slate-report-${new Date().toISOString().slice(0, 10)}.html`,
        content: html,
      },
    ],
  });
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
