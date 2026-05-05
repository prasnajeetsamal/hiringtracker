// api/update-user-role.js
// Admin only. Update another user's role.
//
// Body: { userId, role }
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ALLOWED_ROLES = ['admin', 'hiring_manager', 'hiring_team', 'interviewer'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const callerId = auth.user?.sub;
    const sb = supabaseAdmin();

    const { data: me } = await sb.from('profiles').select('id, role').eq('id', callerId).single();
    if (me?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can change user roles.' });
      return;
    }

    const { userId, role } = req.body || {};
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }
    if (!ALLOWED_ROLES.includes(role)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }

    const { data: updated, error: uErr } = await sb
      .from('profiles')
      .update({ role })
      .eq('id', userId)
      .select()
      .single();
    if (uErr) {
      res.status(500).json({ error: 'Update failed: ' + uErr.message });
      return;
    }

    res.status(200).json({ profile: updated });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
