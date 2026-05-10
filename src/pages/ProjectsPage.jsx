import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, FolderKanban, ArrowRight, Archive, Briefcase, Users,
  Trash2, ArchiveRestore, MapPin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { SkeletonRows } from '../components/common/Skeleton.jsx';
import LocationFields, { formatLocation } from '../components/common/LocationFields.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { defaultStageConfig } from '../lib/pipeline.js';
import { deleteProject } from '../lib/api.js';

const ROLE_STATUS_TONE = {
  open:    'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  on_hold: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  filled:  'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  closed:  'bg-slate-800 text-slate-400 border-slate-700',
};

/**
 * Unified Projects + ProjectDetail page rendered as a master/detail split.
 *
 *   /projects              → list visible, right panel shows "Pick a project"
 *   /projects/:projectId   → list visible (selection highlighted), right
 *                            panel shows that project's roles + actions
 *
 * Routes for individual roles (`/projects/:p/roles/:r`) still go to the
 * full-page RoleDetailPage as before.
 */
export default function ProjectsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const qc = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', { showArchived }],
    queryFn: async () => {
      const [pj, rolesRes, candidatesRes] = await Promise.all([
        supabase.from('hiring_projects').select('id, name, description, status, owner_id, created_at').order('created_at', { ascending: false }),
        supabase.from('roles').select('id, project_id, status'),
        supabase.from('candidates').select('id, role_id, status'),
      ]);
      if (pj.error) throw pj.error;
      const roleByProject = {};
      (rolesRes.data || []).forEach((r) => {
        if (!roleByProject[r.project_id]) roleByProject[r.project_id] = { roleIds: new Set(), open: 0 };
        roleByProject[r.project_id].roleIds.add(r.id);
        if (r.status === 'open') roleByProject[r.project_id].open += 1;
      });
      const candByProject = {};
      (candidatesRes.data || []).forEach((c) => {
        if (c.status !== 'active') return;
        for (const [pid, info] of Object.entries(roleByProject)) {
          if (info.roleIds.has(c.role_id)) {
            candByProject[pid] = (candByProject[pid] || 0) + 1;
            break;
          }
        }
      });
      return (pj.data || []).map((p) => ({
        ...p,
        roleCount: roleByProject[p.id]?.roleIds.size || 0,
        openRoles: roleByProject[p.id]?.open || 0,
        activeCandidates: candByProject[p.id] || 0,
      }));
    },
  });

  const visibleProjects = (projects || []).filter((p) => showArchived || p.status !== 'archived');
  const archivedCount = (projects || []).filter((p) => p.status === 'archived').length;

  const createProject = useMutation({
    mutationFn: async ({ name, description }) => {
      if (!name?.trim()) throw new Error('Name is required.');
      const { data, error } = await supabase
        .from('hiring_projects')
        .insert({ name: name.trim(), description: (description || '').trim() || null, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Project created');
      qc.invalidateQueries({ queryKey: ['projects'] });
      setNewProjectOpen(false);
      navigate(`/projects/${data.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Hiring Projects"
        subtitle="Pick a project on the left to manage its roles."
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition',
                showArchived
                  ? 'border-indigo-500/40 bg-indigo-500/10 text-slate-100'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600'
              )}
            >
              <Archive size={11} /> {showArchived ? 'Hide' : 'Show'} archived
              {archivedCount > 0 && (
                <span className="text-[10px] tabular-nums text-slate-500">({archivedCount})</span>
              )}
            </button>
            <Button icon={Plus} onClick={() => setNewProjectOpen(true)}>New project</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* MASTER: project list */}
        <Card padding={false} className="h-fit lg:sticky lg:top-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
          {isLoading ? (
            <div className="p-3"><SkeletonRows rows={5} height="h-14" /></div>
          ) : !visibleProjects.length ? (
            <div className="p-4 text-sm text-slate-500">
              {(projects?.length || 0) === 0
                ? 'No projects yet. Click "New project" to create one.'
                : 'No projects match. Toggle "Show archived" to see archived ones.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {visibleProjects.map((p) => {
                const isSelected = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 transition border-l-2',
                      isSelected
                        ? 'bg-indigo-500/10 border-indigo-500/60'
                        : 'border-transparent hover:bg-slate-900/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {p.status === 'archived' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[9px] uppercase tracking-wider">
                              <Archive size={8} /> archived
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[9px] uppercase tracking-wider">
                              active
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-slate-100 truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Briefcase size={9} /> {p.roleCount}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users size={9} /> {p.activeCandidates}
                          </span>
                        </div>
                      </div>
                      <ArrowRight size={12} className={isSelected ? 'text-indigo-300' : 'text-slate-600'} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* DETAIL panel */}
        <div className="min-w-0">
          {!projectId ? (
            <EmptyState
              icon={FolderKanban}
              title="Pick a project on the left"
              description={
                visibleProjects.length === 0
                  ? "Or click 'New project' above to create one."
                  : "Or click 'New project' above to create another."
              }
              action={<Button icon={Plus} onClick={() => setNewProjectOpen(true)}>New project</Button>}
            />
          ) : (
            <ProjectDetailPanel projectId={projectId} isAdmin={isAdmin} />
          )}
        </div>
      </div>

      <Modal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        title="New hiring project"
        footer={null}
      >
        <NewProjectForm
          onCancel={() => setNewProjectOpen(false)}
          onSubmit={(payload) => createProject.mutate(payload)}
          loading={createProject.isPending}
        />
      </Modal>
    </>
  );
}

// ─── new project form ───────────────────────────────────────────────

function NewProjectForm({ onCancel, onSubmit, loading }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <div className="space-y-3">
      <Label text="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 Engineering Hiring"
          className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Label>
      <Label text="Description (optional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What's this hiring effort about?"
          className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Label>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit({ name, description })} loading={loading}>Create</Button>
      </div>
    </div>
  );
}

// ─── detail panel: project roles + actions ────────────────────────────

function ProjectDetailPanel({ projectId, isAdmin }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
          .select('id, sr_number, title, location, work_mode, city, state, country, level, status, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
        supabase.from('candidates').select('id, role_id, status'),
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

  const archive = useMutation({
    mutationFn: async (newStatus) => {
      const { error } = await supabase
        .from('hiring_projects')
        .update({ status: newStatus })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: (_, newStatus) => {
      toast.success(newStatus === 'archived' ? 'Project archived' : 'Project restored');
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const removeProject = useMutation({
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

  const createRole = useMutation({
    mutationFn: async (form) => {
      if (!form.title?.trim()) throw new Error('Title is required.');
      const { data, error } = await supabase
        .from('roles')
        .insert({
          project_id: projectId,
          sr_number: (form.sr_number || '').trim() || null,
          title: form.title.trim(),
          level: (form.level || '').trim() || null,
          work_mode: form.work_mode || null,
          city: (form.city || '').trim() || null,
          state: (form.state || '').trim() || null,
          country: (form.country || '').trim() || null,
          jd_source: 'inline',
          jd_html: '',
          stage_config: defaultStageConfig(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success('Role created');
      qc.invalidateQueries({ queryKey: ['roles', projectId] });
      setNewRoleOpen(false);
      navigate(`/projects/${projectId}/roles/${data.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (projectLoading) return <div className="p-4 text-slate-400"><SkeletonRows rows={3} height="h-12" /></div>;
  if (!project) return <div className="text-slate-400 p-4">Project not found.</div>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              {project.status === 'archived' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] uppercase tracking-wider">
                  <Archive size={9} /> archived
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] uppercase tracking-wider">
                  active
                </span>
              )}
              <span className="text-[11px] text-slate-500">created {new Date(project.created_at).toLocaleDateString()}</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-100">{project.name}</h2>
            {project.description && (
              <p className="text-sm text-slate-400 mt-1">{project.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => setNewRoleOpen(true)}>New role</Button>
            {project.status === 'archived' ? (
              <Button variant="secondary" icon={ArchiveRestore} onClick={() => archive.mutate('active')} loading={archive.isPending}>
                Restore
              </Button>
            ) : (
              <Button variant="secondary" icon={Archive} onClick={() => archive.mutate('archived')} loading={archive.isPending}>
                Archive
              </Button>
            )}
            {isAdmin && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </Card>

      {rolesLoading ? (
        <SkeletonRows rows={4} height="h-24" />
      ) : !roles?.length ? (
        <EmptyState
          icon={Briefcase}
          title="No roles in this project yet"
          description="Add an open role to start collecting candidates."
          action={<Button icon={Plus} onClick={() => setNewRoleOpen(true)}>Add role</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {roles.map((r) => {
            const tone = ROLE_STATUS_TONE[r.status] || ROLE_STATUS_TONE.closed;
            const loc = formatLocation(r);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/projects/${projectId}/roles/${r.id}`)}
                className="text-left group"
              >
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
                      </div>
                      {loc && (
                        <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1">
                          <MapPin size={10} /> {loc}
                        </div>
                      )}
                    </div>
                    <ArrowRight size={16} className="text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5 transition shrink-0 mt-1" />
                  </div>
                  <div className="relative mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-1.5 text-xs text-slate-300">
                    <Users size={11} className="text-emerald-300" />
                    <span className="font-semibold text-slate-100 tabular-nums">{r.activeCandidates}</span>
                    <span className="text-slate-500">active {r.activeCandidates === 1 ? 'candidate' : 'candidates'}</span>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <Modal
        open={newRoleOpen}
        onClose={() => setNewRoleOpen(false)}
        title="New role"
        footer={null}
        size="lg"
      >
        <NewRoleForm
          onCancel={() => setNewRoleOpen(false)}
          onSubmit={(payload) => createRole.mutate(payload)}
          loading={createRole.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => removeProject.mutate()}
        loading={removeProject.isPending}
        title="Delete project?"
        message={
          <>
            <p>This permanently removes <strong className="text-slate-100">{project.name}</strong>, every role within it, every candidate on those roles, all pipeline rows, feedback, comments, resume + JD files, and project memberships.</p>
            <p className="mt-2 text-rose-300 text-xs">This cannot be undone. Use Archive if you just want to hide it.</p>
          </>
        }
      />
    </div>
  );
}

function NewRoleForm({ onCancel, onSubmit, loading }) {
  const [form, setForm] = useState({
    sr_number: '', title: '', level: '',
    work_mode: null, city: '', state: '', country: '',
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Label text="SR number">
          <input
            value={form.sr_number}
            onChange={(e) => setForm({ ...form, sr_number: e.target.value })}
            placeholder="e.g. SR-12345"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Label>
        <Label text="Level">
          <input
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
            placeholder="L5 / Senior"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Label>
      </div>
      <Label text="Title">
        <input
          autoFocus
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Senior Software Engineer"
          className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Label>
      <LocationFields
        value={form}
        onChange={(patch) => setForm({ ...form, ...patch })}
        compact
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(form)} loading={loading}>Create</Button>
      </div>
    </div>
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
