// api/cron-scheduled-reports.js
// Hourly Vercel cron. Reads `scheduled_reports`, picks the ones due at this
// UTC hour, builds the report HTML server-side, and emails each recipient
// the file as an HTML attachment.
//
// "Due" means:
//   - active = true
//   - cadence matches current UTC date:
//       daily   - any day
//       weekly  - current weekday matches day_of_week (0-6)
//       monthly - current day-of-month matches day_of_month (1-28)
//   - schedule.hour === current UTC hour
//   - last_sent_at is null OR more than 23h ago (defensive de-dupe)
//
// On success, writes last_sent_at to prevent re-firing within the hour.
export const config = { runtime: 'nodejs' };

import { supabaseAdmin } from '../lib/supabase-admin.js';
import { emailScheduledReport } from '../lib/email.js';
import { renderHtmlDocument, esc } from '../lib/htmlExport.js';

const STAGES = [
  { key: 'resume_submitted',   label: 'Resume Submitted' },
  { key: 'hm_review',          label: 'HM Review' },
  { key: 'technical_written',  label: 'Technical Written' },
  { key: 'technical_interview',label: 'Technical Interview' },
  { key: 'problem_solving',    label: 'Problem Solving' },
  { key: 'case_study',         label: 'Case Study' },
  { key: 'offer',              label: 'Offer' },
  { key: 'joined_fractal',     label: 'Joined Fractal' },
  { key: 'rejected_offer',     label: 'Rejected Offer' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};
const fmtDuration = (ms) => {
  if (!isFinite(ms) || ms <= 0) return '-';
  const days = ms / DAY_MS;
  if (days < 1) return `${(ms / (60 * 60 * 1000)).toFixed(1)} hours`;
  if (days < 14) return `${days.toFixed(1)} days`;
  return `${Math.round(days)} days`;
};

function isDue(schedule, now) {
  if (now.getUTCHours() !== Number(schedule.hour ?? 8)) return false;
  if (schedule.cadence === 'daily') return true;
  if (schedule.cadence === 'weekly') return now.getUTCDay() === Number(schedule.day_of_week ?? 1);
  if (schedule.cadence === 'monthly') return now.getUTCDate() === Number(schedule.day_of_month ?? 1);
  return false;
}

async function buildReportData(sb, { project_id, role_id }) {
  // Pull the same shape useReportData uses on the client.
  const [projects, roles, candidatesAll, pipelineAll] = await Promise.all([
    sb.from('hiring_projects').select('id, name'),
    sb.from('roles').select('id, project_id, title'),
    sb.from('candidates').select(`
      id, full_name, status, current_stage_key, ai_score, ai_analysis, source, created_at, updated_at, role_id,
      role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )
    `),
    sb.from('candidate_pipeline').select('id, candidate_id, stage_key, state, started_at, completed_at'),
  ]);

  const filtered = (candidatesAll.data || []).filter((c) => {
    if (project_id && c.role?.project_id !== project_id) return false;
    if (role_id && c.role_id !== role_id) return false;
    return true;
  });
  const cidSet = new Set(filtered.map((c) => c.id));
  const pipelineRows = (pipelineAll.data || []).filter((p) => cidSet.has(p.candidate_id));

  const kpis = {
    total: filtered.length,
    active: filtered.filter((c) => c.status === 'active').length,
    hired: filtered.filter((c) => c.status === 'hired').length,
    rejected: filtered.filter((c) => c.status === 'rejected').length,
  };

  const activeByStage = {}, passedByStage = {}, failedByStage = {}, skippedByStage = {}, reachedByStage = {};
  filtered.forEach((c) => {
    if (c.status === 'active') {
      const k = c.current_stage_key || 'resume_submitted';
      activeByStage[k] = (activeByStage[k] || 0) + 1;
    }
  });
  const reached = new Map();
  pipelineRows.forEach((p) => {
    if (p.state === 'passed')  passedByStage[p.stage_key]  = (passedByStage[p.stage_key]  || 0) + 1;
    if (p.state === 'failed')  failedByStage[p.stage_key]  = (failedByStage[p.stage_key]  || 0) + 1;
    if (p.state === 'skipped') skippedByStage[p.stage_key] = (skippedByStage[p.stage_key] || 0) + 1;
    if (['in_progress','passed','failed','skipped'].includes(p.state)) {
      if (!reached.has(p.candidate_id)) reached.set(p.candidate_id, new Set());
      reached.get(p.candidate_id).add(p.stage_key);
    }
  });
  reached.forEach((set) => set.forEach((k) => { reachedByStage[k] = (reachedByStage[k] || 0) + 1; }));

  const conversionByStage = {};
  STAGES.forEach((s) => {
    const r = reachedByStage[s.key] || 0;
    const pass = (passedByStage[s.key] || 0) + (skippedByStage[s.key] || 0);
    conversionByStage[s.key] = r > 0 ? Math.round((pass / r) * 100) : null;
  });

  const durations = {};
  STAGES.forEach((s) => { durations[s.key] = []; });
  pipelineRows.forEach((p) => {
    if (p.started_at && p.completed_at) {
      const d = new Date(p.completed_at).getTime() - new Date(p.started_at).getTime();
      if (d >= 0) durations[p.stage_key].push(d);
    }
  });
  const stageMedians = {};
  STAGES.forEach((s) => { stageMedians[s.key] = median(durations[s.key]); });

  const timeToHire = [];
  filtered.forEach((c) => {
    if (c.status !== 'hired') return;
    const created = new Date(c.created_at).getTime();
    const offerRow = pipelineRows.find((p) => p.candidate_id === c.id && p.stage_key === 'offer' && p.state === 'passed');
    const ts = offerRow?.completed_at ? new Date(offerRow.completed_at).getTime() : new Date(c.updated_at).getTime();
    if (ts >= created) timeToHire.push(ts - created);
  });

  const bySource = {};
  filtered.forEach((c) => { const k = c.source || 'manual'; bySource[k] = (bySource[k] || 0) + 1; });

  const topCandidates = filtered
    .filter((c) => c.status === 'active' && typeof c.ai_score === 'number')
    .sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0))
    .slice(0, 5);

  const rejectedByStage = {};
  filtered.forEach((c) => {
    if (c.status !== 'rejected') return;
    const failed = pipelineRows.find((p) => p.candidate_id === c.id && p.state === 'failed');
    const k = failed?.stage_key || c.current_stage_key || 'resume_submitted';
    rejectedByStage[k] = (rejectedByStage[k] || 0) + 1;
  });

  // 60-day activity heatmap
  const HEATMAP_DAYS = 60;
  const anchor = new Date(Date.now() - HEATMAP_DAYS * DAY_MS);
  anchor.setUTCHours(0, 0, 0, 0);
  const heatmapDays = Array.from({ length: HEATMAP_DAYS }, (_, i) => ({
    date: new Date(anchor.getTime() + i * DAY_MS),
    added: 0, advanced: 0, rejected: 0,
  }));
  const dayIndex = (iso) => {
    if (!iso) return -1;
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor((d.getTime() - anchor.getTime()) / DAY_MS);
  };
  filtered.forEach((c) => {
    const i = dayIndex(c.created_at);
    if (i >= 0 && i < HEATMAP_DAYS) heatmapDays[i].added += 1;
  });
  pipelineRows.forEach((p) => {
    if (!p.completed_at) return;
    const i = dayIndex(p.completed_at);
    if (i < 0 || i >= HEATMAP_DAYS) return;
    if (p.state === 'passed') heatmapDays[i].advanced += 1;
    else if (p.state === 'failed') heatmapDays[i].rejected += 1;
  });

  return {
    kpis, activeByStage, passedByStage, failedByStage, skippedByStage,
    reachedByStage, conversionByStage, stageMedians, rejectedByStage,
    timeToHire, bySource, topCandidates, heatmapDays,
    projectName: project_id ? (projects.data || []).find((p) => p.id === project_id)?.name : null,
    roleName: role_id ? (roles.data || []).find((r) => r.id === role_id)?.title : null,
  };
}

