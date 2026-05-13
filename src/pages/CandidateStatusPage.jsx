// src/pages/CandidateStatusPage.jsx
// PUBLIC status page rendered at /c/:token. No Slate login required.
// Possession of the URL grants read-only access to a narrow safe-view of
// the candidate's pipeline status. The server endpoint is the gatekeeper -
// see api/public-status.js for what's exposed.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Check, CircleDot, Circle, SkipForward, X as XIcon, Sparkles, AlertCircle, Loader2,
} from 'lucide-react';

const BASE = (import.meta.env.VITE_API_BASE?.replace(/\/$/, '')) || '';

export default function CandidateStatusPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${BASE}/api/public-status?token=${encodeURIComponent(token || '')}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
        return body;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div
      className="min-h-screen text-slate-200 px-4 py-10 sm:py-16"
      style={{
        background:
          'radial-gradient(60% 50% at 80% 0%, rgba(99,102,241,0.18) 0%, transparent 60%),' +
          'radial-gradient(50% 40% at 0% 100%, rgba(244,114,182,0.15) 0%, transparent 60%),' +
          'linear-gradient(180deg, #050816 0%, #0b1220 100%)',
      }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Brand header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div
              className="text-xs font-bold tracking-[0.18em] uppercase"
              style={{
                backgroundImage: 'linear-gradient(90deg, #818cf8, #c084fc, #f472b6)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Slate
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Application status</div>
          </div>
        </div>

        {loading && (
          <Card>
            <div className="flex items-center gap-3 text-slate-400">
              <Loader2 size={18} className="animate-spin text-indigo-400" />
              <span className="text-sm">Loading your application...</span>
            </div>
          </Card>
        )}

        {error && !loading && (
          <Card tone="error">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-rose-300 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-slate-100 mb-1">We couldn't find your application.</div>
                <div className="text-sm text-slate-300">{error}</div>
                <div className="text-xs text-slate-500 mt-3">
                  Double-check the link you received. If it still doesn't work, reply to the email you got from us.
                </div>
              </div>
            </div>
          </Card>
        )}

        {data && !loading && !error && <StatusContent data={data} />}

        <div className="text-center text-[11px] text-slate-600 mt-8">
          Powered by Slate
        </div>
      </div>
    </div>
  );
}

function StatusContent({ data }) {
  const { candidate, timeline, current_stage, status } = data;
  const terminal = status === 'hired' || status === 'rejected' || status === 'withdrew';

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-2xl sm:text-3xl font-semibold text-slate-100">
          Hi {candidate.first_name},
        </div>
        <div className="text-sm text-slate-300 mt-2 leading-relaxed">
          Thanks for your interest in
          {candidate.role_title ? <> the <strong className="text-slate-100">{candidate.role_title}</strong> role</> : ' the role'}
          {candidate.project_name ? <> on the <strong className="text-slate-100">{candidate.project_name}</strong> team</> : ''}.
          {' '}Here's where things stand.
        </div>
      </Card>

      <Card>
        <StatusHeadline status={status} currentStage={current_stage} />
      </Card>

      <Card>
        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-3">Your journey</div>
        <Timeline timeline={timeline} currentKey={current_stage?.stage_key} terminal={terminal} />
      </Card>

      <Card>
        <div className="text-sm text-slate-400 leading-relaxed">
          Have a question? <strong className="text-slate-200">Reply to the latest email you got from us</strong>.
          We'll get back to you as soon as we can.
        </div>
      </Card>
    </div>
  );
}

function StatusHeadline({ status, currentStage }) {
  if (status === 'hired') {
    return (
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/40 grid place-items-center shrink-0">
          <Sparkles size={18} className="text-emerald-300" />
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-100">You're hired - welcome aboard!</div>
          <div className="text-sm text-slate-400 mt-1">
            We're excited to work with you. Look out for onboarding details from your hiring manager.
          </div>
        </div>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/40 grid place-items-center shrink-0">
          <XIcon size={18} className="text-rose-300" />
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-100">We've moved forward with other candidates.</div>
          <div className="text-sm text-slate-400 mt-1">
            Thank you for the time you put into the process. We genuinely appreciate it and wish you the best.
          </div>
        </div>
      </div>
    );
  }
  if (status === 'withdrew') {
    return (
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-700/40 border border-slate-700 grid place-items-center shrink-0">
          <Circle size={18} className="text-slate-400" />
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-100">Application closed.</div>
          <div className="text-sm text-slate-400 mt-1">
            Thanks for your time. If you'd like to be considered for a future role, please reapply.
          </div>
        </div>
      </div>
    );
  }
  // Active
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-indigo-500/15 border border-indigo-500/40 grid place-items-center shrink-0">
        <CircleDot size={18} className="text-indigo-300" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-slate-100">
          Currently: {currentStage?.label || 'In progress'}
        </div>
        {currentStage?.what_to_expect && (
          <div className="text-sm text-slate-300 mt-1 leading-relaxed">
            {currentStage.what_to_expect}
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ timeline, currentKey, terminal }) {
  return (
    <ol className="relative space-y-3">
      {/* Vertical line behind the dots */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-slate-800/80" aria-hidden />
      {timeline.map((s) => (
        <TimelineRow key={s.stage_key} stage={s} isCurrent={!terminal && s.stage_key === currentKey} />
      ))}
    </ol>
  );
}

function TimelineRow({ stage, isCurrent }) {
  const { icon, ringCls } = (() => {
    if (stage.state === 'passed')       return { icon: <Check size={12} className="text-emerald-200" />, ringCls: 'bg-emerald-500/20 border-emerald-500/50' };
    if (stage.state === 'failed')       return { icon: <XIcon size={12} className="text-rose-200" />,    ringCls: 'bg-rose-500/20 border-rose-500/50' };
    if (stage.state === 'skipped')      return { icon: <SkipForward size={12} className="text-slate-400" />, ringCls: 'bg-slate-700/30 border-slate-700' };
    if (isCurrent)                      return { icon: <CircleDot size={12} className="text-indigo-200" />, ringCls: 'bg-indigo-500/25 border-indigo-500/60 ring-2 ring-indigo-500/30' };
    return { icon: <Circle size={12} className="text-slate-600" />, ringCls: 'bg-slate-900 border-slate-800' };
  })();

  const dateLabel = stage.completed_at
    ? new Date(stage.completed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : stage.started_at
    ? new Date(stage.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null;

  return (
    <li className="relative pl-8">
      <span className={`absolute left-0 top-0.5 w-6 h-6 rounded-full grid place-items-center border ${ringCls}`}>
        {icon}
      </span>
      <div className={`text-sm font-medium ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>
        {stage.label}
        {dateLabel && (
          <span className="text-[11px] text-slate-500 ml-2 tabular-nums font-normal">{dateLabel}</span>
        )}
      </div>
      {(isCurrent || stage.state === 'passed' || stage.state === 'in_progress') && stage.what_to_expect && (
        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{stage.what_to_expect}</div>
      )}
    </li>
  );
}

function Card({ children, tone = 'default' }) {
  const borderCls = tone === 'error' ? 'border-rose-500/30' : 'border-slate-800';
  return (
    <div className={`rounded-2xl border ${borderCls} bg-slate-900/60 backdrop-blur px-5 py-5 sm:px-6 sm:py-5 shadow-xl shadow-slate-950/40`}>
      {children}
    </div>
  );
}
