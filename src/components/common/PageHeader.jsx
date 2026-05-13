import React from 'react';

export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="flex flex-col gap-1 mb-5 sm:mb-6">
      {breadcrumb && <div className="text-xs text-slate-500">{breadcrumb}</div>}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-100 break-words">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}
