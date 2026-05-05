import React from 'react';
import { Loader2 } from 'lucide-react';

export default function Spinner({ label = 'Loading…', size = 18 }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <Loader2 size={size} className="animate-spin text-indigo-400" />
      <span>{label}</span>
    </div>
  );
}
