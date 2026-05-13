import React from 'react';

// Compact daily activity strip for the Reports page. Each column is a day;
// each column has up to three stacked segments (added / advanced / rejected).
// Hover shows the breakdown for that day. Designed for ~60 days at a glance.
//
// Props:
//   days: [{ date: Date, added: number, advanced: number, rejected: number }]
export default function ActivityHeatmap({ days = [] }) {
  if (days.length === 0) {
    return <div className="text-sm text-slate-500 italic">No activity yet.</div>;
  }

  // Scale: the tallest day in the window sets the 100% mark. We use the SUM
  // (added+advanced+rejected) so visually-similar-height columns mean
  // similar total throughput regardless of composition.
  const maxTotal = Math.max(1, ...days.map((d) => d.added + d.advanced + d.rejected));

  const totalAdded = days.reduce((s, d) => s + d.added, 0);
  const totalAdvanced = days.reduce((s, d) => s + d.advanced, 0);
  const totalRejected = days.reduce((s, d) => s + d.rejected, 0);
  const busiestDay = days.reduce((best, d) => {
    const total = d.added + d.advanced + d.rejected;
    return total > (best?.total || 0) ? { ...d, total } : best;
  }, null);

  // Pick a tick every ~10 days for the axis labels.
  const ticks = days
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i === 0 || i === days.length - 1 || i % 10 === 9);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Added <strong className="text-slate-200 ml-1 tabular-nums">{totalAdded}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Advanced <strong className="text-slate-200 ml-1 tabular-nums">{totalAdvanced}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Rejected <strong className="text-slate-200 ml-1 tabular-nums">{totalRejected}</strong>
        </span>
        {busiestDay && busiestDay.total > 0 && (
          <span className="ml-auto text-slate-500">
            Busiest day: <strong className="text-slate-300">{busiestDay.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</strong> ({busiestDay.total} events)
          </span>
        )}
      </div>

      <div className="relative w-full h-24 bg-slate-950/40 border border-slate-800 rounded-lg p-1.5 flex items-end gap-px overflow-hidden">
        {days.map((d, i) => {
          const total = d.added + d.advanced + d.rejected;
          const colHeight = (total / maxTotal) * 100; // % of container height
          const segPct = (n) => total > 0 ? (n / total) * 100 : 0;
          const title = `${d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}\n+${d.added} added, +${d.advanced} advanced, ${d.rejected} rejected`;
          return (
            <div
              key={i}
              title={title}
              className="flex-1 min-w-[3px] h-full flex flex-col-reverse rounded-sm overflow-hidden cursor-help"
            >
              {total === 0 ? (
                <div className="w-full h-full bg-slate-800/20" />
              ) : (
                <div className="w-full flex flex-col-reverse" style={{ height: `${Math.max(2, colHeight)}%` }}>
                  {d.added    > 0 && <div className="w-full bg-indigo-500"  style={{ height: `${segPct(d.added)}%` }} />}
                  {d.advanced > 0 && <div className="w-full bg-emerald-500" style={{ height: `${segPct(d.advanced)}%` }} />}
                  {d.rejected > 0 && <div className="w-full bg-rose-500"    style={{ height: `${segPct(d.rejected)}%` }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative h-3 text-[10px] text-slate-500">
        {ticks.map(({ d, i }) => (
          <span
            key={i}
            className="absolute tabular-nums"
            style={{ left: `${(i / Math.max(1, days.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}
          >
            {d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        ))}
      </div>
    </div>
  );
}
