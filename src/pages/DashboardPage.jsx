import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Users, Briefcase, ClipboardCheck } from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-800/80 grid place-items-center text-indigo-300">
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="text-2xl font-semibold text-slate-100 mt-0.5">{value}</div>
          {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [projects, roles, candidates] = await Promise.all([
        supabase.from('hiring_projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('roles').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      return {
        projects: projects.count ?? 0,
        roles: roles.count ?? 0,
        candidates: candidates.count ?? 0,
      };
    },
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="An at-a-glance view of your hiring pipeline."
      />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat icon={FolderKanban} label="Active projects" value={data?.projects ?? 0} />
          <Stat icon={Briefcase} label="Open roles" value={data?.roles ?? 0} />
          <Stat icon={Users} label="Active candidates" value={data?.candidates ?? 0} />
          <Stat icon={ClipboardCheck} label="My pending feedback" value="—" hint="Wired in v1.0" />
        </div>
      )}
      <Card className="mt-6">
        <div className="text-sm text-slate-400">
          v0.1 walking skeleton. Next up: stages, interviewer assignments, feedback, calendar.
        </div>
      </Card>
    </>
  );
}
