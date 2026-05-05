import React, { useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, startOfDay, addDays } from 'date-fns';
import enUS from 'date-fns/locale/en-US';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';

import { supabase } from '../../lib/supabase.js';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

// Stable color palette — index by interviewer order in the legend.
const PALETTE = [
  '#6366f1', '#a855f7', '#ec4899', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#0ea5e9', '#8b5cf6', '#f43f5e',
];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

export default function TeamAvailabilityCalendar() {
  const [selected, setSelected] = useState(new Set()); // empty = show everyone
  const [rangeStart, setRangeStart] = useState(() => startOfDay(addDays(new Date(), -7)));
  const [rangeEnd, setRangeEnd] = useState(() => startOfDay(addDays(new Date(), 28)));

  // Pull all profiles so we can color and label slots.
  const { data: people } = useQuery({
    queryKey: ['people-for-calendar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  // All availability slots in the visible window.
  const { data: slots, isLoading } = useQuery({
    queryKey: ['team-availability', rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('id, interviewer_id, starts_at, ends_at, status')
        .gte('starts_at', rangeStart.toISOString())
        .lte('starts_at', rangeEnd.toISOString())
        .order('starts_at');
      if (error) throw error;
      return data;
    },
  });

  // People who actually have at least one slot in the window — the legend.
  const interviewerOrder = useMemo(() => {
    const ids = [...new Set((slots || []).map((s) => s.interviewer_id))];
    const peopleById = Object.fromEntries((people || []).map((p) => [p.id, p]));
    return ids
      .map((id) => peopleById[id])
      .filter(Boolean)
      .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  }, [slots, people]);

  const colorById = useMemo(() => {
    const map = {};
    interviewerOrder.forEach((p, i) => { map[p.id] = colorFor(i); });
    return map;
  }, [interviewerOrder]);

  const events = useMemo(() => {
    const filterActive = selected.size > 0;
    const peopleById = Object.fromEntries((people || []).map((p) => [p.id, p]));
    return (slots || [])
      .filter((s) => !filterActive || selected.has(s.interviewer_id))
      .map((s) => {
        const who = peopleById[s.interviewer_id];
        const name = who?.full_name || who?.email || 'Unknown';
        return {
          id: s.id,
          title: s.status === 'booked' ? `${name} · Booked` : s.status === 'blocked' ? `${name} · Blocked` : name,
          start: new Date(s.starts_at),
          end: new Date(s.ends_at),
          resource: s,
        };
      });
  }, [slots, people, selected]);

  const eventStyleGetter = (event) => {
    const status = event.resource?.status;
    let bg = colorById[event.resource?.interviewer_id] || '#6366f1';
    if (status === 'booked') bg = '#0ea5a4';
    else if (status === 'blocked') bg = '#475569';
    return {
      style: {
        backgroundColor: bg,
        opacity: 0.85,
        border: 'none',
        borderRadius: '6px',
        color: '#0f172a',
        fontSize: '11px',
        fontWeight: 500,
      },
    };
  };

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-slate-200">
            <Users size={14} className="text-indigo-300" />
            <span className="text-sm font-medium">Interviewers</span>
            <span className="text-[11px] text-slate-500">({interviewerOrder.length})</span>
          </div>
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Show all
            </button>
          )}
        </div>
        {interviewerOrder.length === 0 ? (
          <div className="text-sm text-slate-500 italic">
            {isLoading ? 'Loading…' : 'No availability slots in this window.'}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {interviewerOrder.map((p) => {
              const isOn = selected.size === 0 || selected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition ${
                    isOn
                      ? 'border-slate-700 bg-slate-900 text-slate-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-500'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: colorById[p.id], opacity: isOn ? 1 : 0.3 }}
                  />
                  {p.full_name || p.email}
                </button>
              );
            })}
          </div>
        )}
      </div>

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
          onRangeChange={(range) => {
            // react-big-calendar gives different shapes per view; normalize.
            if (Array.isArray(range)) {
              setRangeStart(startOfDay(range[0]));
              setRangeEnd(startOfDay(addDays(range[range.length - 1], 1)));
            } else if (range?.start && range?.end) {
              setRangeStart(startOfDay(range.start));
              setRangeEnd(startOfDay(addDays(range.end, 1)));
            }
          }}
          eventPropGetter={eventStyleGetter}
          style={{ height: '100%', color: '#cbd5e1', backgroundColor: 'transparent' }}
        />
      </div>
    </div>
  );
}
