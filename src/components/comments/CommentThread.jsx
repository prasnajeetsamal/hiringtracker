import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, AtSign } from 'lucide-react';
import toast from 'react-hot-toast';

import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { notifyMention } from '../../lib/api.js';

// Stable cache: list of profiles available for @mention. Reused across all
// CommentThread instances on a page.
function useTeammates() {
  return useQuery({
    queryKey: ['mentionable-profiles'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// Parse `@[Display Name](user://uuid)` markers from a draft string and return
// { html, mentionedIds }. Plain text is HTML-escaped with <br> for newlines;
// mentions become a chip-style span the renderer also recognises.
function buildCommentHtml(draft, peopleById) {
  const ids = new Set();
  const escaped = escapeHtml(draft);
  // Walk both escape-safe AND raw - easier to operate on raw, then re-escape segments.
  const out = [];
  let i = 0;
  const re = /@\[([^\]]+)\]\(user:\/\/([a-fA-F0-9-]+)\)/g;
  let m;
  while ((m = re.exec(draft)) !== null) {
    out.push(escapeHtml(draft.slice(i, m.index)));
    const id = m[2];
    const name = m[1];
    ids.add(id);
    out.push(`<span class="mention" data-user-id="${id}">@${escapeHtml(name)}</span>`);
    i = m.index + m[0].length;
  }
  out.push(escapeHtml(draft.slice(i)));
  const html = '<p>' + out.join('').replace(/\n/g, '<br>') + '</p>';
  return { html, mentionedIds: [...ids], _unused: escaped };
}

export default function CommentThread({ entityType, entityId, compact = false }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  const textareaRef = useRef(null);

  // @mention popover state
  const [mentionState, setMentionState] = useState(null); // { startIdx, query }
  const [activeIdx, setActiveIdx] = useState(0);
  const { data: people = [] } = useTeammates();
  const peopleById = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p])),
    [people]
  );

  const { data: comments } = useQuery({
    queryKey: ['comments', entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select(`
          id, body_html, mentions, created_at,
          author:profiles!comments_author_id_fkey ( id, full_name, email )
        `)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      if (!draft.trim()) throw new Error('Comment is empty.');
      const { html, mentionedIds } = buildCommentHtml(draft.trim(), peopleById);
      const { data, error } = await supabase
        .from('comments')
        .insert({
          entity_type: entityType,
          entity_id: entityId,
          author_id: user.id,
          body_html: html,
          mentions: mentionedIds.length ? mentionedIds : null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return { commentId: data?.id, hadMentions: mentionedIds.length > 0 };
    },
    onSuccess: ({ commentId, hadMentions }) => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['comments', entityType, entityId] });
      // Best-effort email dispatch - never block the UI on it.
      if (hadMentions && commentId) {
        notifyMention({ commentId }).catch(() => { /* swallow */ });
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // Detect @mention triggers in the textarea
  const onChange = (val) => {
    setDraft(val);
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? val.length;
    // Find the most recent '@' before the caret that isn't already inside a [Name](user://) marker.
    const upto = val.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at < 0) { setMentionState(null); return; }
    // Reject if the char before '@' is alphanumeric (e.g. email "name@domain")
    const prevCh = at > 0 ? upto[at - 1] : ' ';
    if (/[A-Za-z0-9]/.test(prevCh)) { setMentionState(null); return; }
    // Reject if the segment from @ to caret contains a closing ')' or '\n'
    const seg = upto.slice(at + 1);
    if (/[)\n]/.test(seg) || seg.length > 30) { setMentionState(null); return; }
    setMentionState({ startIdx: at, query: seg.toLowerCase() });
    setActiveIdx(0);
  };

  const filteredPeople = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query;
    return people
      .filter((p) => {
        if (p.id === user?.id) return false;
        const hay = `${p.full_name || ''} ${p.email || ''}`.toLowerCase();
        return !q || hay.includes(q);
      })
      .slice(0, 6);
  }, [mentionState, people, user]);

  const insertMention = (person) => {
    if (!mentionState) return;
    const before = draft.slice(0, mentionState.startIdx);
    // Best-effort find the caret - rely on the textarea's current selectionStart if available.
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const after = draft.slice(caret);
    const display = person.full_name || person.email || 'User';
    const marker = `@[${display}](user://${person.id}) `;
    const next = before + marker + after;
    setDraft(next);
    setMentionState(null);
    // Restore caret right after the inserted marker
    requestAnimationFrame(() => {
      const pos = (before + marker).length;
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); }
    });
  };

  const onKeyDown = (e) => {
    if (mentionState && filteredPeople.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filteredPeople.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filteredPeople.length) % filteredPeople.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredPeople[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      post.mutate();
    }
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {(comments || []).length === 0 ? (
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-slate-500 italic`}>
            No comments yet.
          </div>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg bg-slate-900/40 border border-slate-800 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`${compact ? 'text-xs' : 'text-sm'} text-slate-200 font-medium`}>
                  {c.author?.full_name || c.author?.email || 'Anonymous'}
                </span>
                <span className="text-[11px] text-slate-500 ml-auto">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div
                className={`jd-prose ${compact ? 'text-xs' : 'text-sm'} text-slate-300`}
                dangerouslySetInnerHTML={{ __html: c.body_html }}
              />
            </div>
          ))
        )}
      </div>
      <div className="relative">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={compact ? 2 : 2}
            placeholder={compact ? 'Add a note. Type @ to mention…' : 'Add a note for the team. Type @ to mention…'}
            className={`flex-1 bg-slate-950/60 border border-slate-700 rounded-lg ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'} text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
          />
          <Button icon={Send} size={compact ? 'sm' : undefined} onClick={() => post.mutate()} loading={post.isPending}>
            {compact ? '' : 'Post'}
          </Button>
        </div>

        {mentionState && filteredPeople.length > 0 && (
          <div className="absolute left-0 right-0 bottom-full mb-1 max-w-md z-10 rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800 flex items-center gap-1.5">
              <AtSign size={10} /> Mention a teammate
            </div>
            <div>
              {filteredPeople.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMention(p); }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs ${
                    idx === activeIdx ? 'bg-indigo-500/15 text-indigo-100' : 'text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="font-medium">{p.full_name || p.email}</span>
                  {p.full_name && <span className="text-slate-500">{p.email}</span>}
                  <span className="ml-auto text-[10px] text-slate-500 capitalize">
                    {String(p.role || '').replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}>
        ⌘/Ctrl + Enter to post · Type <span className="font-mono text-slate-400">@</span> to mention.
      </div>
    </div>
  );
}

const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
