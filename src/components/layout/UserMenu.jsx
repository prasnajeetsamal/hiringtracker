// src/components/layout/UserMenu.jsx
import React, { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronDown, User as UserIcon, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';

function initialsFor(email = '') {
  const left = email.split('@')[0] || '';
  if (!left) return '?';
  const parts = left.split(/[._\-+]/).filter(Boolean);
  const a = parts[0]?.[0] || left[0];
  const b = parts[1]?.[0] || left[1] || '';
  return (a + b).toUpperCase().slice(0, 2);
}

export default function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;
  const email = user.email || '';
  const initials = initialsFor(email);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border border-slate-700 bg-slate-900/60 hover:bg-slate-800 transition"
        title={email}
      >
        <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-semibold text-white bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 shadow-sm">
          {initials}
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-800 bg-slate-900/95 backdrop-blur shadow-2xl shadow-slate-950/60 overflow-hidden z-40">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Signed in as</div>
            <div className="text-sm font-medium text-slate-100 truncate flex items-center gap-2 mt-0.5">
              <UserIcon size={14} className="text-slate-400 shrink-0" />
              <span className="truncate">{email}</span>
            </div>
          </div>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800/60 transition"
          >
            <Settings size={14} /> Settings
          </Link>
          <button
            onClick={async () => { setOpen(false); await signOut(); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-300 hover:bg-rose-500/10 transition"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
