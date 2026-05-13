import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';

const RECS = [
  { value: 'strong_hire',    label: 'Strong Hire',    short: 'S', cls: 'border-emerald-500/60 text-emerald-200 bg-emerald-500/10' },
  { value: 'hire',           label: 'Hire',           short: 'H', cls: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5' },
  { value: 'no_hire',        label: 'No Hire',        short: 'N', cls: 'border-rose-500/40 text-rose-300 bg-rose-500/5' },
  { value: 'strong_no_hire', label: 'Strong No Hire', short: 'X', cls: 'border-rose-500/60 text-rose-200 bg-rose-500/10' },
];
const KEY_TO_REC = Object.fromEntries(RECS.map((r) => [r.short.toLowerCase(), r.value]));

const draftKey = (pipelineId, interviewerId) => `slate.feedback-draft.${pipelineId}.${interviewerId}`;
const loadDraft = (pipelineId, interviewerId) => {
  try { return JSON.parse(localStorage.getItem(draftKey(pipelineId, interviewerId)) || 'null'); }
  catch { return null; }
};
const saveDraft = (pipelineId, interviewerId, value) => {
  try { localStorage.setItem(draftKey(pipelineId, interviewerId), JSON.stringify(value)); }
  catch { /* ignore quota errors */ }
};
const clearDraft = (pipelineId, interviewerId) => {
  try { localStorage.removeItem(draftKey(pipelineId, interviewerId)); }
  catch { /* ignore */ }
};

export default function FeedbackForm({ pipelineId, interviewerId, existing }) {
  const qc = useQueryClient();
  const [recommendation, setRecommendation] = useState('');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const containerRef = useRef(null);

  // On mount / when pipeline or existing record changes: prefer the saved
  // server record; fall back to a local draft if one exists.
  useEffect(() => {
    if (existing) {
      setRecommendation(existing.recommendation || '');
      setRating(existing.rating || 0);
      setBody(stripHtml(existing.body_html || ''));
      setHasDraft(false);
      return;
    }
    const draft = loadDraft(pipelineId, interviewerId);
    if (draft && (draft.recommendation || draft.rating || draft.body)) {
      setRecommendation(draft.recommendation || '');
      setRating(draft.rating || 0);
      setBody(draft.body || '');
      setHasDraft(true);
    } else {
      setRecommendation('');
      setRating(0);
      setBody('');
      setHasDraft(false);
    }
  }, [existing, pipelineId, interviewerId]);

  // Auto-save the in-progress draft. Skip when we have an `existing` record
  // (editing a submitted feedback shouldn't quietly write a competing draft).
  useEffect(() => {
    if (existing) return;
    const empty = !recommendation && !rating && !body.trim();
    if (empty) {
      clearDraft(pipelineId, interviewerId);
      setHasDraft(false);
      return;
    }
    saveDraft(pipelineId, interviewerId, { recommendation, rating, body });
    setHasDraft(true);
  }, [recommendation, rating, body, existing, pipelineId, interviewerId]);

  // Keyboard shortcuts: 1-5 set rating, H/S/N/X set recommendation. Ignore
  // events that originate from the textarea / inputs so notes-typing still
  // works normally.
  useEffect(() => {
    const onKey = (e) => {
      if (!containerRef.current) return;
      // Only act when focus is somewhere inside this form
      if (!containerRef.current.contains(document.activeElement)) return;
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      // Don't hijack typing inside the notes textarea or any input.
      if (tag === 'textarea' || tag === 'input' || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        setRating((prev) => (prev === Number(e.key) ? 0 : Number(e.key)));
        return;
      }
      const k = e.key.toLowerCase();
      if (KEY_TO_REC[k]) {
        e.preventDefault();
        setRecommendation((prev) => (prev === KEY_TO_REC[k] ? '' : KEY_TO_REC[k]));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
      clearDraft(pipelineId, interviewerId);
      setHasDraft(false);
      qc.invalidateQueries({ queryKey: ['feedback', pipelineId] });
      qc.invalidateQueries({ queryKey: ['my-feedback'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const discardDraft = () => {
    clearDraft(pipelineId, interviewerId);
    setRecommendation('');
    setRating(0);
    setBody('');
    setHasDraft(false);
  };

  return (
    <div ref={containerRef} tabIndex={-1} className="space-y-3 outline-none">
      {hasDraft && !existing && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
          <span>Restored unsaved draft.</span>
          <button onClick={discardDraft} className="text-amber-300 hover:text-amber-100 underline">
            Discard
          </button>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs text-slate-400">Recommendation</div>
          <div className="text-[10px] text-slate-500">shortcut: S / H / N / X</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {RECS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRecommendation(r.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition flex items-center justify-between ${
                recommendation === r.value
                  ? r.cls + ' ring-1 ring-current'
                  : 'border-slate-700 text-slate-400 bg-slate-900/40 hover:border-slate-600'
              }`}
            >
              <span>{r.label}</span>
              <span className="text-[10px] opacity-50 font-mono">{r.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs text-slate-400">Rating</div>
          <div className="text-[10px] text-slate-500">shortcut: 1 - 5</div>
        </div>
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

      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-slate-500">
          {!existing && (hasDraft ? 'Draft auto-saved locally.' : 'Type a recommendation key (S / H / N / X) or 1 - 5 to begin.')}
        </div>
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
