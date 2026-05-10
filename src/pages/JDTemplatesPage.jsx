import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Modal from '../components/common/Modal.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import JDEditor from '../components/jd/JDEditor.jsx';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useIsAdmin } from '../lib/useIsAdmin.js';

const CATEGORIES = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'product',     label: 'Product' },
  { value: 'data',        label: 'Data' },
  { value: 'design',      label: 'Design' },
  { value: 'other',       label: 'Other' },
];

export default function JDTemplatesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, otherwise template object
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [previewing, setPreviewing] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['jd-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_templates')
        .select('id, name, category, body_html, is_system, created_at')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async ({ id, name, category, body_html, is_system }) => {
      if (!name?.trim()) throw new Error('Name is required.');
      if (!body_html || body_html === '<p></p>' || body_html === '') {
        throw new Error('Template body cannot be empty.');
      }
      if (id) {
        const { error } = await supabase
          .from('jd_templates')
          .update({
            name: name.trim(),
            category,
            body_html,
            ...(isAdmin ? { is_system: !!is_system } : {}),
          })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('jd_templates')
          .insert({
            name: name.trim(),
            category,
            body_html,
            // Only admins can mint a system template; everyone else creates personal ones.
            is_system: isAdmin ? !!is_system : false,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing?.id ? 'Template saved' : 'Template created');
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      qc.invalidateQueries({ queryKey: ['jd-templates-picker'] });
      setEditorOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('jd_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Template deleted');
      qc.invalidateQueries({ queryKey: ['jd-templates'] });
      qc.invalidateQueries({ queryKey: ['jd-templates-picker'] });
      setConfirmDelete(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (template) => {
    setEditing(template);
    setEditorOpen(true);
  };

  return (
    <>
      <PageHeader
        title="JD Templates"
        subtitle="Reusable job descriptions you can pick when creating a role. System templates ship out of the box; you can also create your own."
        actions={<Button icon={Plus} onClick={openCreate}>New template</Button>}
      />

      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Create your first template — it'll show up in the role-creation flow as a starter."
          action={<Button icon={Plus} onClick={openCreate}>New template</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((t) => {
            const canEdit = isAdmin || !t.is_system;
            return (
              <Card key={t.id} className="h-full flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <button
                    type="button"
                    onClick={() => setPreviewing(t)}
                    className="text-left font-medium text-slate-100 hover:text-indigo-300"
                  >
                    {t.name}
                  </button>
                  {t.is_system ? (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 shrink-0">
                      system
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/30 shrink-0">
                      custom
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mb-3 capitalize">{t.category}</div>
                <button
                  type="button"
                  onClick={() => setPreviewing(t)}
                  className="text-xs text-slate-400 line-clamp-4 whitespace-pre-line text-left hover:text-slate-300 flex-1"
                >
                  {(t.body_html || '').replace(/<[^>]+>/g, '').slice(0, 240)}…
                </button>
                <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-1 justify-end">
                  {canEdit && (
                    <>
                      <button
                        onClick={() => openEdit(t)}
                        className="text-[11px] px-2.5 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700 inline-flex items-center gap-1"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                      <button
                        onClick={() => setConfirmDelete(t)}
                        className="text-[11px] px-2.5 py-1 rounded-md text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-500/30 inline-flex items-center gap-1"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateEditor
        open={editorOpen}
        template={editing}
        isAdmin={isAdmin}
        loading={upsert.isPending}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        onSubmit={(payload) => upsert.mutate(payload)}
      />

      <Modal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        title={previewing?.name || 'Template'}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreviewing(null)}>Close</Button>
            {previewing && (isAdmin || !previewing.is_system) && (
              <Button variant="secondary" icon={Pencil} onClick={() => { openEdit(previewing); setPreviewing(null); }}>
                Edit
              </Button>
            )}
          </>
        }
      >
        {previewing && (
          <div>
            <div className="text-[11px] text-slate-500 mb-3 capitalize">
              {previewing.category} · {previewing.is_system ? 'system template' : 'custom template'}
            </div>
            <div className="jd-prose" dangerouslySetInnerHTML={{ __html: previewing.body_html || '' }} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove.mutate(confirmDelete.id)}
        loading={remove.isPending}
        title="Delete template?"
        message={
          confirmDelete && (
            <p>This permanently removes <strong className="text-slate-100">{confirmDelete.name}</strong>. Roles already using it keep their JD content (we copy on use).</p>
          )
        }
      />
    </>
  );
}

function TemplateEditor({ open, template, isAdmin, onSubmit, onClose, loading }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [body, setBody] = useState('');
  const [systemFlag, setSystemFlag] = useState(false);

  React.useEffect(() => {
    if (open) {
      setName(template?.name || '');
      setCategory(template?.category || 'other');
      setBody(template?.body_html || '');
      setSystemFlag(template?.is_system || false);
    }
  }, [open, template]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template?.id ? 'Edit template' : 'New JD template'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={Save}
            onClick={() => onSubmit({
              id: template?.id,
              name,
              category,
              body_html: body,
              is_system: systemFlag,
            })}
            loading={loading}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Body">
          <JDEditor value={body} onChange={setBody} placeholder="Write the template JD…" minHeight={320} />
        </Field>
        {isAdmin && (
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={systemFlag}
              onChange={(e) => setSystemFlag(e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            Make this a <span className="font-medium text-indigo-300">system template</span> (visible to everyone, marked "system" in the picker)
          </label>
        )}
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
