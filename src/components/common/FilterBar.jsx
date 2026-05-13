import React, { useEffect, useRef, useState, useMemo } from 'react';
import clsx from 'clsx';
import { Search, ChevronDown, X, SlidersHorizontal, Check } from 'lucide-react';

/**
 * FilterBar - a horizontal row of filter controls with consistent styling.
 *
 * Compose with <FilterSearch> and <FilterSelect> children, then add an
 * optional "Clear all" pill that lights up when any filter is active.
 */
export default function FilterBar({ children, activeCount = 0, onClearAll, className }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2 mb-4 -mt-1', className)}>
      <div className="hidden md:flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 mr-1">
        <SlidersHorizontal size={11} />
        Filters
      </div>
      {children}
      {activeCount > 0 && onClearAll && (
        <button
          onClick={onClearAll}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-slate-300 hover:text-rose-200 hover:bg-rose-500/10 hover:border-rose-500/40 transition border border-slate-700"
          title="Clear all filters"
        >
          <X size={11} /> Clear all
        </button>
      )}
    </div>
  );
}

/** Free-text search input, pill-shaped to match FilterSelect. */
export function FilterSearch({ value, onChange, placeholder = 'Search…', className }) {
  return (
    <div className={clsx('relative flex-1 min-w-[140px] sm:min-w-[180px] max-w-xs', className)}>
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
          'border focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/60 transition',
          value
            ? 'border-indigo-500/60 bg-indigo-500/10'
            : 'border-slate-700 bg-slate-900/60 hover:border-slate-600'
        )}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100 p-0.5"
          title="Clear search"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/**
 * FilterSelect - a fully custom dropdown that matches the dark theme.
 *
 * Active = `value` !== `defaultValue` (defaults to first option's value).
 * Long option lists (> 8) get a search input inside the popover.
 *
 * Selected state shows the value text in the trigger pill, with a small
 * ✕ to clear - much more obvious than chevron-only "did I pick anything?".
 */
export function FilterSelect({
  label, value, onChange, options, defaultValue, icon: Icon, className, disabled,
}) {
  const sentinel = defaultValue !== undefined ? defaultValue : (options[0]?.value);
  const isActive = value !== sentinel;
  const selected = options.find((o) => String(o.value) === String(value));
  const valueLabel = isActive && selected ? selected.label : null;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showSearch = options.length > 8;
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={clsx(
          'inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full border text-sm transition group',
          disabled
            ? 'border-slate-800 bg-slate-950/30 text-slate-500 cursor-not-allowed'
            : isActive
            ? 'border-indigo-500/60 bg-indigo-500/15 text-slate-100 hover:bg-indigo-500/20 ring-1 ring-indigo-500/30'
            : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:bg-slate-900/80'
        )}
      >
        {Icon && (
          <Icon
            size={12}
            className={clsx('shrink-0', isActive ? 'text-indigo-300' : 'text-slate-500')}
          />
        )}
        <span className={clsx(
          'text-[11px] font-medium uppercase tracking-wider',
          isActive ? 'text-indigo-300' : 'text-slate-500'
        )}>
          {label}
        </span>
        {valueLabel && (
          <>
            <span className={isActive ? 'text-indigo-400/40' : 'text-slate-700'}>·</span>
            <span className="text-sm text-slate-100 max-w-[200px] truncate font-medium normal-case tracking-normal">
              {valueLabel}
            </span>
          </>
        )}
        {isActive ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(sentinel); setSearch(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onChange(sentinel);
                setSearch('');
              }
            }}
            className="ml-0.5 grid place-items-center w-4 h-4 rounded-full text-indigo-300 hover:text-rose-200 hover:bg-rose-500/30 cursor-pointer transition"
            title="Clear"
          >
            <X size={10} />
          </span>
        ) : (
          <ChevronDown
            size={12}
            className={clsx('text-slate-500 transition shrink-0', open && 'rotate-180')}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[220px] max-w-[320px] rounded-xl border border-slate-700 bg-slate-900/98 backdrop-blur-md shadow-2xl shadow-slate-950/70 overflow-hidden">
          {showSearch && (
            <div className="p-2 border-b border-slate-800">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="w-full pl-7 pr-2 py-1.5 rounded-md text-xs text-slate-100 bg-slate-950/60 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center italic">
                No matches.
              </div>
            ) : (
              filtered.map((o, i) => {
                const isSelected = String(o.value) === String(value);
                const isSentinelOpt = String(o.value) === String(sentinel);
                return (
                  <button
                    key={`${o.value}-${i}`}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={clsx(
                      'w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 transition',
                      isSelected
                        ? 'bg-indigo-500/15 text-indigo-100'
                        : 'text-slate-200 hover:bg-slate-800/70'
                    )}
                  >
                    <span className={clsx('truncate', isSentinelOpt && 'text-slate-400 italic')}>
                      {o.label}
                    </span>
                    {isSelected && <Check size={13} className="text-indigo-300 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
