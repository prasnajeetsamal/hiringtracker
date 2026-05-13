import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linkedin, FileUp, User as UserIcon, Briefcase, Sparkles, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import FileDrop from '../common/FileDrop.jsx';
import { supabase } from '../../lib/supabase.js';
import { uploadResume, createCandidate, scoreCandidate } from '../../lib/api.js';

const TABS = [
  { id: 'upload',   label: 'Upload resume(s)', icon: FileUp },
  { id: 'linkedin', label: 'LinkedIn URL',     icon: Linkedin },
  { id: 'manual',   label: 'Manual',           icon: UserIcon },
];

/**
 * Add-candidate dialog.
 *
 * - When `roleId` prop is provided, the candidate is added to that role
 *   directly (the dialog hides the role selector).
 * - When `roleId` is omitted (e.g. opening from the global Candidates
 *   page), a searchable role selector appears at the top.
 * - Upload tab supports MULTIPLE files at once. After upload, AI scoring
 *   is kicked off in parallel for each new candidate (client-side fan-out).
 */
export default function CandidateImportDialog({ open, onClose, roleId: presetRoleId }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('upload');
  const [files, setFiles] = useState([]); // multi-file in upload tab
  const [autoScore, setAutoScore] = useState(true);
  const [progress, setProgress] = useState([]); // [{name, status, score?, error?}]
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', linkedinUrl: '' });
  const [pickedRoleId, setPickedRoleId] = useState(null);
  const [roleSearch, setRoleSearch] = useState('');

  const effectiveRoleId = presetRoleId || pickedRoleId;
  const needsRolePicker = !presetRoleId;

  useEffect(() => {
    if (open) {
      setTab('upload');
      setFiles([]);
      setProgress([]);
      setBusy(false);
      setAutoScore(true);
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

  const close = () => {
    if (busy) return; // don't allow close while uploading
    onClose();
  };

  /** Upload tab: bulk upload + optional auto-score. */
  const runBulkUpload = async () => {
    if (!effectiveRoleId) return toast.error('Pick a role first.');
    if (!files.length) return toast.error('Choose at least one resume.');

    setBusy(true);
    const initialProgress = files.map((f) => ({ name: f.name, status: 'uploading' }));
    setProgress(initialProgress);

    const uploaded = []; // {file, candidate}
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      try {
        const { candidate } = await uploadResume({ file, roleId: effectiveRoleId });
        uploaded.push({ file, candidate });
        setProgress((p) => p.map((row, idx) => idx === i
          ? { ...row, status: autoScore ? 'queued' : 'done', candidateId: candidate?.id }
          : row));
      } catch (e) {
        setProgress((p) => p.map((row, idx) => idx === i
          ? { ...row, status: 'failed', error: e.message }
          : row));
      }
    }

    // Refresh lists right away so the candidates are visible even before scoring finishes.
    await Promise.all([
      qc.refetchQueries({ queryKey: ['candidates', effectiveRoleId], exact: true }),
      qc.refetchQueries({ queryKey: ['candidates-all'], exact: true }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);

    if (autoScore && uploaded.length > 0) {
      // Score in parallel, but cap concurrency to avoid hammering the API.
      const concurrency = 3;
      let cursor = 0;
      const setRowStatus = (candidateId, patch) => {
        setProgress((p) => p.map((row) => row.candidateId === candidateId ? { ...row, ...patch } : row));
      };
      const worker = async () => {
        while (cursor < uploaded.length) {
          const idx = cursor++;
          const { candidate } = uploaded[idx];
          if (!candidate?.id) continue;
          setRowStatus(candidate.id, { status: 'scoring' });
          try {
            const result = await scoreCandidate({ candidateId: candidate.id, roleId: effectiveRoleId });
            setRowStatus(candidate.id, { status: 'done', score: result?.ai_score });
          } catch (e) {
            setRowStatus(candidate.id, { status: 'score_failed', error: e.message });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, uploaded.length) }, worker));

      // Refresh once more so the scores show up in the candidates list.
      await Promise.all([
        qc.refetchQueries({ queryKey: ['candidates', effectiveRoleId], exact: true }),
        qc.refetchQueries({ queryKey: ['candidates-all'], exact: true }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    }

    setBusy(false);
    const ok = uploaded.length;
    const total = files.length;
    if (ok === total) toast.success(`Added ${ok} candidate${ok === 1 ? '' : 's'}`);
    else if (ok > 0)  toast.success(`${ok} of ${total} candidates added - see details below`);
    else              toast.error('No candidates were added - see details below');
  };

  /** LinkedIn / manual tabs. */
  const submitOne = useMutation({
    mutationFn: async () => {
      if (!effectiveRoleId) throw new Error('Pick a role first.');
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
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const onPrimaryClick = () => {
    if (tab === 'upload') runBulkUpload();
    else submitOne.mutate();
  };

  const selectedRole = (roles || []).find((r) => r.id === pickedRoleId);

  const allDone = progress.length > 0 && progress.every((p) => ['done', 'failed', 'score_failed'].includes(p.status));

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add candidate"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {allDone ? 'Done' : 'Cancel'}
          </Button>
          {!allDone && (
            <Button
              onClick={onPrimaryClick}
              loading={busy || submitOne.isPending}
              disabled={!effectiveRoleId || (tab === 'upload' && files.length === 0)}
            >
              {tab === 'upload'
                ? files.length > 1 ? `Upload ${files.length} resumes` : 'Upload resume'
                : 'Add candidate'}
            </Button>
          )}
        </>
      }
    >
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
                disabled={busy}
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
                    {roles?.length === 0 ? 'No roles exist yet - create one first.' : 'No matches.'}
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
            onClick={() => !busy && setTab(id)}
            disabled={busy}
            className={`flex-1 px-3 py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
              tab === id ? 'bg-slate-700 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div className="space-y-3">
          <FileDrop multiple value={files} onChange={setFiles} />

          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950/40 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScore}
              onChange={(e) => setAutoScore(e.target.checked)}
              disabled={busy}
              className="w-4 h-4 accent-indigo-500"
            />
            <Sparkles size={13} className="text-indigo-300" />
            <span className="text-xs text-slate-200">
              Auto-screen against this role's JD using Claude
            </span>
            <span className="text-[10px] text-slate-500 ml-auto">~30-60s per resume</span>
          </label>

          {progress.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 space-y-1 max-h-56 overflow-y-auto">
              {progress.map((row, i) => (
                <ProgressRow key={i} row={row} />
              ))}
            </div>
          )}

          {progress.length === 0 && (
            <div className="text-[11px] text-slate-500">
              We'll parse each resume, create a candidate, and (if Auto-screen is on) score them
              against this role's JD using Claude. Up to 3 candidates score in parallel.
            </div>
          )}
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
            We store the URL only. <strong>AI scoring is unavailable for LinkedIn-only candidates</strong> - upload a resume later to enable it.
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

function ProgressRow({ row }) {
  let icon, tone;
  switch (row.status) {
    case 'uploading':
      icon = <Loader2 size={12} className="animate-spin" />; tone = 'text-indigo-300'; break;
    case 'queued':
      icon = <Loader2 size={12} className="opacity-60" />; tone = 'text-slate-400'; break;
    case 'scoring':
      icon = <Sparkles size={12} className="animate-pulse" />; tone = 'text-violet-300'; break;
    case 'done':
      icon = <CheckCircle2 size={12} />; tone = 'text-emerald-300'; break;
    case 'failed':
    case 'score_failed':
      icon = <AlertCircle size={12} />; tone = 'text-rose-300'; break;
    default:
      icon = null; tone = 'text-slate-400';
  }
  const label = {
    uploading: 'Uploading…',
    queued: 'Queued for scoring',
    scoring: 'Scoring with Claude…',
    done: row.score != null ? `Scored ${row.score}/100` : 'Added',
    failed: row.error ? `Upload failed: ${row.error}` : 'Upload failed',
    score_failed: row.error ? `Score failed: ${row.error}` : 'Score failed',
  }[row.status];
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-md text-xs ${tone}`}>
      <span className="shrink-0">{icon}</span>
      <span className="text-slate-200 truncate flex-1 min-w-0">{row.name}</span>
      <span className="text-[11px] truncate max-w-[55%]">{label}</span>
    </div>
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
