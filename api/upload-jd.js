// api/upload-jd.js
// Upload a JD file (PDF/DOCX/TXT). Stores the original in Supabase Storage,
// extracts structured HTML (mammoth for DOCX; heuristic conversion for
// PDF/TXT), and updates the role with jd_html + jd_file_id +
// jd_source='uploaded'.
//
// Form fields:
//   roleId  (required)
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { parseMultipart, extractHtml } from '../lib/parse-file.js';
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

    const parsed = await extractHtml(file);
    if (parsed.error) {
      res.status(400).json({ error: 'Could not parse file: ' + parsed.error });
      return;
    }

    const safeName = (file.filename || 'jd.bin').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = `${roleId}/${Date.now()}_${safeName}`;
    await uploadToBucket({
      bucket: 'jds',
      path,
      buffer: file.buffer,
      contentType: file.mimeType || 'application/octet-stream',
    });

    const sb = supabaseAdmin();
    const userId = auth.user?.sub;

    const { data: fileRow, error: fErr } = await sb
      .from('files')
      .insert({
        bucket: 'jds',
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

    const html = parsed.html || '';

    const { data: role, error: uErr } = await sb
      .from('roles')
      .update({
        jd_source: 'uploaded',
        jd_html: html,
        jd_file_id: fileRow.id,
      })
      .eq('id', roleId)
      .select()
      .single();
    if (uErr) {
      res.status(500).json({ error: 'Failed to update role: ' + uErr.message });
      return;
    }

    res.status(200).json({ role, jd_html: html });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
}
