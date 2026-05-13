import React, { useMemo } from 'react';
import { Mail, Phone, Linkedin, Globe } from 'lucide-react';

/**
 * Resume text formatter.
 *
 * Resume text comes from PDF/DOCX extraction (lib/parse-file.js#extractText)
 * which gives us raw lines with whitespace preserved. We don't get any
 * structural HTML, so we apply heuristics:
 *
 *   1. Detect section headings - short lines (< 50 chars) that are mostly
 *      ALL CAPS (e.g. "EXPERIENCE", "EDUCATION", "SKILLS").
 *   2. Detect bullet items - lines starting with -, •, *, ▪, ‣, ◦, etc.
 *   3. Detect contact lines - early lines containing emails / phone /
 *      LinkedIn / GitHub URLs separated by typical delimiters (• | / ,).
 *   4. Detect role lines - "Company - Title  Date Range" or similar
 *      patterns that often introduce a job entry; render with subtle
 *      emphasis on the date portion.
 *   5. Everything else renders as a paragraph with line breaks preserved.
 */
export default function ResumeView({ text }) {
  const blocks = useMemo(() => parseResume(text), [text]);

  if (!blocks.length) {
    return <div className="text-sm text-slate-500 italic">Resume text is empty.</div>;
  }

  return (
    <div className="text-[13px] text-slate-300 leading-relaxed space-y-3 max-h-[640px] overflow-y-auto pr-2">
      {blocks.map((b, i) => {
        if (b.type === 'name') {
          return (
            <div key={i} className="text-base font-semibold text-slate-100 leading-tight">{b.text}</div>
          );
        }
        if (b.type === 'contact') {
          return (
            <div key={i} className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-400">
              {b.parts.map((p, j) => <ContactPart key={j} part={p} />)}
            </div>
          );
        }
        if (b.type === 'heading') {
          return (
            <h4 key={i} className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 pt-3 mt-3 first:pt-0 first:mt-0 border-t border-slate-800 first:border-t-0">
              {b.text}
            </h4>
          );
        }
        if (b.type === 'bullets') {
          return (
            <ul key={i} className="space-y-1.5 ml-1">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2 items-start">
                  <span className="text-indigo-400/80 mt-1.5 inline-block w-1 h-1 rounded-full bg-indigo-400/80 shrink-0" />
                  <span className="flex-1 min-w-0 text-slate-300">{it}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'role') {
          return (
            <div key={i} className="text-slate-200">
              <div className="text-sm text-slate-100 font-medium">{b.title}</div>
              {b.dates && <div className="text-[11px] text-slate-500 tabular-nums">{b.dates}</div>}
            </div>
          );
        }
        // paragraph
        return (
          <p key={i} className="whitespace-pre-line text-slate-300">{b.text}</p>
        );
      })}
    </div>
  );
}

function ContactPart({ part }) {
  const t = part.trim();
  if (!t) return null;
  if (/^[^\s@]+@[^\s@]+$/.test(t)) {
    return (
      <a href={`mailto:${t}`} className="inline-flex items-center gap-1 text-slate-300 hover:text-indigo-300 break-all">
        <Mail size={11} className="text-indigo-300/70 shrink-0" /> {t}
      </a>
    );
  }
  if (/^\+?[\d\s().-]{7,}$/.test(t)) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-300">
        <Phone size={11} className="text-indigo-300/70 shrink-0" /> {t}
      </span>
    );
  }
  if (/linkedin\.com\/in\//i.test(t)) {
    const href = t.startsWith('http') ? t : `https://${t}`;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-300 hover:text-indigo-300 break-all">
        <Linkedin size={11} className="text-indigo-300/70 shrink-0" /> {t.replace(/^https?:\/\//, '')}
      </a>
    );
  }
  if (/^https?:\/\//.test(t) || /\.(com|io|dev|me|ai|net|org)/i.test(t)) {
    const href = t.startsWith('http') ? t : `https://${t}`;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-300 hover:text-indigo-300 break-all">
        <Globe size={11} className="text-indigo-300/70 shrink-0" /> {t.replace(/^https?:\/\//, '')}
      </a>
    );
  }
  return <span className="text-slate-400">{t}</span>;
}

// ─── parser ───────────────────────────────────────────────────────────

const BULLET_RE = /^\s*(?:[-*•‣◦▪■●◆◇○]|[•◦▪])\s+/;

function isHeading(line) {
  const t = line.trim();
  if (t.length === 0 || t.length > 50) return false;
  if (/[.?!,;]\s*$/.test(t)) return false;
  if (BULLET_RE.test(t)) return false;
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 2) return false;
  const upperRatio = letters.replace(/[a-z]/g, '').length / letters.length;
  return upperRatio >= 0.85;
}

