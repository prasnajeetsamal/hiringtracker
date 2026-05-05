// api/extract.js
// Multipart -> text. Used for ad-hoc extraction (e.g. previewing a JD/resume
// before saving). For "save resume to a candidate", see api/upload-resume.js.
export const config = { runtime: 'nodejs' };

import { requireAuth } from '../lib/auth.js';
import { parseMultipart, extractText } from '../lib/parse-file.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, res);
  if (!auth.ok) return;

  try {
    const { files } = await parseMultipart(req);
    if (!files.length) {
      res.status(400).json({ error: 'No files received' });
      return;
    }
    const results = await Promise.all(files.map(extractText));
    res.status(200).json({ results });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Upload error' });
  }
}
