// src/lib/api.js
// Centralized API client. Attaches the current Supabase access token
// to every request so backend endpoints can authenticate the caller.

import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_BASE?.replace(/\/$/, '')) || '';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, { method = 'GET', body, signal, isForm = false } = {}) {
  const headers = await authHeaders();
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  const rsp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '');
    if (rsp.status === 401) throw new Error('Your session has expired. Please sign in again.');
    throw new Error(`${path} failed (${rsp.status}) ${text || ''}`.trim());
  }
  const ct = rsp.headers.get('content-type') || '';
  return ct.includes('application/json') ? rsp.json() : rsp.text();
}

export async function extractFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  return req('/api/extract', { method: 'POST', body: fd, isForm: true });
}

export async function uploadResume({ candidateId, file }) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (candidateId) fd.append('candidateId', candidateId);
  return req('/api/upload-resume', { method: 'POST', body: fd, isForm: true });
}

export async function uploadJD({ roleId, file }) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (roleId) fd.append('roleId', roleId);
  return req('/api/upload-jd', { method: 'POST', body: fd, isForm: true });
}

export async function scoreCandidate({ candidateId, roleId }) {
  return req('/api/score-candidate', { method: 'POST', body: { candidateId, roleId } });
}

export async function generateJD(payload) {
  return req('/api/generate-jd', { method: 'POST', body: payload });
}

export async function summarizeFeedback({ candidateId }) {
  return req('/api/summarize-feedback', { method: 'POST', body: { candidateId } });
}

export async function inviteUser({ email, fullName, role }) {
  return req('/api/invite-user', { method: 'POST', body: { email, fullName, role } });
}

export async function updateUserRole({ userId, role }) {
  return req('/api/update-user-role', { method: 'POST', body: { userId, role } });
}
