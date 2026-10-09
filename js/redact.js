// Redaction helpers (pure, unit-tested in Node).
//
// Marks are rectangles in PDF user space: [x1, y1, x2, y2] with y up, the same
// space pdf.js text items use. Pages carry them as page.marks; they're burned
// in (the page is flattened to an image) when the PDF is saved.

/** Built-in search patterns. */
export const PRESETS = {
  email: { label: "Email addresses", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  phone: { label: "Phone numbers", re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}/g },
  number: { label: "Long numbers (IDs, accounts)", re: /\b\d[\d\s.-]{6,}\d\b/g },
  iban: { label: "IBANs", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g },
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A case-insensitive global RegExp for plain text (whitespace matches any whitespace). */
export function textQuery(q) {
  const parts = q.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!parts.length) return null;
  return new RegExp(parts.join("\\s+"), "gi");
}

/**
 * Join pdf.js text items into one string, remembering where each item starts.
 * items: [{ str, transform, width, height, hasEOL }]. Items on separate lines
 * are joined with a space so words don't run together.
 */
export function indexText(items) {
  let text = "";
  const spans = [];
  for (const it of items) {
    if (!it.str) { if (it.hasEOL && text && !text.endsWith(" ")) text += " "; continue; }
    if (text && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
    spans.push({ start: text.length, end: text.length + it.str.length, it });
    text += it.str;
    if (it.hasEOL) text += " ";
  }
  return { text, spans };
}

/**
 * Rectangles (user space) covering text[start, end). Each overlapped item
 * contributes the part of its width proportional to the characters matched,
 * padded a little so ascenders/descenders are covered too.
 */
export function boxesFor(index, start, end) {
  const out = [];
  for (const s of index.spans) {
    if (s.end <= start || s.start >= end) continue;
    const it = s.it, n = it.str.length;
    const a = Math.max(start, s.start) - s.start, b = Math.min(end, s.end) - s.start;
    const [m0, m1, m2, m3, x, y] = it.transform;
    const len = Math.hypot(m0, m1) || 1; // text direction
    const ux = m0 / len, uy = m1 / len;
    const size = Math.hypot(m2, m3) || it.height || 10; // font size
    const w = it.width || size * n * 0.5;
    const x0 = x + ux * (w * a) / n, y0 = y + uy * (w * a) / n;
    const x1 = x + ux * (w * b) / n, y1 = y + uy * (w * b) / n;
    // Normal to the baseline (up), for the box height: descent ~0.25em, ascent ~0.95em.
    const nx = -uy, ny = ux, pad = size * 0.08;
    const pts = [
      [x0 - nx * size * 0.25, y0 - ny * size * 0.25], [x1 - nx * size * 0.25, y1 - ny * size * 0.25],
      [x0 + nx * size * 0.95, y0 + ny * size * 0.95], [x1 + nx * size * 0.95, y1 + ny * size * 0.95],
    ];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.push([Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]);
  }
  return out;
}

/** All matches of `re` in the page's items: [{ text, boxes }]. */
export function findOnPage(items, re) {
  const index = indexText(items), out = [];
  re.lastIndex = 0;
  for (const m of index.text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
    const t = m[0].trim();
    if (!t) continue;
    const start = m.index + m[0].indexOf(t);
    out.push({ text: t, boxes: boxesFor(index, start, start + t.length) });
  }
  return out;
}

/** Normalise a rectangle so x1 < x2 and y1 < y2. */
export const normRect = ([a, b, c, d]) => [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
