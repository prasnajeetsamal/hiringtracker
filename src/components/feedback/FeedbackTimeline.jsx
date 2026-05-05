import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import RecommendationBadge from '../candidates/RecommendationBadge.jsx';
import { STAGE_BY_KEY } from '../../lib/pipeline.js';

export default function FeedbackTimeline({ candidateId, pipelineRows }) {
  const pipelineIds = (pipelineRows || []).map((p) => p.id);
  const { data: feedback } = useQuery({
    queryKey: ['feedback-timeline', candidateId, pipelineIds.join(',')],
    enabled: pipelineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feedback')
        .select(`
          id, pipeline_id, recommendation, rating, body_html, submitted_at,
          interviewer:profiles!feedback_interviewer_id_fkey ( id, full_name, email )
        `)
        .in('pipeline_id', pipelineIds);
      if (error) throw error;
      return data;
    },
  });

  const byPipeline = (feedback || []).reduce((acc, f) => {
    (acc[f.pipeline_id] ||= []).push(f);
    return acc;
  }, {});

  const grouped = (pipelineRows || [])
    .map((p) => ({ ...p, feedback: byPipeline[p.id] || [] }))
    .filter((p) => p.feedback.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">No feedback submitted yet.</div>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map((p) => (
        <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-400 mb-2 font-medium">
            {STAGE_BY_KEY[p.stage_key]?.label || p.stage_key}
          </div>
          <div className="space-y-3">
            {p.feedback.map((f) => (
              <div key={f.id} className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-slate-200 font-medium">
                    {f.interviewer?.full_name || f.interviewer?.email || 'Interviewer'}
                  </span>
                  <RecommendationBadge value={f.recommendation} />
                  {f.rating && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-300">
                      <Star size={10} /> {f.rating}/5
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500 ml-auto">
                    {new Date(f.submitted_at).toLocaleDateString()}
                  </span>
                </div>
                {f.body_html && (
                  <div
                    className="jd-prose text-slate-300 text-sm"
                    dangerouslySetInnerHTML={{ __html: f.body_html }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