function looksLikeContact(line) {
  const hasEmail = /[^\s@]+@[^\s@]+/.test(line);
  const hasPhone = /\+?\d[\d\s().-]{6,}/.test(line);
  const hasUrl = /(linkedin|github|https?:\/\/)/i.test(line);
  const hasSep = /[•|·,/]\s/.test(line) || /[•|·]/.test(line);
  return (hasEmail || hasPhone || hasUrl) && (hasSep || hasEmail);
}

function splitContact(line) {
  return line.split(/\s*[•|·]\s*|\s\s+|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Company - Title  Jan 2020 - Present" style
function parseRoleLine(line) {
  const t = line.trim();
  const dateMatch = t.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\s*[---]\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})|\d{4}\s*[---]\s*(?:Present|Current|\d{4}))/i);
  if (!dateMatch) return null;
  const dates = dateMatch[0];
  const title = t.replace(dates, '').replace(/\s{2,}/g, ' ').replace(/[\s---]+$/, '').trim();
  if (!title) return null;
  return { title, dates };
}

export function parseResume(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const sections = text.split(/\n{2,}/);
  const result = [];
  let firstParagraphSeen = false;

  for (let s = 0; s < sections.length; s += 1) {
    const lines = sections[s].split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // Treat the very first non-empty section as the header (name + contact).
    if (s === 0 && !firstParagraphSeen) {
      firstParagraphSeen = true;
      // Detect a "name" line - usually the first line, short, mostly title
      // case or all caps. If the second line looks like contact info, render
      // it specially.
      let i = 0;
      const nameLine = lines[i];
      if (nameLine && nameLine.length < 60 && !looksLikeContact(nameLine)) {
        result.push({ type: 'name', text: nameLine });
        i += 1;
      }
      // Subsequent lines until first heading or blank -> contact
      const contactParts = [];
      while (i < lines.length && !isHeading(lines[i])) {
        if (looksLikeContact(lines[i])) {
          contactParts.push(...splitContact(lines[i]));
        } else {
          // Generic info line - push as paragraph and stop.
          if (contactParts.length === 0) {
            result.push({ type: 'paragraph', text: lines[i] });
          } else {
            // We already started a contact block. Append remaining as paragraph.
            const rest = lines.slice(i).join('\n');
            result.push({ type: 'contact', parts: contactParts });
            if (rest) result.push({ type: 'paragraph', text: rest });
            i = lines.length;
            break;
          }
        }
        i += 1;
      }
      if (contactParts.length > 0) {
        // Dedupe parts
        const seen = new Set();
        const uniq = contactParts.filter((p) => {
          const k = p.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        result.push({ type: 'contact', parts: uniq });
      }
      // If there's still content (lines after contact in same section), process below.
      const remaining = lines.slice(i);
      if (remaining.length === 0) continue;
      // Treat remaining as its own block; fall through below using `lines`.
      lines.splice(0, lines.length, ...remaining);
    }

    // Pure bullet block
    if (lines.every((l) => BULLET_RE.test(l))) {
      result.push({
        type: 'bullets',
        items: lines.map((l) => l.replace(BULLET_RE, '').trim()),
      });
      continue;
    }

    // First line is a heading - emit heading then the rest
    if (lines.length >= 1 && isHeading(lines[0])) {
      result.push({ type: 'heading', text: lines[0] });
      const rest = lines.slice(1);
      if (rest.length === 0) continue;

      const restAllBullets = rest.every((l) => BULLET_RE.test(l));
      if (restAllBullets) {
        result.push({
          type: 'bullets',
          items: rest.map((l) => l.replace(BULLET_RE, '').trim()),
        });
      } else {
        // Mixed: try to identify role lines + bullets, otherwise paragraph
        emitMixed(rest, result);
      }
      continue;
    }

    // No heading prefix - emit as mixed content
    emitMixed(lines, result);
  }

  return result;
}

function emitMixed(lines, result) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Role line
    const role = parseRoleLine(line);
    if (role && i + 1 < lines.length) {
      result.push({ type: 'role', title: role.title, dates: role.dates });
      i += 1;
      continue;
    }
    // Run of bullets
    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, '').trim());
        i += 1;
      }
      result.push({ type: 'bullets', items });
      continue;
    }
    // Run of plain text lines
    const para = [];
    while (i < lines.length && !BULLET_RE.test(lines[i]) && !parseRoleLine(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) {
      result.push({ type: 'paragraph', text: para.join('\n') });
    }
  }
}
