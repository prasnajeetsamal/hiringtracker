import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { supabase } from '../lib/supabase.js';

export default function JDTemplatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['jd-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_templates')
        .select('id, name, category, body_html, is_system')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader
        title="JD Templates"
        subtitle="Starter job descriptions you can pick when creating a role."
      />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="System templates (Senior Software Engineer, Product Manager, Senior Data Scientist) are seeded by 0003_seed_templates.sql."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((t) => (
            <Card key={t.id} className="h-full">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-slate-100">{t.name}</div>
                {t.is_system && (
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                    system
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 capitalize">{t.category}</div>
              <div className="text-xs text-slate-400 mt-3 line-clamp-4 whitespace-pre-line">
                {(t.body_html || '').replace(/<[^>]+>/g, '').slice(0, 240)}…
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
