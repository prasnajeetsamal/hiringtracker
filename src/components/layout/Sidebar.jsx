// src/components/layout/Sidebar.jsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  CalendarDays,
  ClipboardCheck,
  FileText,
  ClipboardList,
  Sparkles,
  UserCog,
  FileBarChart,
  Clock,
} from 'lucide-react';

import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import UserMenu from './UserMenu.jsx';

// Sidebar pages grouped into two sections.
//   - "Hiring" - the pipeline-oriented day-to-day work
//   - "Tools" - supporting features (your calendar, your interviews, library)
// People is appended to "Tools" only for admins / managers / hiring team.
const SECTIONS = [
  {
    label: 'Hiring',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/projects', label: 'Hiring Projects', icon: FolderKanban },
      { to: '/candidates', label: 'Candidates', icon: Users },
      { to: '/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/my-interviews', label: 'Interviews', icon: ClipboardCheck },
      { to: '/jd-templates', label: 'JD Templates', icon: FileText },
    ],
  },
];

export default function Sidebar() {
  const { user } = useAuth();

  // Show "People" only to admin / hiring_manager / hiring_team. Interviewers don't need it.
  const { data: profile } = useQuery({
    queryKey: ['profile-role', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });
  const showPeople = profile?.role && ['admin', 'hiring_manager', 'hiring_team'].includes(profile.role);
  // Schedule management is admin / manager only - keeps the sidebar tidy for interviewers.
  const showScheduledReports = profile?.role && ['admin', 'hiring_manager'].includes(profile.role);

  // Pending feedback count → renders as a badge on the "Interviews" item.
  // Cheap query: assignments WHERE interviewer_id = me, then count those without feedback.
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['sidebar-pending-feedback', user?.id],
    enabled: !!user,
    refetchInterval: 60_000, // poll every minute so the badge stays fresh
    queryFn: async () => {
      const { data: assigns } = await supabase
        .from('interviewer_assignments')
        .select('id, pipeline_id')
        .eq('interviewer_id', user.id);
      const pipelineIds = (assigns || []).map((a) => a.pipeline_id);
      if (pipelineIds.length === 0) return 0;
      const { data: fb } = await supabase
        .from('feedback')
        .select('pipeline_id')
        .eq('interviewer_id', user.id)
        .in('pipeline_id', pipelineIds);
      const submitted = new Set((fb || []).map((f) => f.pipeline_id));
      return pipelineIds.filter((id) => !submitted.has(id)).length;
    },
  });

  // Build the live sections array, appending People to Tools when allowed.
  // Also attach a badge count to the "Interviews" item.
  const sections = SECTIONS.map((section) => {
    let items = section.items.map((it) =>
      it.to === '/my-interviews' ? { ...it, badge: pendingCount > 0 ? pendingCount : 0 } : it
    );
    if (section.label === 'Tools' && showScheduledReports) {
      items = [...items, { to: '/scheduled-reports', label: 'Scheduled Reports', icon: Clock }];
    }
    if (section.label === 'Tools' && showPeople) {
      items = [...items, { to: '/people', label: 'People', icon: UserCog }];
    }
    return { ...section, items };
  });

  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-slate-800/80 bg-slate-950/60 backdrop-blur">
      <div className="px-5 py-5 border-b border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 blur-md opacity-50" />
            <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-white grid place-items-center shadow-lg shadow-indigo-500/30">
              <ClipboardList size={18} />
            </div>
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight text-gradient">Slate</div>
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <Sparkles size={9} /> Hiring Tracker
            </div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {sections.map((section, sIdx) => (
          <div key={section.label} className={sIdx === 0 ? '' : 'mt-5'}>
            <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
                      isActive
                        ? 'bg-slate-800/80 text-slate-100 border border-slate-700/80'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent',
                    ].join(' ')
                  }
                >
                  <Icon size={16} />
                  <span className="flex-1">{label}</span>
                  {badge ? (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/40 tabular-nums">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-slate-800/60 space-y-2">
        <UserMenu variant="expanded" />
        <div className="text-[10px] text-slate-600 text-center">Slate v1.0</div>
      </div>
    </aside>
  );
}
