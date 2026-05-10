import React from 'react';
import { Building2, Home, Globe2 } from 'lucide-react';
import clsx from 'clsx';

const WORK_MODES = [
  { value: 'remote', label: 'Remote',  icon: Globe2 },
  { value: 'office', label: 'Office',  icon: Building2 },
  { value: 'hybrid', label: 'Hybrid',  icon: Home },
];

/**
 * Reusable role-location editor: work mode (remote/office/hybrid) + city + state
 * + country. Pass { work_mode, city, state, country } as `value` and an
 * `onChange(patch)` that merges keys back. `compact` lays out fields in a
 * 4-column grid (modal use); default is 2 columns (sidebar use).
 */
export default function LocationFields({ value, onChange, compact = false }) {
  const v = value || {};
  const set = (k) => (next) => onChange({ ...v, [k]: next });

  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-xs text-slate-400 mb-1.5">Work mode</div>
        <div className="flex gap-1.5">
          {WORK_MODES.map((m) => {
            const Icon = m.icon;
            const active = v.work_mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => set('work_mode')(active ? null : m.value)}
                className={clsx(
                  'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition',
                  active
                    ? 'border-indigo-500/60 bg-indigo-500/15 text-slate-100'
                    : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                )}
              >
                <Icon size={11} className={active ? 'text-indigo-300' : 'text-slate-500'} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={clsx('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
        <Field label="City">
          <Input value={v.city || ''} onChange={set('city')} placeholder="e.g. Bengaluru" />
        </Field>
        <Field label="State">
          <Input value={v.state || ''} onChange={set('state')} placeholder="e.g. Karnataka" />
        </Field>
        <Field label="Country">
          <Input value={v.country || ''} onChange={set('country')} placeholder="e.g. India" />
        </Field>
      </div>
    </div>
  );
}

/** Format the structured location for read-only display. */
export function formatLocation({ work_mode, city, state, country, location } = {}) {
  const parts = [];
  if (work_mode) parts.push(work_mode === 'remote' ? 'Remote' : work_mode === 'office' ? 'Office' : 'Hybrid');
  const place = [city, state, country].filter(Boolean).join(', ');
  if (place) parts.push(place);
  if (parts.length === 0 && location) return location; // fallback to legacy free-text
  return parts.join(' · ');
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Input({ value, onChange, ...rest }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      {...rest}
    />
  );
}
