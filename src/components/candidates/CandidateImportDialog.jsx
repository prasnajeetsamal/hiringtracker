import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linkedin, FileUp, User as UserIcon, Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import FileDrop from '../common/FileDrop.jsx';
import { supabase } from '../../lib/supabase.js';
import { uploadResume, createCandidate } from '../../lib/api.js';

const TABS = [
  { id: 'upload',   label: 'Upload resume', icon: FileUp },
  { id: 'linkedin', label: 'LinkedIn URL',  icon: Linkedin },
  { id: 'manual',   label: 'Manual',        icon: UserIcon },
];

/**
 * Add-candidate dialog.
 *
 * - When `roleId` prop is provided, the candidate is added to that role
 *   directly (the dialog hides the role selector).
 * - When `roleId` is omitted (e.g. opening from the global Candidates
 *   page), a searchable role selector appears at the top.
 */
export default function CandidateImportDialog({ open, onClose, roleId: presetRoleId }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', linkedinUrl: '' });
  const [pickedRoleId, setPickedRoleId] = useState(null);
  const [roleSearch, setRoleSearch] = useState('');

  const effectiveRoleId = presetRoleId || pickedRoleId;
  const needsRolePicker = !presetRoleId;

  // Reset everything whenever the modal closes-and-reopens.
  useEffect(() => {
    if (open) {
      setTab('upload');
      setFile(null);
      setForm({ fullName: '', email: '', phone: '', linkedinUrl: '' });
      setPickedRoleId(null);
      setRoleSearch('');
    }
  }, [open]);

  const { data: roles } = useQuery({
    queryKey: ['roles-for-add-candidate'],
    enabled: open && needsRolePicker,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, title, level, location, status, project:hiring_projects ( id, name )')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filteredRoles = (roles || [])
    .filter((r) => {
      if (!roleSearch) return true;
      const q = roleSearch.toLowerCase();
      return [r.title, r.level, r.location, r.project?.name].filter(Boolean).join(' ').toLowerCase().includes(q);
    })
    .slice(0, 10);

  const close = () => onClose();

  const submit = useMutation({
    mutationFn: async () => {
      if (!effectiveRoleId) throw new Error('Pick a role first.');
      if (tab === 'upload') {
        if (!file) throw new Error('Please choose a resume file.');
        return uploadResume({ file, roleId: effectiveRoleId, ...form });
      }
      if (tab === 'linkedin' && !form.linkedinUrl.trim()) {
        throw new Error('Paste a LinkedIn URL.');
      }
      return createCandidate({
        roleId: effectiveRoleId,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        linkedinUrl: form.linkedinUrl,
        source: tab === 'linkedin' ? 'linkedin' : 'manual',
      });
    },
    onSuccess: async (result) => {
      const candidate = result?.candidate;
      await Promise.all([
        qc.refetchQueries({ queryKey: ['candidates', effectiveRoleId], exact: true }),
        qc.refetchQueries({ queryKey: ['candidates-all'], exact: true }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success(candidate?.full_name ? `Added ${candidate.full_name}` : 'Candidate added');
      close();
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedRole = (roles || []).find((r) => r.id === pickedRoleId);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add candidate"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button
            onClick={() => submit.mutate()}
            loading={submit.isPending}
            disabled={!effectiveRoleId}
          >
            Add candidate
          </Button>
        </>
      }
    >
      {/* Role picker — only when no preset roleId was passed */}
      {needsRolePicker && (
        <div className="mb-4 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
            <Briefcase size={11} className="text-indigo-300" />
            Role to add this candidate to
          </div>
          {selectedRole ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-100 truncate">{selectedRole.title}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {[selectedRole.level, selectedRole.location, selectedRole.project?.name].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => { setPickedRoleId(null); setRoleSearch(''); }}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                placeholder="Search roles by title, project…"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-1.5 max-h-40 overflow-y-auto space-y-1">
                {filteredRoles.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic px-1 py-2">
                    {roles?.length === 0 ? 'No roles exist yet — create one first.' : 'No matches.'}
                  </div>
                ) : (
                  filteredRoles.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setPickedRoleId(r.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-800/60 text-xs"
                    >
                      <div className="text-slate-100">{r.title}</div>
                      <div className="text-[10px] text-slate-500">
                        {[r.level, r.location, r.project?.name].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex rounded-lg bg-slate-800/60 p-0.5 text-sm border border-slate-700 mb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
              tab === id ? 'bg-slate-700 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div className="space-y-3">
          <FileDrop value={file} onChange={setFile} />
          <div className="text-[11px] text-slate-500">
            We'll parse the resume and auto-create the candidate. You can edit name + email after.
          </div>
        </div>
      )}

      {tab === 'linkedin' && (
        <div className="space-y-3">
          <Field label="LinkedIn URL">
            <Input
              value={form.linkedinUrl}
              onChange={(v) => setForm({ ...form, linkedinUrl: v })}
              placeholder="https://www.linkedin.com/in/…"
            />
          </Field>
          <div className="text-[11px] text-slate-500">
            We store the URL only. <strong>AI scoring is unavailable for LinkedIn-only candidates</strong> — upload a resume later to enable it.
          </div>
        </div>
      )}

      {tab !== 'upload' && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Full name">
            <Input value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </Field>
          {tab === 'manual' && (
            <Field label="LinkedIn URL (optional)">
              <Input value={form.linkedinUrl} onChange={(v) => setForm({ ...form, linkedinUrl: v })} />
            </Field>
          )}
        </div>
      )}
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
