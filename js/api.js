// window.filecairn: a small, stable scripting API for AI agents and automation.
// Pages are numbered from 1, like in the app. Every method is async, goes
// through the same code as the buttons (so it can be undone) and throws
// readable errors. Nothing is fetched or downloaded unless you ask for it.

import * as P from "./pages.js";
import { textItems } from "./engine.js";
import { fieldsOf } from "./forms.js";
import { PRESETS, textQuery, findOnPage, normRect } from "./redact.js";

const METHODS = [
  ["open(files)", "Open PDFs/images (File, Blob or data: URL, or an array of them), replacing nothing: pages are added at the end."],
  ["info()", "{ name, pageCount, pages: [{ page, blank, rotation, width, height, source }], selected, canUndo, canRedo }"],
  ["movePages(pages, before)", "Move pages (array of page numbers) so they sit before page `before` (pageCount + 1 = the end)."],
  ["deletePages(pages)", "Delete pages."],
  ["rotatePages(pages, degrees)", "Rotate pages by a multiple of 90 (positive = clockwise)."],
  ["duplicatePages(pages)", "Insert a copy after each page."],
  ["insertBlank(before, { width, height })", "Insert a blank page before page `before` (size in points; default: A4)."],
  ["select(pages)", "Select pages in the UI (empty array clears)."],
  ["markText(query | { preset })", "Mark every match of plain text (case-insensitive) or a preset (\"email\", \"phone\", \"number\", \"iban\") for redaction. Returns { matches, pages }."],
  ["markArea(page, [x1, y1, x2, y2])", "Mark a rectangle for redaction, in PDF points from the page's bottom-left (as in the original page, before any rotation)."],
  ["clearMarks(pages?)", "Remove redaction marks (all pages if omitted)."],
  ["addAnnotation(page, annotation)", "Add an annotation in PDF points (y up, from the page's bottom-left). Types: { type: \"highlight\"|\"underline\"|\"strike\", color, rects: [[x1,y1,x2,y2]] }, { type: \"ink\", color, width, paths: [[x,y,x,y,…]] }, { type: \"rect\"|\"ellipse\", color, width, rect }, { type: \"line\"|\"arrow\", color, width, from: [x,y], to: [x,y] }, { type: \"text\", x, y (top-left), size, color, text }, { type: \"note\", x, y, color, text }. Colors are #rrggbb."],
  ["clearAnnotations(pages?)", "Remove annotations (all pages if omitted)."],
  ["formFields(page)", "The page's form fields: [{ name, kind: \"text\"|\"multiline\"|\"check\"|\"radio\"|\"select\", value, options, on }]."],
  ["fillField(page, name, value)", "Fill a form field: text for text fields, true/false for checkboxes, the option value for radios and dropdowns. Answers are written in (flattened) on save."],
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
    version: "0.4.0", apiVersion: 1,
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
        pages: S.pages.map((p, i) => ({ page: i + 1, blank: !!p.blank, rotation: p.rot, redactions: p.marks?.length || 0, annotations: p.annots || [], width: Math.round(p.w), height: Math.round(p.h), source: p.blank ? null : S.sources[p.src].name })),
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
    async markText(query) {
      need();
      const re = typeof query === "string" ? textQuery(query) : PRESETS[query?.preset]?.re;
      if (!re) throw new Error(`markText needs text or { preset: ${Object.keys(PRESETS).map((k) => `"${k}"`).join(" | ")} }.`);
      const byId = new Map(); let matches = 0;
      for (const p of S.pages) {
        if (p.blank) continue;
        const m = findOnPage(await textItems(S.sources[p.src], p.index), re);
        if (m.length) { byId.set(p.id, m.flatMap((x) => x.boxes)); matches += m.length; }
      }
      if (matches) commit(P.addMarks(S.pages, byId), `mark ${matches} matches`);
      return { matches, pages: S.pages.map((p, i) => (byId.has(p.id) ? i + 1 : 0)).filter(Boolean) };
    },
    async markArea(page, rect) {
      need(); const id = [...ids([page], "page")][0], p = S.pages.find((q) => q.id === id);
      if (p.blank) throw new Error("Blank pages have nothing to redact.");
      if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => typeof v !== "number")) throw new Error("rect must be [x1, y1, x2, y2] in PDF points.");
      commit(P.setMarks(S.pages, id, [...(p.marks || []), normRect(rect)]), "mark area");
      return api.info();
    },
    async addAnnotation(page, a) {
      need(); const id = [...ids([page], "page")][0], p = S.pages.find((q) => q.id === id);
      const ok = { image: ["x", "y", "w", "h", "src"], highlight: ["rects"], underline: ["rects"], strike: ["rects"], ink: ["paths"], rect: ["rect"], ellipse: ["rect"], line: ["from", "to"], arrow: ["from", "to"], text: ["x", "y", "text"], note: ["x", "y"] }[a?.type];
      if (!ok) throw new Error("Unknown annotation type. See filecairn.help().");
      for (const k of ok) if (a[k] == null) throw new Error(`A ${a.type} annotation needs "${k}".`);
      const an = { color: a.type === "highlight" || a.type === "note" ? "#ffd400" : "#d93f3f", width: 2, size: 14, rot: 0, ...a };
      if (an.color && !/^#[0-9a-f]{6}$/i.test(an.color)) throw new Error("color must be #rrggbb.");
      commit(P.setAnnots(S.pages, id, [...(p.annots || []), an]), `add ${a.type}`);
      return api.info().pages[S.pages.findIndex((q) => q.id === id)];
    },
    async formFields(page) {
      need(); const id = [...ids([page], "page")][0], p = S.pages.find((q) => q.id === id);
      if (p.blank) return [];
      return (await fieldsOf(S.sources[p.src], p.index)).map((f) => ({ name: f.name, kind: f.kind, value: p.fields && f.name in p.fields ? p.fields[f.name] : f.value, options: f.options?.map((o) => o.value) || null, on: f.on }));
    },
    async fillField(page, name, value) {
      need(); const id = [...ids([page], "page")][0], p = S.pages.find((q) => q.id === id);
      const f = (await api.formFields(page)).find((x) => x.name === name);
      if (!f) throw new Error(`Page ${page} has no field "${name}". See formFields(${page}).`);
      if (f.kind === "check" && typeof value !== "boolean") throw new Error(`"${name}" is a checkbox: pass true or false.`);
      if ((f.kind === "radio" || f.kind === "select") && f.options && !f.options.includes(value)) throw new Error(`"${name}" accepts: ${f.options.join(", ")}.`);
      commit(P.setFields(S.pages, id, { ...(p.fields || {}), [name]: value }), "fill form");
      return api.formFields(page);
    },
    async clearAnnotations(pages) {
      need(); const s = pages ? ids(pages) : null;
      commit(S.pages.map((p) => (p.annots && (!s || s.has(p.id)) ? { ...p, annots: undefined } : p)), "clear annotations"); return api.info();
    },
    async clearMarks(pages) { need(); commit(P.clearMarks(S.pages, pages ? ids(pages) : null), "clear marks"); return api.info(); },
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
