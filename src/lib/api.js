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

export async function uploadResume({ file, roleId, candidateId, fullName, email, phone, linkedinUrl }) {
  if (!file) throw new Error('uploadResume requires a file.');
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (roleId) fd.append('roleId', roleId);
  if (candidateId) fd.append('candidateId', candidateId);
  if (fullName) fd.append('fullName', fullName);
  if (email) fd.append('email', email);
  if (phone) fd.append('phone', phone);
  if (linkedinUrl) fd.append('linkedinUrl', linkedinUrl);
  return req('/api/upload-resume', { method: 'POST', body: fd, isForm: true });
}

export async function uploadJD({ file, roleId }) {
  if (!file) throw new Error('uploadJD requires a file.');
  if (!roleId) throw new Error('uploadJD requires a roleId.');
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('roleId', roleId);
  return req('/api/upload-jd', { method: 'POST', body: fd, isForm: true });
}

export async function createCandidate(payload) {
  return req('/api/create-candidate', { method: 'POST', body: payload });
}

// Consolidated admin-delete endpoint (one Vercel function for all 3 delete
// flavors so we stay under the Hobby plan's 12-function limit).
export async function deleteCandidate({ candidateId }) {
  return req('/api/admin-delete', { method: 'POST', body: { entityType: 'candidate', id: candidateId } });
}

export async function deleteRole({ roleId }) {
  return req('/api/admin-delete', { method: 'POST', body: { entityType: 'role', id: roleId } });
}

export async function deleteProject({ projectId }) {
  return req('/api/admin-delete', { method: 'POST', body: { entityType: 'project', id: projectId } });
}

export async function cloneCandidate({ candidateId, targetRoleId }) {
  return req('/api/clone-candidate', { method: 'POST', body: { candidateId, targetRoleId } });
}

export async function askAssistant({ messages }) {
  return req('/api/ask', { method: 'POST', body: { messages } });
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

// Consolidated admin-users endpoint (one Vercel function dispatching on `action`).
export async function inviteUser({ email, fullName, role }) {
  return req('/api/admin-users', { method: 'POST', body: { action: 'invite', email, fullName, role } });
}

export async function updateUserRole({ userId, role }) {
  return req('/api/admin-users', { method: 'POST', body: { action: 'update_role', userId, role } });
}

export async function semanticSearchCandidates({ query, limit, projectId, roleId }) {
  return req('/api/semantic-search', { method: 'POST', body: { query, limit, projectId, roleId } });
}

export async function notifyMention({ commentId }) {
  return req('/api/notify-mention', { method: 'POST', body: { commentId } });
}

export async function transitionCandidate({ candidateId, action }) {
  return req('/api/transition-candidate', { method: 'POST', body: { candidateId, action } });
}

export async function emailCandidate(payload) {
  return req('/api/email-candidate', { method: 'POST', body: payload });
}
