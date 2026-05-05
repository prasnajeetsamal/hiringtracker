import React from 'react';
import clsx from 'clsx';
import { STAGE_BY_KEY } from '../../lib/pipeline.js';

const STATE_STYLES = {
  pending:     'bg-slate-800 text-slate-300 border-slate-700',
  in_progress: 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40',
  passed:      'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  failed:      'bg-rose-500/15 text-rose-200 border-rose-500/40',
  skipped:     'bg-slate-800 text-slate-500 border-slate-700 line-through',
};

export default function StageBadge({ stageKey, state = 'pending', size = 'md' }) {
  const stage = STAGE_BY_KEY[stageKey];
  const label = stage?.short || stageKey || 'Unknown';
  const style = STATE_STYLES[state] || STATE_STYLES.pending;
  const sz = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border font-medium', style, sz)}>
      {label}
    </span>
  );
}
