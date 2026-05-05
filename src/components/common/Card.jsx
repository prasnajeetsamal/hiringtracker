import React from 'react';
import clsx from 'clsx';

export default function Card({ className, children, padding = true }) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/40 backdrop-blur shadow-xl shadow-slate-950/40',
        padding && 'p-5',
        className
      )}
    >
      {children}
    </div>
  );
}
