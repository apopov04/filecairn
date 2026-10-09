// Filecairn: page organiser for PDFs. Open PDFs/images, reorder, rotate,
// delete, duplicate and insert pages, merge files, extract and split, save.

import * as P from "./pages.js";
import { loadFile, renderPage, buildPdf } from "./engine.js";
import { zip } from "./zip.js";
import { ph } from "./icons.js";
import { installApi } from "./api.js";
import { createRedactView } from "./redactview.js";

const $ = (s) => document.querySelector(s);
const app = $("#app"), grid = $("#grid"), main = $("#main");

/* ----------------------------------- state ---------------------------------- */

const S = {
  sources: [], // loadFile() results; pages refer to them by index
  pages: [],
  sel: new Set(), // selected page ids
  anchor: null, // last clicked id, for Shift+click ranges
  undo: [], redo: [],
  name: "document",
  dpi: +(localStorage.getItem("fc-dpi") || 200), // resolution of redacted (flattened) pages
};

function commit(pages, label) {
  S.undo.push({ pages: S.pages, label });
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  S.pages = pages;
  for (const id of [...S.sel]) if (!pages.some((p) => p.id === id)) S.sel.delete(id);
  render();
  rview?.refresh();
}
function undo() {
  const u = S.undo.pop(); if (!u) return;
  S.redo.push({ pages: S.pages, label: u.label }); S.pages = u.pages; render(); rview?.refresh(); toast(`Undid ${u.label}`);
}
function redo() {
  const r = S.redo.pop(); if (!r) return;
  S.undo.push({ pages: S.pages, label: r.label }); S.pages = r.pages; render(); rview?.refresh(); toast(`Redid ${r.label}`);
}

/* ---------------------------------- opening --------------------------------- */

const baseName = (n) => (n || "document").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "document";

/** Add files' pages at position `at` (default: the end). Returns the number of pages added. */
async function addFiles(files, at = S.pages.length) {
  files = [...files];
  if (!files.length) return 0;
  const first = !S.pages.length;
  status(`Opening ${files.length === 1 ? files[0].name || "file" : `${files.length} files`}…`);
  const added = [];
  for (const f of files) {
    try {
      const src = await loadFile(f, f.name || "document.pdf");
      const si = S.sources.push(src) - 1;
      src.pages.forEach((pg, index) => added.push({ id: P.newId(), src: si, index, rot: 0, w: pg.w, h: pg.h, own: pg.own }));
    } catch (e) { toast(e.message, 5000); }
  }
  if (!added.length) { status(""); return 0; }
  const next = S.pages.slice(); next.splice(at, 0, ...added);
  if (first) { S.name = baseName(files[0].name); $("#doc-name").value = S.name; S.pages = next; S.undo = []; S.redo = []; render(); }
  else commit(next, `add ${added.length} page${added.length === 1 ? "" : "s"}`);
  S.sel = new Set(added.map((p) => p.id));
  render();
  toast(first ? `Opened ${added.length} page${added.length === 1 ? "" : "s"}` : `Added ${added.length} page${added.length === 1 ? "" : "s"}`);
  return added.length;
}

const fileInput = $("#file-input");
let addAt = null;
function pick(at = null) { addAt = at; fileInput.click(); }
fileInput.onchange = () => { const f = [...fileInput.files]; fileInput.value = ""; addFiles(f, addAt ?? S.pages.length); };
$("#btn-open").onclick = () => pick();
$("#btn-add").onclick = () => pick(insertPos());

// Drop files anywhere.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; $("#dropzone").hidden = false; } });
addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("#dropzone").hidden = true; } });
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $("#dropzone").hidden = true;
  addFiles(e.dataTransfer.files, insertPos());
});
// Paste a PDF or image.
addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files, insertPos()); }
});

/** Where new pages go: after the last selected page, else at the end. */
function insertPos() {
  let at = -1;
  S.pages.forEach((p, i) => { if (S.sel.has(p.id)) at = i; });
  return at < 0 ? S.pages.length : at + 1;
}

/* --------------------------------- rendering -------------------------------- */

