import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/AuthContext.jsx';

export default function InterviewerAssignment({ pipelineId }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');

  const { data: assignments } = useQuery({
    queryKey: ['assignments', pipelineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interviewer_assignments')
        .select(`
          id, interviewer_id,
          interviewer:profiles!interviewer_assignments_interviewer_id_fkey ( id, full_name, email )
        `)
        .eq('pipeline_id', pipelineId);
      if (error) throw error;
      return data;
    },
  });

  const { data: candidates } = useQuery({
    queryKey: ['profiles-list'],
    enabled: picking,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const assign = useMutation({
    mutationFn: async (interviewerId) => {
      const { error } = await supabase
        .from('interviewer_assignments')
        .insert({ pipeline_id: pipelineId, interviewer_id: interviewerId, assigned_by: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Interviewer assigned');
      qc.invalidateQueries({ queryKey: ['assignments', pipelineId] });
      setSearch('');
    },
    onError: (e) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async (assignmentId) => {
      const { error } = await supabase
        .from('interviewer_assignments')
        .delete()
        .eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Removed');
      qc.invalidateQueries({ queryKey: ['assignments', pipelineId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const assignedIds = new Set((assignments || []).map((a) => a.interviewer_id));
  const filtered = (candidates || [])
    .filter((p) => !assignedIds.has(p.id))
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
    })
    .slice(0, 8);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(assignments || []).map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-200"
          >
            {a.interviewer?.full_name || a.interviewer?.email || 'Unknown'}
            <button
              onClick={() => unassign.mutate(a.id)}
              className="text-slate-500 hover:text-rose-300"
              title="Remove"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {!picking && (
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-indigo-300 hover:text-indigo-200 border border-dashed border-slate-700 hover:border-indigo-500/50"
          >
            <UserPlus size={11} /> Assign
          </button>
        )}
      </div>

      {picking && (
        <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-1.5 max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-[11px] text-slate-500 px-2 py-2">No matches.</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => assign.mutate(p.id)}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800/60 text-xs"
                >
                  <div className="text-slate-100">{p.full_name || p.email}</div>
                  <div className="text-[10px] text-slate-500">{p.email} · {p.role}</div>
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end mt-1.5">
            <button onClick={() => { setPicking(false); setSearch(''); }} className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
