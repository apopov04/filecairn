// PDF engine: load files (PDFs and images), render page thumbnails with pdf.js,
// and build the edited PDF with pdf-lib. Everything runs in the browser.

import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { PDFDocument, degrees, rgb, BlendMode, StandardFonts, PDFHexString, PDFName, pushGraphicsState, popGraphicsState, setFillingRgbColor, rectangle, fill } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { norm } from "./pages.js";
import { drawAnnots } from "./annots.js";

const VENDOR = new URL("../vendor/pdfjs/", import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "pdf.worker.min.mjs";

const isPdf = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const A4_LONG = 841.89; // points

/** Turn an image file into the bytes of a one-page PDF (page shaped like the image, A4-sized). */
async function imageToPdf(file, bytes) {
  const bmp = await createImageBitmap(file);
  const doc = await PDFDocument.create();
  let img;
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) img = await doc.embedJpg(bytes); // keep the original JPEG data
  else {
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    img = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
  }
  const s = A4_LONG / Math.max(bmp.width, bmp.height);
  const page = doc.addPage([bmp.width * s, bmp.height * s]);
  page.drawImage(img, { x: 0, y: 0, width: bmp.width * s, height: bmp.height * s });
  bmp.close?.();
  return doc.save();
}

/**
 * Load a File/Blob. Returns { name, bytes, pdf, pages: [{ w, h }] } where
 * w/h are each page's unrotated size in points. Throws a readable Error.
 */
export async function loadFile(file, name = file.name || "document.pdf") {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) {
    if (file.type?.startsWith("image/") || IMAGE.test(name)) {
      try { bytes = await imageToPdf(file, bytes); } catch { throw new Error(`Couldn't read the image "${name}".`); }
    } else throw new Error(`"${name}" isn't a PDF or an image. Filecairn opens PDFs, JPG, PNG and WebP.`);
  }
  let pdf;
  try {
    // pdf.js takes ownership of the buffer it's given, so pass a copy.
    pdf = await pdfjs.getDocument({ data: bytes.slice(), cMapUrl: VENDOR + "cmaps/", cMapPacked: true, standardFontDataUrl: VENDOR + "standard_fonts/", wasmUrl: VENDOR + "wasm/", isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new Error(`"${name}" is password-protected. Unlocking isn't supported yet.`);
    throw new Error(`Couldn't open "${name}": it may be damaged.`);
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const vp = p.getViewport({ scale: 1, rotation: 0 });
    pages.push({ w: vp.width, h: vp.height, own: p.rotate || 0 });
  }
  return { name, bytes, pdf, pages };
}

// Map between PDF user space and a pdf.js viewport's pixels using its transform matrix.
export function toViewport(vp, x, y) { const [a, b, c, d, e, f] = vp.transform; return [a * x + c * y + e, b * x + d * y + f]; }
export function toUserSpace(vp, px, py) {
  const [a, b, c, d, e, f] = vp.transform, det = a * d - b * c;
  return [(d * (px - e) - c * (py - f)) / det, (-b * (px - e) + a * (py - f)) / det];
}
/** A user-space rect [x1, y1, x2, y2] as a viewport pixel box [x, y, w, h]. */
export function rectToViewport(vp, [x1, y1, x2, y2]) {
  const [a, b] = toViewport(vp, x1, y1), [c, d] = toViewport(vp, x2, y2);
  return [Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)];
}

/** Draw redaction marks (user-space rects) onto a rendered page. */
function burnMarks(ctx, vp, marks) {
  if (!marks?.length) return;
  ctx.fillStyle = "#000";
  for (const m of marks) {
    const [x, y, w, h] = rectToViewport(vp, m);
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w) + 1, Math.ceil(h) + 1);
  }
}

/** The page's text items (pdf.js getTextContent), cached per source page. */
export async function textItems(src, index) {
  src.text ??= new Map();
  if (!src.text.has(index)) src.text.set(index, (await (await src.pdf.getPage(index + 1)).getTextContent()).items);
  return src.text.get(index);
}