const cards = new Map(); // page id -> card element
const thumbs = new Map(); // "src:index:rot:size" -> canvas
let thumbW = +(localStorage.getItem("fc-thumb") || 170);

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); queueThumb(e.target); }
}, { root: main, rootMargin: "400px" });

let rendering = 0;
const queue = [];
function queueThumb(card) { queue.push(card); pump(); }
function pump() {
  while (rendering < 3 && queue.length) {
    const card = queue.shift(), p = card._page;
    if (!card.isConnected || p.blank) continue;
    const key = `${p.src}:${p.index}:${p.rot}:${thumbW}:${JSON.stringify(p.marks || [])}`;
    const box = card.querySelector(".page");
    if (thumbs.has(key)) { box.replaceChildren(thumbs.get(key)); continue; }
    rendering++;
    renderPage(S.sources[p.src], p.index, p.rot, thumbW, p.marks)
      .then((c) => { thumbs.set(key, c); if (card._page === p) box.replaceChildren(c); })
      .catch(() => { box.textContent = "Can't show"; })
      .finally(() => { rendering--; pump(); });
  }
}

const shownSize = (p) => (P.norm((p.own || 0) + p.rot) % 180 ? { w: p.h, h: p.w } : { w: p.w, h: p.h });

function makeCard(p) {
  const el = document.createElement("div");
  el.className = "card"; el.setAttribute("role", "option"); el.tabIndex = -1;
  el.innerHTML = '<div class="thumb"><div class="page"></div></div><span class="num"></span>';
  el.dataset.id = p.id;
  return el;
}

function render() {
  app.classList.toggle("empty", !S.pages.length);
  const frag = { children: [] }; // the cards, in page order
  S.pages.forEach((p, i) => {
    let el = cards.get(p.id);
    if (!el) { el = makeCard(p); cards.set(p.id, el); }
    const stale = el._page !== p; // new or changed (e.g. rotated)
    el._page = p;
    const s = shownSize(p);
    el.querySelector(".page").style.setProperty("--par", (s.w / s.h).toFixed(4));
    el.querySelector(".thumb").style.setProperty("--ar", Math.min(1.4, Math.max(.6, s.w / s.h)).toFixed(4));
    el.querySelector(".page").classList.toggle("blank", !!p.blank);
    el.classList.toggle("has-marks", !!p.marks?.length);
    el.querySelector(".num").textContent = i + 1;
    const selected = S.sel.has(p.id);
    el.setAttribute("aria-selected", String(selected));
    el.setAttribute("aria-label", `Page ${i + 1}${p.blank ? ", blank" : ""}${p.rot ? `, rotated ${p.rot}°` : ""}${p.marks?.length ? `, ${p.marks.length} redaction${p.marks.length === 1 ? "" : "s"}` : ""}`);
    if (stale) { if (!p.blank) { el.querySelector(".page").replaceChildren(); io.observe(el); } else el.querySelector(".page").replaceChildren(); }
    frag.children.push(el);
  });
  // Only re-insert cards when the order changed: moving nodes would cancel
  // double-clicks and reset focus.
  const want = [...frag.children], have = [...grid.children];
  if (want.length !== have.length || want.some((el, i) => el !== have[i])) grid.replaceChildren(...want);
  for (const id of [...cards.keys()]) if (!S.pages.some((p) => p.id === id)) cards.delete(id);
  renderActions();
  $("#btn-undo").disabled = !S.undo.length; $("#btn-redo").disabled = !S.redo.length;
  $("#btn-undo").title = S.undo.length ? `Undo ${S.undo.at(-1).label} (Ctrl+Z)` : "Undo (Ctrl+Z)";
  status(`${S.pages.length} page${S.pages.length === 1 ? "" : "s"}${S.sel.size ? ` · ${S.sel.size} selected` : ""}`);
}

/* ---------------------------------- actions --------------------------------- */

const selIds = () => (S.sel.size ? S.sel : new Set());
const needSel = (verb) => { if (!S.sel.size) { toast(`Select pages to ${verb} first (click a page; Ctrl/Shift+click for more).`); return false; } return true; };

