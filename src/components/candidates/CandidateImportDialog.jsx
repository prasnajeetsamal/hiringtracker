import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Linkedin, FileUp, User as UserIcon } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import FileDrop from '../common/FileDrop.jsx';
import { uploadResume, createCandidate } from '../../lib/api.js';

const TABS = [
  { id: 'upload',   label: 'Upload resume', icon: FileUp },
  { id: 'linkedin', label: 'LinkedIn URL',  icon: Linkedin },
  { id: 'manual',   label: 'Manual',        icon: UserIcon },
];

export default function CandidateImportDialog({ open, onClose, roleId }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', linkedinUrl: '' });

  const reset = () => {
    setTab('upload');
    setFile(null);
    setForm({ fullName: '', email: '', phone: '', linkedinUrl: '' });
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (tab === 'upload') {
        if (!file) throw new Error('Please choose a resume file.');
        return uploadResume({ file, roleId, ...form });
      }
      if (tab === 'linkedin' && !form.linkedinUrl.trim()) {
        throw new Error('Paste a LinkedIn URL.');
      }
      return createCandidate({
        roleId,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        linkedinUrl: form.linkedinUrl,
        source: tab === 'linkedin' ? 'linkedin' : 'manual',
      });
    },
    onSuccess: () => {
      toast.success('Candidate added');
      qc.invalidateQueries({ queryKey: ['candidates', roleId] });
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      close();
    },
    onError: (e) => toast.error(e.message),
  });

  // Form fields are shared across tabs; "upload" mode also accepts pre-fills.
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add candidate"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={() => submit.mutate()} loading={submit.isPending}>Add candidate</Button>
        </>
      }
    >
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
            We'll parse the resume and auto-create the candidate. You can edit the name + email after.
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
            We store the URL only. <strong>AI scoring is unavailable for LinkedIn-only candidates</strong> — upload a resume later if you want to enable it.
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
