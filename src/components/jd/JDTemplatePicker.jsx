import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Sparkles } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import Spinner from '../common/Spinner.jsx';
import { supabase } from '../../lib/supabase.js';

export default function JDTemplatePicker({ open, onClose, onPick }) {
  const [selectedId, setSelectedId] = useState(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['jd-templates-picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_templates')
        .select('id, name, category, body_html, is_system')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const selected = templates?.find((t) => t.id === selectedId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pick a JD template"
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selected}
            onClick={() => { onPick(selected); onClose(); }}
          >
            Use this template
          </Button>
        </>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : !templates?.length ? (
        <div className="text-sm text-slate-400">No templates seeded yet. Run <code className="text-slate-200">supabase/migrations/0003_seed_templates.sql</code>.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[440px]">
          <div className="md:col-span-1 space-y-1.5 overflow-y-auto max-h-[440px]">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition ${
                  selectedId === t.id
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-indigo-300 shrink-0" />
                  <div className="text-sm font-medium text-slate-100 truncate">{t.name}</div>
                  {t.is_system && (
                    <Sparkles size={10} className="text-violet-300 shrink-0" />
                  )}
                </div>
                <div className="text-[11px] text-slate-500 capitalize mt-0.5">{t.category}</div>
              </button>
            ))}
          </div>
          <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/60 p-4 overflow-y-auto max-h-[440px]">
            {!selected ? (
              <div className="text-sm text-slate-500 grid place-items-center h-full">Select a template to preview</div>
            ) : (
              <>
                <div className="text-base font-semibold text-slate-100 mb-1">{selected.name}</div>
                <div className="text-[11px] text-slate-500 capitalize mb-3">{selected.category}{selected.is_system ? ' · system template' : ''}</div>
                <div className="jd-prose" dangerouslySetInnerHTML={{ __html: selected.body_html }} />
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
