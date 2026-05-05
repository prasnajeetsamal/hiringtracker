import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Briefcase, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';
import { STAGES } from '../lib/pipeline.js';

export default function RoleDetailPage() {
  const { projectId, roleId } = useParams();
  const qc = useQueryClient();

  const { data: role, isLoading } = useQuery({
    queryKey: ['role', roleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, project_id, sr_number, title, location, level, status, jd_html, jd_source, stage_config')
        .eq('id', roleId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [draft, setDraft] = useState({ jd_html: '', sr_number: '', title: '', location: '', level: '' });
  useEffect(() => {
    if (role) {
      setDraft({
        jd_html: role.jd_html || '',
        sr_number: role.sr_number || '',
        title: role.title || '',
        location: role.location || '',
        level: role.level || '',
      });
    }
  }, [role]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('roles')
        .update({
          jd_html: draft.jd_html,
          sr_number: draft.sr_number || null,
          title: draft.title,
          location: draft.location || null,
          level: draft.level || null,
        })
        .eq('id', roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Role saved');
      qc.invalidateQueries({ queryKey: ['role', roleId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (!role) return <div className="text-slate-400">Role not found.</div>;

  const stageConfig = Array.isArray(role.stage_config) ? role.stage_config : [];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to={`/projects/${projectId}`} className="inline-flex items-center gap-1 hover:text-slate-300">
            <ArrowLeft size={11} /> Back to project
          </Link>
        }
        title={role.title}
        subtitle="Edit the role and its job description. Pipeline + candidates land here in v0.5."
        actions={<Button icon={Save} onClick={() => save.mutate()} loading={save.isPending}>Save</Button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3 text-slate-200">
            <FileText size={16} className="text-indigo-300" /> <span className="font-medium">Job description</span>
          </div>
          <p className="text-xs text-slate-400 mb-2">
            Plain-text for now. v0.5 swaps this for a rich-text editor and a JD template picker.
          </p>
          <textarea
            value={draft.jd_html}
            onChange={(e) => setDraft({ ...draft, jd_html: e.target.value })}
            rows={20}
            placeholder="Paste or write the job description here…"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono leading-relaxed"
          />
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3 text-slate-200">
              <Briefcase size={16} className="text-indigo-300" /> <span className="font-medium">Role details</span>
            </div>
            <div className="space-y-3">
              <Field label="Title">
                <Input value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
              </Field>
              <Field label="SR number">
                <Input value={draft.sr_number} onChange={(v) => setDraft({ ...draft, sr_number: v })} placeholder="e.g. SR-12345" />
              </Field>
              <Field label="Level">
                <Input value={draft.level} onChange={(v) => setDraft({ ...draft, level: v })} />
              </Field>
              <Field label="Location">
                <Input value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
              </Field>
            </div>
          </Card>

          <Card>
            <div className="text-slate-200 font-medium mb-2">Pipeline stages</div>
            <p className="text-xs text-slate-400 mb-3">
              Default stages for this role. Per-role customization (skip / what-to-expect) lands in v0.5.
            </p>
            <ol className="space-y-1.5 text-sm">
              {STAGES.map((s, i) => {
                const cfg = stageConfig.find((c) => c.stage_key === s.key);
                const enabled = cfg?.enabled !== false;
                return (
                  <li
                    key={s.key}
                    className={`flex items-center gap-2 ${enabled ? 'text-slate-200' : 'text-slate-500 line-through'}`}
                  >
                    <span className="w-5 text-[11px] text-slate-500">{i + 1}.</span>
                    <span>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Input({ value, onChange, ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      {...rest}
    />
  );
}
