import React from 'react';

export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="flex flex-col gap-1 mb-6">
      {breadcrumb && <div className="text-xs text-slate-500">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
