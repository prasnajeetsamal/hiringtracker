import React from 'react';
import { STAGES } from '../../lib/pipeline.js';

const COLORS = ['#6366f1', '#7c5cf5', '#9333ea', '#a855f7', '#c026d3', '#db2777', '#ec4899'];

/**
 * Renders a stage-by-stage breakdown showing:
 *   - candidates currently at the stage (active)
 *   - candidates that passed through (passed)
 *   - candidates rejected at the stage (failed)
 *   - drop-off % between consecutive stages
 */
export default function StageBreakdown({ active, passed, failed, skipped }) {
  const total = STAGES.reduce((sum, s) => sum + (active[s.key] || 0) + (passed[s.key] || 0) + (failed[s.key] || 0), 0);
  const max = Math.max(1, ...STAGES.map((s) => (active[s.key] || 0) + (passed[s.key] || 0) + (failed[s.key] || 0)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-12 text-[10px] uppercase tracking-wider text-slate-500 px-2">
        <div className="col-span-3">Stage</div>
        <div className="col-span-5">Distribution</div>
        <div className="col-span-1 text-right">Here</div>
        <div className="col-span-1 text-right">Passed</div>
        <div className="col-span-1 text-right">Rejected</div>
        <div className="col-span-1 text-right">Skipped</div>
      </div>
      {STAGES.map((s, i) => {
        const here = active[s.key] || 0;
        const pass = passed[s.key] || 0;
        const rej = failed[s.key] || 0;
        const skp = skipped[s.key] || 0;
        const all = here + pass + rej;
        const widthPct = (all / max) * 100;
        const color = COLORS[i];
        return (
          <div key={s.key} className="grid grid-cols-12 items-center gap-2 px-2">
            <div className="col-span-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-slate-200">{s.label}</span>
            </div>
            <div className="col-span-5 h-5 rounded-md bg-slate-900/60 border border-slate-800 overflow-hidden flex">
              {all > 0 && (
                <>
                  <div style={{ width: `${(here / all) * widthPct}%`, backgroundColor: color, opacity: 0.95 }} />
                  <div style={{ width: `${(pass / all) * widthPct}%`, backgroundColor: '#34d399', opacity: 0.7 }} />
                  <div style={{ width: `${(rej / all) * widthPct}%`, backgroundColor: '#f87171', opacity: 0.7 }} />
                </>
              )}
            </div>
            <div className="col-span-1 text-right text-xs tabular-nums text-slate-200">{here || '—'}</div>
            <div className="col-span-1 text-right text-xs tabular-nums text-emerald-300">{pass || '—'}</div>
            <div className="col-span-1 text-right text-xs tabular-nums text-rose-300">{rej || '—'}</div>
            <div className="col-span-1 text-right text-xs tabular-nums text-slate-500">{skp || '—'}</div>
          </div>
        );
      })}
      <div className="px-2 pt-2 border-t border-slate-800 text-[11px] text-slate-500">
        Total transitions: <strong className="text-slate-200">{total}</strong> ·
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-indigo-400" /> currently here
        </span>
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> passed through
        </span>
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-400" /> rejected here
        </span>
      </div>
    </div>
  );
}
