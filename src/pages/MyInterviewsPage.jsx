import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardCheck, AlertCircle, ArrowRight, Users, User as UserIcon } from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { STAGE_BY_KEY } from '../lib/pipeline.js';

const TABS = [
  { id: 'mine', label: 'Mine',  icon: UserIcon },
  { id: 'all',  label: 'All',   icon: Users },
];

export default function MyInterviewsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('mine');

  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle={
          tab === 'mine'
            ? 'Your assigned rounds and pending feedback.'
            : 'All assignments across the team. Useful for spotting overdue feedback.'
        }
      />
      <div className="flex rounded-lg bg-slate-800/60 p-0.5 text-sm border border-slate-700 mb-4 max-w-xs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
              tab === id ? 'bg-slate-700 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {tab === 'mine' ? <MineView userId={user?.id} /> : <AllView />}
    </>
  );
}

function MineView({ userId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from('interviewer_assignments')
        .select(`
          id, pipeline_id, created_at,
          pipeline:candidate_pipeline (
            id, stage_key, state,
            candidate:candidates ( id, full_name, current_stage_key, status,
              role:roles ( id, title, project:hiring_projects ( id, name ) )
            )
          )
        `)
        .eq('interviewer_id', userId);
      if (error) throw error;

      const pipelineIds = (assignments || []).map((a) => a.pipeline_id);
      const { data: feedback } = await supabase
        .from('feedback')
        .select('id, pipeline_id, recommendation, submitted_at')
        .eq('interviewer_id', userId)
        .in('pipeline_id', pipelineIds.length ? pipelineIds : ['00000000-0000-0000-0000-000000000000']);
      const feedbackByPipeline = Object.fromEntries((feedback || []).map((f) => [f.pipeline_id, f]));
      return { assignments: assignments || [], feedbackByPipeline };
    },
  });

  if (isLoading) return <Spinner />;
  if (!data?.assignments?.length) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No assignments yet"
        description="When a hiring team assigns you as an interviewer for a candidate, you'll see them here."
      />
    );
  }

  const pending = data.assignments.filter((a) => !data.feedbackByPipeline[a.pipeline_id]);
  const submitted = data.assignments.filter((a) => data.feedbackByPipeline[a.pipeline_id]);

  return (
    <>
      {pending.length > 0 && (
        <Card className="mb-4" padding={false}>
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-400" />
            <span className="text-sm font-medium text-slate-200">Feedback pending ({pending.length})</span>
          </div>
          <AssignmentList rows={pending} feedbackByPipeline={data.feedbackByPipeline} />
        </Card>
      )}

      {submitted.length > 0 && (
        <Card padding={false}>
          <div className="px-4 py-2.5 border-b border-slate-800">
            <span className="text-sm font-medium text-slate-200">Already submitted ({submitted.length})</span>
          </div>
          <AssignmentList rows={submitted} feedbackByPipeline={data.feedbackByPipeline} />
        </Card>
      )}
    </>
  );
}

function AllView() {
  const { data, isLoading } = useQuery({
    queryKey: ['all-interviews'],
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from('interviewer_assignments')
        .select(`
          id, pipeline_id, interviewer_id, created_at,
          interviewer:profiles!interviewer_assignments_interviewer_id_fkey ( id, full_name, email ),
          pipeline:candidate_pipeline (
            id, stage_key, state,
            candidate:candidates ( id, full_name, current_stage_key, status,
              role:roles ( id, title, project:hiring_projects ( id, name ) )
            )
          )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const pipelineIds = [...new Set((assignments || []).map((a) => a.pipeline_id))];
      const interviewerIds = [...new Set((assignments || []).map((a) => a.interviewer_id))];

      const { data: feedback } = await supabase
        .from('feedback')
        .select('id, pipeline_id, interviewer_id, recommendation, submitted_at')
        .in('pipeline_id', pipelineIds.length ? pipelineIds : ['00000000-0000-0000-0000-000000000000']);

      // Index by "pipeline_id|interviewer_id"
      const fbKey = (a) => `${a.pipeline_id}|${a.interviewer_id}`;
      const feedbackByKey = {};
      (feedback || []).forEach((f) => { feedbackByKey[`${f.pipeline_id}|${f.interviewer_id}`] = f; });

      return { assignments: assignments || [], feedbackByKey, fbKey };
    },
  });

  if (isLoading) return <Spinner />;
  if (!data?.assignments?.length) {
    return (
      <EmptyState
        icon={Users}
        title="No assignments anywhere yet"
        description="When the hiring team starts assigning interviewers, they'll show up here."
      />
    );
  }

  // Group by candidate
  const byCandidate = new Map();
  for (const a of data.assignments) {
    const c = a.pipeline?.candidate;
    if (!c) continue;
    if (!byCandidate.has(c.id)) byCandidate.set(c.id, { candidate: c, rows: [] });
    byCandidate.get(c.id).rows.push(a);
  }

  return (
    <Card padding={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <th className="px-4 py-2.5 font-medium">Candidate</th>
              <th className="px-4 py-2.5 font-medium">Role / Project</th>
              <th className="px-4 py-2.5 font-medium">Stage</th>
              <th className="px-4 py-2.5 font-medium">Interviewer</th>
              <th className="px-4 py-2.5 font-medium">Feedback</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.assignments.map((a) => {
              const c = a.pipeline?.candidate;
              if (!c) return null;
              const fb = data.feedbackByKey[`${a.pipeline_id}|${a.interviewer_id}`];
              return (
                <tr key={a.id} className="border-b border-slate-800/60 hover:bg-slate-900/40 transition">
                  <td className="px-4 py-2.5">
                    <Link to={`/candidates/${c.id}`} className="text-slate-100 font-medium hover:text-indigo-300">
                      {c.full_name || '(no name)'}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200">{c.role?.title || '—'}</div>
                    <div className="text-[11px] text-slate-500">{c.role?.project?.name}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StageBadge stageKey={a.pipeline?.stage_key} state={a.pipeline?.state} size="sm" />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200 text-xs">{a.interviewer?.full_name || a.interviewer?.email || '—'}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {fb ? <RecommendationBadge value={fb.recommendation} /> : <span className="text-[11px] text-amber-300">Pending</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to={`/candidates/${c.id}`} className="text-slate-500 hover:text-indigo-300">
                      <ArrowRight size={14} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AssignmentList({ rows, feedbackByPipeline }) {
  return (
    <div className="divide-y divide-slate-800/60">
      {rows.map((a) => {
        const c = a.pipeline?.candidate;
        const stage = STAGE_BY_KEY[a.pipeline?.stage_key];
        const fb = feedbackByPipeline[a.pipeline_id];
        if (!c) return null;
        return (
          <Link
            key={a.id}
            to={`/candidates/${c.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-900/60 transition"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {c.role?.title} · {c.role?.project?.name}
              </div>
            </div>
            <div className="hidden sm:block">
              <StageBadge stageKey={a.pipeline?.stage_key} state={a.pipeline?.state} size="sm" />
            </div>
            <div className="hidden md:block text-[11px] text-slate-500">
              {stage?.label}
            </div>
            <div>{fb ? <RecommendationBadge value={fb.recommendation} /> : <span className="text-[11px] text-amber-300">Pending</span>}</div>
            <ArrowRight size={14} className="text-slate-500" />
          </Link>
        );
      })}
    </div>
  );
}
