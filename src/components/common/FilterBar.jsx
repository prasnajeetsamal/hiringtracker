import React from 'react';
import clsx from 'clsx';
import { Search, ChevronDown, X, SlidersHorizontal } from 'lucide-react';

/**
 * FilterBar — a horizontal row of filter controls with consistent styling.
 *
 * Compose with <FilterSearch> and <FilterSelect> children, then add an
 * optional "Clear all" pill that lights up when any filter is active.
 *
 * Active filters get an indigo accent so the user can see at a glance
 * which dimensions are narrowing the view.
 */
export default function FilterBar({ children, activeCount = 0, onClearAll, className }) {
  return (
    <div className={clsx('rounded-xl border border-slate-800 bg-slate-900/40 backdrop-blur p-2 flex flex-wrap items-center gap-2 mb-4', className)}>
      <div className="hidden md:flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500 px-2">
        <SlidersHorizontal size={11} />
        Filters
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        {children}
      </div>
      {activeCount > 0 && onClearAll && (
        <button
          onClick={onClearAll}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 transition border border-slate-700"
          title="Clear all filters"
        >
          <X size={11} /> Clear ({activeCount})
        </button>
      )}
    </div>
  );
}

/** Free-text search input with a leading icon. Pill-shaped to match FilterSelect. */
export function FilterSearch({ value, onChange, placeholder = 'Search…', className }) {
  return (
    <div className={clsx('relative flex-1 min-w-[180px] max-w-sm', className)}>
      <Search
        size={13}
        className={clsx(
          'absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none',
          value ? 'text-indigo-300' : 'text-slate-500'
        )}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(
          'w-full pl-8 pr-7 py-1.5 rounded-full text-sm text-slate-100 placeholder:text-slate-500',
          'border focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/60 transition',
          value
            ? 'border-indigo-500/60 bg-indigo-500/15 ring-1 ring-indigo-500/30'
            : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
        )}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-indigo-300 hover:text-indigo-100 p-0.5"
          title="Clear search"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/**
 * FilterSelect — labeled dropdown that highlights when active.
 *
 * Active = `value` is not the `defaultValue` (or, if `defaultValue` is
 * unspecified, the first option's value — the "no filter" sentinel).
 * Pass `defaultValue` when the page boots with a non-empty default
 * (e.g. status="active") that you don't want to look "filtered".
 *
 * Optional `icon` (a lucide-react component) renders to the left of
 * the label.
 */
export function FilterSelect({ label, value, onChange, options, defaultValue, icon: Icon, className, disabled }) {
  const sentinel = defaultValue !== undefined ? defaultValue : (options[0]?.value);
  const isActive = value !== sentinel;
  // Show the selected option's text as a small "value" tag when active,
  // so users can see the current narrowing at a glance.
  const selected = options.find((o) => String(o.value) === String(value));
  const valueLabel = isActive && selected ? selected.label : null;

  return (
    <div
      className={clsx(
        'group relative inline-flex items-center rounded-full border transition',
        disabled
          ? 'border-slate-800 bg-slate-950/30 opacity-60'
          : isActive
          ? 'border-indigo-500/60 bg-indigo-500/15 hover:bg-indigo-500/20 ring-1 ring-indigo-500/30'
          : 'border-slate-700 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900/80',
        className
      )}
    >
      {Icon && (
        <Icon
          size={12}
          className={clsx('ml-3 shrink-0', isActive ? 'text-indigo-300' : 'text-slate-500')}
        />
      )}
      <span className={clsx(
        'pl-2 pr-1 text-[11px] font-medium whitespace-nowrap',
        isActive ? 'text-indigo-200' : 'text-slate-400'
      )}>
        {label}
        {valueLabel && (
          <>
            <span className={isActive ? 'text-indigo-300/60 mx-1' : 'text-slate-600 mx-1'}>·</span>
            <span className={isActive ? 'text-slate-100' : 'text-slate-300'}>{valueLabel}</span>
          </>
        )}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className={clsx('mr-2.5 ml-1 pointer-events-none', isActive ? 'text-indigo-300' : 'text-slate-500')}
      />
    </div>
  );
}
