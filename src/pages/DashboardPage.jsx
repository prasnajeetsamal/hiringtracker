import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FolderKanban, Users, Briefcase, ClipboardCheck, Clock, Star, Sparkles,
  ArrowRight, AlertTriangle, TrendingUp,
} from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { STAGES, STAGE_BY_KEY } from '../lib/pipeline.js';

const STALE_DAYS = 7;

// ─── KPI cards ────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, hint, to, tone = 'indigo' }) {
  const toneCls = {
    indigo:  'text-indigo-300',
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    rose:    'text-rose-300',
    violet:  'text-violet-300',
  }[tone] || 'text-indigo-300';

  const inner = (
    <Card className="h-full flex flex-col">
      <div className="flex items-start gap-3 flex-1">
        <div className={`w-9 h-9 rounded-lg bg-slate-800/80 grid place-items-center ${toneCls}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="text-3xl font-semibold text-slate-100 mt-1 leading-none">{value}</div>
          <div className="text-[11px] text-slate-500 mt-2 min-h-[14px]">{hint || ''}</div>
        </div>
      </div>
    </Card>
  );
  return to ? (
    <Link to={to} className="block h-full hover:scale-[1.005] transition-transform">
      {inner}
    </Link>
  ) : (
    <div className="h-full">{inner}</div>
  );
}

// ─── data hooks ───────────────────────────────────────────────────────
function useDashboardData(userId) {
  return useQuery({
    queryKey: ['dashboard', userId],
    enabled: !!userId,
    queryFn: async () => {
      const since = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

      const [
        projectsAgg,
        rolesAgg,
        candidatesAll,
        myAssignments,
        recentCandidates,
        topCandidates,
        recentAudit,
      ] = await Promise.all([
        supabase.from('hiring_projects').select('id, name, status'),
        supabase.from('roles').select('id, project_id, status'),
        supabase.from('candidates').select(`
          id, full_name, current_stage_key, status, ai_score, source, updated_at, role_id, created_at,
          ai_analysis,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
        `),
        supabase.from('interviewer_assignments').select('id, pipeline_id').eq('interviewer_id', userId),
        supabase.from('candidates')
          .select(`id, full_name, current_stage_key, status, source, created_at, role:roles ( id, title )`)
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.from('candidates')
          .select(`id, full_name, ai_score, ai_analysis, current_stage_key, status, role:roles ( id, title )`)
          .eq('status', 'active')
          .not('ai_score', 'is', null)
          .order('ai_score', { ascending: false })
          .limit(5),
        supabase.from('audit_log')
          .select(`id, action, entity_type, entity_id, before, after, created_at,
                   actor:profiles!audit_log_actor_id_fkey ( id, full_name, email )`)
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      let pendingFeedback = 0;
      const pipelineIds = (myAssignments.data || []).map((a) => a.pipeline_id);
      if (pipelineIds.length) {
        const { data: fb } = await supabase
          .from('feedback')
          .select('pipeline_id')
          .eq('interviewer_id', userId)
          .in('pipeline_id', pipelineIds);
        const submitted = new Set((fb || []).map((f) => f.pipeline_id));
        pendingFeedback = pipelineIds.filter((id) => !submitted.has(id)).length;
      }

      const allCandidates = candidatesAll.data || [];
      const activeCandidates = allCandidates.filter((c) => c.status === 'active');
      const hiredCount = allCandidates.filter((c) => c.status === 'hired').length;
      const rejectedCount = allCandidates.filter((c) => c.status === 'rejected').length;

      // Pipeline funnel
      const stageCounts = {};
      STAGES.forEach((s) => { stageCounts[s.key] = 0; });
      activeCandidates.forEach((c) => {
        const k = c.current_stage_key || 'resume_submitted';
        if (stageCounts[k] === undefined) stageCounts[k] = 0;
        stageCounts[k] += 1;
      });

      // Stale candidates
      const stale = activeCandidates
        .filter((c) => c.updated_at < since)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .slice(0, 5);

      // Roles needing attention: open roles with most active candidates not yet
      // past HM Review, OR roles with zero candidates
      const openRoles = (rolesAgg.data || []).filter((r) => r.status === 'open');
      const candidatesByRole = {};
      activeCandidates.forEach((c) => {
        if (!c.role_id) return;
        candidatesByRole[c.role_id] = (candidatesByRole[c.role_id] || 0) + 1;
      });
      const allRolesById = Object.fromEntries(
        (rolesAgg.data || []).map((r) => [r.id, r])
      );
      const projectsById = Object.fromEntries(
        (projectsAgg.data || []).map((p) => [p.id, p])
      );

      const attentionRoles = (allCandidates || [])
        .reduce((acc, c) => {
          if (!c.role) return acc;
          const key = c.role_id;
          if (!acc[key]) {
            acc[key] = {
              roleId: c.role_id,
              roleTitle: c.role.title,
              projectId: c.role.project_id,
              projectName: c.role.project?.name,
              total: 0, byStage: {},
            };
          }
          if (c.status === 'active') {
            acc[key].total += 1;
            acc[key].byStage[c.current_stage_key] = (acc[key].byStage[c.current_stage_key] || 0) + 1;
          }
          return acc;
        }, {});
      const topRoles = Object.values(attentionRoles)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        kpis: {
          activeProjects: (projectsAgg.data || []).filter((p) => p.status === 'active').length,
          openRoles: openRoles.length,
          activeCandidates: activeCandidates.length,
          pendingFeedback,
          hiredCount,
          rejectedCount,
          totalCandidates: allCandidates.length,
        },
        stageCounts,
        recentCandidates: recentCandidates.data || [],
        topCandidates: topCandidates.data || [],
        stale,
        topRoles,
        recentAudit: recentAudit.data || [],
        allRolesById,
        projectsById,
      };
    },
  });
}

// ─── widgets ──────────────────────────────────────────────────────────

function StageFunnel({ counts }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="space-y-2">
      {STAGES.map((s) => {
        const n = counts[s.key] || 0;
        const pct = max > 0 ? (n / max) * 100 : 0;
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="w-32 text-xs text-slate-300">{s.label}</div>
            <div className="flex-1 h-5 rounded-md bg-slate-900/60 border border-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500/70 via-violet-500/70 to-pink-500/70"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-8 text-right text-xs text-slate-300 tabular-nums">{n}</div>
          </div>
        );
      })}
    </div>
  );
}

const ACTION_VERB = {
  insert: 'created',
  update: 'updated',
  delete: 'deleted',
};
const ENTITY_NOUN = {
  candidates: 'candidate',
  candidate_pipeline: 'pipeline',
  feedback: 'feedback',
  hiring_projects: 'project',
  roles: 'role',
};

function describeEvent(ev) {
  const noun = ENTITY_NOUN[ev.entity_type] || ev.entity_type;
  if (ev.entity_type === 'candidates' && ev.action === 'insert') {
    const name = ev.after?.full_name || 'a candidate';
    return { text: `Added ${name}`, link: `/candidates/${ev.entity_id}` };
  }
  if (ev.entity_type === 'candidates' && ev.action === 'update') {
    const before = ev.before || {};
    const after = ev.after || {};
    const name = after.full_name || 'Candidate';
    if (before.status !== after.status) {
      return { text: `${name} → ${after.status}`, link: `/candidates/${ev.entity_id}` };
    }
    if (before.current_stage_key !== after.current_stage_key) {
      return {
        text: `${name} → ${STAGE_BY_KEY[after.current_stage_key]?.short || after.current_stage_key}`,
        link: `/candidates/${ev.entity_id}`,
      };
    }
    if (before.ai_score !== after.ai_score && after.ai_score != null) {
      return { text: `${name} scored ${after.ai_score}/100`, link: `/candidates/${ev.entity_id}` };
    }
    return { text: `Updated ${name}`, link: `/candidates/${ev.entity_id}` };
  }
  if (ev.entity_type === 'candidate_pipeline' && ev.action === 'update') {
    const before = ev.before || {};
    const after = ev.after || {};
    if (before.state !== after.state) {
      const stage = STAGE_BY_KEY[after.stage_key]?.short || after.stage_key;
      return { text: `${stage}: ${after.state}`, link: null };
    }
  }
  if (ev.entity_type === 'feedback') {
    return { text: `Feedback ${ACTION_VERB[ev.action]}`, link: null };
  }
  return { text: `${ACTION_VERB[ev.action] || ev.action} ${noun}`, link: null };
}

function RelativeTime({ iso }) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  let label;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins}m ago`;
  else if (mins < 60 * 24) label = `${Math.floor(mins / 60)}h ago`;
  else label = `${Math.floor(mins / 60 / 24)}d ago`;
  return <span className="text-[11px] text-slate-500 tabular-nums">{label}</span>;
}

// ─── page ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useDashboardData(user?.id);

  if (isLoading) return <Spinner />;

  const k = data?.kpis || {};
  const conversion = k.totalCandidates ? Math.round((k.hiredCount / k.totalCandidates) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="A summary of every project, role, candidate, and interview in flight."
      />

      {/* KPI grid — auto-rows-fr keeps every card the exact same height */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
        <Stat icon={FolderKanban} label="Active projects" value={k.activeProjects ?? 0} hint="Click to manage" to="/projects" tone="indigo" />
        <Stat icon={Briefcase}    label="Open roles"      value={k.openRoles ?? 0}      hint={k.openRoles ? 'Awaiting candidates' : 'No open roles'} to="/projects" tone="violet" />
        <Stat icon={Users}        label="Active candidates" value={k.activeCandidates ?? 0} hint={`${k.hiredCount || 0} hired · ${k.rejectedCount || 0} rejected`} to="/candidates" tone="emerald" />
        <Stat
          icon={ClipboardCheck}
          label="My pending feedback"
          value={k.pendingFeedback ?? 0}
          hint={k.pendingFeedback ? 'Submit before stale' : 'You\'re all caught up'}
          to="/my-interviews"
          tone={k.pendingFeedback ? 'amber' : 'emerald'}
        />
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Funnel + roles needing attention */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <TrendingUp size={16} className="text-indigo-300" />
                <span className="font-medium">Pipeline by stage</span>
              </div>
              <div className="text-[11px] text-slate-500">active candidates only</div>
            </div>
            {k.activeCandidates ? (
              <StageFunnel counts={data.stageCounts} />
            ) : (
              <div className="text-sm text-slate-500 italic">No active candidates yet.</div>
            )}
            {k.totalCandidates > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-4 text-[11px] text-slate-400">
                <span>Total tracked: <strong className="text-slate-200">{k.totalCandidates}</strong></span>
                <span className="text-slate-600">·</span>
                <span>Conversion: <strong className="text-slate-200">{conversion}%</strong> hired</span>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Briefcase size={16} className="text-violet-300" />
                <span className="font-medium">Roles needing attention</span>
              </div>
            </div>
            {!data?.topRoles?.length ? (
              <div className="text-sm text-slate-500 italic">No active candidates on any role yet.</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {data.topRoles.map((r) => (
                  <Link
                    key={r.roleId}
                    to={`/projects/${r.projectId}/roles/${r.roleId}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-slate-900/40 -mx-2 px-2 rounded-md transition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{r.roleTitle}</div>
                      <div className="text-[11px] text-slate-500 truncate">{r.projectName}</div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                      {Object.entries(r.byStage).slice(0, 3).map(([k, n]) => (
                        <span key={k} className="text-[10px] text-slate-400 bg-slate-800/60 border border-slate-700 px-1.5 py-0.5 rounded-full">
                          {STAGE_BY_KEY[k]?.short || k}: {n}
                        </span>
                      ))}
                    </div>
                    <div className="text-sm font-semibold text-slate-100 tabular-nums w-8 text-right">{r.total}</div>
                    <ArrowRight size={14} className="text-slate-500" />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: top candidates + stale + recent activity */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Star size={16} className="text-amber-300" />
                <span className="font-medium">Top AI scores</span>
              </div>
            </div>
            {!data?.topCandidates?.length ? (
              <div className="text-sm text-slate-500 italic">Score candidates to see them here.</div>
            ) : (
              <div className="space-y-1.5">
                {data.topCandidates.map((c) => (
                  <Link
                    key={c.id}
                    to={`/candidates/${c.id}`}
                    className="flex items-center gap-2 py-1 hover:bg-slate-900/40 -mx-2 px-2 rounded-md transition"
                  >
                    <span className="inline-flex items-center justify-center w-9 h-7 rounded-md bg-amber-500/10 text-amber-200 border border-amber-500/30 text-xs font-semibold tabular-nums">
                      {c.ai_score}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                      <div className="text-[11px] text-slate-500 truncate">{c.role?.title}</div>
                    </div>
                    <RecommendationBadge value={c.ai_analysis?.recommendation} />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <AlertTriangle size={16} className="text-rose-300" />
                <span className="font-medium">Stale candidates</span>
              </div>
              <div className="text-[11px] text-slate-500">{STALE_DAYS}+ days idle</div>
            </div>
            {!data?.stale?.length ? (
              <div className="text-sm text-slate-500 italic">No stale candidates. 🎉</div>
            ) : (
              <div className="space-y-1.5">
                {data.stale.map((c) => {
                  const days = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / (24 * 60 * 60 * 1000));
                  return (
                    <Link
                      key={c.id}
                      to={`/candidates/${c.id}`}
                      className="flex items-center gap-2 py-1 hover:bg-slate-900/40 -mx-2 px-2 rounded-md transition"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                        <div className="text-[11px] text-slate-500 truncate">{c.role?.title}</div>
                      </div>
                      <StageBadge stageKey={c.current_stage_key} state="in_progress" size="sm" />
                      <span className="text-[11px] text-rose-300 tabular-nums">{days}d</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Clock size={16} className="text-indigo-300" />
                <span className="font-medium">Recent activity</span>
              </div>
            </div>
            {!data?.recentAudit?.length ? (
              <div className="text-sm text-slate-500 italic">
                No activity yet. Audit triggers populate this when candidates / pipeline / feedback change.
              </div>
            ) : (
              <div className="space-y-1.5">
                {data.recentAudit.map((ev) => {
                  const { text, link } = describeEvent(ev);
                  const actorName = ev.actor?.full_name || ev.actor?.email || 'Someone';
                  const Inner = (
                    <div className="text-sm">
                      <span className="text-slate-300">{actorName}</span>{' '}
                      <span className="text-slate-400">{text}</span>
                    </div>
                  );
                  return (
                    <div key={ev.id} className="flex items-start justify-between gap-2 py-1">
                      <div className="min-w-0">
                        {link ? (
                          <Link to={link} className="hover:bg-slate-900/40 -mx-2 px-2 py-0.5 block rounded-md">
                            {Inner}
                          </Link>
                        ) : Inner}
                      </div>
                      <RelativeTime iso={ev.created_at} />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Recently added candidates row */}
      {data?.recentCandidates?.length > 0 && (
        <div className="mt-4">
          <Card padding={false}>
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-300" />
              <span className="text-sm font-medium text-slate-200">Recently added candidates</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-800/60">
              {data.recentCandidates.map((c) => (
                <Link
                  key={c.id}
                  to={`/candidates/${c.id}`}
                  className="bg-slate-900/40 hover:bg-slate-900/80 transition px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                      <div className="text-[11px] text-slate-500 truncate">{c.role?.title}</div>
                    </div>
                    <StageBadge stageKey={c.current_stage_key} state="in_progress" size="sm" />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1.5 capitalize">{c.source} · {new Date(c.created_at).toLocaleDateString()}</div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
