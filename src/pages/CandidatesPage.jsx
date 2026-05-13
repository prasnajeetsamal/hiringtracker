import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Download, Star, ArrowRight, Trash2, Plus, Activity, Layers, FolderKanban, Briefcase, Tag as TagIcon, Sparkles, X as XIcon, Save, Bookmark, CheckSquare } from 'lucide-react';
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
import SemanticSearchDialog from '../components/candidates/SemanticSearchDialog.jsx';
import { supabase } from '../lib/supabase.js';
import { STAGES } from '../lib/pipeline.js';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { deleteCandidate, transitionCandidate } from '../lib/api.js';

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
  const [tagFilter, setTagFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // candidate row or null
  const [importOpen, setImportOpen] = useState(false);
  const [smartSearchOpen, setSmartSearchOpen] = useState(false);

  // ── Bulk selection ─────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null); // 'advance' | 'reject' | 'tag' | null
  const [bulkTagText, setBulkTagText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ── Saved searches (localStorage; per-browser is fine for v1) ──────
  const SAVED_KEY = 'slate.candidates.saved-searches';
  const [savedSearches, setSavedSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); }
    catch { return []; }
  });
  const persistSaved = (next) => {
    setSavedSearches(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const currentFilters = { search, statusFilter, stageFilter, projectFilter, roleFilter, tagFilter };
  const applySaved = (s) => {
    setSearch(s.filters?.search || '');
    setStatusFilter(s.filters?.statusFilter ?? 'active');
    setStageFilter(s.filters?.stageFilter || '');
    setProjectFilter(s.filters?.projectFilter || '');
    setRoleFilter(s.filters?.roleFilter || '');
    setTagFilter(s.filters?.tagFilter || '');
  };
  const saveCurrent = () => {
    const name = window.prompt('Name this saved search:', '');
    if (!name || !name.trim()) return;
    const next = [{ id: crypto.randomUUID(), name: name.trim(), filters: currentFilters }, ...savedSearches].slice(0, 12);
    persistSaved(next);
  };
  const removeSaved = (id) => persistSaved(savedSearches.filter((s) => s.id !== id));

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

  // Run a per-candidate operation across the selected set with limited
  // concurrency. Returns { ok, failed } counts.
  const runBulk = async (ids, op, label) => {
    const arr = [...ids];
    if (arr.length === 0) return { ok: 0, failed: 0 };
    setBulkBusy(true);
    const t = toast.loading(`${label} (0 / ${arr.length})...`);
    let ok = 0;
    let failed = 0;
    // 4 at a time keeps DB / endpoint load reasonable without making the user wait too long
    const CONC = 4;
    const queue = [...arr];
    const workers = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try { await op(id); ok += 1; }
        catch (_) { failed += 1; }
        toast.loading(`${label} (${ok + failed} / ${arr.length})...`, { id: t });
      }
    });
    await Promise.all(workers);
    if (failed === 0) toast.success(`${label}: ${ok} done`, { id: t });
    else toast(`${label}: ${ok} succeeded, ${failed} failed`, { id: t, icon: '⚠️' });
    setBulkBusy(false);
    return { ok, failed };
  };

  const performBulkAdvance = async () => {
    await runBulk(selectedIds, (id) => transitionCandidate({ candidateId: id, action: 'advance' }), 'Advancing');
    qc.invalidateQueries({ queryKey: ['candidates-all'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setBulkAction(null);
    clearSelection();
  };

  const performBulkReject = async () => {
    await runBulk(selectedIds, (id) => transitionCandidate({ candidateId: id, action: 'reject' }), 'Rejecting');
    qc.invalidateQueries({ queryKey: ['candidates-all'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setBulkAction(null);
    clearSelection();
  };

  const performBulkTag = async () => {
    const tag = bulkTagText.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) { toast.error('Enter a tag name.'); return; }
    // Read existing tags per candidate so we don't clobber.
    const byId = Object.fromEntries((candidates || []).map((c) => [c.id, c]));
    await runBulk(selectedIds, async (id) => {
      const cur = (byId[id]?.tags || []);
      if (cur.includes(tag)) return; // no-op
      const { error } = await supabase.from('candidates').update({ tags: [...cur, tag] }).eq('id', id);
      if (error) throw error;
    }, `Tagging "${tag}"`);
    qc.invalidateQueries({ queryKey: ['candidates-all'] });
    setBulkAction(null);
    setBulkTagText('');
    clearSelection();
  };

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select(`
          id, full_name, email, phone, source, current_stage_key, status, ai_score, ai_analysis,
          created_at, role_id, tags,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Distinct tags across visible candidates - feed the tag dropdown.
  const allTags = useMemo(() => {
    const set = new Set();
    (candidates || []).forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [candidates]);

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
      if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
      return true;
    });
  }, [candidates, search, stageFilter, statusFilter, projectFilter, roleFilter, tagFilter]);

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
            <Button icon={Sparkles} variant="secondary" onClick={() => setSmartSearchOpen(true)}>Smart search</Button>
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
          (roleFilter ? 1 : 0) +
          (tagFilter ? 1 : 0)
        }
        onClearAll={() => {
          setSearch('');
          setStatusFilter('active');
          setStageFilter('');
          setProjectFilter('');
          setRoleFilter('');
          setTagFilter('');
        }}
      >
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name, email…" />
        <FilterSelect
          label="Status"
          icon={Activity}
          value={statusFilter}
          onChange={setStatusFilter}
          defaultValue="active"
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          label="Stage"
          icon={Layers}
          value={stageFilter}
          onChange={setStageFilter}
          options={[
            { value: '', label: 'All stages' },
            ...STAGES.map((s) => ({ value: s.key, label: s.label })),
          ]}
        />
        <FilterSelect
          label="Project"
          icon={FolderKanban}
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: '', label: 'All projects' },
            ...(projects || []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <FilterSelect
          label="Role"
          icon={Briefcase}
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { value: '', label: projectFilter ? 'All roles in project' : 'All roles' },
            ...rolesForProject.map((r) => ({
              value: r.id,
              label: r.title + (!projectFilter && r.project?.name ? ` - ${r.project.name}` : ''),
            })),
          ]}
        />
        {allTags.length > 0 && (
          <FilterSelect
            label="Tag"
            icon={TagIcon}
            value={tagFilter}
            onChange={setTagFilter}
            options={[
              { value: '', label: 'Any tag' },
              ...allTags.map((t) => ({ value: t, label: t })),
            ]}
          />
        )}
        <button
          onClick={saveCurrent}
          className="text-[11px] px-2.5 py-1 rounded-full text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700 inline-flex items-center gap-1.5 ml-auto"
          title="Save current filter combination"
        >
          <Save size={11} /> Save filter
        </button>
      </FilterBar>

      {savedSearches.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4 -mt-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 inline-flex items-center gap-1 mr-1">
            <Bookmark size={10} /> Saved
          </span>
          {savedSearches.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-200 border border-indigo-500/30"
            >
              <button onClick={() => applySaved(s)} className="hover:text-indigo-100">{s.name}</button>
              <button onClick={() => removeSaved(s.id)} title="Delete saved search" className="text-indigo-300/70 hover:text-rose-200">
                <XIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Bulk action toolbar - sticky-feeling bar that surfaces when any row is selected */}
      {selectedIds.size > 0 && (
        <div className="mb-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 flex items-center gap-2 flex-wrap">
          <CheckSquare size={14} className="text-indigo-300 shrink-0" />
          <span className="text-sm text-slate-100">
            <strong className="tabular-nums">{selectedIds.size}</strong> selected
          </span>
          <button
            onClick={clearSelection}
            className="text-[11px] px-2 py-0.5 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
          >
            Clear
          </button>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            <button
              onClick={() => setBulkAction('advance')}
              disabled={bulkBusy}
              className="text-[11px] px-2.5 py-1 rounded-md text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 inline-flex items-center gap-1"
            >
              <ArrowRight size={11} /> Advance stage
            </button>
            <button
              onClick={() => setBulkAction('reject')}
              disabled={bulkBusy}
              className="text-[11px] px-2.5 py-1 rounded-md text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-500/30"
            >
              Reject
            </button>
            <button
              onClick={() => setBulkAction('tag')}
              disabled={bulkBusy}
              className="text-[11px] px-2.5 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700 inline-flex items-center gap-1"
            >
              <TagIcon size={11} /> Add tag
            </button>
          </div>
        </div>
      )}

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
                  <th className="pl-4 pr-2 py-2.5 font-medium w-8">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-indigo-500"
                      checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filtered.map((c) => c.id)));
                        else clearSelection();
                      }}
                      title="Select all visible"
                    />
                  </th>
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
                    className={`border-b border-slate-800/60 hover:bg-slate-900/40 transition ${
                      selectedIds.has(c.id) ? 'bg-indigo-500/5' : ''
                    }`}
                  >
                    <td className="pl-4 pr-2 py-2.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-indigo-500"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelected(c.id)}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link to={`/candidates/${c.id}`} className="text-slate-100 font-medium hover:text-indigo-300">
                        {c.full_name || '(no name)'}
                      </Link>
                      {c.email && <div className="text-[11px] text-slate-500 mt-0.5">{c.email}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200">{c.role?.title || '-'}</div>
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
                      ) : <span className="text-[11px] text-slate-500">-</span>}
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
        // No roleId - dialog will show its own role picker
      />

      <SemanticSearchDialog
        open={smartSearchOpen}
        onClose={() => setSmartSearchOpen(false)}
        projectId={projectFilter || undefined}
        roleId={roleFilter || undefined}
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

      {/* Bulk advance confirm */}
      <ConfirmDialog
        open={bulkAction === 'advance'}
        onClose={() => setBulkAction(null)}
        onConfirm={performBulkAdvance}
        loading={bulkBusy}
        title={`Advance ${selectedIds.size} candidate${selectedIds.size === 1 ? '' : 's'}?`}
        message={
          <>
            <p>Each selected candidate moves to the next enabled stage in their pipeline. Candidates already in a terminal status (hired / rejected / withdrew) are skipped.</p>
            <p className="mt-2 text-slate-400 text-xs">Runs in parallel batches of 4.</p>
          </>
        }
      />

      {/* Bulk reject confirm */}
      <ConfirmDialog
        open={bulkAction === 'reject'}
        onClose={() => setBulkAction(null)}
        onConfirm={performBulkReject}
        loading={bulkBusy}
        title={`Reject ${selectedIds.size} candidate${selectedIds.size === 1 ? '' : 's'}?`}
        message={
          <>
            <p>Each selected candidate's current pipeline stage is marked <em>failed</em> and status flips to <strong className="text-rose-300">rejected</strong>.</p>
            <p className="mt-2 text-rose-300 text-xs">No emails are sent automatically - use Email candidate per row if you want to notify them.</p>
          </>
        }
      />

      {/* Bulk add tag - same dialog shape but with an input inside the message */}
      <ConfirmDialog
        open={bulkAction === 'tag'}
        onClose={() => { setBulkAction(null); setBulkTagText(''); }}
        onConfirm={performBulkTag}
        loading={bulkBusy}
        title={`Add tag to ${selectedIds.size} candidate${selectedIds.size === 1 ? '' : 's'}?`}
        message={
          <>
            <p className="mb-2">Tag will be appended to each selected candidate (no duplicates).</p>
            <input
              autoFocus
              value={bulkTagText}
              onChange={(e) => setBulkTagText(e.target.value)}
              placeholder="e.g. callback, priority"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </>
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
