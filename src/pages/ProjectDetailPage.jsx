import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Briefcase, ArrowLeft, ArrowRight, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import Spinner from '../components/common/Spinner.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { SkeletonGrid } from '../components/common/Skeleton.jsx';
import { supabase } from '../lib/supabase.js';
import { defaultStageConfig } from '../lib/pipeline.js';
import { deleteProject } from '../lib/api.js';
import { useIsAdmin } from '../lib/useIsAdmin.js';

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [form, setForm] = useState({ sr_number: '', title: '', location: '', level: '' });

  const remove = useMutation({
    mutationFn: async () => deleteProject({ projectId }),
    onSuccess: () => {
      toast.success('Project deleted');
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/projects');
    },
    onError: (e) => toast.error(e.message),
  });

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
      const [rolesRes, candidatesRes] = await Promise.all([
        supabase.from('roles')
          .select('id, sr_number, title, location, level, status, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
        supabase.from('candidates')
          .select('id, role_id, status'),
      ]);
      if (rolesRes.error) throw rolesRes.error;
      const counts = {};
      (candidatesRes.data || []).forEach((c) => {
        if (c.status !== 'active') return;
        counts[c.role_id] = (counts[c.role_id] || 0) + 1;
      });
      return (rolesRes.data || []).map((r) => ({ ...r, activeCandidates: counts[r.id] || 0 }));
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
        actions={
          <>
            <Button icon={Plus} onClick={() => setOpen(true)}>New role</Button>
            {isAdmin && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)}>
                Delete project
              </Button>
            )}
          </>
        }
      />

      {rolesLoading ? (
        <SkeletonGrid count={6} className="h-36" />
      ) : !roles?.length ? (
        <EmptyState
          icon={Briefcase}
          title="No roles in this project yet"
          description="Add an open role to start collecting candidates."
          action={<Button icon={Plus} onClick={() => setOpen(true)}>Add role</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((r) => {
            const STATUS_TONE = {
              open:    'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
              on_hold: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
              filled:  'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
              closed:  'bg-slate-800 text-slate-400 border-slate-700',
            };
            const tone = STATUS_TONE[r.status] || STATUS_TONE.closed;
            return (
              <Link key={r.id} to={`/projects/${projectId}/roles/${r.id}`} className="group">
                <Card className="h-full hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition relative overflow-hidden">
                  <div className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-violet-500/10 blur-3xl group-hover:bg-violet-500/20 transition" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] capitalize ${tone}`}>
                        {r.status.replace('_', ' ')}
                      </span>
                      <div className="text-base font-semibold text-slate-100 mt-1.5 truncate">{r.title}</div>
                      <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                        {r.sr_number && <span className="font-mono">SR {r.sr_number}</span>}
                        {r.level && <span>· {r.level}</span>}
                        {r.location && <span>· {r.location}</span>}
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5 transition shrink-0 mt-1" />
                  </div>
                  <div className="relative mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-xs text-slate-300">
                    <Users size={11} className="text-emerald-300" />
                    <span className="font-semibold text-slate-100 tabular-nums">{r.activeCandidates}</span>
                    <span className="text-slate-500">active {r.activeCandidates === 1 ? 'candidate' : 'candidates'}</span>
                  </div>
                </Card>
              </Link>
            );
          })}
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

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete project?"
        message={
          <>
            <p>This permanently removes <strong className="text-slate-100">{project.name}</strong>, every role within it, every candidate on those roles, all pipeline rows, feedback, comments, resume + JD files, and project memberships.</p>
            <p className="mt-2 text-rose-300 text-xs">This cannot be undone.</p>
          </>
        }
      />
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
