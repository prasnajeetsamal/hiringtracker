import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Briefcase, ArrowLeft, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';
import { defaultStageConfig } from '../lib/pipeline.js';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sr_number: '', title: '', location: '', level: '' });

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hiring_projects')
        .select('id, name, description, status, created_at')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, sr_number, title, location, level, status, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('Title is required.');
      const { data, error } = await supabase
        .from('roles')
        .insert({
          project_id: projectId,
          sr_number: form.sr_number.trim() || null,
          title: form.title.trim(),
          location: form.location.trim() || null,
          level: form.level.trim() || null,
          jd_source: 'inline',
          jd_html: '',
          stage_config: defaultStageConfig(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Role created');
      qc.invalidateQueries({ queryKey: ['roles', projectId] });
      setOpen(false);
      setForm({ sr_number: '', title: '', location: '', level: '' });
    },
    onError: (e) => toast.error(e.message),
  });

  if (projectLoading) return <Spinner />;
  if (!project) return <div className="text-slate-400">Project not found.</div>;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/projects" className="inline-flex items-center gap-1 hover:text-slate-300">
            <ArrowLeft size={11} /> All projects
          </Link>
        }
        title={project.name}
        subtitle={project.description || 'Open roles for this hiring project.'}
        actions={<Button icon={Plus} onClick={() => setOpen(true)}>New role</Button>}
      />

      {rolesLoading ? (
        <Spinner />
      ) : !roles?.length ? (
        <EmptyState
          icon={Briefcase}
          title="No roles in this project yet"
          description="Add an open role to start collecting candidates."
          action={<Button icon={Plus} onClick={() => setOpen(true)}>Add role</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((r) => (
            <Link key={r.id} to={`/projects/${projectId}/roles/${r.id}`} className="group">
              <Card className="h-full hover:border-indigo-500/40 transition">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-100 truncate">{r.title}</div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                      {r.sr_number && <span className="font-mono">SR {r.sr_number}</span>}
                      {r.level && <span>· {r.level}</span>}
                      {r.location && <span>· {r.location}</span>}
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-slate-500 group-hover:text-indigo-300 transition shrink-0 mt-1" />
                </div>
                <div className="mt-4 text-[11px] text-slate-500 capitalize">
                  status: {r.status}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New role"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Label text="SR number">
            <Input value={form.sr_number} onChange={(v) => setForm({ ...form, sr_number: v })} placeholder="e.g. SR-12345" />
          </Label>
          <Label text="Title">
            <Input value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Senior Software Engineer" autoFocus />
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label text="Level">
              <Input value={form.level} onChange={(v) => setForm({ ...form, level: v })} placeholder="L5 / Senior" />
            </Label>
            <Label text="Location">
              <Input value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="Remote, Bengaluru" />
            </Label>
          </div>
        </div>
      </Modal>
    </>
  );
}

function Label({ text, children }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{text}</div>
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
