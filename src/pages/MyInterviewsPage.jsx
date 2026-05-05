import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardCheck, AlertCircle, ArrowRight } from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { STAGE_BY_KEY } from '../lib/pipeline.js';

export default function MyInterviewsPage() {
  const { user } = useAuth();

  // All my assignments + the candidate + role + my feedback (if any)
  const { data, isLoading } = useQuery({
    queryKey: ['my-interviews', user?.id],
    enabled: !!user,
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
        .eq('interviewer_id', user.id);
      if (error) throw error;

      const pipelineIds = (assignments || []).map((a) => a.pipeline_id);
      const { data: feedback } = await supabase
        .from('feedback')
        .select('id, pipeline_id, recommendation, submitted_at')
        .eq('interviewer_id', user.id)
        .in('pipeline_id', pipelineIds.length ? pipelineIds : ['00000000-0000-0000-0000-000000000000']);
      const feedbackByPipeline = Object.fromEntries((feedback || []).map((f) => [f.pipeline_id, f]));
      return { assignments: assignments || [], feedbackByPipeline };
    },
  });

  if (isLoading) return <Spinner />;
  if (!data?.assignments?.length) {
    return (
      <>
        <PageHeader title="My Interviews" subtitle="Your assigned rounds and pending feedback." />
        <EmptyState
          icon={ClipboardCheck}
          title="No assignments yet"
          description="When a hiring team assigns you as an interviewer for a candidate, you'll see them here."
        />
      </>
    );
  }

  const pending = data.assignments.filter((a) => !data.feedbackByPipeline[a.pipeline_id]);
  const submitted = data.assignments.filter((a) => data.feedbackByPipeline[a.pipeline_id]);

  return (
    <>
      <PageHeader
        title="My Interviews"
        subtitle={`${pending.length} pending feedback · ${submitted.length} submitted`}
      />

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