const ACTIONS = {
  rotateL: () => needSel("rotate") && commit(P.rotate(S.pages, selIds(), -90), "rotate"),
  rotateR: () => needSel("rotate") && commit(P.rotate(S.pages, selIds(), 90), "rotate"),
  duplicate: () => { if (!needSel("duplicate")) return; const r = P.duplicate(S.pages, selIds()); commit(r.pages, "duplicate"); S.sel = new Set(r.added); render(); },
  blank: () => {
    const at = insertPos(), ref = S.pages[at - 1] || S.pages[at];
    const s = ref ? shownSize(ref) : { w: 595.28, h: 841.89 };
    const r = P.insertBlank(S.pages, at, s.w, s.h); commit(r.pages, "insert blank page"); S.sel = new Set(r.added); render();
  },
  remove: () => {
    if (!needSel("delete")) return;
    if (S.sel.size === S.pages.length) return toast("That would delete every page. Keep at least one.");
    const n = S.sel.size; commit(P.remove(S.pages, selIds()), `delete ${n} page${n === 1 ? "" : "s"}`); S.sel.clear(); render();
  },
  all: () => { S.sel = new Set(S.pages.map((p) => p.id)); render(); },
  none: () => { S.sel.clear(); render(); },
  extract: async () => {
    if (!needSel("extract")) return;
    const pages = S.pages.filter((p) => S.sel.has(p.id));
    await download(await busy("Extracting", () => buildPdf(S.sources, pages, { dpi: S.dpi })), `${docName()}-pages.pdf`, "application/pdf");
  },
  split: () => openSplit(),
  redact: () => rview.open(S.pages.find((p) => S.sel.has(p.id))?.id),
  save: () => save(),
};

function renderActions() {
  const n = S.sel.size;
  const b = (key, icon, label, title, cls = "") => {
    const el = document.createElement("button");
    el.className = cls; el.title = title; el.setAttribute("aria-label", label);
    el.innerHTML = `${ph(icon)}<span class="lbl">${label}</span>`;
    el.onclick = ACTIONS[key]; el.dataset.key = key;
    if (!n && !["all", "none", "blank", "split", "redact"].includes(key)) el.disabled = true;
    return el;
  };
  const sep = () => Object.assign(document.createElement("span"), { className: "sep" });
  const info = Object.assign(document.createElement("span"), { className: "sel-info", textContent: n ? `${n} selected` : "Click pages to select" });
  const els = [
    info,
    b(n === S.pages.length ? "none" : "all", n === S.pages.length ? "x" : "checks", n === S.pages.length ? "Select none" : "Select all", "Ctrl+A / Esc"),
    sep(),
    b("rotateL", "arrow-counter-clockwise", "Rotate left", "Rotate left (Shift+R)"),
    b("rotateR", "arrow-clockwise", "Rotate right", "Rotate right (R)"),
    b("duplicate", "copy", "Duplicate", "Duplicate selected pages (Ctrl+D)"),
    b("blank", "file", "Blank page", "Insert a blank page after the selection"),
    b("remove", "trash", "Delete", "Delete selected pages (Delete)", "danger"),
    sep(),
    b("extract", "export", "Extract", "Save the selected pages as a new PDF"),
    b("split", "scissors", "Split", "Split into several PDFs"),
    sep(),
    b("redact", "eye-slash", "Redact", "Black out text and areas for good (double-click a page)"),
  ];
  $("#actions").replaceChildren(...els);
}

/* ----------------------------- selection & drag ----------------------------- */

const cardOf = (t) => t.closest?.(".card");

function selectClick(id, e) {
  const ids = S.pages.map((p) => p.id);
  if (e.shiftKey && S.anchor != null && ids.includes(S.anchor)) {
    const a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    if (!(e.ctrlKey || e.metaKey)) S.sel.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(ids[i]);
  } else if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
    S.anchor = id;
  } else { S.sel = new Set([id]); S.anchor = id; }
  render();
}

