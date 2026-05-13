import React, { useState } from 'react';
import { Tag as TagIcon, X, Plus } from 'lucide-react';

/**
 * Inline tag editor for a candidate.
 *
 *   value: string[]   - current tags
 *   onChange: (next: string[]) => void
 *   readOnly?: boolean
 */
export default function TagsEditor({ value = [], onChange, readOnly = false, suggestions = [] }) {
  const [input, setInput] = useState('');

  const tags = Array.isArray(value) ? value : [];

  const add = (raw) => {
    const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!t) return;
    if (tags.includes(t)) return;
    onChange?.([...tags, t]);
    setInput('');
  };

  const remove = (tag) => {
    onChange?.(tags.filter((t) => t !== tag));
  };

  const onKey = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      add(input);
    }
    if (e.key === 'Backspace' && !input && tags.length) {
      remove(tags[tags.length - 1]);
    }
  };

  const sugg = suggestions.filter((s) => !tags.includes(s) && (!input || s.startsWith(input.toLowerCase())));

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 min-h-[28px] min-w-0">
        {tags.length === 0 && readOnly && (
          <span className="text-[11px] text-slate-500 italic">No tags</span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-500/10 text-indigo-200 border border-indigo-500/30 max-w-full break-all"
          >
            <TagIcon size={9} className="text-indigo-300 shrink-0" />
            <span className="break-all">{t}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => remove(t)}
                className="text-indigo-300/70 hover:text-rose-200 ml-0.5 shrink-0"
                title="Remove tag"
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[, ]+$/, ''))}
            onKeyDown={onKey}
            onBlur={() => input.trim() && add(input)}
            placeholder={tags.length ? '+ add tag' : '+ add a tag'}
            className="bg-transparent border-0 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none flex-1 min-w-[80px]"
          />
        )}
      </div>
      {!readOnly && sugg.length > 0 && input && (
        <div className="flex flex-wrap gap-1">
          {sugg.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600"
            >
              <Plus size={9} /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
