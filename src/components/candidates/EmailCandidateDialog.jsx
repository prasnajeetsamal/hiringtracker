import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import { emailCandidate } from '../../lib/api.js';

const TEMPLATES = [
  { value: 'custom',         label: 'Free-form message',  desc: 'Compose subject + body from scratch.' },
  { value: 'interview',      label: 'Interview invite',   desc: 'Invite to the next interview round.' },
  { value: 'resume_request', label: 'Request resume',     desc: 'Ask for an updated resume file.' },
  { value: 'rejection',      label: 'Polite rejection',   desc: 'Short, kind decline.' },
  { value: 'offer',          label: 'Offer',              desc: 'Extend a formal offer.' },
];

// Pre-filled subject + body per template. The custom template stays blank so
// the user writes their own; everything else seeds a sane starting point that
// they can edit before sending. The endpoint also accepts structured fields
// for non-custom templates so the rendered HTML matches the lib/email.js
// formatting - we only use these strings when the user previews / edits.
function defaultsFor(template, candidate, stageLabel) {
  const firstName = (candidate?.full_name || '').split(/\s+/)[0] || 'there';
  const roleTitle = candidate?.role?.title || 'the role';
  switch (template) {
    case 'interview':
      return {
        subject: `Interview invitation - ${roleTitle}`,
        message: `Looking forward to hearing more from you. We're particularly keen on the experience you'd bring to ${roleTitle}.`,
        schedulerUrl: '',
      };
    case 'resume_request':
      return {
        subject: `Resume request - ${roleTitle}`,
        message: 'A PDF or DOCX works best. No need to format it - whatever is freshest.',
      };
    case 'rejection':
      return {
        subject: `Update on your application - ${roleTitle}`,
        kindNote: 'Please keep us in mind for future roles - we may be in touch as new positions open up.',
      };
    case 'offer':
      return {
        subject: `Offer - ${roleTitle}`,
        offerSummary: 'A separate email with the formal letter and terms will follow shortly.',
      };
    case 'custom':
    default:
      return {
        subject: `Hi ${firstName}`,
        body_html: `<p>Hi ${firstName},</p>\n<p></p>`,
      };
  }
}

export default function EmailCandidateDialog({ open, onClose, candidate }) {
  const qc = useQueryClient();
  const [template, setTemplate] = useState('custom');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [message, setMessage] = useState('');         // for interview / resume_request
  const [stageLabel, setStageLabel] = useState('');   // for interview
  const [schedulerUrl, setSchedulerUrl] = useState('');// for interview
  const [kindNote, setKindNote] = useState('');       // for rejection
  const [offerSummary, setOfferSummary] = useState('');// for offer

  // When the user changes template (or the dialog opens) seed the fields.
  const applyTemplateDefaults = (tpl) => {
    const d = defaultsFor(tpl, candidate);
    setSubject(d.subject || '');
    setBodyHtml(d.body_html || '');
    setMessage(d.message || '');
    setStageLabel('');
    setSchedulerUrl(d.schedulerUrl || '');
    setKindNote(d.kindNote || '');
    setOfferSummary(d.offerSummary || '');
  };

  useEffect(() => {
    if (open) applyTemplateDefaults('custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidate?.id]);

  const send = useMutation({
    mutationFn: async () => {
      const payload = { candidateId: candidate.id, template };
      if (template === 'custom') {
        if (!subject.trim() || !bodyHtml.trim()) throw new Error('Subject and body are required.');
        payload.subject = subject.trim();
        payload.body_html = bodyHtml.trim();
      } else if (template === 'interview') {
        payload.stageLabel = stageLabel || null;
        payload.schedulerUrl = schedulerUrl || null;
        payload.message = message || null;
      } else if (template === 'resume_request') {
        payload.message = message || null;
      } else if (template === 'rejection') {
        payload.kindNote = kindNote || null;
      } else if (template === 'offer') {
        payload.offerSummary = offerSummary || null;
      }
      return emailCandidate(payload);
    },
    onSuccess: (r) => {
      if (r?.skipped) {
        toast('Email queued (no RESEND_API_KEY configured)', { icon: 'ℹ️' });
      } else {
        toast.success(`Sent to ${r?.to || candidate.email}`);
      }
      qc.invalidateQueries({ queryKey: ['candidate-emails', candidate.id] });
      onClose?.();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!candidate) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email candidate"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Send} onClick={() => send.mutate()} loading={send.isPending} disabled={!candidate.email}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
          <Mail size={13} className="text-indigo-300 shrink-0" />
          <span className="truncate">
            To: <strong className="text-slate-200">{candidate.email || '(no email on file)'}</strong>
            {candidate.full_name && <> · {candidate.full_name}</>}
            {candidate.role?.title && <> · {candidate.role.title}</>}
          </span>
        </div>

        <Field label="Template">
          <select
            value={template}
            onChange={(e) => { setTemplate(e.target.value); applyTemplateDefaults(e.target.value); }}
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="text-[11px] text-slate-500 mt-1">{TEMPLATES.find((t) => t.value === template)?.desc}</div>
        </Field>

        {template === 'custom' && (
          <>
            <Field label="Subject">
              <Input value={subject} onChange={setSubject} placeholder={`Subject line for ${candidate.full_name || 'the candidate'}`} />
            </Field>
            <Field label="Body (HTML allowed)">
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={10}
                placeholder="<p>Hi ...</p>"
                className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </Field>
          </>
        )}

        {template === 'interview' && (
          <>
            <Field label="Stage (optional)">
              <Input value={stageLabel} onChange={setStageLabel} placeholder="e.g. Technical Interview" />
            </Field>
            <Field label="Scheduler link (optional)">
              <Input value={schedulerUrl} onChange={setSchedulerUrl} placeholder="https://calendly.com/..." />
            </Field>
            <Field label="Personal note (optional)">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="A line or two of personalisation."
                className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>
          </>
        )}

        {template === 'resume_request' && (
          <Field label="Personal note (optional)">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="A line or two on what you'd like to see."
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        )}

        {template === 'rejection' && (
          <Field label="Optional kind note">
            <textarea
              value={kindNote}
              onChange={(e) => setKindNote(e.target.value)}
              rows={4}
              placeholder="Something kind / encouraging."
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        )}

        {template === 'offer' && (
          <Field label="Offer summary (optional)">
            <textarea
              value={offerSummary}
              onChange={(e) => setOfferSummary(e.target.value)}
              rows={4}
              placeholder="Brief mention of the role / start date / next steps."
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        )}

        <div className="text-[11px] text-slate-500 flex items-start gap-1.5 pt-1">
          <Wand2 size={11} className="mt-0.5 shrink-0" />
          <span>
            Emails are sent from the Resend sender configured via <code className="text-slate-400">EMAIL_FROM</code>.
            Make sure that domain is verified in Resend before reaching out to real candidates.
            Every send is logged to <code className="text-slate-400">email_log</code>.
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Input({ value, onChange, ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      {...rest}
    />
  );
}
