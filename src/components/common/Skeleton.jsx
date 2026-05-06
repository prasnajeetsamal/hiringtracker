import React from 'react';
import clsx from 'clsx';

/** Shimmering placeholder block. Use for loading states instead of a centered spinner. */
export default function Skeleton({ className }) {
  return (
    <div
      className={clsx(
        'rounded-md bg-slate-800/60 relative overflow-hidden',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite]',
        'before:bg-gradient-to-r before:from-transparent before:via-slate-700/60 before:to-transparent',
        className
      )}
    />
  );
}

export function SkeletonRows({ rows = 4, height = 'h-10' }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`${height} w-full`} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 6, className = 'h-32' }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}
