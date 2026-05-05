// api/upload-resume.js
// Multipart upload of a resume file. Saves the original to Supabase Storage,
// extracts text, creates (or updates) a candidate row.
//
// Form fields:
//   roleId       (required): role to associate the candidate with
//   candidateId  (optional): if updating an existing candidate's resume
//   fullName     (optional): pre-fill candidate name
//   email        (optional)
//   phone        (optional)
//   linkedinUrl  (optional)
//
// Returns: { candidate }
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { parseMultipart, extractText } from '../lib/parse-file.js';
import { uploadToBucket } from '../lib/storage.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const { files, fields } = await parseMultipart(req);
    if (!files.length) {
      res.status(400).json({ error: 'No file received' });
      return;
    }
    const file = files[0];
    const roleId = fields.roleId;
    if (!roleId) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }

    const sb = supabaseAdmin();
    const userId = auth.user?.sub;

    const parsed = await extractText(file);
    if (parsed.error) {
      res.status(400).json({ error: 'Could not parse file: ' + parsed.error });
      return;
    }

    const safeName = (file.filename || 'resume.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = `${roleId}/${Date.now()}_${safeName}`;
    await uploadToBucket({
      bucket: 'resumes',
      path,
      buffer: file.buffer,
      contentType: file.mimeType || 'application/octet-stream',
    });

    const { data: fileRow, error: fErr } = await sb
      .from('files')
      .insert({
        bucket: 'resumes',
        path,
        original_name: file.filename,
        mime: file.mimeType,
        size_bytes: file.buffer.length,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (fErr) {
      res.status(500).json({ error: 'Failed to record file: ' + fErr.message });
      return;
    }

    const candidatePayload = {
      role_id: roleId,
      full_name: fields.fullName || parsed.name?.replace(/\.[^.]+$/, '') || 'Candidate',
      email: fields.email || null,
      phone: fields.phone || null,
      linkedin_url: fields.linkedinUrl || null,
      resume_file_id: fileRow.id,
      resume_text: parsed.text || '',
      source: 'uploaded',
    };

    let candidate;
    if (fields.candidateId) {
      const { data, error } = await sb
        .from('candidates')
        .update({
          resume_file_id: fileRow.id,
          resume_text: parsed.text || '',
          source: 'uploaded',
        })
        .eq('id', fields.candidateId)
        .select()
        .single();
      if (error) {
        res.status(500).json({ error: 'Failed to update candidate: ' + error.message });
        return;
      }
      candidate = data;
    } else {
      const { data, error } = await sb
        .from('candidates')
        .insert(candidatePayload)
        .select()
        .single();
      if (error) {
        res.status(500).json({ error: 'Failed to create candidate: ' + error.message });
        return;
      }
      candidate = data;
    }

    res.status(200).json({ candidate });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
