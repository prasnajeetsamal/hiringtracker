import React from 'react';
import clsx from 'clsx';

const STYLES = {
  strong_hire:    { label: 'Strong Hire',    cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40' },
  hire:           { label: 'Hire',           cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  no_hire:        { label: 'No Hire',        cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  strong_no_hire: { label: 'Strong No Hire', cls: 'bg-rose-500/15 text-rose-200 border-rose-500/40' },
  HIRE:           { label: 'Hire',           cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40' },
  CONSIDER:       { label: 'Consider',       cls: 'bg-amber-500/15 text-amber-200 border-amber-500/40' },
  REJECT:         { label: 'Reject',         cls: 'bg-rose-500/15 text-rose-200 border-rose-500/40' },
};

export default function RecommendationBadge({ value }) {
  if (!value) return null;
  const { label, cls } = STYLES[value] || { label: value, cls: 'bg-slate-800 text-slate-300 border-slate-700' };
  return (
    <span className={clsx('inline-flex items-center rounded-full border text-[11px] px-2 py-0.5 font-medium', cls)}>
      {label}
    </span>
  );
}
