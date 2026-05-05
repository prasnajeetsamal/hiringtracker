import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Save } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import { STAGES, defaultStageConfig } from '../../lib/pipeline.js';
import { supabase } from '../../lib/supabase.js';

export default function StageCustomizer({ open, onClose, roleId, stageConfig }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (open) {
      const cfg = (Array.isArray(stageConfig) && stageConfig.length > 0) ? stageConfig : defaultStageConfig();
      // Ensure every default stage exists in the draft, in canonical order
      const map = new Map(cfg.map((c) => [c.stage_key, c]));
      setDraft(STAGES.map((s) => {
        const existing = map.get(s.key) || {};
        return {
          stage_key: s.key,
          label: s.label,
          enabled: existing.enabled !== false,
          what_to_expect: existing.what_to_expect || s.whatToExpect,
        };
      }));
    }
  }, [open, stageConfig]);

  const save = useMutation({
    mutationFn: async () => {
      const cfg = draft.map(({ label, ...rest }) => rest);
      const { error } = await supabase
        .from('roles')
        .update({ stage_config: cfg })
        .eq('id', roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Pipeline saved');
      qc.invalidateQueries({ queryKey: ['role', roleId] });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize pipeline"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Save} onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        </>
      }
    >
      <p className="text-xs text-slate-400 mb-4">
        Toggle stages off to skip them for every new candidate on this role. Edit the "what to expect" copy candidates and interviewers will see.
      </p>
      <div className="space-y-3">
        {draft.map((s, i) => (
          <div key={s.stage_key} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...next[i], enabled: e.target.checked };
                  setDraft(next);
                }}
                className="w-4 h-4 accent-indigo-500"
              />
              <div className={`text-sm font-medium flex-1 ${s.enabled ? 'text-slate-100' : 'text-slate-500 line-through'}`}>
                {i + 1}. {s.label}
              </div>
              <Settings2 size={12} className="text-slate-500" />
            </div>
            {s.enabled && (
              <textarea
                value={s.what_to_expect}
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...next[i], what_to_expect: e.target.value };
                  setDraft(next);
                }}
                rows={2}
                className="mt-2 w-full bg-slate-950/60 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="What to expect in this round…"
              />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
