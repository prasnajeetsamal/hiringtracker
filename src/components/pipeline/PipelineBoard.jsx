import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase.js';
import { STAGES, enabledStages } from '../../lib/pipeline.js';
import StageColumn from './StageColumn.jsx';
import Spinner from '../common/Spinner.jsx';
import EmptyState from '../common/EmptyState.jsx';
import { Users } from 'lucide-react';

export default function PipelineBoard({ roleId, stageConfig }) {
  const { data: candidates, isLoading } = useQuery({
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
  if (!candidates?.length) {
    return (
      <EmptyState
        icon={Users}
        title="No candidates yet"
        description="Click 'Add candidate' above to upload a resume or paste a LinkedIn URL."
      />
    );
  }

  const stages = enabledStages(stageConfig);
  const visibleKeys = new Set(stages.map((s) => s.key));

  // Bucket candidates: active candidates by current stage; rejected candidates pinned to their last stage.
  const buckets = {};
  STAGES.forEach((s) => { buckets[s.key] = []; });
  candidates.forEach((c) => {
    const k = c.current_stage_key || 'resume_submitted';
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(c);
  });

  return (
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
  );
}
