import React from 'react';
import { Sparkles, Calendar } from 'lucide-react';

function timeGreeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Working late';
}

function pickHeadline({ pendingFeedback, openRoles, activeCandidates }) {
  if (pendingFeedback > 0) {
    return {
      label: `You have ${pendingFeedback} pending interview ${pendingFeedback === 1 ? 'feedback' : 'feedbacks'}`,
      tone: 'amber',
    };
  }
  if (activeCandidates === 0 && openRoles > 0) {
    return { label: `${openRoles} open ${openRoles === 1 ? 'role' : 'roles'} waiting on candidates`, tone: 'indigo' };
  }
  if (activeCandidates > 0) {
    return { label: `${activeCandidates} active ${activeCandidates === 1 ? 'candidate' : 'candidates'} in motion`, tone: 'emerald' };
  }
  return { label: 'A fresh start. Create a project to begin.', tone: 'indigo' };
}

export default function HeroCard({ name, kpis, today = new Date() }) {
  const headline = pickHeadline(kpis);
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/40 p-6 mb-5 shadow-xl shadow-slate-950/40">
      <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-pink-500/15 blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
          <Calendar size={12} /> {dateLabel}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100">
          {timeGreeting(today)}{name ? `, ${name.split(' ')[0]}` : ''}.
        </h1>
        <div className="mt-2 inline-flex items-center gap-2 text-sm text-slate-300">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white">
            <Sparkles size={12} />
          </span>
          {headline.label}
        </div>
      </div>
    </div>
  );
}
