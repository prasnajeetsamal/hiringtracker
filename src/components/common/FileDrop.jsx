import React, { useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import clsx from 'clsx';

const ACCEPT = '.pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

export default function FileDrop({ value, onChange, accept = ACCEPT, label = 'PDF, DOCX, or TXT (max 20 MB)' }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const pick = (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      alert('File is too large (max 20 MB).');
      return;
    }
    onChange?.(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) pick(f);
      }}
      className={clsx(
        'rounded-lg border border-dashed p-5 text-center cursor-pointer transition',
        drag ? 'border-indigo-400 bg-indigo-500/5' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'
      )}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {value ? (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-200">
          <FileText size={14} className="text-indigo-300" />
          <span className="truncate max-w-[280px]">{value.name}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange?.(null); }}
            className="text-slate-400 hover:text-slate-100 p-0.5 rounded"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-slate-400">
          <Upload size={18} className="text-indigo-300" />
          <div className="text-sm">Drop a file or click to upload</div>
          <div className="text-[11px] text-slate-500">{label}</div>
        </div>
      )}
    </div>
  );
}
