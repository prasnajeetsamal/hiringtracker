// lib/parse-file.js
// Shared multipart-stream parser + PDF/DOCX/TXT text extraction.
// Used by api/extract.js, api/upload-resume.js, api/upload-jd.js.

import Busboy from 'busboy';
import path from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

export const DEFAULT_LIMITS = { maxFiles: 20, maxSize: 20 * 1024 * 1024 }; // 20 MB / file

/**
 * Parse a multipart request body. Returns { files: [{filename, mimeType, buffer}], fields: {key:value} }.
 * Rejects on stream error. Truncates files that exceed maxSize and silently drops them.
 */
export function parseMultipart(req, limits = DEFAULT_LIMITS) {
  return new Promise((resolve, reject) => {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data upload'));
      return;
    }
    const bb = Busboy({ headers: req.headers });
    const files = [];
    const fields = {};
    let fileCount = 0;

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (_fieldname, file, info) => {
      const { filename, mimeType } = info;
      fileCount += 1;
      if (fileCount > limits.maxFiles) {
        file.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      file.on('data', (d) => {
        size += d.length;
        if (size > limits.maxSize) {
          file.truncated = true;
        } else {
          chunks.push(d);
        }
      });
      file.on('end', () => {
        if (!file.truncated) {
          files.push({ filename, mimeType, buffer: Buffer.concat(chunks) });
        }
      });
    });

    bb.on('error', (err) => reject(err));
    bb.on('finish', () => resolve({ files, fields }));

    req.pipe(bb);
  });
}

/**
 * Extract text from a single uploaded file buffer.
 * Returns { name, size, text } or { name, error } on failure.
 */
export async function extractText(file) {
  try {
    const ext = (path.extname(file.filename || '') || '').toLowerCase();
    const mime = (file.mimeType || '').toLowerCase();
    let text = '';

    if (mime === 'application/pdf' || ext === '.pdf') {
      const data = await pdf(file.buffer);
      text = data.text || '';
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      text = value || '';
    } else if (ext === '.txt' || mime.startsWith('text/')) {
      text = file.buffer.toString('utf8');
    } else {
      text = file.buffer.toString('utf8');
    }
    return { name: file.filename, size: file.buffer.length, text };
  } catch (e) {
    return { name: file.filename, error: e.message || 'Parse failed' };
  }
}
