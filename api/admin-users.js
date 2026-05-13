// api/admin-users.js
// Consolidated admin endpoint for user-management actions.
// Replaces api/invite-user.js and api/update-user-role.js so we stay under
// Vercel Hobby's 12-function cap.
//
// Body: { action: 'invite' | 'update_role', ...payload }
//
//   action='invite'      → { email, fullName?, role? }   admin OR project-manager
//                          Returns { user, profile, inviteUrl? }
//
//   action='update_role' → { userId, role }              admin only
//                          Returns { profile }
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

async function handleInvite(sb, callerId, body, res) {
  const me = await callerProfile(sb, callerId);
  const isAdmin = me?.role === 'admin';
  const isManager = isAdmin || (await callerIsManagerSomewhere(sb, callerId));
  if (!isAdmin && !isManager) {
    res.status(403).json({ error: 'Only admins or project managers can invite users.' });
    return;
  }

  const { email, fullName, role } = body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  const targetRole = role || 'interviewer';
  if (!ALLOWED_ROLES.includes(targetRole)) {
    res.status(400).json({ error: 'Invalid role.' });
    return;
  }
  if (targetRole === 'admin' && !isAdmin) {
    res.status(403).json({ error: 'Only admins can grant the admin role.' });
    return;
  }

  let userId;
  let inviteUrl;

  const { data: invitedData, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName || null },
  });

  if (inviteError) {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!existing) {
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
}

async function handleUpdateRole(sb, callerId, body, res) {
  const me = await callerProfile(sb, callerId);
  if (me?.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can change user roles.' });
    return;
  }

  const { userId, role } = body || {};
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
    const action = req.body?.action;

    if (action === 'invite')      return await handleInvite(sb, callerId, req.body, res);
    if (action === 'update_role') return await handleUpdateRole(sb, callerId, req.body, res);

    res.status(400).json({ error: "action must be 'invite' or 'update_role'." });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
