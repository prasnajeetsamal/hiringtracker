import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';

const RECS = [
  { value: 'strong_hire',    label: 'Strong Hire',    cls: 'border-emerald-500/60 text-emerald-200 bg-emerald-500/10' },
  { value: 'hire',           label: 'Hire',           cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5' },
  { value: 'no_hire',        label: 'No Hire',        cls: 'border-rose-500/40 text-rose-300 bg-rose-500/5' },
  { value: 'strong_no_hire', label: 'Strong No Hire', cls: 'border-rose-500/60 text-rose-200 bg-rose-500/10' },
];

export default function FeedbackForm({ pipelineId, interviewerId, existing }) {
  const qc = useQueryClient();
  const [recommendation, setRecommendation] = useState('');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (existing) {
      setRecommendation(existing.recommendation || '');
      setRating(existing.rating || 0);
      setBody(stripHtml(existing.body_html || ''));
    } else {
      setRecommendation('');
      setRating(0);
      setBody('');
    }
  }, [existing, pipelineId]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!recommendation) throw new Error('Pick a recommendation.');
      const payload = {
        pipeline_id: pipelineId,
        interviewer_id: interviewerId,
        recommendation,
        rating: rating || null,
        body_html: body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : '',
        submitted_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('feedback')
        .upsert(payload, { onConflict: 'pipeline_id,interviewer_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Feedback saved');
      qc.invalidateQueries({ queryKey: ['feedback', pipelineId] });
      qc.invalidateQueries({ queryKey: ['my-feedback'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-slate-400 mb-1.5">Recommendation</div>
        <div className="grid grid-cols-2 gap-2">
          {RECS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRecommendation(r.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition ${
                recommendation === r.value
                  ? r.cls + ' ring-1 ring-current'
                  : 'border-slate-700 text-slate-400 bg-slate-900/40 hover:border-slate-600'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1.5">Rating</div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(rating === n ? 0 : n)}
              className={`w-8 h-8 rounded-md text-sm font-medium transition ${
                rating >= n
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'bg-slate-900/40 text-slate-500 border border-slate-700 hover:border-slate-600'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1.5">Notes</div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="What did the candidate do well? What were the gaps? Specific examples are best."
          className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => submit.mutate()} loading={submit.isPending}>
          {existing ? 'Update feedback' : 'Submit feedback'}
        </Button>
      </div>
    </div>
  );
}

const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const stripHtml = (s) =>
  String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
