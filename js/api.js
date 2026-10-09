// window.filecairn: a small, stable scripting API for AI agents and automation.
// Pages are numbered from 1, like in the app. Every method is async, goes
// through the same code as the buttons (so it can be undone) and throws
// readable errors. Nothing is fetched or downloaded unless you ask for it.

import * as P from "./pages.js";

const METHODS = [
  ["open(files)", "Open PDFs/images (File, Blob or data: URL, or an array of them), replacing nothing: pages are added at the end."],
  ["info()", "{ name, pageCount, pages: [{ page, blank, rotation, width, height, source }], selected, canUndo, canRedo }"],
  ["movePages(pages, before)", "Move pages (array of page numbers) so they sit before page `before` (pageCount + 1 = the end)."],
  ["deletePages(pages)", "Delete pages."],
  ["rotatePages(pages, degrees)", "Rotate pages by a multiple of 90 (positive = clockwise)."],
  ["duplicatePages(pages)", "Insert a copy after each page."],
  ["insertBlank(before, { width, height })", "Insert a blank page before page `before` (size in points; default: A4)."],
  ["select(pages)", "Select pages in the UI (empty array clears)."],
  ["exportPdf({ pages, as })", "Build the PDF (optionally only some pages). as: \"blob\" (default), \"bytes\" or \"dataurl\". Doesn't download."],
  ["save()", "Download the whole PDF, like the Save button."],
  ["undo() / redo()", "Undo or redo the last change."],
  ["help()", "This list."],
];

export function installApi({ S, addFiles, commit, render, buildPdf, undo, redo, actions }) {
  const need = () => { if (!S.pages.length) throw new Error("No document open. Call filecairn.open(file) first."); };
  const ids = (pages, what = "pages") => {
    if (!Array.isArray(pages) || !pages.length) throw new Error(`${what} must be a non-empty array of page numbers (1–${S.pages.length}).`);
    return new Set(pages.map((n) => {
      if (!Number.isInteger(n) || n < 1 || n > S.pages.length) throw new Error(`Page ${n} doesn't exist (1–${S.pages.length}).`);
      return S.pages[n - 1].id;
    }));
  };
  const toFile = async (x, i) => {
    if (x instanceof Blob) return x.name ? x : new File([x], `file-${i + 1}${x.type === "application/pdf" ? ".pdf" : ""}`, { type: x.type });
    if (typeof x === "string" && x.startsWith("data:")) { const b = await (await fetch(x)).blob(); return new File([b], `file-${i + 1}`, { type: b.type }); }
    throw new Error("open() takes File/Blob objects or data: URLs. (Fetching other websites is blocked by Filecairn's privacy policy.)");
  };
  const api = {
    version: "0.1.0", apiVersion: 1,
    help: () => METHODS.map(([sig, desc]) => ({ sig, desc })),
    async open(files) {
      const list = await Promise.all((Array.isArray(files) ? files : [files]).map(toFile));
      const n = await addFiles(list);
      if (!n) throw new Error("Nothing could be opened (see the message in the page).");
      return api.info();
    },
    info() {
      return {
        name: S.name, pageCount: S.pages.length,
        pages: S.pages.map((p, i) => ({ page: i + 1, blank: !!p.blank, rotation: p.rot, width: Math.round(p.w), height: Math.round(p.h), source: p.blank ? null : S.sources[p.src].name })),
        selected: S.pages.map((p, i) => (S.sel.has(p.id) ? i + 1 : 0)).filter(Boolean),
        canUndo: S.undo.length > 0, canRedo: S.redo.length > 0,
      };
    },
    async movePages(pages, before) { need(); const s = ids(pages); if (!Number.isInteger(before) || before < 1 || before > S.pages.length + 1) throw new Error(`before must be 1–${S.pages.length + 1}.`); commit(P.move(S.pages, s, before - 1), "move pages"); return api.info(); },
    async deletePages(pages) { need(); const s = ids(pages); if (s.size === S.pages.length) throw new Error("Can't delete every page."); commit(P.remove(S.pages, s), "delete pages"); return api.info(); },
    async rotatePages(pages, degrees) { need(); if (degrees % 90) throw new Error("degrees must be a multiple of 90."); commit(P.rotate(S.pages, ids(pages), degrees), "rotate"); return api.info(); },
    async duplicatePages(pages) { need(); commit(P.duplicate(S.pages, ids(pages)).pages, "duplicate"); return api.info(); },
    async insertBlank(before = S.pages.length + 1, { width = 595.28, height = 841.89 } = {}) { need(); commit(P.insertBlank(S.pages, before - 1, width, height).pages, "insert blank page"); return api.info(); },
    async select(pages = []) { need(); S.sel = pages.length ? ids(pages) : new Set(); render(); return api.info().selected; },
    async exportPdf({ pages, as = "blob" } = {}) {
      need();
      const list = pages ? [...ids(pages)].map((id) => S.pages.find((p) => p.id === id)) : S.pages;
      const bytes = await buildPdf(S.sources, list);
      if (as === "bytes") return bytes;
      const blob = new Blob([bytes], { type: "application/pdf" });
      if (as === "dataurl") return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      return blob;
    },
    async save() { need(); await actions.save(); },
    async undo() { undo(); return api.info(); },
    async redo() { redo(); return api.info(); },
  };
  window.filecairn = Object.freeze(api);
}
