import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, FolderKanban, ArrowRight, Archive, Briefcase, Users,
  Trash2, ArchiveRestore, MapPin, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { SkeletonGrid, SkeletonRows } from '../components/common/Skeleton.jsx';
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
 * Hiring Projects page.
 *
 *   /projects            → full-width grid of project cards (no detail panel)
 *   /projects/:projectId → grid still visible but condensed; right-side panel
 *                          slides in showing the selected project's roles
 *                          and actions. Close X returns to /projects.
 *
 * The collapsible panel pattern preserves context — the project list stays
 * visible while a single project is being inspected. Clicking another card
 * swaps the panel to that project; clicking the close button or pressing
 * Escape returns to the full grid.
 *
 * Individual role pages (`/projects/:p/roles/:r`) still go to a full-page
 * RoleDetailPage.
 */
export default function ProjectsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const qc = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // Allow Escape to close the side panel.
  useEffect(() => {
    if (!projectId) return;
    const onKey = (e) => {
      if (e.key === 'Escape') navigate('/projects');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [projectId, navigate]);

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

  const panelOpen = !!projectId;

  return (
    <>
      <PageHeader
        title="Hiring Projects"
        subtitle={panelOpen
          ? 'Click another project to swap the panel, or close to see all projects.'
          : 'Click a project to open its roles in a side panel.'}
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

      {/*
        Layout:
        - When NO project is selected, the grid spans the full width.
        - When a project IS selected, the layout becomes a 2-column grid:
          left = project cards (squeezed; uses auto-fit so cards rewrap),
          right = sticky detail panel.
      */}
      <div
        className={clsx(
          'grid gap-4 transition-[grid-template-columns] duration-300',
          panelOpen ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_640px]' : 'grid-cols-1'
        )}
      >
        {/* PROJECT GRID */}
        <div className="min-w-0">
          {isLoading ? (
            <SkeletonGrid count={6} className="h-44" />
          ) : !visibleProjects.length ? (
            <EmptyState
              icon={FolderKanban}
              title="No hiring projects yet"
              description="Create your first hiring project to start tracking roles and candidates."
              action={<Button icon={Plus} onClick={() => setNewProjectOpen(true)}>Create project</Button>}
            />
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: panelOpen
                  ? 'repeat(auto-fill, minmax(220px, 1fr))'
                  : 'repeat(auto-fill, minmax(280px, 1fr))',
              }}
            >
              {visibleProjects.map((p) => {
                const isSelected = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="text-left group"
                  >
                    <Card
                      className={clsx(
                        'h-full transition relative overflow-hidden',
                        isSelected
                          ? 'border-indigo-500/60 ring-1 ring-indigo-500/40 shadow-indigo-500/15'
                          : 'hover:border-indigo-500/40 hover:shadow-indigo-500/10'
                      )}
                    >
                      <div className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-indigo-500/10 blur-3xl group-hover:bg-indigo-500/20 transition" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {p.status === 'archived' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px]">
                                <Archive size={9} /> archived
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px]">
                                active
                              </span>
                            )}
                          </div>
                          <div className="text-base font-semibold text-slate-100 mt-1.5 truncate">{p.name}</div>
                          {p.description && (
                            <div className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</div>
                          )}
                        </div>
                        <ArrowRight
                          size={16}
                          className={clsx(
                            'transition shrink-0 mt-1',
                            isSelected
                              ? 'text-indigo-300'
                              : 'text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5'
                          )}
                        />
                      </div>
                      <div className="relative mt-4 pt-3 border-t border-slate-800/60 grid grid-cols-2 gap-3 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Briefcase size={11} className="text-violet-300" />
                          <span className="font-semibold text-slate-100 tabular-nums">{p.roleCount}</span>
                          <span className="text-slate-500">{p.roleCount === 1 ? 'role' : 'roles'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Users size={11} className="text-emerald-300" />
                          <span className="font-semibold text-slate-100 tabular-nums">{p.activeCandidates}</span>
                          <span className="text-slate-500">{p.activeCandidates === 1 ? 'candidate' : 'candidates'}</span>
                        </div>
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* SIDE PANEL */}
        {panelOpen && (
          <div className="min-w-0 xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <ProjectDetailPanel
              key={projectId}
              projectId={projectId}
              isAdmin={isAdmin}
              onClose={() => navigate('/projects')}
            />
          </div>
        )}
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

// ─── side panel: project roles + actions ──────────────────────────────

function ProjectDetailPanel({ projectId, isAdmin, onClose }) {
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

  return (
    <Card padding={false} className="relative">
      {/* Sticky panel header — close button always visible */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="min-w-0 flex-1">
          {projectLoading ? (
            <SkeletonRows rows={1} height="h-6" />
          ) : !project ? (
            <div className="text-slate-400 text-sm">Project not found.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-0.5">
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
              <h2 className="text-base font-semibold text-slate-100 truncate">{project.name}</h2>
              {project.description && (
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{project.description}</p>
              )}
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-100 p-1 rounded-md hover:bg-slate-800/60 shrink-0"
          title="Close panel (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      {project && (
        <div className="px-4 pt-3 pb-4 flex flex-wrap gap-2 border-b border-slate-800/60">
          <Button size="sm" icon={Plus} onClick={() => setNewRoleOpen(true)}>New role</Button>
          {project.status === 'archived' ? (
            <Button size="sm" variant="secondary" icon={ArchiveRestore} onClick={() => archive.mutate('active')} loading={archive.isPending}>
              Restore
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={Archive} onClick={() => archive.mutate('archived')} loading={archive.isPending}>
              Archive
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)}>
              Delete
            </Button>
          )}
        </div>
      )}

      <div className="px-4 py-4">
        {rolesLoading ? (
          <SkeletonRows rows={4} height="h-20" />
        ) : !roles?.length ? (
          <EmptyState
            icon={Briefcase}
            title="No roles in this project yet"
            description="Add an open role to start collecting candidates."
            action={<Button size="sm" icon={Plus} onClick={() => setNewRoleOpen(true)}>Add role</Button>}
          />
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1 px-1">
              Roles ({roles.length})
            </div>
            {roles.map((r) => {
              const tone = ROLE_STATUS_TONE[r.status] || ROLE_STATUS_TONE.closed;
              const loc = formatLocation(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/projects/${projectId}/roles/${r.id}`)}
                  className="w-full text-left rounded-lg border border-slate-800 bg-slate-900/40 hover:border-indigo-500/40 hover:bg-slate-900/70 px-3 py-2.5 transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className={`inline-flex items-center px-1.5 py-0 rounded-full border text-[9px] capitalize ${tone}`}>
                          {r.status.replace('_', ' ')}
                        </span>
                        {r.sr_number && (
                          <span className="text-[10px] text-slate-500 font-mono">SR {r.sr_number}</span>
                        )}
                        {r.level && <span className="text-[10px] text-slate-500">{r.level}</span>}
                      </div>
                      <div className="text-sm font-medium text-slate-100 truncate">{r.title}</div>
                      {loc && (
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <MapPin size={10} /> {loc}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <div className="flex items-center gap-1 text-[11px] text-slate-300">
                        <Users size={10} className="text-emerald-300" />
                        <span className="font-semibold text-slate-100 tabular-nums">{r.activeCandidates}</span>
                      </div>
                      <ArrowRight size={12} className="text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5 transition" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

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
          project && (
            <>
              <p>This permanently removes <strong className="text-slate-100">{project.name}</strong>, every role within it, every candidate on those roles, all pipeline rows, feedback, comments, resume + JD files, and project memberships.</p>
              <p className="mt-2 text-rose-300 text-xs">This cannot be undone. Use Archive if you just want to hide it.</p>
            </>
          )
        }
      />
    </Card>
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
