import React from 'react';

/** A small circular progress gauge that represents an AI score 0-100. */
export default function ScoreGauge({ score = 0, size = 38, stroke = 4 }) {
  const safe = Math.max(0, Math.min(100, score || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - (safe / 100) * c;

  const tone = safe >= 80 ? '#34d399' : safe >= 65 ? '#fbbf24' : '#f87171';

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(51,65,85,0.6)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <span className="absolute text-[10px] font-semibold tabular-nums" style={{ color: tone }}>
        {safe}
      </span>
    </div>
  );
}
