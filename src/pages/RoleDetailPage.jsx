import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Briefcase, FileText, Sliders, Upload, FileBox, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import FileDrop from '../components/common/FileDrop.jsx';
import Spinner from '../components/common/Spinner.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import LocationFields, { formatLocation } from '../components/common/LocationFields.jsx';

import JDEditor from '../components/jd/JDEditor.jsx';
import JDTemplatePicker from '../components/jd/JDTemplatePicker.jsx';
import PipelineBoard from '../components/pipeline/PipelineBoard.jsx';
import StageCustomizer from '../components/pipeline/StageCustomizer.jsx';

import { supabase } from '../lib/supabase.js';
import { uploadJD, deleteRole } from '../lib/api.js';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { fetchRoleById, updateRole } from '../lib/queryHelpers.js';

export default function RoleDetailPage() {
  const { projectId, roleId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const { data: role, isLoading, error: roleError } = useQuery({
    queryKey: ['role', roleId],
    queryFn: () => fetchRoleById(supabase, roleId),
  });

  const [draft, setDraft] = useState({
    jd_html: '', sr_number: '', title: '', level: '',
    work_mode: null, city: '', state: '', country: '',
  });
  const [pickOpen, setPickOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [jdFile, setJdFile] = useState(null);

  useEffect(() => {
    if (role) {
      setDraft({
        jd_html: role.jd_html || '',
        sr_number: role.sr_number || '',
        title: role.title || '',
        level: role.level || '',
        work_mode: role.work_mode || null,
        city: role.city || '',
        state: role.state || '',
        country: role.country || '',
      });
    }
  }, [role]);

  const save = useMutation({
    mutationFn: async () => {
      // updateRole transparently retries without work_mode/city/state/country
      // if those columns don't exist (i.e. migration 0007 not yet applied).
      return updateRole(supabase, roleId, {
        jd_html: draft.jd_html,
        jd_source: role?.jd_source === 'uploaded' ? 'inline' : (role?.jd_source || 'inline'),
        sr_number: draft.sr_number || null,
        title: draft.title,
        level: draft.level || null,
        work_mode: draft.work_mode || null,
        city: (draft.city || '').trim() || null,
        state: (draft.state || '').trim() || null,
        country: (draft.country || '').trim() || null,
        // Keep `location` aligned with the structured fields for back-compat.
        location: formatLocation(draft) || null,
      });
    },
    onSuccess: ({ schemaWasLegacy } = {}) => {
      if (schemaWasLegacy) {
        toast.success('Role saved (note: run migration 0007 to enable structured location fields)');
      } else {
        toast.success('Role saved');
      }
      qc.invalidateQueries({ queryKey: ['role', roleId] });
      qc.invalidateQueries({ queryKey: ['roles', projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async (next) => {
      const { error } = await supabase.from('roles').update({ status: next }).eq('id', roleId);
      if (error) throw error;
    },
    onSuccess: (_, next) => {
      toast.success(next === 'closed' ? 'Role archived' : 'Role reopened');
      qc.invalidateQueries({ queryKey: ['role', roleId] });
      qc.invalidateQueries({ queryKey: ['roles', projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!jdFile) throw new Error('Please choose a file.');
      return uploadJD({ roleId, file: jdFile });
    },
    onSuccess: ({ jd_html }) => {
      toast.success('JD uploaded and parsed');
      setDraft((d) => ({ ...d, jd_html: jd_html || d.jd_html }));
      setUploadOpen(false);
      setJdFile(null);
      qc.invalidateQueries({ queryKey: ['role', roleId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => deleteRole({ roleId }),
    onSuccess: () => {
      toast.success('Role deleted');
      qc.invalidateQueries({ queryKey: ['roles', projectId] });
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/projects/${projectId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Spinner />;
  if (roleError) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        <div className="font-medium mb-1">Couldn't load this role.</div>
        <div className="text-xs text-rose-300/90 break-words">{roleError.message || String(roleError)}</div>
        <div className="text-xs text-slate-400 mt-2">
          If you recently updated Slate but haven't run the latest SQL migration in Supabase yet, that's the most likely cause. Open Supabase → SQL Editor and run the unrun files in <code className="text-slate-300">supabase/migrations/</code>.
        </div>
      </div>
    );
  }
  if (!role) return <div className="text-slate-400">Role not found.</div>;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to={`/projects/${projectId}`} className="inline-flex items-center gap-1 hover:text-slate-300">
            <ArrowLeft size={11} /> Back to project
          </Link>
        }
        title={role.title}
        subtitle={[role.sr_number && `SR ${role.sr_number}`, role.level, formatLocation(role)].filter(Boolean).join(' · ') || 'Role details'}
        actions={
          <>
            <Button icon={Save} onClick={() => save.mutate()} loading={save.isPending}>Save role</Button>
            {role.status === 'closed' ? (
              <Button variant="secondary" icon={ArchiveRestore} onClick={() => archive.mutate('open')} loading={archive.isPending}>Reopen</Button>
            ) : (
              <Button variant="secondary" icon={Archive} onClick={() => archive.mutate('closed')} loading={archive.isPending}>Archive</Button>
            )}
            {isAdmin && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)}>Delete role</Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200">
              <FileText size={16} className="text-indigo-300" />
              <span className="font-medium">Job description</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={FileBox} onClick={() => setPickOpen(true)}>Use template</Button>
              <Button size="sm" variant="ghost" icon={Upload} onClick={() => setUploadOpen(true)}>Upload</Button>
            </div>
          </div>
          <JDEditor value={draft.jd_html} onChange={(v) => setDraft({ ...draft, jd_html: v })} />
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 mb-3 text-slate-200">
              <Briefcase size={16} className="text-indigo-300" /><span className="font-medium">Role details</span>
            </div>
            <div className="space-y-3">
              <Field label="Title">
                <Input value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
              </Field>
              <Field label="SR number">
                <Input value={draft.sr_number} onChange={(v) => setDraft({ ...draft, sr_number: v })} placeholder="e.g. SR-12345" />
              </Field>
              <Field label="Level">
                <Input value={draft.level} onChange={(v) => setDraft({ ...draft, level: v })} />
              </Field>
              <LocationFields
                value={draft}
                onChange={(patch) => setDraft({ ...draft, ...patch })}
              />
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-200 font-medium">Pipeline</div>
              <Button size="sm" variant="ghost" icon={Sliders} onClick={() => setStageOpen(true)}>Customize</Button>
            </div>
            <PipelineSummary stageConfig={role.stage_config} />
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-sm font-medium text-slate-200 mb-2">Pipeline board</div>
        <PipelineBoard roleId={roleId} stageConfig={role.stage_config} />
      </div>

      <JDTemplatePicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        onPick={(t) => setDraft((d) => ({ ...d, jd_html: t.body_html }))}
      />

      <StageCustomizer
        open={stageOpen}
        onClose={() => setStageOpen(false)}
        roleId={roleId}
        stageConfig={role.stage_config}
      />

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload JD file"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setUploadOpen(false); setJdFile(null); }}>Cancel</Button>
            <Button onClick={() => upload.mutate()} loading={upload.isPending}>Upload + parse</Button>
          </>
        }
      >
        <p className="text-xs text-slate-400 mb-3">
          We'll parse the file's text and replace the JD content. The original is saved in the <code className="text-slate-300">jds</code> bucket.
        </p>
        <FileDrop value={jdFile} onChange={setJdFile} />
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete role?"
        message={
          <>
            <p>This permanently removes <strong className="text-slate-100">{role.title}</strong>, every candidate on this role, and all their pipeline rows, feedback, comments, resume files, and the JD file.</p>
            <p className="mt-2 text-rose-300 text-xs">This cannot be undone.</p>
          </>
        }
      />
    </>
  );
}

function PipelineSummary({ stageConfig }) {
  const cfg = Array.isArray(stageConfig) ? stageConfig : [];
  const STAGES_ORDER = [
    'resume_submitted','hm_review','technical_written','technical_interview',
    'problem_solving','case_study','offer','joined_fractal','rejected_offer',
  ];
  const labels = {
    resume_submitted: 'Submitted',
    hm_review: 'HM Review',
    technical_written: 'Tech Written',
    technical_interview: 'Tech Interview',
    problem_solving: 'Problem Solving',
    case_study: 'Case Study',
    offer: 'Offer',
    joined_fractal: 'Joined',
    rejected_offer: 'Declined',
  };
  return (
    <ul className="space-y-1 text-sm">
      {STAGES_ORDER.map((k, i) => {
        const item = cfg.find((c) => c.stage_key === k);
        const enabled = item?.enabled !== false;
        return (
          <li key={k} className={`flex items-center gap-2 ${enabled ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
            <span className="w-5 text-[11px] text-slate-500">{i + 1}.</span>
            <span>{labels[k]}</span>
          </li>
        );
      })}
    </ul>
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
