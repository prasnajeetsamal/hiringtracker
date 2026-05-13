// src/lib/htmlExport.js
// Client-facing wrapper. Re-exports the shared HTML shell from
// lib/htmlExport.js (server-safe; no `document` reliance) and layers on
// `downloadHtmlFile` which uses browser-only APIs.

export { esc, sanitizeHtml, renderHtmlDocument } from '../../lib/htmlExport.js';

export function downloadHtmlFile(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
