import React from 'react';

/**
 * Distribution of AI scores split into 10-point buckets.
 *
 * scores: number[]  - array of ai_score values (numbers only)
 */
export default function ScoreHistogram({ scores = [] }) {
  const buckets = Array.from({ length: 10 }, () => 0);
  scores.forEach((s) => {
    if (typeof s !== 'number') return;
    const b = Math.min(9, Math.max(0, Math.floor(s / 10)));
    buckets[b] += 1;
  });
  const max = Math.max(1, ...buckets);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-10 gap-1 items-end h-32">
        {buckets.map((count, i) => {
          const heightPct = (count / max) * 100;
          // Color gradient - red (low) -> amber (mid) -> emerald (high)
          const color = i < 4 ? '#f87171' : i < 7 ? '#fbbf24' : '#34d399';
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="text-[10px] text-slate-300 tabular-nums" style={{ minHeight: 12 }}>
                {count > 0 ? count : ''}
              </div>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${heightPct}%`,
                    minHeight: count > 0 ? 4 : 0,
                    background: `linear-gradient(180deg, ${color}cc, ${color}66)`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-10 gap-1">
        {buckets.map((_, i) => (
          <div key={i} className="text-center text-[9px] text-slate-500 tabular-nums">
            {i * 10}-{i * 10 + 9}
          </div>
        ))}
      </div>
    </div>
  );
}
