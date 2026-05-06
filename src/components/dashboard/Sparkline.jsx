import React from 'react';

/** Tiny inline-SVG sparkline. Renders 0 if no data. */
export default function Sparkline({ values = [], width = 64, height = 20, color = '#a5b4fc' }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`).join(' ');
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polygon points={area} fill={color} fillOpacity="0.15" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
