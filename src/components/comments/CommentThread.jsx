import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import toast from 'react-hot-toast';

import Button from '../common/Button.jsx';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/AuthContext.jsx';

export default function CommentThread({ entityType, entityId }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [body, setBody] = useState('');

  const { data: comments } = useQuery({
    queryKey: ['comments', entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select(`
          id, body_html, created_at,
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
      if (!body.trim()) throw new Error('Comment is empty.');
      const html = `<p>${escapeHtml(body.trim()).replace(/\n/g, '<br>')}</p>`;
      const { error } = await supabase.from('comments').insert({
        entity_type: entityType,
        entity_id: entityId,
        author_id: user.id,
        body_html: html,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['comments', entityType, entityId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {(comments || []).length === 0 ? (
          <div className="text-sm text-slate-500 italic">No comments yet.</div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-900/40 border border-slate-800 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm text-slate-200 font-medium">
                  {c.author?.full_name || c.author?.email || 'Anonymous'}
                </span>
                <span className="text-[11px] text-slate-500 ml-auto">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div className="jd-prose text-sm text-slate-300" dangerouslySetInnerHTML={{ __html: c.body_html }} />
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a note for the team…"
          className="flex-1 bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              post.mutate();
            }
          }}
        />
        <Button icon={Send} onClick={() => post.mutate()} loading={post.isPending}>Post</Button>
      </div>
      <div className="text-[11px] text-slate-500">⌘/Ctrl + Enter to post.</div>
    </div>
  );
}

const escapeHtml = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
