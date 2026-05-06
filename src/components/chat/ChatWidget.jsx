import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, X, Send, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { askAssistant } from '../../lib/api.js';

const STORAGE_KEY = 'slate.chat.messages';
const SUGGESTIONS = [
  'Which candidates are at HM Review?',
  'How many candidates do we have at each stage?',
  'Show me the top-scoring active candidates.',
  'What roles are open right now?',
];

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); }
  catch { /* ignore quota */ }
}

// Lightweight markdown-ish renderer: bold via **x**, lists via "- " or "* ",
// candidate://id links converted to clickable spans, line breaks preserved.
function renderRich(text, onCandidateClick) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n');
    const isList = lines.every((l) => /^\s*[-*]\s+/.test(l)) && lines.length >= 2;
    if (isList) {
      return (
        <ul key={bi} className="list-disc list-inside space-y-0.5 my-1.5">
          {lines.map((l, li) => (
            <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''), onCandidateClick)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="my-1.5">
        {lines.map((l, li) => (
          <React.Fragment key={li}>
            {renderInline(l, onCandidateClick)}
            {li < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

function renderInline(text, onCandidateClick) {
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\(candidate:\/\/[^)]+\))/g;
  const parts = text.split(re);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="text-slate-100 font-semibold">{p.slice(2, -2)}</strong>;
    }
    const m = p.match(/^\[([^\]]+)\]\(candidate:\/\/([^)]+)\)$/);
    if (m) {
      const label = m[1];
      const id = m[2];
      return (
        <button
          key={i}
          onClick={() => onCandidateClick(id)}
          className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2 decoration-dotted"
        >
          {label}
        </button>
      );
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

export default function ChatWidget() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadHistory());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => { saveHistory(messages); }, [messages]);
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages, busy]);

  const sendMessage = async (text) => {
    const content = (text || '').trim();
    if (!content || busy) return;
    setError('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const { reply } = await askAssistant({ messages: next });
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e.message || 'Could not reach the assistant');
    } finally {
      setBusy(false);
    }
  };

  const onCandidateClick = (id) => {
    setOpen(false);
    navigate(`/candidates/${id}`);
  };

  const clearHistory = () => {
    setMessages([]);
    setError('');
  };

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full grid place-items-center text-white shadow-2xl shadow-indigo-900/50 transition-transform hover:scale-105 bg-gradient-to-br from-indigo-600 via-violet-600 to-pink-600"
      >
        {open ? <X size={20} /> : <MessageSquare size={20} />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-[min(420px,calc(100vw-2.5rem))] h-[min(620px,calc(100vh-7rem))] flex flex-col rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-slate-950/70 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-pink-500/10">
            <div className="w-7 h-7 rounded-lg grid place-items-center text-white bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500">
              <Sparkles size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-100">Slate Assistant</div>
              <div className="text-[11px] text-slate-400">Ask anything about your hiring data</div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-slate-500 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800/60"
                title="Clear conversation"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800/60"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {messages.length === 0 ? (
              <div className="text-slate-400 text-sm">
                <p>Hi! I can answer questions about your candidates, roles, projects, and pipeline. Try one of these:</p>
                <div className="mt-3 space-y-1.5">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/40 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition text-slate-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <Message key={i} message={m} onCandidateClick={onCandidateClick} />
              ))
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin text-indigo-400" /> Thinking…
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(draft); }}
            className="border-t border-slate-800 px-3 py-2.5 flex items-center gap-2 bg-slate-950/40"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about candidates, roles, pipeline…"
              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="w-9 h-9 rounded-lg grid place-items-center text-white bg-gradient-to-br from-indigo-600 via-violet-600 to-pink-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Message({ message, onCandidateClick }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 bg-gradient-to-br from-indigo-600 via-violet-600 to-pink-600 text-white text-sm shadow-lg shadow-indigo-900/30'
            : 'max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 bg-slate-800/80 text-slate-200 text-sm border border-slate-700'
        }
      >
        <div className={isUser ? '' : 'leading-relaxed'}>
          {isUser
            ? message.content
            : renderRich(message.content || '', onCandidateClick)}
        </div>
      </div>
    </div>
  );
}
