import React from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Star, X } from 'lucide-react';

import { STAGE_BY_KEY } from '../../lib/pipeline.js';

export default function StageColumn({ stageKey, candidates }) {
  const stage = STAGE_BY_KEY[stageKey];
  return (
    <div className="flex-1 min-w-[220px] rounded-xl bg-slate-900/40 border border-slate-800 flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between">
        <div className="text-xs font-medium text-slate-200">{stage?.short || stageKey}</div>
        <div className="text-[10px] text-slate-500">{candidates.length}</div>
      </div>
      <div className="p-2 space-y-1.5 flex-1 min-h-[80px]">
        {candidates.length === 0 ? (
          <div className="text-[11px] text-slate-600 text-center py-3">—</div>
        ) : (
          candidates.map((c) => <CandidateCard key={c.id} candidate={c} />)
        )}
      </div>
    </div>
  );
}

function CandidateCard({ candidate }) {
  const score = candidate.ai_score;
  return (
    <Link
      to={`/candidates/${candidate.id}`}
      className={clsx(
        'block rounded-lg border px-2.5 py-2 transition',
        candidate.status === 'rejected'
          ? 'border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50'
          : candidate.status === 'hired'
          ? 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50'
          : 'border-slate-700 bg-slate-900/60 hover:border-indigo-500/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-slate-100 truncate font-medium">
          {candidate.full_name || 'Unnamed'}
        </div>
        {candidate.status === 'rejected' && <X size={12} className="text-rose-400 shrink-0 mt-0.5" />}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
        {typeof score === 'number' && (
          <span className="inline-flex items-center gap-0.5 text-amber-300">
            <Star size={9} /> {score}
          </span>
        )}
        {candidate.source && <span className="capitalize">{candidate.source}</span>}
      </div>
    </Link>
  );
}
