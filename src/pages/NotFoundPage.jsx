import React from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] grid place-items-center text-center">
      <div>
        <div className="text-6xl font-bold text-slate-100">404</div>
        <div className="text-sm text-slate-400 mt-2">That page doesn't exist.</div>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200"
        >
          <Home size={14} /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
