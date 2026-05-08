import React, { useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import clsx from 'clsx';

const ACCEPT = '.pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

/**
 * FileDrop
 *
 *   <FileDrop value={file} onChange={setFile} />              // single file
 *   <FileDrop multiple value={files} onChange={setFiles} />   // multiple files
 *
 * In `multiple` mode `value` is treated as an array and `onChange` is called
 * with the merged array (existing + newly added). Individual files can be
 * removed via the per-row ✕ button.
 */
export default function FileDrop({
  value,
  onChange,
  accept = ACCEPT,
  multiple = false,
  label = 'PDF, DOCX, or TXT (max 20 MB each)',
}) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const validate = (file) => {
    if (file.size > 20 * 1024 * 1024) {
      alert(`"${file.name}" is too large (max 20 MB).`);
      return false;
    }
    return true;
  };

  const pickMany = (fileList) => {
    const incoming = Array.from(fileList || []).filter(validate);
    if (incoming.length === 0) return;
    if (multiple) {
      const existing = Array.isArray(value) ? value : [];
      // Dedupe by name+size (best-effort).
      const key = (f) => `${f.name}|${f.size}`;
      const seen = new Set(existing.map(key));
      const merged = [...existing];
      for (const f of incoming) {
        if (!seen.has(key(f))) { merged.push(f); seen.add(key(f)); }
      }
      onChange?.(merged);
    } else {
      onChange?.(incoming[0] || null);
    }
  };

  const removeAt = (idx) => {
    if (!multiple) { onChange?.(null); return; }
    const next = [...(Array.isArray(value) ? value : [])];
    next.splice(idx, 1);
    onChange?.(next);
  };

  const items = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
  const hasItems = items.length > 0;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files?.length) pickMany(e.dataTransfer.files);
      }}
      className={clsx(
        'rounded-lg border border-dashed p-4 transition',
        drag ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { pickMany(e.target.files); e.target.value = ''; }}
      />

      {!hasItems ? (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-1.5 text-slate-400 cursor-pointer py-2"
        >
          <Upload size={18} className="text-indigo-300" />
          <div className="text-sm">
            Drop {multiple ? 'files' : 'a file'} or click to upload
          </div>
          <div className="text-[11px] text-slate-500">{label}</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="space-y-1">
            {items.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-900/60 border border-slate-800"
              >
                <FileText size={13} className="text-indigo-300 shrink-0" />
                <span className="text-sm text-slate-100 truncate flex-1 min-w-0">{f.name}</span>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-slate-400 hover:text-rose-300 p-0.5 rounded"
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full text-center text-[11px] text-indigo-300 hover:text-indigo-200 py-1.5 rounded-md hover:bg-indigo-500/5"
          >
            + Add {multiple ? 'more files' : 'a different file'}
          </button>
        </div>
      )}
    </div>
  );
}
