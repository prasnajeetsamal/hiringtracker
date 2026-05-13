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

/**
 * Extract HTML from a single uploaded file. Used for JD uploads where we
 * want to preserve structure (headings, lists, bold) and feed it into the
 * Tiptap editor.
 *
 * - DOCX: mammoth.convertToHtml - preserves structure natively.
 * - PDF / TXT / unknown: heuristic conversion of plain text to HTML
 *   (paragraphs, bullet lists, numbered lists, ALL-CAPS headings).
 */
export async function extractHtml(file) {
  try {
    const ext = (path.extname(file.filename || '') || '').toLowerCase();
    const mime = (file.mimeType || '').toLowerCase();

    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      const { value } = await mammoth.convertToHtml(
        { buffer: file.buffer },
        {
          styleMap: [
            "p[style-name='Heading 1'] => h2:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Title'] => h2:fresh",
            "p[style-name='Subtitle'] => h3:fresh",
          ],
        }
      );
      const html = sanitizeHtml(value || '');
      return { name: file.filename, size: file.buffer.length, html, text: stripHtml(html) };
    }

    let text = '';
    if (mime === 'application/pdf' || ext === '.pdf') {
      const data = await pdf(file.buffer);
      text = data.text || '';
    } else if (ext === '.txt' || mime.startsWith('text/')) {
      text = file.buffer.toString('utf8');
    } else {
      text = file.buffer.toString('utf8');
    }
    const html = textToHtml(text);
    return { name: file.filename, size: file.buffer.length, html, text };
  } catch (e) {
    return { name: file.filename, error: e.message || 'Parse failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Text → HTML heuristics for PDF/TXT JDs
// ─────────────────────────────────────────────────────────────────────

const escapeHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const stripHtml = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const BULLET_RE = /^\s*(?:[•‣◦▪■●◆◇○]|[-*--])\s+/;
const NUM_BULLET_RE = /^\s*(?:\d{1,2}[.)]|\(\d{1,2}\))\s+/;

const isBullet = (line) => BULLET_RE.test(line);
const isNumBullet = (line) => NUM_BULLET_RE.test(line);
const stripBullet = (line) => line.replace(BULLET_RE, '').replace(NUM_BULLET_RE, '').trim();

// A heading is a short line that's mostly alphabetic and either ALL CAPS,
// ends in ":", or is preceded/followed by content blocks. Conservative.
const looksLikeHeading = (line) => {
  const t = line.trim();
  if (t.length === 0 || t.length > 80) return false;
  if (/[.?!]\s*$/.test(t)) return false; // ends in sentence punctuation
  const colon = t.endsWith(':');
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return false;
  const upperRatio = letters.replace(/[a-z]/g, '').length / letters.length;
  if (upperRatio >= 0.85 && letters.length >= 3) return true;
  if (colon && t.length <= 60) return true;
  return false;
};

function textToHtml(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  // Split into paragraphs by blank lines.
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  const html = [];

  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    // All bullets?
    if (lines.length >= 2 && lines.every((l) => isBullet(l) || isNumBullet(l))) {
      const ordered = lines.every(isNumBullet);
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>` + lines.map((l) => `<li>${escapeHtml(stripBullet(l))}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // Mixed: line-by-line with potential leading heading and possible bullets.
    let i = 0;
    let buffer = []; // accumulates non-bullet lines into a paragraph

    const flushParagraph = () => {
      if (buffer.length === 0) return;
      const joined = buffer.join(' ');
      html.push(`<p>${escapeHtml(joined)}</p>`);
      buffer = [];
    };

    while (i < lines.length) {
      const line = lines[i];

      // First-line heading?
      if (i === 0 && looksLikeHeading(line)) {
        flushParagraph();
        const cleaned = line.endsWith(':') ? line.slice(0, -1) : line;
        html.push(`<h3>${escapeHtml(cleaned)}</h3>`);
        i += 1;
        continue;
      }

      if (isBullet(line) || isNumBullet(line)) {
        flushParagraph();
        const ordered = isNumBullet(line);
        const items = [];
        while (i < lines.length && (isBullet(lines[i]) || isNumBullet(lines[i]))) {
          items.push(stripBullet(lines[i]));
          i += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        html.push(`<${tag}>` + items.map((t) => `<li>${escapeHtml(t)}</li>`).join('') + `</${tag}>`);
        continue;
      }

      buffer.push(line);
      i += 1;
    }
    flushParagraph();
  }

  return html.join('\n');
}

// Light sanitization - strip <script>/<style> and on* attributes. The HTML
// is always rendered inside our app behind auth, but we still don't want
// scripts from a malicious file to run.
function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
}
