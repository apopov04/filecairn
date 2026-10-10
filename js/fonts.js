// Fonts for text boxes: the built-in basics (Helvetica/Times/Courier, no
// download), the bundled library (50 free fonts hosted on this site, loaded
// when first used), fonts on this computer (Local Font Access, Chrome/Edge
// desktop, with permission) and uploaded .ttf/.otf files (kept in this
// browser's IndexedDB). Nothing is fetched from other servers.

const LIB = new URL("../vendor/fonts/library/", import.meta.url).href;

/** The three basics map to the standard PDF fonts (no embedding needed). */
export const BASIC = {
  sans: { name: "Helvetica", css: "Helvetica, Arial, sans-serif" },
  serif: { name: "Times", css: '"Times New Roman", Times, serif' },
  mono: { name: "Courier", css: '"Courier New", Courier, monospace' },
};
export const isBasic = (id) => !id || id in BASIC;

let catalog = null;
const custom = new Map(); // id -> { id, name, category: "local" | "upload", files: { style: () => Promise<ArrayBuffer> } }
const faces = new Map(); // "id:style" -> Promise<boolean>
const listeners = new Set();
export const onFontLoad = (fn) => listeners.add(fn);

/** The bundled library: [{ id, name, category, alias, styles }]. */
export async function library() {
  catalog ??= fetch(LIB + "fonts.json").then((r) => r.json()).catch(() => []);
  return catalog;
}

/** Everything to show in the picker. */
export async function allFonts() {
  return [...(await library()), ...custom.values()];
}

export async function fontName(id) {
  if (isBasic(id)) return BASIC[id || "sans"].name;
  return (await allFonts()).find((f) => f.id === id)?.name || id.replace(/^(local|upload):/, "");
}

const styleKey = (bold, italic) => (bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "regular");
// The closest style a font actually has.
function pick(styles, bold, italic) {
  for (const k of [styleKey(bold, italic), bold ? "bold" : null, italic ? "italic" : null, "regular"]) if (k && styles.includes(k)) return k;
  return styles[0];
}

/** CSS font-family for a font id (falls back to a generic family while loading). */
export function cssFamily(id) {
  if (isBasic(id)) return BASIC[id || "sans"].css;
  return `"fc-${id}", Helvetica, Arial, sans-serif`;
}

async function sourceOf(id) {
  const lib = (await library()).find((f) => f.id === id);
  if (lib) return { styles: lib.styles, get: (k) => fetch(`${LIB}${id}/${k}.ttf`).then((r) => { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); }) };
  if (!custom.has(id) && id.startsWith("local:")) await addLocalFonts(true).catch(() => {});
  if (!custom.has(id) && id.startsWith("upload:")) await restoreUploads();
  const c = custom.get(id);
  return c && { styles: Object.keys(c.files), get: (k) => c.files[k]() };
}

/**
 * Make sure a font (in the requested style, or the nearest one) is available
 * to the page's canvases. Listeners are told when it arrives.
 */
export function ensureFont(id, bold = false, italic = false) {
  if (isBasic(id)) return Promise.resolve(true);
  const want = `${id}:${styleKey(bold, italic)}`;
  if (!faces.has(want)) {
    faces.set(want, (async () => {
      const src = await sourceOf(id);
      if (!src) return false;
      const k = pick(src.styles, bold, italic);
      const face = new FontFace(`fc-${id}`, await src.get(k), { weight: k.includes("bold") ? "700" : "400", style: k.includes("italic") ? "italic" : "normal" });
      document.fonts.add(await face.load());
      listeners.forEach((fn) => fn());
      return true;
    })().catch(() => false));
  }
  return faces.get(want);
}

/** The font file bytes to embed in a PDF (nearest available style), or null. */
export async function fontBytes(id, bold, italic) {
  const src = await sourceOf(id);
  if (!src) return null;
  return src.get(pick(src.styles, bold, italic));
}

/* ------------------------------- your own fonts ------------------------------ */

export const canUseLocalFonts = () => "queryLocalFonts" in window;

/** Add the fonts installed on this computer (asks for permission the first time). Returns how many families. */
export async function addLocalFonts(quiet = false) {
  if (!canUseLocalFonts()) return 0;
  if (quiet) { // only if permission was already given; never prompt behind the user's back
    const st = await navigator.permissions?.query({ name: "local-fonts" }).catch(() => null);
    if (st?.state !== "granted") return 0;
  }
  const list = await window.queryLocalFonts();
  const fams = new Map();
  for (const f of list) {
    const st = (f.style || "").toLowerCase(), k = /bold/.test(st) && /(italic|oblique)/.test(st) ? "bolditalic" : /bold/.test(st) ? "bold" : /(italic|oblique)/.test(st) ? "italic" : /^(regular|normal|book|roman)$/.test(st) ? "regular" : null;
    if (!k) continue;
    if (!fams.has(f.family)) fams.set(f.family, {});
    fams.get(f.family)[k] ??= f;
  }
  for (const [family, styles] of fams) {
    if (!styles.regular) continue;
    const files = {};
    for (const [k, fd] of Object.entries(styles)) files[k] = () => fd.blob().then((b) => b.arrayBuffer());
    custom.set(`local:${family}`, { id: `local:${family}`, name: family, category: "local", files });
  }
  return [...custom.values()].filter((c) => c.category === "local").length;
}

// Uploaded fonts live in IndexedDB so they're still there next time.
const DB = () => new Promise((ok, fail) => { const r = indexedDB.open("filecairn-fonts", 1); r.onupgradeneeded = () => r.result.createObjectStore("fonts", { keyPath: "key" }); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
let restored = null;
export function restoreUploads() {
  restored ??= DB().then((db) => new Promise((ok) => {
    const req = db.transaction("fonts").objectStore("fonts").getAll();
    req.onsuccess = () => { for (const rec of req.result) register(rec.family, rec.style, rec.data); ok(); };
    req.onerror = () => ok();
  })).catch(() => {});
  return restored;
}
function register(family, style, data) {
  const id = `upload:${family}`, c = custom.get(id) || { id, name: family, category: "upload", files: {} };
  c.files[style] = async () => data;
  custom.set(id, c);
  return id;
}

/** Add an uploaded .ttf/.otf file. "MyFont-BoldItalic.ttf" joins the "MyFont" family as bold italic. Returns the font id. */
export async function addUploadedFont(file) {
  const base = file.name.replace(/\.(ttf|otf)$/i, "");
  const m = base.match(/^(.*?)[-_ ]?(bold ?italic|bolditalic|bold ?oblique|bold|italic|oblique|regular)$/i);
  const family = (m?.[1] || base).trim() || base;
  const s = (m?.[2] || "regular").toLowerCase().replace(/\s/g, "").replace("oblique", "italic");
  const style = s === "boldoblique" ? "bolditalic" : s;
  const data = await file.arrayBuffer();
  await new FontFace("fc-check", data).load(); // rejects files that aren't usable fonts
  const db = await DB().catch(() => null);
  if (db) db.transaction("fonts", "readwrite").objectStore("fonts").put({ key: `${family}:${style}`, family, style, data });
  return register(family, style, data);
}
