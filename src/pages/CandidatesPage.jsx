import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Download, Star, ArrowRight } from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import { supabase } from '../lib/supabase.js';
import { STAGES } from '../lib/pipeline.js';

const STATUS_OPTIONS = [
  { value: '',          label: 'All statuses' },
  { value: 'active',    label: 'Active' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'hired',     label: 'Hired' },
  { value: 'withdrew',  label: 'Withdrew' },
];

export default function CandidatesPage() {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [roleFilter, setRoleFilter] = useState('');

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
        .select('id, title, project:hiring_projects ( name )')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    return (candidates || []).filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = [c.full_name, c.email, c.role?.title, c.role?.project?.name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (stageFilter && c.current_stage_key !== stageFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (roleFilter && c.role_id !== roleFilter) return false;
      return true;
    });
  }, [candidates, search, stageFilter, statusFilter, roleFilter]);

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
        subtitle="All candidates across roles. Filter, then export to CSV."
        actions={
          <Button icon={Download} variant="secondary" onClick={downloadCSV} disabled={filtered.length === 0}>
            Export CSV ({filtered.length})
          </Button>
        }
      />

      <Card className="mb-4" padding={false}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, role…"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All roles</option>
            {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.project?.name ? ` — ${r.project.name}` : ''}</option>)}
          </select>
        </div>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates match"
          description="Try clearing filters, or add candidates from a role page."
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
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