let drag = null;
grid.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const card = cardOf(e.target);
  if (!card) { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) { S.sel.clear(); render(); } return; }
  const id = +card.dataset.id;
  drag = { id, x: e.clientX, y: e.clientY, started: false, touch: e.pointerType === "touch", ready: e.pointerType !== "touch", pointerId: e.pointerId };
  // Touch: hold briefly to pick a page up, so normal swipes still scroll.
  if (drag.touch) drag.timer = setTimeout(() => { if (drag) { drag.ready = true; navigator.vibrate?.(10); } }, 300);
});
addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
  if (!drag.started) {
    if (!far) return;
    if (!drag.ready) { clearTimeout(drag.timer); drag = null; return; } // a scroll swipe
    startDrag(e);
  }
  e.preventDefault();
  moveDrag(e);
}, { passive: false });
addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  clearTimeout(drag.timer);
  const d = drag; drag = null;
  if (d.started) return endDrag(e, d);
  selectClick(d.id, e);
});
addEventListener("pointercancel", () => { if (drag) { clearTimeout(drag.timer); if (drag.started) cleanupDrag(); drag = null; } });

function startDrag(e) {
  drag.started = true;
  if (!S.sel.has(drag.id)) { S.sel = new Set([drag.id]); S.anchor = drag.id; render(); }
  drag.ids = new Set(S.sel);
  for (const id of drag.ids) cards.get(id)?.classList.add("dragging");
  drag.ghost = Object.assign(document.createElement("div"), { className: "drag-ghost", textContent: `${drag.ids.size} page${drag.ids.size === 1 ? "" : "s"}` });
  document.body.append(drag.ghost);
  grid.setPointerCapture?.(e.pointerId);
}
function dropTarget(e) {
  // Nearest card to the pointer; before or after it depending on the side.
  let best = null, bestD = Infinity;
  for (const el of grid.children) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = Math.hypot((e.clientX - cx) / 2, e.clientY - cy);
    if (d < bestD) { bestD = d; best = { el, after: e.clientX > cx }; }
  }
  if (!best) return null;
  const i = [...grid.children].indexOf(best.el);
  return { el: best.el, after: best.after, to: best.after ? i + 1 : i };
}
let marked = null, scrollTimer = null;
function moveDrag(e) {
  drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`;
  const t = dropTarget(e);
  marked?.classList.remove("drop-before", "drop-after");
  if (t) { t.el.classList.add(t.after ? "drop-after" : "drop-before"); marked = t.el; drag.to = t.to; }
  // Auto-scroll near the top or bottom edge.
  const r = main.getBoundingClientRect(), edge = 60;
  const v = e.clientY < r.top + edge ? -1 : e.clientY > r.bottom - edge ? 1 : 0;
  clearInterval(scrollTimer);
  if (v) scrollTimer = setInterval(() => { main.scrollTop += v * 14; }, 16);
}
function cleanupDrag() {
  clearInterval(scrollTimer);
  marked?.classList.remove("drop-before", "drop-after"); marked = null;
  document.querySelectorAll(".card.dragging").forEach((el) => el.classList.remove("dragging"));
  document.querySelector(".drag-ghost")?.remove();
}
function endDrag(e, d) {
  cleanupDrag();
  if (d.to == null) return;
  const next = P.move(S.pages, d.ids, d.to);
  if (next.some((p, i) => p !== S.pages[i])) commit(next, `move ${d.ids.size} page${d.ids.size === 1 ? "" : "s"}`);
}

/* ------------------------------- save & split ------------------------------- */

const docName = () => baseName($("#doc-name").value) || S.name;
$("#doc-name").addEventListener("change", () => { $("#doc-name").value = docName(); });

async function busy(what, fn) {
  status(`${what}…`); document.body.style.cursor = "progress";
  try { return await fn(); } finally { document.body.style.cursor = ""; render(); }
}

async function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Saved ${name}`);
}

async function save() {
  if (!S.pages.length) return;
  try { await download(await busy("Saving", () => buildPdf(S.sources, S.pages, { dpi: S.dpi })), `${docName()}.pdf`, "application/pdf"); }
  catch (e) { toast(`Couldn't save: ${e.message}`, 5000); }
}
$("#btn-save").onclick = save;