function buildBody(data, sections) {
  const on = (k) => !sections || sections.length === 0 || sections.includes(k);
  const k = data.kpis;
  const conv = k.total ? Math.round((k.hired / k.total) * 100) : 0;
  const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

  const kpiCard = (label, value, hint, tone) => `
    <div class="kpi kpi--${tone}">
      <div class="kpi__label">${esc(label)}</div>
      <div class="kpi__value">${esc(value)}</div>
      ${hint ? `<div class="kpi__hint">${esc(hint)}</div>` : ''}
    </div>`;

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
      ${STAGES.map((s) => {
        const active = data.activeByStage[s.key] || 0;
        const passed = data.passedByStage[s.key] || 0;
        const failed = data.failedByStage[s.key] || 0;
        const skipped = data.skippedByStage[s.key] || 0;
        const total = Math.max(1, active + passed + failed + skipped);
        const seg = (n, c) => n > 0 ? `<span class="seg" style="width:${(n / total) * 100}%;background:${c};"></span>` : '';
        return `
          <div class="stage">
            <div class="stage__label">${esc(s.label)}</div>
            <div class="stage__bar">
              ${seg(active, '#6366f1')}${seg(passed, '#10b981')}${seg(failed, '#f43f5e')}${seg(skipped, '#94a3b8')}
            </div>
            <div class="stage__counts">
              <span class="dot dot--indigo"></span>${active}
              <span class="dot dot--emerald"></span>${passed}
              <span class="dot dot--rose"></span>${failed}
              <span class="dot dot--slate"></span>${skipped}
              <span class="stage__reached">reached ${data.reachedByStage[s.key] || 0}</span>
            </div>
          </div>`;
      }).join('')}
    </div>`;

  const timesBlock = !on('times') ? '' : `
    <div class="panel">
      <div class="panel__title">Time spent at each stage</div>
      <table>
        <thead><tr><th>Stage</th><th class="num">Reached</th><th class="num">Pass-through %</th><th class="num">Median time</th><th class="num">Rejected here</th></tr></thead>
        <tbody>
          ${STAGES.map((s) => `
            <tr>
              <td>${esc(s.label)}</td>
              <td class="num">${data.reachedByStage[s.key] || 0}</td>
              <td class="num">${data.conversionByStage[s.key] != null ? data.conversionByStage[s.key] + '%' : '-'}</td>
              <td class="num">${esc(fmtDuration(data.stageMedians[s.key]))}</td>
              <td class="num rose">${data.rejectedByStage[s.key] || 0}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const heatmapBlock = !on('heatmap') || !data.heatmapDays?.length ? '' : (() => {
    const days = data.heatmapDays;
    const maxTotal = Math.max(1, ...days.map((d) => d.added + d.advanced + d.rejected));
    const totalAdded = days.reduce((s, d) => s + d.added, 0);
    const totalAdvanced = days.reduce((s, d) => s + d.advanced, 0);
    const totalRejected = days.reduce((s, d) => s + d.rejected, 0);
    const cols = days.map((d) => {
      const total = d.added + d.advanced + d.rejected;
      const colHeight = total === 0 ? 0 : Math.max(2, (total / maxTotal) * 100);
      const seg = (n, color) => n > 0 ? `<div style="width:100%;background:${color};height:${(n / Math.max(1, total)) * 100}%"></div>` : '';
      return `
        <div style="flex:1;min-width:3px;height:100%;display:flex;flex-direction:column-reverse;border-radius:2px;overflow:hidden;">
          ${total === 0
            ? `<div style="width:100%;height:100%;background:rgba(30,41,59,0.2);"></div>`
            : `<div style="width:100%;height:${colHeight}%;display:flex;flex-direction:column-reverse;">
                 ${seg(d.added, '#6366f1')}${seg(d.advanced, '#10b981')}${seg(d.rejected, '#f43f5e')}
               </div>`}
        </div>`;
    }).join('');
    return `
      <div class="panel">
        <div class="panel__title">Activity heatmap (last 60 days)</div>
        <div style="display:flex;gap:16px;font-size:11px;color:var(--ink-dim);margin-bottom:8px;flex-wrap:wrap;">
          <span><span style="display:inline-block;width:10px;height:10px;background:#6366f1;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Added <strong>${totalAdded}</strong></span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Advanced <strong>${totalAdvanced}</strong></span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#f43f5e;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>Rejected <strong>${totalRejected}</strong></span>
        </div>
        <div style="width:100%;height:96px;background:rgba(15,23,42,0.4);border:1px solid var(--panel-border);border-radius:8px;padding:6px;display:flex;align-items:flex-end;gap:1px;">
          ${cols}
        </div>
      </div>`;
  })();

  const sourceRows = Object.entries(data.bySource).sort((a, b) => b[1] - a[1]).map(([src, count]) => `
    <div class="source-row">
      <div class="source-row__label">${esc(src)}</div>
      <div class="source-row__bar"><span style="width:${(count / Math.max(1, k.total)) * 100}%"></span></div>
      <div class="source-row__count">${count}</div>
    </div>`).join('');
  const topRows = data.topCandidates.length === 0
    ? '<div class="muted">No active candidates have been scored yet.</div>'
    : data.topCandidates.map((c) => `
        <div class="top-row">
          <div class="top-row__score">${c.ai_score}</div>
          <div class="top-row__main">
            <div class="top-row__name">${esc(c.full_name || 'Unnamed')}</div>
            <div class="top-row__sub">${esc(c.role?.title || '')} · ${esc(STAGE_BY_KEY[c.current_stage_key]?.label || c.current_stage_key)}</div>
          </div>
          <div class="top-row__rec rec--${esc((c.ai_analysis?.recommendation || '').toLowerCase())}">${esc(c.ai_analysis?.recommendation || '')}</div>
        </div>`).join('');

  const bottomBlock = (!on('sources') && !on('topscorers')) ? '' : `
    <div class="grid-2">
      ${on('sources') ? `<div class="panel"><div class="panel__title">Where candidates came from</div>${sourceRows || '<div class="muted">No data.</div>'}</div>` : ''}
      ${on('topscorers') ? `<div class="panel"><div class="panel__title">Top candidates by AI score</div>${topRows}</div>` : ''}
    </div>`;

  return [kpiBlock, stagesBlock, timesBlock, heatmapBlock, bottomBlock].filter(Boolean).join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== expected) { res.status(401).json({ error: 'Unauthorized' }); return; }
  }

  try {
    const sb = supabaseAdmin();
    const { data: schedules, error } = await sb
      .from('scheduled_reports')
      .select('*')
      .eq('active', true);
    if (error) throw new Error('Failed to read schedules: ' + error.message);

    const now = new Date();
    const due = (schedules || []).filter((s) => {
      if (!isDue(s, now)) return false;
      if (s.last_sent_at) {
        const ageHours = (now.getTime() - new Date(s.last_sent_at).getTime()) / (60 * 60 * 1000);
        if (ageHours < 23) return false; // de-dupe within the day
      }
      return true;
    });

    let sent = 0;
    for (const s of due) {
      const data = await buildReportData(sb, { project_id: s.project_id, role_id: s.role_id });
      const scopeLabel = data.projectName && data.roleName
        ? `${data.roleName} - ${data.projectName}`
        : data.projectName || 'All projects · all roles';
      const html = renderHtmlDocument({
        title: `Slate - ${s.name}`,
        header: {
          eyebrow: 'Slate · Hiring Reports',
          title: scopeLabel,
          subtitle: `${data.kpis.total} candidates considered`,
        },
        body: buildBody(data, s.sections),
      });
      for (const to of (s.recipients || [])) {
        await emailScheduledReport({
          to,
          scheduleName: s.name,
          scopeLabel,
          html,
          attachmentFilename: `slate-report-${s.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.html`,
        });
        sent += 1;
      }
      await sb.from('scheduled_reports').update({ last_sent_at: now.toISOString() }).eq('id', s.id);
    }

    res.status(200).json({ due: due.length, emails_sent: sent });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
