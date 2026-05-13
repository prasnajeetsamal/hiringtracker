import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  FileBarChart, Share2, Users, UserCheck, UserX,
  Clock, Sparkles, FolderKanban, Briefcase, TrendingUp, Calendar, FileDown,
} from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import Modal from '../components/common/Modal.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import FilterBar, { FilterSelect } from '../components/common/FilterBar.jsx';
import StageBreakdown from '../components/reports/StageBreakdown.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import { supabase } from '../lib/supabase.js';
import { STAGES, STAGE_BY_KEY } from '../lib/pipeline.js';
import { renderHtmlDocument, downloadHtmlFile, esc } from '../lib/htmlExport.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return '-';
  const days = ms / DAY_MS;
  if (days < 1) {
    const hours = ms / (60 * 60 * 1000);
    return `${hours.toFixed(1)} hours`;
  }
  if (days < 14) return `${days.toFixed(1)} days`;
  return `${Math.round(days)} days`;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function useReportData({ projectId, roleId }) {
  return useQuery({
    queryKey: ['report', projectId, roleId],
    queryFn: async () => {
      // Pull projects + roles + candidates + their pipeline rows.
      const [projects, roles, candidatesAll, pipelineAll] = await Promise.all([
        supabase.from('hiring_projects').select('id, name, status'),
        supabase.from('roles').select('id, project_id, title, status, level, location, sr_number, created_at'),
        supabase.from('candidates').select(`
          id, full_name, status, current_stage_key, ai_score, ai_analysis, source, created_at, updated_at, role_id,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
        `),
        supabase.from('candidate_pipeline').select('id, candidate_id, stage_key, state, started_at, completed_at, decided_by'),
      ]);

      // Scope candidates by filters
      const filtered = (candidatesAll.data || []).filter((c) => {
        if (projectId && c.role?.project_id !== projectId) return false;
        if (roleId && c.role_id !== roleId) return false;
        return true;
      });
      const candidateIds = new Set(filtered.map((c) => c.id));
      const pipelineRows = (pipelineAll.data || []).filter((p) => candidateIds.has(p.candidate_id));

      // Counts by status
      const total = filtered.length;
      const active = filtered.filter((c) => c.status === 'active').length;
      const hired = filtered.filter((c) => c.status === 'hired').length;
      const rejected = filtered.filter((c) => c.status === 'rejected').length;
      const withdrew = filtered.filter((c) => c.status === 'withdrew').length;

      // Stage breakdown
      const activeByStage = {};
      filtered.forEach((c) => {
        if (c.status !== 'active') return;
        const k = c.current_stage_key || 'resume_submitted';
        activeByStage[k] = (activeByStage[k] || 0) + 1;
      });
      const passedByStage = {};
      const failedByStage = {};
      const skippedByStage = {};
      pipelineRows.forEach((p) => {
        if (p.state === 'passed')  passedByStage[p.stage_key]  = (passedByStage[p.stage_key]  || 0) + 1;
        if (p.state === 'failed')  failedByStage[p.stage_key]  = (failedByStage[p.stage_key]  || 0) + 1;
        if (p.state === 'skipped') skippedByStage[p.stage_key] = (skippedByStage[p.stage_key] || 0) + 1;
      });

      // Reach: # candidates whose pipeline EVER touched stage X
      const reachedByStage = {};
      STAGES.forEach((s) => { reachedByStage[s.key] = 0; });
      const candidateStagesReached = new Map();
      pipelineRows.forEach((p) => {
        if (['in_progress', 'passed', 'failed', 'skipped'].includes(p.state)) {
          if (!candidateStagesReached.has(p.candidate_id)) candidateStagesReached.set(p.candidate_id, new Set());
          candidateStagesReached.get(p.candidate_id).add(p.stage_key);
        }
      });
      candidateStagesReached.forEach((stageSet) => {
        stageSet.forEach((sk) => { reachedByStage[sk] = (reachedByStage[sk] || 0) + 1; });
      });

      // Conversion (pass-through) rate per stage = passed_or_skipped / reached
      const conversionByStage = {};
      STAGES.forEach((s) => {
        const reached = reachedByStage[s.key] || 0;
        const passOrSkip = (passedByStage[s.key] || 0) + (skippedByStage[s.key] || 0);
        conversionByStage[s.key] = reached > 0 ? Math.round((passOrSkip / reached) * 100) : null;
      });

      // Time at each stage (median + avg in days)
      const durationsByStage = {};
      STAGES.forEach((s) => { durationsByStage[s.key] = []; });
      pipelineRows.forEach((p) => {
        if (p.started_at && p.completed_at) {
          const ms = new Date(p.completed_at).getTime() - new Date(p.started_at).getTime();
          if (ms >= 0) durationsByStage[p.stage_key].push(ms);
        }
      });
      const stageMedians = {};
      const stageAverages = {};
      STAGES.forEach((s) => {
        stageMedians[s.key] = median(durationsByStage[s.key]);
        stageAverages[s.key] = avg(durationsByStage[s.key]);
      });

      // Time to hire: created_at -> when offer.passed completed_at, for hired candidates
      const timeToHire = [];
      const timeToReject = [];
      filtered.forEach((c) => {
        const created = new Date(c.created_at).getTime();
        if (c.status === 'hired') {
          const offerRow = pipelineRows.find((p) => p.candidate_id === c.id && p.stage_key === 'offer' && p.state === 'passed');
          const ts = offerRow?.completed_at ? new Date(offerRow.completed_at).getTime() : new Date(c.updated_at).getTime();
          if (ts >= created) timeToHire.push(ts - created);
        }
        if (c.status === 'rejected') {
          const failedRow = pipelineRows.find((p) => p.candidate_id === c.id && p.state === 'failed');
          const ts = failedRow?.completed_at ? new Date(failedRow.completed_at).getTime() : new Date(c.updated_at).getTime();
          if (ts >= created) timeToReject.push(ts - created);
        }
      });

      // AI scores
      const scores = filtered.map((c) => c.ai_score).filter((x) => typeof x === 'number');

      // Sources
      const bySource = {};
      filtered.forEach((c) => {
        const k = c.source || 'manual';
        bySource[k] = (bySource[k] || 0) + 1;
      });

      // Top 5 candidates by AI score (active)
      const topCandidates = filtered
        .filter((c) => c.status === 'active' && typeof c.ai_score === 'number')
        .sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0))
        .slice(0, 5);

      // Rejected candidates by stage where they were rejected
      const rejectedByStage = {};
      filtered.forEach((c) => {
        if (c.status !== 'rejected') return;
        const failedRow = pipelineRows.find((p) => p.candidate_id === c.id && p.state === 'failed');
        const k = failedRow?.stage_key || c.current_stage_key || 'resume_submitted';
        rejectedByStage[k] = (rejectedByStage[k] || 0) + 1;
      });

      return {
        scope: {
          projectId,
          roleId,
          projectName: (projects.data || []).find((p) => p.id === projectId)?.name,
          roleName: (roles.data || []).find((r) => r.id === roleId)?.title,
        },
        projects: (projects.data || []).filter((p) => p.status === 'active'),
        roles: roles.data || [],
        kpis: { total, active, hired, rejected, withdrew },
        activeByStage,
        passedByStage,
        failedByStage,
        skippedByStage,
        reachedByStage,
        conversionByStage,
        rejectedByStage,
        stageMedians,
        stageAverages,
        timeToHire,
        timeToReject,
        scores,
        bySource,
        topCandidates,
      };
    },
  });
}

