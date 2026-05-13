import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2, Pause, Play, X as XIcon } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';

const CADENCES = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_SECTIONS = [
  { key: 'kpis',       label: 'KPI summary' },
  { key: 'stages',     label: 'Pipeline breakdown' },
  { key: 'times',      label: 'Time per stage' },
  { key: 'heatmap',    label: 'Activity heatmap' },
  { key: 'sources',    label: 'Source breakdown' },
  { key: 'topscorers', label: 'Top scorers' },
];

function cadenceLabel(s) {
  if (s.cadence === 'daily')   return `Daily at ${String(s.hour).padStart(2, '0')}:00 UTC`;
  if (s.cadence === 'weekly')  return `Every ${WEEKDAYS[s.day_of_week ?? 1]} at ${String(s.hour).padStart(2, '0')}:00 UTC`;
  if (s.cadence === 'monthly') return `Day ${s.day_of_month ?? 1} of each month at ${String(s.hour).padStart(2, '0')}:00 UTC`;
  return s.cadence;
}

export default function ScheduledReportsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { data: schedules, isLoading, error: scheduleError } = useQuery({
    queryKey: ['scheduled-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_reports')
        .select(`
          id, name, cadence, day_of_week, day_of_month, hour, sections, recipients,
          active, last_sent_at, created_at, created_by, project_id, role_id,
          project:hiring_projects ( id, name ),
          role:roles ( id, title )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-flat'],
    queryFn: async () => {
      const { data } = await supabase.from('hiring_projects').select('id, name').order('name');
      return data || [];
    },
  });
  const { data: roles } = useQuery({
    queryKey: ['roles-flat'],
    queryFn: async () => {
      const { data } = await supabase.from('roles').select('id, title, project_id').order('title');
      return data || [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload) => {
      const row = {
        name: payload.name?.trim(),
        cadence: payload.cadence,
        day_of_week: payload.cadence === 'weekly' ? Number(payload.day_of_week ?? 1) : null,
        day_of_month: payload.cadence === 'monthly' ? Number(payload.day_of_month ?? 1) : null,
        hour: Math.max(0, Math.min(23, Number(payload.hour ?? 8))),
        project_id: payload.project_id || null,
        role_id: payload.role_id || null,
        sections: payload.sections,
        recipients: payload.recipients,
        active: payload.active,
      };
      if (!row.name) throw new Error('Name is required.');
      if (!row.recipients?.length) throw new Error('At least one recipient email is required.');
      if (!row.sections?.length) throw new Error('Pick at least one section to include.');
      if (payload.id) {
        const { error } = await supabase.from('scheduled_reports').update(row).eq('id', payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('scheduled_reports').insert({ ...row, created_by: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing?.id ? 'Schedule updated' : 'Schedule created');
      qc.invalidateQueries({ queryKey: ['scheduled-reports'] });
      setEditorOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => {
      const { error } = await supabase.from('scheduled_reports').update({ active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-reports'] }),
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('scheduled_reports').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Schedule deleted');
      qc.invalidateQueries({ queryKey: ['scheduled-reports'] });
      setConfirmDelete(null);
    },
    onError: (e) => toast.error(e.message),
  });

  if (scheduleError) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        <div className="font-medium mb-1">Couldn't load schedules.</div>
        <div className="text-xs text-rose-300/90 break-words">{scheduleError.message}</div>
        <div className="text-xs text-slate-400 mt-2">
          If you haven't run migration <code className="text-slate-300">0010_scheduled_reports.sql</code> yet, do that first in Supabase SQL editor.
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Scheduled Reports"
        subtitle="Email the hiring report on a recurring cadence. Recipients get a self-contained HTML file - no Slate login required to view."
        actions={
          <Button icon={Plus} onClick={() => { setEditing(null); setEditorOpen(true); }}>
            New schedule
          </Button>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : !schedules?.length ? (
        <EmptyState
          icon={Clock}
          title="No schedules yet"
          description="Create a recurring report to email a hiring summary to anyone, on any cadence."
          action={
            <Button icon={Plus} onClick={() => { setEditing(null); setEditorOpen(true); }}>
              New schedule
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-medium text-slate-100">{s.name}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                      s.active
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-700/30 text-slate-400 border-slate-700'
                    }`}>
                      {s.active ? 'active' : 'paused'}
                    </span>
                    <span className="text-[11px] text-slate-500">{cadenceLabel(s)}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Scope: {s.role?.title ? `${s.role.title} - ${s.project?.name}` : (s.project?.name || 'All projects')}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Sections: {(s.sections || []).map((k) => ALL_SECTIONS.find((o) => o.key === k)?.label || k).join(', ') || '-'}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 break-all">
                    To: {(s.recipients || []).join(', ')}
                  </div>
                  {s.last_sent_at && (
                    <div className="text-[11px] text-slate-500 mt-1.5">
                      Last sent {new Date(s.last_sent_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleActive.mutate({ id: s.id, active: !s.active })}
                    className="text-[11px] px-2.5 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700 inline-flex items-center gap-1"
                  >
                    {s.active ? (<><Pause size={11} /> Pause</>) : (<><Play size={11} /> Resume</>)}
                  </button>
                  <button
                    onClick={() => { setEditing(s); setEditorOpen(true); }}
                    className="text-[11px] px-2.5 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDelete(s)}
                    className="text-[11px] px-2.5 py-1 rounded-md text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-500/30 inline-flex items-center gap-1"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ScheduleEditor
        open={editorOpen}
        schedule={editing}
        projects={projects || []}
        roles={roles || []}
        loading={upsert.isPending}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        onSubmit={(p) => upsert.mutate(p)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove.mutate(confirmDelete.id)}
        loading={remove.isPending}
        title="Delete schedule?"
        message={confirmDelete && <p>This permanently removes <strong className="text-slate-100">{confirmDelete.name}</strong>. Recipients will no longer receive the report.</p>}
      />
    </>
  );
}

function ScheduleEditor({ open, schedule, projects, roles, onSubmit, onClose, loading }) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [projectId, setProjectId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [sections, setSections] = useState(ALL_SECTIONS.map((s) => s.key));
  const [recipientsText, setRecipientsText] = useState('');
  const [active, setActive] = useState(true);

  React.useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name || '');
      setCadence(schedule.cadence || 'weekly');
      setDayOfWeek(schedule.day_of_week ?? 1);
      setDayOfMonth(schedule.day_of_month ?? 1);
      setHour(schedule.hour ?? 8);
      setProjectId(schedule.project_id || '');
      setRoleId(schedule.role_id || '');
      setSections(schedule.sections || ALL_SECTIONS.map((s) => s.key));
      setRecipientsText((schedule.recipients || []).join(', '));
      setActive(schedule.active ?? true);
    } else {
      setName('');
      setCadence('weekly');
      setDayOfWeek(1);
      setDayOfMonth(1);
      setHour(8);
      setProjectId('');
      setRoleId('');
      setSections(ALL_SECTIONS.map((s) => s.key));
      setRecipientsText('');
      setActive(true);
    }
  }, [open, schedule]);

  const rolesForProject = projectId ? roles.filter((r) => r.project_id === projectId) : roles;
  React.useEffect(() => {
    if (roleId && !rolesForProject.some((r) => r.id === roleId)) setRoleId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const toggleSection = (k) => {
    setSections((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  };

  const submit = () => {
    const recipients = recipientsText
      .split(/[,\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    onSubmit({
      id: schedule?.id,
      name,
      cadence,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
      hour,
      project_id: projectId || null,
      role_id: roleId || null,
      sections,
      recipients,
      active,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule?.id ? 'Edit schedule' : 'New schedule'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={loading}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={setName} placeholder="e.g. Weekly hiring snapshot" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Hour (UTC)">
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
        </div>

        {cadence === 'weekly' && (
          <Field label="Day of week">
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </Field>
        )}
        {cadence === 'monthly' && (
          <Field label="Day of month (1-28)">
            <Input
              type="number"
              value={dayOfMonth}
              onChange={(v) => setDayOfMonth(Math.max(1, Math.min(28, Number(v) || 1)))}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project (optional)">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Role (optional)">
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All roles</option>
              {rolesForProject.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Sections to include">
          <div className="grid grid-cols-2 gap-1.5">
            {ALL_SECTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-2 p-2 rounded-lg border border-slate-800 hover:border-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sections.includes(s.key)}
                  onChange={() => toggleSection(s.key)}
                  className="w-4 h-4 accent-indigo-500"
                />
                <span className="text-sm text-slate-200">{s.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Recipients (comma or newline separated)">
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            rows={3}
            placeholder="alice@example.com, bob@example.com"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>

        <label className="flex items-center gap-2 text-xs text-slate-300 pt-1">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 accent-indigo-500"
          />
          Active (uncheck to pause without deleting)
        </label>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Input({ value, onChange, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      {...rest}
    />
  );
}
