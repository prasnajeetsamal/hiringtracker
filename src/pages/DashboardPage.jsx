import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Users, Briefcase, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';

function Stat({ icon: Icon, label, value, hint, to }) {
  const inner = (
    <>
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
    </>
  );
  return to ? (
    <Link to={to}>
      <Card className="hover:border-indigo-500/40 transition">{inner}</Card>
    </Link>
  ) : (
    <Card>{inner}</Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [projects, roles, candidates, myAssignments] = await Promise.all([
        supabase.from('hiring_projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('roles').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('interviewer_assignments').select('id, pipeline_id').eq('interviewer_id', user.id),
      ]);

      let pendingFeedback = 0;
      const pipelineIds = (myAssignments.data || []).map((a) => a.pipeline_id);
      if (pipelineIds.length) {
        const { data: fb } = await supabase
          .from('feedback')
          .select('pipeline_id')
          .eq('interviewer_id', user.id)
          .in('pipeline_id', pipelineIds);
        const submitted = new Set((fb || []).map((f) => f.pipeline_id));
        pendingFeedback = pipelineIds.filter((id) => !submitted.has(id)).length;
      }

      return {
        projects: projects.count ?? 0,
        roles: roles.count ?? 0,
        candidates: candidates.count ?? 0,
        pendingFeedback,
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
          <Stat icon={FolderKanban} label="Active projects" value={data?.projects ?? 0} to="/projects" />
          <Stat icon={Briefcase} label="Open roles" value={data?.roles ?? 0} to="/projects" />
          <Stat icon={Users} label="Active candidates" value={data?.candidates ?? 0} to="/candidates" />
          <Stat
            icon={ClipboardCheck}
            label="My pending feedback"
            value={data?.pendingFeedback ?? 0}
            hint={data?.pendingFeedback ? 'Submit before interviews stale-out' : 'You\'re all caught up'}
            to="/my-interviews"
          />
        </div>
      )}
    </>
  );
}
