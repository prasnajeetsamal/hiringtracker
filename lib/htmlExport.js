// lib/htmlExport.js
// SERVER-SAFE mirror of the HTML export shell. Same content as
// src/lib/htmlExport.js minus the browser-only `downloadHtmlFile` helper.
// Imported by Vercel serverless functions (e.g. cron-scheduled-reports).
//
// The client wrapper at src/lib/htmlExport.js re-exports renderHtmlDocument /
// esc / sanitizeHtml from here and layers on `downloadHtmlFile`. Keep the two
// in sync if you change the CSS or document shell.

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

const BASE_CSS = `
  :root {
    --bg: #0b1220;
    --panel: rgba(30, 41, 59, 0.55);
    --panel-border: rgba(148, 163, 184, 0.18);
    --ink: #f1f5f9;
    --ink-muted: #cbd5e1;
    --ink-dim: #94a3b8;
    --ink-faint: #64748b;
    --indigo: #818cf8;
    --violet: #c084fc;
    --pink: #f472b6;
    --emerald: #6ee7b7;
    --rose: #fda4af;
    --amber: #fcd34d;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background:
      radial-gradient(60% 50% at 80% 0%, rgba(99,102,241,0.18) 0%, transparent 60%),
      radial-gradient(50% 40% at 0% 100%, rgba(244,114,182,0.15) 0%, transparent 60%),
      linear-gradient(180deg, #050816 0%, #0b1220 100%);
    color: var(--ink);
    min-height: 100vh;
    padding: 40px 24px;
  }
  .container { max-width: 1080px; margin: 0 auto; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-end;
    flex-wrap: wrap; gap: 12px; margin-bottom: 24px;
  }
  .brand {
    font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    background: linear-gradient(90deg, var(--indigo), var(--violet), var(--pink));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h1 { margin: 6px 0 0; font-size: 28px; font-weight: 600; letter-spacing: -0.01em; }
  h2 { margin: 1.2em 0 0.4em; font-size: 16px; font-weight: 600; color: var(--ink); letter-spacing: 0.02em; }
  h3 { margin: 1em 0 0.3em; font-size: 13px; font-weight: 600; color: var(--ink-muted); }
  .subtitle { color: var(--ink-dim); font-size: 13px; margin-top: 4px; }
  .generated { color: var(--ink-faint); font-size: 12px; }
  a { color: var(--indigo); text-decoration: none; }
  a:hover { text-decoration: underline; }
  p { margin: 0.5em 0; color: var(--ink-muted); line-height: 1.55; }
  ul, ol { margin: 0.5em 0; padding-left: 1.4em; color: var(--ink-muted); }
  li { margin: 0.2em 0; }
  strong { color: var(--ink); }
  em { color: var(--ink-muted); }
  blockquote { margin: 0.5em 0; padding-left: 12px; border-left: 2px solid var(--panel-border); color: var(--ink-dim); font-style: italic; }
  .panel { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 16px; padding: 20px; margin-bottom: 16px; backdrop-filter: blur(8px); }
  .panel__title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); margin: 0 0 14px; font-weight: 600; }

  .kpis { display: grid; gap: 12px; grid-template-columns: repeat(5, 1fr); margin-bottom: 16px; }
  @media (max-width: 760px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
  .kpi { position: relative; overflow: hidden; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--panel-border); border-radius: 14px; padding: 16px; }
  .kpi::after { content: ""; position: absolute; inset: -50% -50% auto auto; width: 160px; height: 160px; border-radius: 50%; filter: blur(40px); opacity: 0.4; }
  .kpi--indigo::after  { background: var(--indigo); }
  .kpi--emerald::after { background: var(--emerald); }
  .kpi--rose::after    { background: var(--rose); }
  .kpi--violet::after  { background: var(--violet); }
  .kpi--amber::after   { background: var(--amber); }
  .kpi__label { font-size: 11px; color: var(--ink-dim); letter-spacing: 0.04em; }
  .kpi__value { font-size: 28px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .kpi__hint  { font-size: 11px; color: var(--ink-faint); margin-top: 8px; }

  .stage { margin-bottom: 12px; }
  .stage__label { font-size: 13px; color: var(--ink); margin-bottom: 6px; }
  .stage__bar { display: flex; height: 12px; border-radius: 6px; background: rgba(15,23,42,0.6); overflow: hidden; border: 1px solid var(--panel-border); }
  .stage__bar .seg { display: block; height: 100%; }
  .stage__counts { margin-top: 5px; display: flex; gap: 14px; align-items: center; font-size: 11px; color: var(--ink-dim); font-variant-numeric: tabular-nums; }
  .stage__reached { margin-left: auto; color: var(--ink-faint); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
  .dot--indigo  { background: #6366f1; }
  .dot--emerald { background: #10b981; }
  .dot--rose    { background: #f43f5e; }
  .dot--slate   { background: #94a3b8; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); font-weight: 500; padding: 8px 0; border-bottom: 1px solid var(--panel-border); }
  thead th.num, tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td { padding: 9px 8px; border-bottom: 1px solid rgba(148,163,184,0.08); color: var(--ink-muted); }
  tbody td:first-child { padding-left: 0; color: var(--ink); }
  tbody td.rose { color: var(--rose); }

  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; border: 1px solid var(--panel-border); background: rgba(15,23,42,0.5); color: var(--ink-muted); }
  .pill--indigo  { border-color: rgba(129,140,248,0.35); background: rgba(99,102,241,0.12); color: var(--indigo); }
  .pill--emerald { border-color: rgba(110,231,183,0.35); background: rgba(16,185,129,0.12); color: var(--emerald); }
  .pill--rose    { border-color: rgba(253,164,175,0.35); background: rgba(244,63,94,0.12); color: var(--rose); }
  .pill--amber   { border-color: rgba(252,211,77,0.35); background: rgba(245,158,11,0.12); color: var(--amber); }
  .pill--violet  { border-color: rgba(192,132,252,0.35); background: rgba(168,85,247,0.12); color: var(--violet); }

  .source-row { display: flex; align-items: center; gap: 12px; margin-bottom: 7px; }
  .source-row__label { width: 110px; font-size: 12px; color: var(--ink); text-transform: capitalize; }
  .source-row__bar { flex: 1; height: 14px; border-radius: 8px; background: rgba(15,23,42,0.6); border: 1px solid var(--panel-border); overflow: hidden; }
  .source-row__bar span { display: block; height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7); }
  .source-row__count { width: 42px; text-align: right; font-size: 12px; color: var(--ink); font-variant-numeric: tabular-nums; }

  .top-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(148,163,184,0.08); }
  .top-row:last-child { border-bottom: 0; }
  .top-row__score { width: 44px; height: 30px; display: inline-flex; align-items: center; justify-content: center; background: rgba(252, 211, 77, 0.12); color: var(--amber); border: 1px solid rgba(252, 211, 77, 0.3); border-radius: 8px; font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; }
  .top-row__main { flex: 1; min-width: 0; }
  .top-row__name { font-size: 14px; color: var(--ink); }
  .top-row__sub  { font-size: 11px; color: var(--ink-faint); }
  .top-row__rec  { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; }
  .rec--hire     { background: rgba(110,231,183,0.12); color: #6ee7b7; border-color: rgba(110,231,183,0.35); }
  .rec--consider { background: rgba(252,211,77,0.12); color: #fcd34d; border-color: rgba(252,211,77,0.35); }
  .rec--reject   { background: rgba(253,164,175,0.12); color: #fda4af; border-color: rgba(253,164,175,0.35); }

  .meta-grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; font-size: 13px; }
  .meta-grid dt { color: var(--ink-faint); }
  .meta-grid dd { margin: 0; color: var(--ink-muted); }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .grid-2 { grid-template-columns: 1fr; } }

  .muted { color: var(--ink-faint); font-size: 13px; font-style: italic; }
  .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--panel-border); font-size: 11px; color: var(--ink-faint); text-align: center; }

  @media print {
    body { background: white !important; padding: 0.4in; color: #0f172a; }
    .panel { background: white; border: 1px solid #cbd5e1; backdrop-filter: none; page-break-inside: avoid; }
    .kpi { background: #f8fafc; border-color: #cbd5e1; }
    .kpi::after { opacity: 0.5; }
    h1, h2, h3, .top-row__name, .stage__label { color: #0f172a !important; }
    .subtitle, .kpi__label { color: #475569 !important; }
    .kpi__value, p, li { color: #1e293b !important; }
    .kpi__hint, .stage__counts, .generated, .footer, tbody td, .top-row__sub, .source-row__label { color: #475569 !important; }
    tbody td:first-child { color: #0f172a !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`;

export function renderHtmlDocument({ title, header, body }) {
  const generated = new Date().toLocaleDateString(undefined, { dateStyle: 'medium' });
  const eyebrow = header?.eyebrow || 'Slate - Hiring Tracker';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${BASE_CSS}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="brand">${esc(eyebrow)}</div>
        <h1>${esc(header.title)}</h1>
        ${header.subtitle ? `<div class="subtitle">${esc(header.subtitle)}</div>` : ''}
      </div>
      <div class="generated">Generated ${esc(generated)}</div>
    </div>
    ${body}
    <div class="footer">
      Generated by Slate - Hiring Tracker - ${esc(new Date().toISOString())}
    </div>
  </div>
</body>
</html>`;
}
