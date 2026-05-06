import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { STAGES, enabledStages } from '../../lib/pipeline.js';
import StageColumn from './StageColumn.jsx';
import Spinner from '../common/Spinner.jsx';
import EmptyState from '../common/EmptyState.jsx';

export default function PipelineBoard({ roleId, stageConfig }) {
  const qc = useQueryClient();

  const { data: candidates, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['candidates', roleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name, current_stage_key, status, ai_score, source, created_at')
        .eq('role_id', roleId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Spinner />;

  const stages = enabledStages(stageConfig);
  const visibleKeys = new Set(stages.map((s) => s.key));

  // Bucket candidates by current stage. Candidates whose stage is disabled
  // for this role still go into a fallback bucket so they're not lost.
  const buckets = {};
  STAGES.forEach((s) => { buckets[s.key] = []; });
  (candidates || []).forEach((c) => {
    const k = c.current_stage_key || 'resume_submitted';
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(c);
  });

  const empty = !candidates?.length;

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-slate-500">
          {candidates?.length || 0} candidate{candidates?.length === 1 ? '' : 's'}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
          title="Refresh candidates"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {empty ? (
        <EmptyState
          icon={Users}
          title="No candidates yet"
          description="Click 'Add candidate' above to upload a resume or paste a LinkedIn URL. If you just added one and don't see it, click Refresh, or run migration 0004 in Supabase if you haven't yet."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => (
            <StageColumn
              key={s.key}
              stageKey={s.key}
              candidates={buckets[s.key] || []}
            />
          ))}
          {STAGES.filter((s) => !visibleKeys.has(s.key)).length > 0 && (
            <div className="flex-1 min-w-[160px] rounded-xl border border-dashed border-slate-800 p-3 text-[11px] text-slate-500">
              {STAGES.filter((s) => !visibleKeys.has(s.key)).map((s) => s.short).join(', ')} skipped for this role
            </div>
          )}
        </div>
      )}
    </>
  );
}
