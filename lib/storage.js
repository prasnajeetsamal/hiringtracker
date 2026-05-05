// lib/storage.js
// Helpers for Supabase Storage. Auto-creates the required buckets on first
// upload so the user doesn't need to provision them manually.

import { supabaseAdmin } from './supabase-admin.js';

const REQUIRED_BUCKETS = {
  resumes: { public: false, fileSizeLimit: 20 * 1024 * 1024 },
  jds:     { public: false, fileSizeLimit: 20 * 1024 * 1024 },
};

let _ensured = false;

export async function ensureBuckets() {
  if (_ensured) return;
  const sb = supabaseAdmin();
  const { data: existing, error } = await sb.storage.listBuckets();
  if (error) throw new Error('Failed to list storage buckets: ' + error.message);
  const have = new Set((existing || []).map((b) => b.name));
  for (const [name, opts] of Object.entries(REQUIRED_BUCKETS)) {
    if (!have.has(name)) {
      const { error: cErr } = await sb.storage.createBucket(name, opts);
      if (cErr && !/already exists/i.test(cErr.message)) {
        throw new Error(`Failed to create bucket "${name}": ${cErr.message}`);
      }
    }
  }
  _ensured = true;
}

export async function uploadToBucket({ bucket, path, buffer, contentType }) {
  await ensureBuckets();
  const sb = supabaseAdmin();
  const { error } = await sb.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error('Upload failed: ' + error.message);
}

export async function getSignedUrl({ bucket, path, expiresIn = 3600 }) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw new Error('Sign URL failed: ' + error.message);
  return data.signedUrl;
}
