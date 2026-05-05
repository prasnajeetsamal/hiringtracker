import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, FolderKanban, ArrowRight, Archive } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import Spinner from '../components/common/Spinner.jsx';
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
      const { data, error } = await supabase
        .from('hiring_projects')
        .select('id, name, description, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
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
        <Spinner />
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
              <Card className="h-full hover:border-indigo-500/40 transition">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-100 truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</div>
                    )}
                  </div>
                  <ArrowRight size={16} className="text-slate-500 group-hover:text-indigo-300 transition shrink-0 mt-1" />
                </div>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
                  {p.status === 'archived' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                      <Archive size={10} /> archived
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      active
                    </span>
                  )}
                  <span>· created {new Date(p.created_at).toLocaleDateString()}</span>
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
