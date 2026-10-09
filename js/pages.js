// The document model: an immutable list of pages. Each page is
//   { id, src, index, rot, w, h }   (a page of source file `src`), or
//   { id, blank: true, rot, w, h }  (an inserted blank page).
// w/h are the unrotated size in PDF points; rot is the extra rotation we apply
// (0/90/180/270) on top of the page's own. Operations return new arrays, so
// undo is just keeping old ones. Pure functions, unit-tested in Node.

let nextId = 1;
export const newId = () => nextId++;

export const norm = (deg) => ((deg % 360) + 360) % 360;

/** Remove the pages with these ids. */
export const remove = (pages, ids) => pages.filter((p) => !ids.has(p.id));

/** Rotate the pages with these ids by delta degrees (multiple of 90). */
export const rotate = (pages, ids, delta) => pages.map((p) => (ids.has(p.id) ? { ...p, rot: norm(p.rot + delta) } : p));

/** Insert a copy after each selected page. Returns { pages, added } (ids of the copies). */
export function duplicate(pages, ids) {
  const out = [], added = [];
  for (const p of pages) {
    out.push(p);
    if (ids.has(p.id)) { const c = { ...p, id: newId() }; out.push(c); added.push(c.id); }
  }
  return { pages: out, added };
}

/** Insert a blank page at position `at` (0-based; pages.length = at the end). */
export function insertBlank(pages, at, w = 595.28, h = 841.89) {
  const page = { id: newId(), blank: true, rot: 0, w, h };
  const out = pages.slice();
  out.splice(Math.max(0, Math.min(at, pages.length)), 0, page);
  return { pages: out, added: [page.id] };
}

/**
 * Move the pages with these ids (keeping their order) so they sit before the
 * page that is currently at position `to` (0-based; pages.length = the end).
 */
export function move(pages, ids, to) {
  const moving = pages.filter((p) => ids.has(p.id));
  if (!moving.length) return pages;
  // Position among the pages that stay = stayers originally before `to`.
  let at = 0;
  for (let i = 0; i < Math.min(to, pages.length); i++) if (!ids.has(pages[i].id)) at++;
  const rest = pages.filter((p) => !ids.has(p.id));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * Parse page ranges like "1-3, 5, 8-" (1-based, inclusive) for n pages.
 * Returns an array of groups, each an array of 0-based positions; throws a
 * readable Error on bad input.
 */
export function parseRanges(text, n) {
  const groups = [];
  for (const part of String(text).split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(?:-\s*(\d*))?$/);
    if (!m || (m[1] === "" && m[2] === undefined)) throw new Error(`"${part}" isn't a page or range (use e.g. 1-3, 5, 8-).`);
    const a = m[1] === "" ? 1 : +m[1];
    const b = m[2] === undefined ? a : m[2] === "" ? n : +m[2];
    if (a < 1 || b < 1 || a > n || b > n) throw new Error(`"${part}" is outside 1–${n}.`);
    if (a > b) throw new Error(`"${part}" goes backwards.`);
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  if (!groups.length) throw new Error("Enter at least one page or range.");
  return groups;
}

/** Split n pages into chunks of `every` pages: [[0..every-1], ...]. */
export function chunks(n, every) {
  const k = Math.max(1, Math.floor(every)), out = [];
  for (let i = 0; i < n; i += k) out.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
  return out;
}

/** Replace one page's redaction marks. */
export const setMarks = (pages, id, marks) => pages.map((p) => (p.id === id ? { ...p, marks: marks.length ? marks : undefined } : p));

/** Add marks to several pages: byId is a Map(id -> [rects]). */
export const addMarks = (pages, byId) => pages.map((p) => (byId.has(p.id) ? { ...p, marks: [...(p.marks || []), ...byId.get(p.id)] } : p));

/** Remove all marks from the pages with these ids (all pages if ids is null). */
export const clearMarks = (pages, ids = null) => pages.map((p) => (p.marks && (!ids || ids.has(p.id)) ? { ...p, marks: undefined } : p));

/** Replace one page's annotations. */
export const setAnnots = (pages, id, annots) => pages.map((p) => (p.id === id ? { ...p, annots: annots.length ? annots : undefined } : p));
