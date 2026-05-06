import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, FolderKanban, ArrowRight, Archive, Briefcase, Users } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { SkeletonGrid } from '../components/common/Skeleton.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';

export default function ProjectsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const [{ data: pj, error }, { data: roles }, { data: candidates }] = await Promise.all([
        supabase.from('hiring_projects').select('id, name, description, status, created_at').order('created_at', { ascending: false }),
        supabase.from('roles').select('id, project_id, status'),
        supabase.from('candidates').select('id, role_id, status'),
      ]);
      if (error) throw error;
      const roleByProject = {};
      (roles || []).forEach((r) => {
        if (!roleByProject[r.project_id]) roleByProject[r.project_id] = { roleIds: new Set(), open: 0 };
        roleByProject[r.project_id].roleIds.add(r.id);
        if (r.status === 'open') roleByProject[r.project_id].open += 1;
      });
      const candByProject = {};
      (candidates || []).forEach((c) => {
        if (c.status !== 'active') return;
        for (const [pid, info] of Object.entries(roleByProject)) {
          if (info.roleIds.has(c.role_id)) {
            candByProject[pid] = (candByProject[pid] || 0) + 1;
            break;
          }
        }
      });
      return (pj || []).map((p) => ({
        ...p,
        roleCount: roleByProject[p.id]?.roleIds.size || 0,
        openRoles: roleByProject[p.id]?.open || 0,
        activeCandidates: candByProject[p.id] || 0,
      }));
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required.');
      const { data, error } = await supabase
        .from('hiring_projects')
        .insert({ name: name.trim(), description: description.trim() || null, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Project created');
      qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName('');
      setDescription('');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Hiring Projects"
        subtitle="A project bundles related roles together — e.g. 'Q3 Engineering Hiring'."
        actions={
          <Button icon={Plus} onClick={() => setOpen(true)}>
            New project
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonGrid count={6} className="h-36" />
      ) : !projects?.length ? (
        <EmptyState
          icon={FolderKanban}
          title="No hiring projects yet"
          description="Create your first hiring project to start tracking roles and candidates."
          action={<Button icon={Plus} onClick={() => setOpen(true)}>Create project</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="group">
              <Card className="h-full hover:border-indigo-500/40 hover:shadow-indigo-500/10 transition relative overflow-hidden">
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
                  <ArrowRight size={16} className="text-slate-500 group-hover:text-indigo-300 group-hover:translate-x-0.5 transition shrink-0 mt-1" />
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
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New hiring project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
          </>
        }
      >
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
