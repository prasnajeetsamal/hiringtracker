import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FolderKanban, Users, Briefcase, ClipboardCheck, Clock, Sparkles,
  ArrowRight, AlertTriangle, TrendingUp, Activity, Plus, Database, Copy,
  CheckCircle2, XCircle, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Vite raw import — bundles the SQL file content as a string.
import seedSql from '../../supabase/demo/seed_demo_data.sql?raw';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import HeroCard from '../components/dashboard/HeroCard.jsx';
import PipelineFunnel from '../components/dashboard/PipelineFunnel.jsx';
import Sparkline from '../components/dashboard/Sparkline.jsx';
import ScoreGauge from '../components/dashboard/ScoreGauge.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { STAGE_BY_KEY } from '../lib/pipeline.js';

const STALE_DAYS = 7;

// ─── data ─────────────────────────────────────────────────────────────

function useDashboardData(userId) {
  return useQuery({
    queryKey: ['dashboard', userId],
    enabled: !!userId,
    queryFn: async () => {
      const since = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        projectsAgg, rolesAgg, candidatesAll, myAssignments, pipelineRows,
        recentCandidates, topCandidates, recentAudit, profileRow,
      ] = await Promise.all([
        supabase.from('hiring_projects').select('id, name, status'),
        supabase.from('roles').select('id, project_id, status'),
        supabase.from('candidates').select(`
          id, full_name, email, current_stage_key, status, ai_score, source, updated_at, role_id, created_at,
          ai_analysis,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
        `),
        supabase.from('interviewer_assignments').select('id, pipeline_id').eq('interviewer_id', userId),
        supabase.from('candidate_pipeline').select('id, stage_key, state'),
        supabase.from('candidates')
          .select(`id, full_name, email, current_stage_key, status, source, created_at, role:roles ( id, title )`)
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
          .limit(10),
        supabase.from('profiles').select('full_name, email').eq('id', userId).single(),
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

      // Pipeline funnel: current vs ever-reached per stage.
      const currentByStage = {};
      activeCandidates.forEach((c) => {
        const k = c.current_stage_key || 'resume_submitted';
        currentByStage[k] = (currentByStage[k] || 0) + 1;
      });
      const everReachedByStage = {};
      (pipelineRows.data || []).forEach((row) => {
        if (['in_progress', 'passed', 'skipped'].includes(row.state)) {
          everReachedByStage[row.stage_key] = (everReachedByStage[row.stage_key] || 0) + 1;
        }
      });

      // Stale candidates
      const stale = activeCandidates
        .filter((c) => c.updated_at < since)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .slice(0, 5);

      // Roles needing attention: highest active-candidate count
      const attention = {};
      activeCandidates.forEach((c) => {
        if (!c.role) return;
        const k = c.role_id;
        if (!attention[k]) {
          attention[k] = {
            roleId: c.role_id,
            roleTitle: c.role.title,
            projectId: c.role.project_id,
            projectName: c.role.project?.name,
            total: 0, byStage: {},
          };
        }
        attention[k].total += 1;
        attention[k].byStage[c.current_stage_key] = (attention[k].byStage[c.current_stage_key] || 0) + 1;
      });
      const topRoles = Object.values(attention).sort((a, b) => b.total - a.total).slice(0, 5);

      // Sparkline: candidates added per day for last 14 days
      const dayBuckets = Array(14).fill(0);
      const start = sevenDaysAgo.getTime() - 7 * 24 * 60 * 60 * 1000;
      allCandidates.forEach((c) => {
        const t = new Date(c.created_at).getTime();
        const dayIdx = Math.floor((t - start) / (24 * 60 * 60 * 1000));
        if (dayIdx >= 0 && dayIdx < 14) dayBuckets[dayIdx] += 1;
      });
      const candidatesThisWeek = dayBuckets.slice(7).reduce((a, b) => a + b, 0);
      const candidatesPrevWeek = dayBuckets.slice(0, 7).reduce((a, b) => a + b, 0);

      return {
        profile: profileRow.data,
        kpis: {
          activeProjects: (projectsAgg.data || []).filter((p) => p.status === 'active').length,
          openRoles: (rolesAgg.data || []).filter((r) => r.status === 'open').length,
          activeCandidates: activeCandidates.length,
          pendingFeedback,
          hiredCount,
          rejectedCount,
          totalCandidates: allCandidates.length,
          candidatesThisWeek,
          candidatesPrevWeek,
        },
        currentByStage,
        everReachedByStage,
        recentCandidates: recentCandidates.data || [],
        topCandidates: topCandidates.data || [],
        stale,
        topRoles,
        recentAudit: recentAudit.data || [],
        sparkline: dayBuckets,
      };
    },
  });
}

// ─── small bits ───────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, accent = 'indigo', spark, to }) {
  const accents = {
    indigo:  { ring: 'from-indigo-500/40',  fg: 'text-indigo-300',  spark: '#a5b4fc' },
    violet:  { ring: 'from-violet-500/40',  fg: 'text-violet-300',  spark: '#c4b5fd' },
    emerald: { ring: 'from-emerald-500/40', fg: 'text-emerald-300', spark: '#6ee7b7' },
    amber:   { ring: 'from-amber-500/40',   fg: 'text-amber-300',   spark: '#fcd34d' },
    rose:    { ring: 'from-rose-500/40',    fg: 'text-rose-300',    spark: '#fda4af' },
  }[accent];

  const inner = (
    <div className="relative h-full rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-900/40 p-5 overflow-hidden flex flex-col">
      <div className={`pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl bg-gradient-to-br ${accents.ring} to-transparent`} />
      <div className="relative flex items-start gap-3 flex-1">
        <div className={`w-9 h-9 rounded-lg bg-slate-800/80 grid place-items-center ${accents.fg} shrink-0`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="flex items-end justify-between gap-2">
            <div className="text-3xl font-semibold text-slate-100 leading-none mt-1 tabular-nums">{value}</div>
            {spark && spark.length > 0 && (
              <Sparkline values={spark} color={accents.spark} width={64} height={22} />
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 min-h-[14px]">{sub}</div>
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to} className="block h-full hover:scale-[1.005] transition-transform">{inner}</Link> : <div className="h-full">{inner}</div>;
}

function trendLabel(thisWeek, prevWeek) {
  if (thisWeek === 0 && prevWeek === 0) return 'No new candidates';
  if (prevWeek === 0) return `+${thisWeek} this week`;
  const delta = thisWeek - prevWeek;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const pct = Math.round((Math.abs(delta) / prevWeek) * 100);
  return `${arrow} ${pct}% vs. last week (${thisWeek} new)`;
}

function initialsFor(name = '') {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase().slice(0, 2);
}

function Avatar({ name, size = 24 }) {
  const initials = initialsFor(name);
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </span>
  );
}

function RelativeTime({ iso }) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  let label;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins}m`;
  else if (mins < 60 * 24) label = `${Math.floor(mins / 60)}h`;
  else label = `${Math.floor(mins / 60 / 24)}d`;
  return <span className="text-[11px] text-slate-500 tabular-nums">{label}</span>;
}

// Activity event icons / colors / human description.
function describeEvent(ev) {
  const after = ev.after || {};
  const before = ev.before || {};
  if (ev.entity_type === 'candidates' && ev.action === 'insert') {
    return { icon: Plus, tone: 'indigo', text: `Added ${after.full_name || 'a candidate'}`, link: `/candidates/${ev.entity_id}` };
  }
  if (ev.entity_type === 'candidates' && ev.action === 'update') {
    if (before.status !== after.status) {
      const map = { hired: { icon: CheckCircle2, tone: 'emerald' }, rejected: { icon: XCircle, tone: 'rose' } };
      const m = map[after.status] || { icon: Activity, tone: 'slate' };
      return { ...m, text: `${after.full_name || 'Candidate'} → ${after.status}`, link: `/candidates/${ev.entity_id}` };
    }
    if (before.current_stage_key !== after.current_stage_key) {
      return {
        icon: ArrowRight, tone: 'violet',
        text: `${after.full_name || 'Candidate'} → ${STAGE_BY_KEY[after.current_stage_key]?.short || after.current_stage_key}`,
        link: `/candidates/${ev.entity_id}`,
      };
    }
    if (before.ai_score !== after.ai_score && after.ai_score != null) {
      return { icon: Sparkles, tone: 'amber', text: `${after.full_name || 'Candidate'} scored ${after.ai_score}`, link: `/candidates/${ev.entity_id}` };
    }
    return { icon: Activity, tone: 'slate', text: `Updated ${after.full_name || 'candidate'}`, link: `/candidates/${ev.entity_id}` };
  }
  if (ev.entity_type === 'feedback') {
    return { icon: Send, tone: 'emerald', text: `Feedback submitted`, link: null };
  }
  if (ev.entity_type === 'candidate_pipeline' && ev.action === 'update') {
    if (before.state !== after.state) {
      const stage = STAGE_BY_KEY[after.stage_key]?.short || after.stage_key;
      const tone = after.state === 'passed' ? 'emerald' : after.state === 'failed' ? 'rose' : 'slate';
      return { icon: Activity, tone, text: `${stage}: ${after.state}`, link: null };
    }
  }
  return { icon: Activity, tone: 'slate', text: `${ev.action} ${ev.entity_type}`, link: null };
}

const TONE = {
  emerald: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30',
  rose:    'text-rose-300 bg-rose-500/10 ring-rose-500/30',
  amber:   'text-amber-300 bg-amber-500/10 ring-amber-500/30',
  indigo:  'text-indigo-300 bg-indigo-500/10 ring-indigo-500/30',
  violet:  'text-violet-300 bg-violet-500/10 ring-violet-500/30',
  slate:   'text-slate-300 bg-slate-800 ring-slate-700',
};

// ─── empty state with seed CTA ────────────────────────────────────────

function SeedDataCallout({ visible }) {
  const { isAdmin } = useIsAdmin();
  if (!visible || !isAdmin) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(seedSql);
      toast.success('Seed SQL copied — paste it into Supabase SQL Editor and click Run.');
    } catch {
      toast.error('Could not copy. Open supabase/demo/seed_demo_data.sql in your repo.');
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-violet-500/10 to-pink-500/10 p-5 mb-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-lg bg-indigo-500/20 grid place-items-center text-indigo-300 shrink-0">
        <Database size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-100">Want to see Slate with sample data?</div>
        <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
          Click <strong>Copy seed SQL</strong>, paste it into your Supabase project's SQL Editor, and click Run. It seeds ~5 candidates per role across all 7 stages, with AI scores, comments, and availability slots — and skips any role that already has real data. Tagged for easy bulk-delete later.
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" icon={Copy} onClick={copy}>Copy seed SQL</Button>
          <a
            href="https://github.com/prasnajeetsamal/hiringtracker/blob/main/supabase/demo/seed_demo_data.sql"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition border border-slate-700"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useDashboardData(user?.id);

  if (isLoading) return <Spinner />;

  const k = data?.kpis || {};
  const conversion = k.totalCandidates ? Math.round((k.hiredCount / k.totalCandidates) * 100) : 0;
  const isEmpty = (k.totalCandidates ?? 0) === 0;

  return (
    <>
      <HeroCard name={data?.profile?.full_name || data?.profile?.email} kpis={k} />

      <SeedDataCallout visible={isEmpty} />

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr mb-5">
        <KpiCard
          icon={FolderKanban}
          label="Active projects"
          value={k.activeProjects ?? 0}
          sub={k.activeProjects ? `${(data?.topRoles?.length ?? 0)} roles need attention` : 'Click to create one'}
          accent="indigo"
          to="/projects"
        />
        <KpiCard
          icon={Briefcase}
          label="Open roles"
          value={k.openRoles ?? 0}
          sub={k.openRoles ? 'Awaiting candidates' : 'No open roles'}
          accent="violet"
          to="/projects"
        />
        <KpiCard
          icon={Users}
          label="Active candidates"
          value={k.activeCandidates ?? 0}
          sub={trendLabel(k.candidatesThisWeek ?? 0, k.candidatesPrevWeek ?? 0)}
          accent="emerald"
          to="/candidates"
          spark={data?.sparkline?.slice(-14) || []}
        />
        <KpiCard
          icon={ClipboardCheck}
          label="My pending feedback"
          value={k.pendingFeedback ?? 0}
          sub={k.pendingFeedback ? 'Submit before stale' : "You're all caught up"}
          accent={k.pendingFeedback ? 'amber' : 'emerald'}
          to="/my-interviews"
        />
      </div>

      {/* Funnel + side rails */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-slate-200">
              <TrendingUp size={16} className="text-indigo-300" />
              <span className="font-medium">Pipeline funnel</span>
            </div>
            {k.totalCandidates > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span>Total: <strong className="text-slate-100">{k.totalCandidates}</strong></span>
                <span>·</span>
                <span>Hired: <strong className="text-emerald-300">{k.hiredCount}</strong></span>
                <span>·</span>
                <span>Rejected: <strong className="text-rose-300">{k.rejectedCount}</strong></span>
                <span>·</span>
                <span>Conversion: <strong className="text-slate-100">{conversion}%</strong></span>
              </div>
            )}
          </div>
          {k.activeCandidates || Object.keys(data?.everReachedByStage || {}).length ? (
            <PipelineFunnel
              currentByStage={data.currentByStage}
              everReachedByStage={data.everReachedByStage}
            />
          ) : (
            <div className="text-sm text-slate-500 italic py-4">
              Add a candidate to see the funnel populate.
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200">
              <Sparkles size={16} className="text-amber-300" />
              <span className="font-medium">Top AI scores</span>
            </div>
          </div>
          {!data?.topCandidates?.length ? (
            <div className="text-sm text-slate-500 italic">Score candidates to see them here.</div>
          ) : (
            <div className="space-y-2">
              {data.topCandidates.map((c) => (
                <Link key={c.id} to={`/candidates/${c.id}`} className="flex items-center gap-3 -mx-2 px-2 py-1.5 rounded-md hover:bg-slate-900/40 transition">
                  <ScoreGauge score={c.ai_score} size={36} />
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
      </div>

      {/* Bottom: roles + activity + stale */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-2 text-slate-200 mb-3">
            <Briefcase size={16} className="text-violet-300" />
            <span className="font-medium">Roles needing attention</span>
          </div>
          {!data?.topRoles?.length ? (
            <div className="text-sm text-slate-500 italic">No active candidates on any role yet.</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {data.topRoles.map((r) => (
                <Link key={r.roleId} to={`/projects/${r.projectId}/roles/${r.roleId}`} className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-md hover:bg-slate-900/40 transition">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">{r.roleTitle}</div>
                    <div className="text-[11px] text-slate-500 truncate">{r.projectName}</div>
                  </div>
                  <span className="text-sm font-semibold text-slate-100 tabular-nums">{r.total}</span>
                  <ArrowRight size={14} className="text-slate-500" />
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
            <span className="text-[11px] text-slate-500">{STALE_DAYS}+ days idle</span>
          </div>
          {!data?.stale?.length ? (
            <div className="text-sm text-slate-500 italic">No stale candidates. 🎉</div>
          ) : (
            <div className="space-y-1">
              {data.stale.map((c) => {
                const days = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / (24 * 60 * 60 * 1000));
                return (
                  <Link key={c.id} to={`/candidates/${c.id}`} className="flex items-center gap-2.5 py-1.5 -mx-2 px-2 rounded-md hover:bg-slate-900/40 transition">
                    <Avatar name={c.full_name || 'Unnamed'} size={26} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                      <div className="text-[11px] text-slate-500 truncate">{c.role?.title}</div>
                    </div>
                    <StageBadge stageKey={c.current_stage_key} state="in_progress" size="sm" />
                    <span className="text-[11px] text-rose-300 tabular-nums w-8 text-right">{days}d</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 text-slate-200 mb-3">
            <Clock size={16} className="text-indigo-300" />
            <span className="font-medium">Recent activity</span>
          </div>
          {!data?.recentAudit?.length ? (
            <div className="text-sm text-slate-500 italic">
              No activity yet. Audit triggers (migration 0004) populate this when candidates / pipeline / feedback change.
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentAudit.map((ev) => {
                const { icon: Icon, tone, text, link } = describeEvent(ev);
                const actor = ev.actor?.full_name || ev.actor?.email || 'Someone';
                const Inner = (
                  <div className="flex items-start gap-2.5">
                    <span className={`w-6 h-6 rounded-md grid place-items-center ring-1 ${TONE[tone] || TONE.slate} shrink-0`}>
                      <Icon size={11} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200">
                        <span className="text-slate-300">{actor}</span>{' '}
                        <span className="text-slate-400">{text}</span>
                      </div>
                    </div>
                    <RelativeTime iso={ev.created_at} />
                  </div>
                );
                return (
                  <div key={ev.id}>
                    {link ? (
                      <Link to={link} className="block -mx-2 px-2 py-0.5 rounded-md hover:bg-slate-900/40 transition">{Inner}</Link>
                    ) : Inner}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Recently added grid */}
      {data?.recentCandidates?.length > 0 && (
        <div className="mt-5">
          <Card padding={false}>
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <Plus size={14} className="text-indigo-300" />
              <span className="text-sm font-medium text-slate-200">Recently added candidates</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-800/60">
              {data.recentCandidates.map((c) => (
                <Link key={c.id} to={`/candidates/${c.id}`} className="bg-slate-900/40 hover:bg-slate-900/80 transition px-4 py-3 flex items-center gap-3">
                  <Avatar name={c.full_name || 'Unnamed'} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">{c.full_name || 'Unnamed'}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {c.role?.title} · {new Date(c.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <StageBadge stageKey={c.current_stage_key} state="in_progress" size="sm" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
