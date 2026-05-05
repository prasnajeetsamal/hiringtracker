// api/invite-user.js
// Admin / hiring-manager only. Invites a user via Supabase Auth admin API
// and sets their initial role + full_name on the profiles row.
//
// Body: { email, fullName?, role? }
// Returns: { user, profile, inviteUrl? }
//
// If Supabase SMTP is configured, an invite email is sent automatically.
// If not, we fall back to generating a magic link and return it so the
// admin can share manually.
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';

const ALLOWED_ROLES = ['admin', 'hiring_manager', 'hiring_team', 'interviewer'];

async function callerProfile(sb, userId) {
  const { data } = await sb.from('profiles').select('id, role').eq('id', userId).single();
  return data;
}

async function callerIsManagerSomewhere(sb, userId) {
  const { data } = await sb
    .from('project_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('role_in_project', 'manager')
    .limit(1);
  return (data || []).length > 0;
}

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

    const me = await callerProfile(sb, callerId);
    const isAdmin = me?.role === 'admin';
    const isManager = isAdmin || (await callerIsManagerSomewhere(sb, callerId));
    if (!isAdmin && !isManager) {
      res.status(403).json({ error: 'Only admins or project managers can invite users.' });
      return;
    }

    const { email, fullName, role } = req.body || {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: 'A valid email is required.' });
      return;
    }
    const targetRole = role || 'interviewer';
    if (!ALLOWED_ROLES.includes(targetRole)) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    // Only admins can mint another admin.
    if (targetRole === 'admin' && !isAdmin) {
      res.status(403).json({ error: 'Only admins can grant the admin role.' });
      return;
    }

    let userId;
    let inviteUrl;

    // Try inviteUserByEmail first (sends email if SMTP is configured)
    const { data: invitedData, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName || null },
    });

    if (inviteError) {
      // Common case: user already exists. Look them up and update role/name only.
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (!existing) {
        // SMTP not configured? Fall back to generateLink so the admin can share the URL manually.
        const { data: linkData, error: linkError } = await sb.auth.admin.generateLink({
          type: 'invite',
          email,
        });
        if (linkError || !linkData?.user) {
          res.status(500).json({ error: 'Invite failed: ' + (inviteError.message || linkError?.message || 'unknown') });
          return;
        }
        userId = linkData.user.id;
        inviteUrl = linkData.properties?.action_link || null;
      } else {
        userId = existing.id;
      }
    } else {
      userId = invitedData?.user?.id;
    }

    if (!userId) {
      res.status(500).json({ error: 'Invite created no user id.' });
      return;
    }

    // The auth.users insert trigger creates the profile row. Update role + name.
    const { data: profile, error: pErr } = await sb
      .from('profiles')
      .update({
        role: targetRole,
        ...(fullName ? { full_name: fullName } : {}),
      })
      .eq('id', userId)
      .select()
      .single();
    if (pErr) {
      // Profile row may not exist yet if the trigger hasn't fired (rare). Upsert.
      const { data: upserted, error: upErr } = await sb
        .from('profiles')
        .upsert({ id: userId, email, role: targetRole, full_name: fullName || null }, { onConflict: 'id' })
        .select()
        .single();
      if (upErr) {
        res.status(500).json({ error: 'Profile update failed: ' + upErr.message });
        return;
      }
      res.status(200).json({ user: { id: userId, email }, profile: upserted, inviteUrl });
      return;
    }

    res.status(200).json({ user: { id: userId, email }, profile, inviteUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
