import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/30 p-10 text-center">
      {Icon && (
        <div className="mx-auto mb-3 w-11 h-11 rounded-xl bg-slate-800/80 grid place-items-center text-slate-300">
          <Icon size={20} />
        </div>
      )}
      {title && <div className="text-slate-100 font-medium">{title}</div>}
      {description && <div className="text-sm text-slate-400 mt-1">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
