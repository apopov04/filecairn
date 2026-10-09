// PDF engine: load files (PDFs and images), render page thumbnails with pdf.js,
// and build the edited PDF with pdf-lib. Everything runs in the browser.

import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { PDFDocument, degrees } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { norm } from "./pages.js";

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
export async function renderPage(src, index, rot, width, marks = null) {
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
  for (const p of pages) {
    if (p.blank) {
      const page = out.addPage([p.w, p.h]);
      if (p.rot) page.setRotation(degrees(p.rot));
      continue;
    }
    if (p.marks?.length) { await addRedacted(out, sources[p.src], p, dpi); continue; }
    const page = out.addPage(copied.get(p.id));
    if (p.rot) page.setRotation(degrees(norm(page.getRotation().angle + p.rot)));
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
}

function groupBySource(pages) {
  const m = new Map();
  for (const p of pages) if (!p.blank && !p.marks?.length) { if (!m.has(p.src)) m.set(p.src, []); m.get(p.src).push(p); }
  return m;
}