/**
 * Render a page to a canvas about `width` CSS pixels wide, with extra rotation
 * `rot`, and redaction marks drawn as black boxes. canvas.viewport is the
 * pdf.js viewport (device pixels), for mapping between screen and user space.
 */
export async function renderPage(src, index, rot, width, marks = null, annots = null) {
  const page = await src.pdf.getPage(index + 1);
  const rotation = norm((page.rotate || 0) + rot);
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width * dpr) / base.width, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  burnMarks(ctx, vp, marks);
  drawAnnots(ctx, vp, annots);
  canvas.viewport = vp;
  return canvas;
}

/**
 * Build a PDF from the page list. sources[src] are loadFile() results.
 * Source metadata (author, software, dates) isn't carried over.
 */
export async function buildPdf(sources, pages, { dpi = 200 } = {}) {
  const out = await PDFDocument.create();
  const libs = new Map(), copied = new Map();
  // Copy each source's pages in one go (faster than one at a time).
  for (const [src, list] of groupBySource(pages)) {
    if (!libs.has(src)) libs.set(src, await PDFDocument.load(sources[src].bytes, { updateMetadata: false }));
    const got = await out.copyPages(libs.get(src), list.map((p) => p.index));
    list.forEach((p, i) => copied.set(p.id, got[i]));
  }
  const fonts = {};
  for (const p of pages) {
    let page;
    if (p.blank) {
      page = out.addPage([p.w, p.h]);
      if (p.rot) page.setRotation(degrees(p.rot));
    } else if (p.marks?.length) page = await addRedacted(out, sources[p.src], p, dpi);
    else {
      page = out.addPage(copied.get(p.id));
      if (p.rot) page.setRotation(degrees(norm(page.getRotation().angle + p.rot)));
    }
    if (p.annots?.length) await writeAnnots(out, page, p.annots, fonts, !!p.marks?.length);
  }
  out.setProducer("Filecairn"); out.setCreator("Filecairn");
  return out.save({ useObjectStreams: true });
}

/**
 * Redaction: the page is rendered to an image with the marks burned in and
 * replaces the original, so the text, images, links and form fields under the
 * marks are gone from the file, not just covered.
 */
