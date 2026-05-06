import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Download, Star, ArrowRight, Trash2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import FilterBar, { FilterSearch, FilterSelect } from '../components/common/FilterBar.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import CandidateImportDialog from '../components/candidates/CandidateImportDialog.jsx';
import { supabase } from '../lib/supabase.js';
import { STAGES } from '../lib/pipeline.js';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { deleteCandidate } from '../lib/api.js';

const STATUS_OPTIONS = [
  { value: '',          label: 'All statuses' },
  { value: 'active',    label: 'Active' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'hired',     label: 'Hired' },
  { value: 'withdrew',  label: 'Withdrew' },
];

export default function CandidatesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [projectFilter, setProjectFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // candidate row or null
  const [importOpen, setImportOpen] = useState(false);

  const remove = useMutation({
    mutationFn: async (id) => deleteCandidate({ candidateId: id }),
    onSuccess: () => {
      toast.success('Candidate deleted');
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmDelete(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select(`
          id, full_name, email, phone, source, current_stage_key, status, ai_score, ai_analysis,
          created_at, role_id,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: roles } = useQuery({
    queryKey: ['roles-flat'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, title, project_id, project:hiring_projects ( id, name )')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-flat'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hiring_projects')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Roles dropdown is filtered by the selected project (if any).
  const rolesForProject = useMemo(() => {
    if (!projectFilter) return roles || [];
    return (roles || []).filter((r) => r.project_id === projectFilter);
  }, [roles, projectFilter]);

  // Whenever the project filter changes, reset role filter if it's no longer valid.
  React.useEffect(() => {
    if (roleFilter && !rolesForProject.some((r) => r.id === roleFilter)) {
      setRoleFilter('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const filtered = useMemo(() => {
    return (candidates || []).filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = [c.full_name, c.email, c.role?.title, c.role?.project?.name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (stageFilter && c.current_stage_key !== stageFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (projectFilter && c.role?.project_id !== projectFilter) return false;
      if (roleFilter && c.role_id !== roleFilter) return false;
      return true;
    });
  }, [candidates, search, stageFilter, statusFilter, projectFilter, roleFilter]);

  const csv = useMemo(() => buildCSV(filtered), [filtered]);

  const downloadCSV = () => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slate-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Candidates"
        subtitle="All candidates across roles. Add, filter, export."
        actions={
          <>
            <Button icon={Plus} onClick={() => setImportOpen(true)}>Add candidate</Button>
            <Button icon={Download} variant="secondary" onClick={downloadCSV} disabled={filtered.length === 0}>
              Export CSV ({filtered.length})
            </Button>
          </>
        }
      />

      <FilterBar
        activeCount={
          (search ? 1 : 0) +
          (statusFilter !== 'active' ? 1 : 0) +
          (stageFilter ? 1 : 0) +
          (projectFilter ? 1 : 0) +
          (roleFilter ? 1 : 0)
        }
        onClearAll={() => {
          setSearch('');
          setStatusFilter('active');
          setStageFilter('');
          setProjectFilter('');
          setRoleFilter('');
        }}
      >
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name, email…" />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          defaultValue="active"
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label="Stage"
          value={stageFilter}
          onChange={setStageFilter}
          options={[
            { value: '', label: 'All stages' },
            ...STAGES.map((s) => ({ value: s.key, label: s.label })),
          ]}
        />
        <FilterSelect
          label="Project"
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: '', label: 'All projects' },
            ...(projects || []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <FilterSelect
          label="Role"
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { value: '', label: projectFilter ? 'All roles in project' : 'All roles' },
            ...rolesForProject.map((r) => ({
              value: r.id,
              label: r.title + (!projectFilter && r.project?.name ? ` — ${r.project.name}` : ''),
            })),
          ]}
        />
      </FilterBar>

      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={(candidates?.length || 0) === 0 ? 'No candidates yet' : 'No candidates match'}
          description={(candidates?.length || 0) === 0
            ? 'Click "Add candidate" above to upload a resume, paste a LinkedIn URL, or enter manually.'
            : 'Try clearing filters or changing the search term.'}
          action={(candidates?.length || 0) === 0
            ? <Button icon={Plus} onClick={() => setImportOpen(true)}>Add candidate</Button>
            : undefined}
        />
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-2.5 font-medium">Candidate</th>
                  <th className="px-4 py-2.5 font-medium">Role / Project</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">AI</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th></th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-800/60 hover:bg-slate-900/40 transition"
                  >
                    <td className="px-4 py-2.5">
                      <Link to={`/candidates/${c.id}`} className="text-slate-100 font-medium hover:text-indigo-300">
                        {c.full_name || '(no name)'}
                      </Link>
                      {c.email && <div className="text-[11px] text-slate-500 mt-0.5">{c.email}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200">{c.role?.title || '—'}</div>
                      <div className="text-[11px] text-slate-500">{c.role?.project?.name}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StageBadge stageKey={c.current_stage_key} state="in_progress" size="sm" />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={
                        c.status === 'active' ? 'text-slate-300 text-xs' :
                        c.status === 'rejected' ? 'text-rose-300 text-xs' :
                        c.status === 'hired' ? 'text-emerald-300 text-xs' :
                        'text-slate-400 text-xs'
                      }>{c.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {typeof c.ai_score === 'number' ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-amber-300 text-xs">
                            <Star size={11} /> {c.ai_score}
                          </span>
                          <RecommendationBadge value={c.ai_analysis?.recommendation} />
                        </div>
                      ) : <span className="text-[11px] text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] text-slate-400 capitalize">{c.source}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={`/candidates/${c.id}`} className="text-slate-500 hover:text-indigo-300">
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setConfirmDelete(c)}
                          className="text-slate-500 hover:text-rose-300 p-1 rounded transition"
                          title="Delete candidate"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CandidateImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        // No roleId — dialog will show its own role picker
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove.mutate(confirmDelete.id)}
        loading={remove.isPending}
        title="Delete candidate?"
        message={
          confirmDelete && (
            <>
              <p>This permanently removes <strong className="text-slate-100">{confirmDelete.full_name || 'this candidate'}</strong>, all their pipeline rows, feedback, comments, and the resume file in storage.</p>
              <p className="mt-2 text-rose-300 text-xs">This cannot be undone.</p>
            </>
          )
        }
      />
    </>
  );
}

function csvCell(s) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCSV(rows) {
  const headers = ['name', 'email', 'phone', 'role', 'project', 'stage', 'status', 'ai_score', 'ai_recommendation', 'source', 'created_at'];
  const lines = [headers.join(',')];
  for (const c of rows) {
    lines.push([
      csvCell(c.full_name),
      csvCell(c.email),
      csvCell(c.phone),
      csvCell(c.role?.title),
      csvCell(c.role?.project?.name),
      csvCell(c.current_stage_key),
      csvCell(c.status),
      csvCell(c.ai_score),
      csvCell(c.ai_analysis?.recommendation),
      csvCell(c.source),
      csvCell(c.created_at),
    ].join(','));
  }
  return lines.join('\n');
}
