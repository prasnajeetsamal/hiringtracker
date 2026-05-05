import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'hiring_team', label: 'Hiring Team' },
  { value: 'interviewer', label: 'Interviewer' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, timezone')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [draft, setDraft] = useState({ full_name: '', role: 'interviewer', timezone: 'UTC' });
  useEffect(() => {
    if (profile) {
      setDraft({
        full_name: profile.full_name || '',
        role: profile.role || 'interviewer',
        timezone: profile.timezone || 'UTC',
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: draft.full_name || null,
          role: draft.role,
          timezone: draft.timezone || 'UTC',
        })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Profile saved');
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your profile. Admin-only edits to other users' roles land in v1.0."
        actions={<Button icon={Save} onClick={() => save.mutate()} loading={save.isPending}>Save</Button>}
      />

      <Card className="max-w-xl">
        <div className="space-y-4">
          <Field label="Email">
            <div className="text-sm text-slate-300">{profile?.email}</div>
          </Field>
          <Field label="Full name">
            <input
              value={draft.full_name}
              onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
              placeholder="e.g. Alex Kumar"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Role">
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="text-[11px] text-slate-500 mt-1">
              v0.1 lets you self-select. v1.0 restricts role edits to admins.
            </div>
          </Field>
          <Field label="Timezone">
            <input
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              placeholder="e.g. Asia/Kolkata"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>
      </Card>
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
