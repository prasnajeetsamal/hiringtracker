import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Copy, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { inviteUser, updateUserRole } from '../lib/api.js';

const ROLE_OPTIONS = [
  { value: 'admin',          label: 'Admin' },
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'hiring_team',    label: 'Hiring Team' },
  { value: 'interviewer',    label: 'Interviewer' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

export default function PeoplePage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: me } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, role').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const isAdmin = me?.role === 'admin';

  const { data: people, isLoading } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, timezone, created_at')
        .order('full_name', { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', role: 'interviewer' });
  const [inviteUrl, setInviteUrl] = useState(null);

  const invite = useMutation({
    mutationFn: async () => {
      if (!form.email.trim()) throw new Error('Email is required.');
      return inviteUser({ email: form.email.trim(), fullName: form.fullName.trim(), role: form.role });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['people'] });
      if (res.inviteUrl) {
        // SMTP not configured - surface the link to share manually
        setInviteUrl(res.inviteUrl);
        toast('Invite link generated', { icon: 'ℹ️' });
      } else {
        toast.success('Invite email sent');
        setInviteOpen(false);
        setForm({ email: '', fullName: '', role: 'interviewer' });
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }) => updateUserRole({ userId, role }),
    onSuccess: () => {
      toast.success('Role updated');
      qc.invalidateQueries({ queryKey: ['people'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Invite interviewers and hiring team members. Admins can change roles."
        actions={
          <Button icon={UserPlus} onClick={() => { setInviteOpen(true); setInviteUrl(null); }}>
            Invite person
          </Button>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Timezone</th>
                </tr>
              </thead>
              <tbody>
                {(people || []).map((p) => (
                  <tr key={p.id} className="border-b border-slate-800/60">
                    <td className="px-4 py-2.5 text-slate-100">{p.full_name || <span className="text-slate-500">-</span>}</td>
                    <td className="px-4 py-2.5 text-slate-300">{p.email}</td>
                    <td className="px-4 py-2.5">
                      {isAdmin && p.id !== user.id ? (
                        <select
                          value={p.role}
                          onChange={(e) => changeRole.mutate({ userId: p.id, role: e.target.value })}
                          className="bg-slate-950/60 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-300">{ROLE_LABEL[p.role] || p.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-400">{p.timezone || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => { setInviteOpen(false); setInviteUrl(null); }}
        title="Invite a person"
        footer={
          inviteUrl ? (
            <Button onClick={() => { setInviteOpen(false); setInviteUrl(null); setForm({ email: '', fullName: '', role: 'interviewer' }); }}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={() => invite.mutate()} loading={invite.isPending}>Send invite</Button>
            </>
          )
        }
      >
        {inviteUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Email delivery isn't set up in your Supabase project - share this invite link with <strong>{form.email}</strong> manually:
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={Copy}
                onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('Copied'); }}
              >
                Copy
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Configure SMTP in Supabase Auth settings to send invite emails automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Email">
              <Input
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="someone@example.com"
                type="email"
                autoFocus
              />
            </Field>
            <Field label="Full name (optional)">
              <Input value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} placeholder="e.g. Alex Kumar" />
            </Field>
            <Field label="Role">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ROLE_OPTIONS.filter((o) => o.value !== 'admin' || isAdmin).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <p className="text-[11px] text-slate-500 flex items-start gap-1.5 pt-1">
              <Mail size={11} className="mt-0.5 shrink-0" />
              <span>
                We'll email an invite link they can use to set a password. If your Supabase project doesn't have SMTP configured, we'll show the link here so you can share it manually.
              </span>
            </p>
          </div>
        )}
      </Modal>
    </>
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

function Input({ value, onChange, ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      {...rest}
    />
  );
}
