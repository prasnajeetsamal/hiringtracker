import React from 'react';
import { STAGES } from '../../lib/pipeline.js';

// Hex stops the funnel rows interpolate through, indigo -> violet -> pink.
const STAGE_COLORS = [
  '#6366f1', // resume_submitted
  '#7c5cf5', // hm_review
  '#9333ea', // technical_written
  '#a855f7', // technical_interview
  '#c026d3', // problem_solving
  '#db2777', // case_study
  '#ec4899', // offer
];

/**
 * `current` = candidates currently AT this stage (active candidates only)
 * `everReached` = candidates that ever entered this stage (passed | in_progress | skipped)
 *                 used for drop-off math
 */
export default function PipelineFunnel({ currentByStage = {}, everReachedByStage = {} }) {
  const everArr = STAGES.map((s) => everReachedByStage[s.key] || 0);
  const max = Math.max(1, ...everArr, ...Object.values(currentByStage));

  return (
    <div className="space-y-2.5">
      {STAGES.map((s, i) => {
        const current = currentByStage[s.key] || 0;
        const ever = everReachedByStage[s.key] || 0;
        const widthPct = (ever / max) * 100;
        const currentPct = ever > 0 ? (current / ever) * 100 : 0;
        const prevEver = i > 0 ? everArr[i - 1] : null;
        const dropPct = prevEver && prevEver > 0 ? Math.round((1 - ever / prevEver) * 100) : null;
        const color = STAGE_COLORS[i];
        return (
          <div key={s.key}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-36 shrink-0">
                <span
                  className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-900"
                  style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}66` }}
                />
                <span className="text-xs text-slate-300 truncate">{s.label}</span>
              </div>

              <div className="flex-1 relative h-6 rounded-md bg-slate-900/60 border border-slate-800 overflow-hidden">
                {/* Ever-reached band (lighter) */}
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-700"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${color}33, ${color}55)`,
                  }}
                />
                {/* Currently-here band (darker, on top) */}
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-700"
                  style={{
                    width: `${(current / max) * 100}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-slate-200 font-medium tabular-nums">
                  {current > 0 && <span className="text-slate-100">{current}</span>}
                </div>
              </div>

              <div className="w-12 text-right text-[11px] tabular-nums text-slate-400 shrink-0">
                {ever}
              </div>
            </div>

            {dropPct !== null && dropPct > 0 && (
              <div className="ml-[154px] text-[10px] text-slate-500 mt-0.5">
                ↘ {dropPct}% drop
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3 pt-2 mt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: '#6366f1' }} />
          currently here
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: '#6366f155' }} />
          ever reached
        </span>
      </div>
    </div>
  );
}
