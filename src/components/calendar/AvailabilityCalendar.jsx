import React, { useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addMinutes } from 'date-fns';
import enUS from 'date-fns/locale/en-US';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';

import 'react-big-calendar/lib/css/react-big-calendar.css';
import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/AuthContext.jsx';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

export default function AvailabilityCalendar() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [editingSlot, setEditingSlot] = useState(null);
  const [creating, setCreating] = useState(null);

  const { data: slots } = useQuery({
    queryKey: ['my-availability', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('id, starts_at, ends_at, status, recurrence')
        .eq('interviewer_id', user.id)
        .order('starts_at');
      if (error) throw error;
      return data;
    },
  });

  const events = useMemo(() => (slots || []).map((s) => ({
    id: s.id,
    title: s.status === 'booked' ? 'Booked' : s.status === 'blocked' ? 'Blocked' : 'Available',
    start: new Date(s.starts_at),
    end: new Date(s.ends_at),
    resource: s,
  })), [slots]);

  const create = useMutation({
    mutationFn: async ({ starts_at, ends_at, status }) => {
      const { error } = await supabase.from('availability_slots').insert({
        interviewer_id: user.id,
        starts_at, ends_at,
        status: status || 'open',
        recurrence: 'none',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Slot saved');
      qc.invalidateQueries({ queryKey: ['my-availability', user?.id] });
      setCreating(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('availability_slots').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Slot removed');
      qc.invalidateQueries({ queryKey: ['my-availability', user?.id] });
      setEditingSlot(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const eventStyleGetter = (event) => {
    const status = event.resource?.status;
    const bg = status === 'booked' ? '#0ea5a4' : status === 'blocked' ? '#475569' : '#6366f1';
    return {
      style: {
        backgroundColor: bg,
        border: 'none',
        borderRadius: '6px',
        color: '#f1f5f9',
        fontSize: '11px',
      },
    };
  };

  return (
    <>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3" style={{ height: 700 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          defaultView="week"
          views={['week', 'day', 'agenda']}
          step={30}
          timeslots={2}
          selectable
          onSelectSlot={(slot) => {
            setCreating({
              starts_at: slot.start.toISOString(),
              ends_at: slot.end.toISOString(),
              status: 'open',
            });
          }}
          onSelectEvent={(e) => setEditingSlot(e.resource)}
          eventPropGetter={eventStyleGetter}
          style={{ height: '100%', color: '#cbd5e1', backgroundColor: 'transparent' }}
        />
      </div>

      <Modal
        open={!!creating}
        onClose={() => setCreating(null)}
        title="New availability slot"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(null)}>Cancel</Button>
            <Button onClick={() => create.mutate(creating)} loading={create.isPending}>Save</Button>
          </>
        }
      >
        {creating && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-slate-400">When</div>
              <div className="text-slate-200">
                {new Date(creating.starts_at).toLocaleString()}
                {' → '}
                {new Date(creating.ends_at).toLocaleTimeString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Type</div>
              <div className="flex gap-2">
                {[
                  { v: 'open',    l: 'Available', cls: 'bg-indigo-500/15 text-indigo-200 border-indigo-500/40' },
                  { v: 'blocked', l: 'Blocked',   cls: 'bg-slate-800 text-slate-300 border-slate-700' },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setCreating({ ...creating, status: o.v })}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                      creating.status === o.v ? o.cls + ' ring-1 ring-current' : 'border-slate-700 text-slate-400 bg-slate-900/40 hover:border-slate-600'
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editingSlot}
        onClose={() => setEditingSlot(null)}
        title="Slot"
        footer={
          <>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => remove.mutate(editingSlot.id)}
              loading={remove.isPending}
              disabled={editingSlot?.status === 'booked'}
            >
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setEditingSlot(null)}>Close</Button>
          </>
        }
      >
        {editingSlot && (
          <div className="text-sm space-y-2">
            <div>
              <div className="text-xs text-slate-400">When</div>
              <div className="text-slate-200">
                {new Date(editingSlot.starts_at).toLocaleString()}
                {' → '}
                {new Date(editingSlot.ends_at).toLocaleTimeString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Status</div>
              <div className="text-slate-200 capitalize">{editingSlot.status}</div>
              {editingSlot.status === 'booked' && (
                <div className="text-[11px] text-slate-500 mt-1">Booked slots can't be removed here.</div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