async function addRedacted(out, src, p, dpi) {
  const page = await src.pdf.getPage(p.index + 1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  // Stay under ~25 megapixels so large pages don't exhaust memory.
  const scale = Math.min(dpi / 72, Math.sqrt(25e6 / (base.width * base.height)));
  const vp = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  burnMarks(ctx, vp, p.marks);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  canvas.width = canvas.height = 0; // free the memory now
  const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const np = out.addPage([base.width, base.height]);
  np.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
  const rot = norm((page.rotate || 0) + p.rot);
  if (rot) np.setRotation(degrees(rot));
  return np;
}

/* ----------------------------- annotations -> PDF ---------------------------- */

const color = (hex = "#000000") => { const n = parseInt(hex.slice(1), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

// The 14 standard PDF fonts cover Western European text; anything else
// (Greek, Cyrillic, Polish…) loads fontkit and embeds Liberation Sans, which
// is bundled with pdf.js (serif and mono fall back to it too).
const STD = {
  sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
  serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
  mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"],
};
const LIB = ["Regular", "Bold", "Italic", "BoldItalic"];
async function fontFor(out, a, fonts) {
  const v = (a.bold ? 1 : 0) + (a.italic ? 2 : 0), name = STD[a.font in STD ? a.font : "sans"][v];
  fonts[name] ??= await out.embedFont(StandardFonts[name]);
  try { fonts[name].encodeText(a.text); return fonts[name]; } catch { /* not WinAnsi */ }
  const key = `lib-${v}`;
  if (!fonts[key]) {
    if (!globalThis.fontkit) await new Promise((ok, fail) => { const sc = document.createElement("script"); sc.src = new URL("../vendor/fontkit/fontkit.umd.min.js", import.meta.url).href; sc.onload = ok; sc.onerror = fail; document.head.append(sc); });
    if (!fonts.kit) { out.registerFontkit(globalThis.fontkit); fonts.kit = true; }
    const ttf = await (await fetch(`${VENDOR}standard_fonts/LiberationSans-${LIB[v]}.ttf`)).arrayBuffer();
    fonts[key] = await out.embedFont(ttf, { subset: true });
  }
  return fonts[key];
}

/**
 * Markups (highlights, pen, shapes, text) are drawn into the page so they look
 * the same in every viewer. Sticky notes become real PDF comments.
 */
async function writeAnnots(out, page, annots, fonts, flattened) {
  // Highlights made from text go *behind* the page content, so the text keeps
  // its exact colour, like ink under a real highlighter. (Not on flattened
  // redacted pages, where the content is an opaque image.)
  const under = flattened ? [] : annots.filter((a) => a.type === "highlight" && a.onText);
  if (under.length) {
    const ops = [pushGraphicsState()];
    for (const a of under) { const c = color(a.color); ops.push(setFillingRgbColor(c.red, c.green, c.blue)); for (const [x1, y1, x2, y2] of a.rects) ops.push(rectangle(x1, y1, x2 - x1, y2 - y1)); ops.push(fill()); }
    ops.push(popGraphicsState());
    const ref = out.context.register(out.context.contentStream(ops));
    page.node.normalize();
    page.node.Contents().insert(0, ref);
  }
  for (const a of annots) {
    if (under.includes(a)) continue;
    const c = color(a.color), w = a.width || 2;
    switch (a.type) {
      case "highlight":
        for (const [x1, y1, x2, y2] of a.rects) page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: c, opacity: 0.45, blendMode: BlendMode.Multiply });
        break;
      case "underline": case "strike":
        for (const [x1, y1, x2, y2] of a.rects) { const y = y1 + (y2 - y1) * (a.type === "underline" ? 0.18 : 0.45); page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 1.2, color: c }); }
        break;
      case "ink":
        for (const p of a.paths) {
          let d = `M ${p[0]} ${-p[1]}`;
          for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${-p[i + 1]}`;
          if (p.length === 2) d += ` L ${p[0] + 0.01} ${-p[1]}`;
          page.drawSvgPath(d, { x: 0, y: 0, borderColor: c, borderWidth: w, borderLineCap: 1 });
        }
        break;
      case "rect": { const [x1, y1, x2, y2] = a.rect; page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, borderColor: c, borderWidth: w }); break; }
      case "ellipse": { const [x1, y1, x2, y2] = a.rect; page.drawEllipse({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, xScale: (x2 - x1) / 2, yScale: (y2 - y1) / 2, borderColor: c, borderWidth: w }); break; }
      case "line": case "arrow": {
        const [x1, y1] = a.from, [x2, y2] = a.to;
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: c, lineCap: 1 });
        if (a.type === "arrow") {
          const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.max(8, w * 4);
          for (const s of [-0.45, 0.45]) page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - len * Math.cos(ang + s), y: y2 - len * Math.sin(ang + s) }, thickness: w, color: c, lineCap: 1 });
        }
        break;
      }
      case "text": {
        const r = norm(a.rot || 0), down = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[r];
        const font = await fontFor(out, a, fonts);
        String(a.text).split("\n").forEach((line, j) => {
          const off = a.size * (0.8 + j * 1.2); // baseline of line j below the top edge
          page.drawText(line, { x: a.x + down[0] * off, y: a.y + down[1] * off, size: a.size, font, color: c, rotate: degrees(r) });
        });
        break;
      }
      case "note": {
        const ctx = out.context, cc = color(a.color || "#ffd400");
        const annot = ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [a.x, a.y - 18, a.x + 18, a.y], Name: "Comment", F: 4, Open: false, C: [cc.red, cc.green, cc.blue] });
        annot.set(PDFName.of("Contents"), PDFHexString.fromText(a.text || ""));
        page.node.addAnnot(ctx.register(annot));
        break;
      }
    }
  }
}

function groupBySource(pages) {
  const m = new Map();
  for (const p of pages) if (!p.blank && !p.marks?.length) { if (!m.has(p.src)) m.set(p.src, []); m.get(p.src).push(p); }
  return m;
}