function StatCard({ icon: Icon, label, value, hint, tone = 'indigo' }) {
  const ring = {
    indigo: 'text-indigo-300', emerald: 'text-emerald-300',
    rose: 'text-rose-300', amber: 'text-amber-300', violet: 'text-violet-300',
  }[tone] || 'text-indigo-300';
  return (
    <Card className="h-full">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg bg-slate-800/80 grid place-items-center ${ring} shrink-0`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="text-2xl font-semibold text-slate-100 mt-0.5 leading-none tabular-nums">{value}</div>
          {hint && <div className="text-[11px] text-slate-500 mt-2">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectFilter, setProjectFilter] = useState(searchParams.get('projectId') || '');
  const [roleFilter, setRoleFilter] = useState(searchParams.get('roleId') || '');

  // Export modal: pick which sections + which destination.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSections, setExportSections] = useState({
    kpis: true, stages: true, times: true, sources: true, topscorers: true,
  });
  const [exportBusy, setExportBusy] = useState(false);

  // Keep query string in sync so the URL is shareable.
  useEffect(() => {
    const next = {};
    if (projectFilter) next.projectId = projectFilter;
    if (roleFilter) next.roleId = roleFilter;
    setSearchParams(next, { replace: true });
  }, [projectFilter, roleFilter, setSearchParams]);

  const { data, isLoading } = useReportData({
    projectId: projectFilter,
    roleId: roleFilter,
  });

  const rolesForProject = useMemo(() => {
    if (!projectFilter) return data?.roles || [];
    return (data?.roles || []).filter((r) => r.project_id === projectFilter);
  }, [data?.roles, projectFilter]);

  useEffect(() => {
    if (roleFilter && !rolesForProject.some((r) => r.id === roleFilter)) {
      setRoleFilter('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const filterCount = (projectFilter ? 1 : 0) + (roleFilter ? 1 : 0);

  const downloadCsv = () => {
    if (!data) return;
    const k = data.kpis;
    const conv = k.total ? Math.round((k.hired / k.total) * 100) : 0;
    const lines = [
      ['Section', 'Metric', 'Value'],
      ['Scope', 'Project', data.scope.projectName || 'All projects'],
      ['Scope', 'Role', data.scope.roleName || 'All roles'],
      ['Scope', 'Generated at', new Date().toISOString()],
      [],
      ['Summary', 'Total candidates considered', k.total],
      ['Summary', 'Active', k.active],
      ['Summary', 'Hired', k.hired],
      ['Summary', 'Rejected', k.rejected],
      ['Summary', 'Withdrew', k.withdrew],
      ['Summary', 'Conversion (hired %)', `${conv}%`],
      [],
      ['Time-to-X', 'Median time to hire', fmtDuration(median(data.timeToHire))],
      ['Time-to-X', 'Avg time to hire', fmtDuration(avg(data.timeToHire))],
      ['Time-to-X', 'Median time to reject', fmtDuration(median(data.timeToReject))],
      ['Time-to-X', 'Avg time to reject', fmtDuration(avg(data.timeToReject))],
      [],
      ['Stage', 'Active here', 'Passed', 'Rejected here', 'Skipped', 'Reached', 'Conversion', 'Median time'],
    ];
    STAGES.forEach((s) => {
      lines.push([
        s.label,
        data.activeByStage[s.key] || 0,
        data.passedByStage[s.key] || 0,
        data.failedByStage[s.key] || 0,
        data.skippedByStage[s.key] || 0,
        data.reachedByStage[s.key] || 0,
        data.conversionByStage[s.key] != null ? `${data.conversionByStage[s.key]}%` : '-',
        fmtDuration(data.stageMedians[s.key]),
      ]);
    });
    lines.push([]);
    lines.push(['Source', 'Count']);
    Object.entries(data.bySource).forEach(([src, count]) => lines.push([src, count]));

    const csv = lines.map((row) =>
      row.map((cell) => {
        if (cell === undefined || cell === null) return '';
        const s = String(cell);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slate-hiring-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report CSV downloaded');
  };

  const downloadHtml = (sections = exportSections) => {
    if (!data) return;
    const k = data.kpis;
    const conv = k.total ? Math.round((k.hired / k.total) * 100) : 0;
    const rejectionRate = k.total ? Math.round((k.rejected / k.total) * 100) : 0;
    const scopeTitle = data.scope.projectName && data.scope.roleName
      ? `${data.scope.roleName} - ${data.scope.projectName}`
      : data.scope.projectName || 'All projects · all roles';
    const html = renderHtmlDocument({
      title: 'Slate - Hiring Report',
      header: {
        eyebrow: 'Slate · Hiring Reports',
        title: scopeTitle,
        subtitle: `${k.total} candidates considered · ${conv}% hired · ${rejectionRate}% rejected`,
      },
      body: buildHtmlReport(data, sections),
    });
    downloadHtmlFile(html, `slate-hiring-report-${new Date().toISOString().slice(0, 10)}.html`);
    toast.success('HTML report downloaded');
  };

  // Pixel-perfect PDF via html2canvas + jsPDF. Lazy-loads the helper so the
  // heavy deps don't bloat first paint.
  const downloadPdf = async (sections = exportSections) => {
    if (!data) return;
    const el = document.getElementById('report-printable');
    if (!el) { toast.error('Report not yet rendered'); return; }
    const omitted = Object.entries(sections).filter(([, v]) => !v).map(([k2]) => `[data-section="${k2}"]`).join(', ');
    const filename = `slate-hiring-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    setExportBusy(true);
    const t = toast.loading('Rendering PDF...');
    try {
      const mod = await import('../lib/pdfExport.js');
      await mod.exportElementToPdf(el, {
        filename,
        backgroundColor: '#050816',
        scale: 2,
        hideSelector: omitted || null,
      });
      toast.success('PDF downloaded', { id: t });
    } catch (e) {
      toast.error(e.message || 'PDF render failed', { id: t });
    } finally {
      setExportBusy(false);
    }
  };

  const printWithSections = (sections = exportSections) => {
    if (!data) return;
    // Temporarily hide deselected sections, run the browser print, then restore.
    const toHide = Object.entries(sections).filter(([, v]) => !v).map(([k2]) => k2);
    const nodes = toHide.flatMap((s) => Array.from(document.querySelectorAll(`[data-section="${s}"]`)));
    const prev = nodes.map((n) => ({ n, v: n.style.display }));
    nodes.forEach((n) => { n.style.display = 'none'; });
    setTimeout(() => {
      window.print();
      prev.forEach(({ n, v }) => { n.style.display = v || ''; });
    }, 50);
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Shareable link copied');
    } catch {
      toast.error('Could not copy. URL: ' + window.location.href);
    }
  };

  if (isLoading) return <Spinner />;

  const k = data?.kpis || {};
  const conversion = k.total ? Math.round((k.hired / k.total) * 100) : 0;
  const rejectionRate = k.total ? Math.round((k.rejected / k.total) * 100) : 0;
  const empty = (k.total ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="Hiring Reports"
        subtitle="Hiring performance review for any project or role."
        actions={
          <>
            <Button variant="secondary" icon={Share2} onClick={copyShareLink}>Share link</Button>
            <Button icon={FileDown} onClick={() => setExportOpen(true)} disabled={empty}>Export</Button>
          </>
        }
      />

      <FilterBar
        activeCount={filterCount}
        onClearAll={() => { setProjectFilter(''); setRoleFilter(''); }}
      >
        <FilterSelect
          label="Project"
          icon={FolderKanban}
          value={projectFilter}
          onChange={setProjectFilter}
          options={[
            { value: '', label: 'All projects' },
            ...(data?.projects || []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <FilterSelect
          label="Role"
          icon={Briefcase}
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { value: '', label: projectFilter ? 'All roles in project' : 'All roles' },
            ...rolesForProject.map((r) => {
              const pName = (data?.projects || []).find((p) => p.id === r.project_id)?.name;
              return {
                value: r.id,
                label: !projectFilter && pName ? `${r.title} - ${pName}` : r.title,
              };
            }),
          ]}
        />
        {filterCount > 0 && (
          <div className="text-[11px] text-slate-400 px-2">
            {[data?.scope.projectName, data?.scope.roleName].filter(Boolean).join(' · ')}
          </div>
        )}
      </FilterBar>

      {empty ? (
        <EmptyState
          icon={FileBarChart}
          title="No data for this scope"
          description="Add candidates to a role (or pick different filters above) to populate this report."
        />
      ) : (
        <div id="report-printable" className="space-y-4">
          {/* Header summary - always included in exports */}
          <Card>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Calendar size={11} /> Generated {new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </div>
                <h2 className="text-lg font-semibold text-slate-100">
                  {data.scope.projectName && data.scope.roleName
                    ? `${data.scope.roleName} - ${data.scope.projectName}`
                    : data.scope.projectName
                    ? `${data.scope.projectName}`
                    : 'All projects · all roles'}
                </h2>
                <div className="text-xs text-slate-400 mt-1">
                  {k.total} candidates considered · {conversion}% hired · {rejectionRate}% rejected
                </div>
              </div>
            </div>
          </Card>

          {/* KPI grid */}
          <div data-section="kpis" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 auto-rows-fr">
            <StatCard icon={Users} label="Considered" value={k.total} hint="All-time" />
            <StatCard icon={TrendingUp} label="Active" value={k.active} hint="In flight" tone="indigo" />
            <StatCard icon={UserCheck} label="Hired" value={k.hired} hint={`${conversion}% conversion`} tone="emerald" />
            <StatCard icon={UserX} label="Rejected" value={k.rejected} hint={`${rejectionRate}% rejection rate`} tone="rose" />
            <StatCard icon={Clock} label="Median time-to-hire" value={fmtDuration(median(data.timeToHire))}
              hint={data.timeToHire.length ? `${data.timeToHire.length} hires` : 'No hires yet'} tone="violet" />
          </div>

          {/* Stage breakdown */}
          <div data-section="stages">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <FileBarChart size={16} className="text-indigo-300" />
                <span className="font-medium">Pipeline breakdown</span>
              </div>
              <div className="text-[11px] text-slate-500">All-time</div>
            </div>
            <StageBreakdown
              active={data.activeByStage}
              passed={data.passedByStage}
              failed={data.failedByStage}
              skipped={data.skippedByStage}
            />
          </Card>
          </div>

          {/* Time + per-stage table */}
          <div data-section="times">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Clock size={16} className="text-violet-300" />
                <span className="font-medium">Time spent at each stage</span>
              </div>
              <div className="text-[11px] text-slate-500">Median across completed transitions</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-4 font-medium">Stage</th>
                    <th className="py-2 px-2 font-medium text-right">Reached</th>
                    <th className="py-2 px-2 font-medium text-right">Pass-through %</th>
                    <th className="py-2 px-2 font-medium text-right">Median time</th>
                    <th className="py-2 px-2 font-medium text-right">Avg time</th>
                    <th className="py-2 pl-2 font-medium text-right">Rejected here</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGES.map((s) => (
                    <tr key={s.key} className="border-b border-slate-800/60">
                      <td className="py-2 pr-4 text-slate-200">{s.label}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-300">{data.reachedByStage[s.key] || 0}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-300">
                        {data.conversionByStage[s.key] != null ? `${data.conversionByStage[s.key]}%` : '-'}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-300">{fmtDuration(data.stageMedians[s.key])}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-slate-300">{fmtDuration(data.stageAverages[s.key])}</td>
                      <td className="py-2 pl-2 text-right tabular-nums text-rose-300">{data.rejectedByStage[s.key] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source breakdown */}
            <div data-section="sources">
            <Card>
              <div className="flex items-center gap-2 text-slate-200 mb-3">
                <Users size={16} className="text-indigo-300" />
                <span className="font-medium">Where candidates came from</span>
              </div>
              {Object.keys(data.bySource).length === 0 ? (
                <div className="text-sm text-slate-500 italic">No data.</div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(data.bySource)
                    .sort((a, b) => b[1] - a[1])
                    .map(([src, count]) => {
                      const pct = data.kpis.total ? (count / data.kpis.total) * 100 : 0;
                      return (
                        <div key={src} className="flex items-center gap-3">
                          <div className="w-24 text-xs text-slate-300 capitalize">{src}</div>
                          <div className="flex-1 h-4 rounded-md bg-slate-900/60 border border-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-indigo-500/80 to-violet-500/80"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="w-12 text-right text-xs tabular-nums text-slate-300">{count}</div>
                        </div>
                      );
                    })}
                </div>
              )}
            </Card>
            </div>

            {/* Top scorers */}
            <div data-section="topscorers">
            <Card>
              <div className="flex items-center gap-2 text-slate-200 mb-3">
                <Sparkles size={16} className="text-amber-300" />
                <span className="font-medium">Top candidates by AI score</span>
              </div>
              {data.topCandidates.length === 0 ? (
                <div className="text-sm text-slate-500 italic">No active candidates have been scored yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.topCandidates.map((c) => (
                    <a
                      key={c.id}
                      href={`/candidates/${c.id}`}
                      className="flex items-center gap-3 px-2 py-1 -mx-2 rounded-md hover:bg-slate-900/40"
                    >
                      <span className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-amber-500/10 text-amber-200 border border-amber-500/30 text-xs font-semibold tabular-nums shrink-0">
                        {c.ai_score}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {c.role?.title} · {STAGE_BY_KEY[c.current_stage_key]?.short || c.current_stage_key}
                        </div>
                      </div>
                      <RecommendationBadge value={c.ai_analysis?.recommendation} />
                    </a>
                  ))}
                </div>
              )}
            </Card>
            </div>
          </div>

          <Card className="no-print">
            <div className="text-xs text-slate-400">
              Click <strong className="text-slate-200">Export</strong> to download as PDF (pixel-perfect, colours preserved),
              HTML (self-contained file, viewable without Slate login), or send to the printer. Choose which sections to
              include via the chart picker. <strong className="text-slate-200">Share link</strong> copies the URL with
              current filters baked in.
            </div>
          </Card>
        </div>
      )}

      <ExportOptionsModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        sections={exportSections}
        onSectionsChange={setExportSections}
        busy={exportBusy}
        onPdf={() => { downloadPdf(exportSections); setExportOpen(false); }}
        onHtml={() => { downloadHtml(exportSections); setExportOpen(false); }}
        onPrint={() => { printWithSections(exportSections); setExportOpen(false); }}
        onCsv={() => { downloadCsv(); setExportOpen(false); }}
      />
    </>
  );
}

// ─── Report body sections (CSS lives in src/lib/htmlExport.js) ─────────

const ALL_SECTIONS = { kpis: true, stages: true, times: true, sources: true, topscorers: true };

function buildHtmlReport(data, sections = ALL_SECTIONS) {
  const on = (k) => sections[k] !== false;
  const k = data.kpis;
  const conv = k.total ? Math.round((k.hired / k.total) * 100) : 0;

  const kpiCard = (label, value, hint, tone) => `
    <div class="kpi kpi--${tone}">
      <div class="kpi__label">${esc(label)}</div>
      <div class="kpi__value">${esc(value)}</div>
      ${hint ? `<div class="kpi__hint">${esc(hint)}</div>` : ''}
    </div>`;

  // Stage breakdown - gradient bars per stage
  const stageRows = STAGES.map((s) => {
    const reached = data.reachedByStage[s.key] || 0;
    const active = data.activeByStage[s.key] || 0;
    const passed = data.passedByStage[s.key] || 0;
    const failed = data.failedByStage[s.key] || 0;
    const skipped = data.skippedByStage[s.key] || 0;
    const total = Math.max(1, active + passed + failed + skipped);
    const seg = (count, color) => count > 0
      ? `<span class="seg" style="width:${(count / total) * 100}%;background:${color};" title="${count}"></span>`
      : '';
    return `
      <div class="stage">
        <div class="stage__label">${esc(s.label)}</div>
        <div class="stage__bar">
          ${seg(active, '#6366f1')}
          ${seg(passed, '#10b981')}
          ${seg(failed, '#f43f5e')}
          ${seg(skipped, '#94a3b8')}
        </div>
        <div class="stage__counts">
          <span class="dot dot--indigo"></span>${active}
          <span class="dot dot--emerald"></span>${passed}
          <span class="dot dot--rose"></span>${failed}
          <span class="dot dot--slate"></span>${skipped}
          <span class="stage__reached">reached ${reached}</span>
        </div>
      </div>`;
  }).join('');

  // Time-at-stage table
  const timeRows = STAGES.map((s) => `
    <tr>
      <td>${esc(s.label)}</td>
      <td class="num">${data.reachedByStage[s.key] || 0}</td>
      <td class="num">${data.conversionByStage[s.key] != null ? data.conversionByStage[s.key] + '%' : '-'}</td>
      <td class="num">${esc(fmtDuration(data.stageMedians[s.key]))}</td>
      <td class="num">${esc(fmtDuration(data.stageAverages[s.key]))}</td>
      <td class="num rose">${data.rejectedByStage[s.key] || 0}</td>
    </tr>`).join('');

  // Source breakdown bars
  const totalForPct = k.total || 1;
  const sourceRows = Object.entries(data.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => `
      <div class="source-row">
        <div class="source-row__label">${esc(src)}</div>
        <div class="source-row__bar"><span style="width:${(count / totalForPct) * 100}%"></span></div>
        <div class="source-row__count">${count}</div>
      </div>`).join('');

  // Top scorers
  const topRows = data.topCandidates.length === 0
    ? '<div class="muted">No active candidates have been scored yet.</div>'
    : data.topCandidates.map((c) => `
        <div class="top-row">
          <div class="top-row__score">${c.ai_score}</div>
          <div class="top-row__main">
            <div class="top-row__name">${esc(c.full_name || 'Unnamed')}</div>
            <div class="top-row__sub">${esc(c.role?.title || '')} · ${esc(STAGE_BY_KEY[c.current_stage_key]?.short || c.current_stage_key)}</div>
          </div>
          <div class="top-row__rec rec--${esc((c.ai_analysis?.recommendation || '').toLowerCase())}">
            ${esc(c.ai_analysis?.recommendation || '')}
          </div>
        </div>`).join('');

  const kpiBlock = !on('kpis') ? '' : `
    <div class="kpis">
      ${kpiCard('Considered', k.total, 'All-time', 'indigo')}
      ${kpiCard('Active', k.active, 'In flight', 'indigo')}
      ${kpiCard('Hired', k.hired, conv + '% conversion', 'emerald')}
      ${kpiCard('Rejected', k.rejected, (k.total ? Math.round((k.rejected / k.total) * 100) : 0) + '% rejection rate', 'rose')}
      ${kpiCard('Median time-to-hire', fmtDuration(median(data.timeToHire)),
                data.timeToHire.length ? data.timeToHire.length + ' hires' : 'No hires yet', 'violet')}
    </div>`;

  const stagesBlock = !on('stages') ? '' : `
    <div class="panel">
      <div class="panel__title">Pipeline breakdown</div>
      ${stageRows}
    </div>`;

  const timesBlock = !on('times') ? '' : `
    <div class="panel">
      <div class="panel__title">Time spent at each stage</div>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th class="num">Reached</th>
            <th class="num">Pass-through %</th>
            <th class="num">Median time</th>
            <th class="num">Avg time</th>
            <th class="num">Rejected here</th>
          </tr>
        </thead>
        <tbody>${timeRows}</tbody>
      </table>
    </div>`;

  const bottomBlock = (!on('sources') && !on('topscorers')) ? '' : `
    <div class="grid-2">
      ${on('sources') ? `
      <div class="panel">
        <div class="panel__title">Where candidates came from</div>
        ${sourceRows || '<div class="muted">No data.</div>'}
      </div>` : ''}
      ${on('topscorers') ? `
      <div class="panel">
        <div class="panel__title">Top candidates by AI score</div>
        ${topRows}
      </div>` : ''}
    </div>`;

  return [kpiBlock, stagesBlock, timesBlock, bottomBlock].filter(Boolean).join('\n');
}

// ─── Chart-picker modal ──────────────────────────────────────────────────

const EXPORT_SECTION_OPTIONS = [
  { key: 'kpis',       label: 'KPI summary' },
  { key: 'stages',     label: 'Pipeline breakdown' },
  { key: 'times',      label: 'Time per stage' },
  { key: 'sources',    label: 'Source breakdown' },
  { key: 'topscorers', label: 'Top scorers' },
];

function ExportOptionsModal({ open, onClose, sections, onSectionsChange, onPdf, onHtml, onPrint, onCsv, busy }) {
  const toggle = (k) => onSectionsChange({ ...sections, [k]: !sections[k] });
  const allOn = EXPORT_SECTION_OPTIONS.every((s) => sections[s.key]);
  const noneOn = EXPORT_SECTION_OPTIONS.every((s) => !sections[s.key]);

  return (
    <Modal open={open} onClose={onClose} title="Export report" size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={onCsv}>CSV (raw)</Button>
          <Button variant="secondary" onClick={onPrint} disabled={noneOn}>Print</Button>
          <Button variant="secondary" onClick={onHtml} disabled={noneOn}>HTML</Button>
          <Button onClick={onPdf} loading={busy} disabled={noneOn}>PDF</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-xs text-slate-400">
          Choose which sections to include in the export. PDF preserves on-screen colours pixel-for-pixel; HTML is a self-contained file you can email; Print opens the browser print dialog with the same colours.
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Sections</span>
          <button
            type="button"
            onClick={() => onSectionsChange(
              allOn
                ? Object.fromEntries(EXPORT_SECTION_OPTIONS.map((s) => [s.key, false]))
                : Object.fromEntries(EXPORT_SECTION_OPTIONS.map((s) => [s.key, true]))
            )}
            className="text-[11px] text-indigo-300 hover:text-indigo-200"
          >
            {allOn ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EXPORT_SECTION_OPTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 p-2 rounded-lg border border-slate-800 hover:border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!sections[s.key]}
                onChange={() => toggle(s.key)}
                className="w-4 h-4 accent-indigo-500"
              />
              <span className="text-sm text-slate-200">{s.label}</span>
            </label>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 pt-1">
          The header summary (project / role / hired %) is always included.
        </div>
      </div>
    </Modal>
  );
}
