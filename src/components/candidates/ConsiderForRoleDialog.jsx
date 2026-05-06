import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';
import { cloneCandidate } from '../../lib/api.js';

export default function ConsiderForRoleDialog({ open, onClose, candidate }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState(null);

  const { data: roles } = useQuery({
    queryKey: ['roles-for-clone'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, title, level, location, status, project:hiring_projects ( id, name )')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (roles || [])
    .filter((r) => r.id !== candidate?.role_id)
    .filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [r.title, r.level, r.location, r.project?.name].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedRoleId) throw new Error('Pick a role.');
      return cloneCandidate({ candidateId: candidate.id, targetRoleId: selectedRoleId });
    },
    onSuccess: ({ candidate: cloned }) => {
      toast.success(`Added ${cloned?.full_name || 'candidate'} to the new role`);
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      qc.invalidateQueries({ queryKey: ['candidates', selectedRoleId] });
      qc.invalidateQueries({ queryKey: ['siblings', candidate?.email] });
      onClose();
      if (cloned?.id) navigate(`/candidates/${cloned.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Consider for another role"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!selectedRoleId}>
            Add to selected role
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-400 mb-3">
        Creates a separate candidate row for <strong className="text-slate-200">{candidate?.full_name}</strong> on the chosen role.
        Their resume + profile carry over; pipeline progress and AI score start fresh.
      </p>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search roles by title, level, location, project…"
        className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
      />
      <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-500 italic px-2 py-4">
            {roles?.length === 0 ? 'No other roles exist yet.' : 'No matches.'}
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedRoleId(r.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                selectedRoleId === r.id
                  ? 'border-indigo-500/60 bg-indigo-500/10'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Briefcase size={13} className="text-indigo-300" />
                <span className="text-sm font-medium text-slate-100">{r.title}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide ml-auto">{r.status}</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {[r.level, r.location, r.project?.name].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
