import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, Search } from 'lucide-react';
import toast from 'react-hot-toast';

import Modal from '../common/Modal.jsx';
import Button from '../common/Button.jsx';
import Spinner from '../common/Spinner.jsx';
import StageBadge from './StageBadge.jsx';
import { semanticSearchCandidates } from '../../lib/api.js';

const EXAMPLES = [
  'fintech engineers with payments experience',
  'senior data scientists who have shipped LLM products',
  'PMs with marketplace and growth chops',
  'candidates fluent in both Python and React',
  'people with MLOps + cloud cost optimisation work',
];

export default function SemanticSearchDialog({ open, onClose, projectId, roleId }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);

  const run = async (q) => {
    const text = (q ?? query).trim();
    if (!text) return;
    setLoading(true);
    setResults(null);
    try {
      const r = await semanticSearchCandidates({ query: text, projectId, roleId });
      setResults(r.matches || []);
      setScanned(r.scanned || 0);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setQuery('');
    setResults(null);
    onClose?.();
  };

  return (
    <Modal open={open} onClose={close} title="Smart candidate search" size="lg">
      <div className="space-y-4">
        <div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                autoFocus
                placeholder="Describe the candidate you're looking for, in plain English…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
                className="w-full bg-slate-950/60 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <Button icon={Sparkles} onClick={() => run()} loading={loading} disabled={!query.trim()}>
              Search
            </Button>
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            Claude reads each candidate's resume + role context and ranks by fit to your query.
            {(projectId || roleId) && <> Scoped to the current filters.</>}
          </div>
        </div>

        {!results && !loading && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Try one of these</div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setQuery(ex); run(ex); }}
                  className="text-xs px-2.5 py-1 rounded-full border border-slate-700 bg-slate-900/60 text-slate-300 hover:border-indigo-500/50 hover:text-indigo-200 hover:bg-indigo-500/5 transition"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="py-6 flex items-center justify-center text-sm text-slate-400">
            <Spinner /> <span className="ml-2">Reading resumes…</span>
          </div>
        )}

        {results && (
          <div>
            <div className="text-[11px] text-slate-500 mb-2">
              {results.length === 0
                ? `No strong matches across ${scanned} scanned candidates.`
                : `Top ${results.length} matches across ${scanned} scanned candidates.`}
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {results.map((r) => (
                <Link
                  key={r.id}
                  to={`/candidates/${r.id}`}
                  onClick={close}
                  className="block rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 hover:border-indigo-500/40 transition px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-100">{r.name || 'Unnamed'}</span>
                    <StageBadge stageKey={r.stage?.toLowerCase().replace(/\s+/g, '_') || ''} state="in_progress" size="sm" />
                    <span className="text-[11px] text-slate-500">{r.role}{r.project ? ` · ${r.project}` : ''}</span>
                    <span className={`ml-auto text-xs font-semibold tabular-nums ${
                      r.score >= 85 ? 'text-emerald-300' :
                      r.score >= 65 ? 'text-amber-300' : 'text-slate-400'
                    }`}>
                      {r.score}
                    </span>
                    <ArrowRight size={14} className="text-slate-500" />
                  </div>
                  {r.reason && <div className="text-xs text-slate-400 mt-1 leading-relaxed">{r.reason}</div>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