const dlg = $("#split-dialog");
function openSplit() {
  $("#split-err").textContent = "";
  dlg.showModal();
}
dlg.addEventListener("close", async () => {
  if (dlg.returnValue !== "go") return;
  const n = S.pages.length;
  let groups;
  try {
    const mode = dlg.querySelector("input[name=mode]:checked").value;
    groups = mode === "every" ? P.chunks(n, +$("#split-every").value || 1) : P.parseRanges($("#split-ranges").value, n);
  } catch (e) { $("#split-err").textContent = e.message; dlg.showModal(); return; }
  if (groups.length === 1 && groups[0].length === n) return toast("That would make one file with every page. Pick smaller parts.");
  try {
    const files = await busy("Splitting", async () => {
      const out = [], pad = String(groups.length).length;
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g.at(-1) + 1}`;
        out.push({ name: `${docName()}-${String(i + 1).padStart(pad, "0")}-${label}.pdf`, data: await buildPdf(S.sources, g.map((k) => S.pages[k]), { dpi: S.dpi }) });
      }
      return out;
    });
    await download(zip(files), `${docName()}-split.zip`, "application/zip");
  } catch (e) { toast(`Couldn't split: ${e.message}`, 5000); }
});
// Typing in a field picks its option.
$("#split-every").addEventListener("focus", () => { dlg.querySelector("input[value=every]").checked = true; });
$("#split-ranges").addEventListener("focus", () => { dlg.querySelector("input[value=ranges]").checked = true; });

/* ------------------------------ ui odds & ends ------------------------------ */

$("#btn-undo").innerHTML = ph("arrow-u-up-left"); $("#btn-undo").onclick = undo;
$("#btn-redo").innerHTML = ph("arrow-u-up-right"); $("#btn-redo").onclick = redo;
$("#btn-add").insertAdjacentHTML("afterbegin", ph("file-plus"));
$("#btn-save").insertAdjacentHTML("afterbegin", ph("download-simple"));

const sizeIn = $("#thumb-size");
sizeIn.value = thumbW;
document.documentElement.style.setProperty("--thumb", `${thumbW}px`);
sizeIn.addEventListener("input", () => {
  thumbW = +sizeIn.value; localStorage.setItem("fc-thumb", thumbW);
  document.documentElement.style.setProperty("--thumb", `${thumbW}px`);
});
sizeIn.addEventListener("change", () => { for (const el of grid.children) { el._page = null; } render(); });

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function status(s) { $("#status").textContent = s; }

// Double-click a page to redact it.
grid.addEventListener("dblclick", (e) => { const c = cardOf(e.target); if (c) rview.open(+c.dataset.id); });

addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (rview.isOpen && !mod && rview.keydown(e)) { e.preventDefault(); return; }
  if (mod && k === "o") { e.preventDefault(); return pick(S.pages.length ? insertPos() : null); }
  if (e.target.closest?.("input, textarea, dialog")) return;
  if (!S.pages.length) return;
  if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && k === "y") { e.preventDefault(); return redo(); }
  if (mod && k === "s") { e.preventDefault(); return save(); }
  if (mod && k === "a") { e.preventDefault(); return ACTIONS.all(); }
  if (mod && k === "d") { e.preventDefault(); return ACTIONS.duplicate(); }
  if (rview.isOpen && !(mod && ["z", "y", "s"].includes(k))) return;
  if (e.key === "Escape") return ACTIONS.none();
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return ACTIONS.remove(); }
  if (!mod && k === "r") return e.shiftKey ? ACTIONS.rotateL() : ACTIONS.rotateR();
});

addEventListener("beforeunload", (e) => { if (S.undo.length) e.preventDefault(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

const rview = createRedactView({ S, commit, toast, root: main, onToggle: (open) => { app.classList.toggle("redacting", open); if (!open) render(); } });
installApi({ S, addFiles, commit, render, buildPdf: (src, pages) => buildPdf(src, pages, { dpi: S.dpi }), actions: ACTIONS, undo, redo, docName, rview });
render();
