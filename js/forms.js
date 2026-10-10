// PDF forms: read a page's fields (for the editor's input overlay) and write
// the answers into the saved file. Answers live on pages as page.fields =
// { fieldName: value } (so they're undoable like everything else).
//   text / multiline: string · check: true/false · radio: chosen option · select: chosen option

import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "../vendor/pdf-lib/pdf-lib.esm.min.js";

/** The page's form fields: [{ name, kind, rect, value, options, on, readOnly, maxLen }]. */
export async function fieldsOf(src, index) {
  src.fields ??= new Map();
  if (!src.fields.has(index)) {
    const annots = await (await src.pdf.getPage(index + 1)).getAnnotations();
    src.fields.set(index, annots.filter((a) => a.subtype === "Widget" && a.fieldName && !a.hidden).map((a) => {
      const kind = a.fieldType === "Tx" ? (a.multiLine ? "multiline" : "text")
        : a.fieldType === "Ch" ? "select"
        : a.checkBox ? "check" : a.radioButton ? "radio" : null; // push buttons and signature fields are skipped
      if (!kind) return null;
      const value = kind === "check" ? a.fieldValue && a.fieldValue !== "Off"
        : kind === "radio" ? (a.fieldValue && a.fieldValue !== "Off" ? a.fieldValue : null)
        : kind === "select" ? (Array.isArray(a.fieldValue) ? a.fieldValue[0] ?? "" : a.fieldValue ?? "")
        : a.fieldValue ?? "";
      return {
        name: a.fieldName, kind, rect: a.rect, value, readOnly: !!a.readOnly, maxLen: a.maxLen || 0,
        options: kind === "select" ? (a.options || []).map((o) => ({ value: o.exportValue, label: o.displayValue ?? o.exportValue })) : null,
        on: kind === "radio" ? a.buttonValue : kind === "check" ? a.exportValue || "Yes" : null,
      };
    }).filter(Boolean));
  }
  return src.fields.get(index);
}

/** All answers given for one source document, merged across its pages. */
export function answersFor(pages, srcIndex) {
  const out = {};
  for (const p of pages) if (p.src === srcIndex && p.fields) Object.assign(out, p.fields);
  return out;
}

/**
 * Fill a source document's form with `answers` and flatten it (the answers
 * become part of the page). Returns the bytes of the filled document.
 * Fields pdf-lib can't fill are left as they were.
 */
export async function fillAndFlatten(bytes, answers, embedUnicodeFont) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  let needsUnicode = false;
  for (const [name, v] of Object.entries(answers)) {
    try {
      // instanceof, not constructor.name: class names are mangled in the minified build.
      const f = form.getField(name);
      if (f instanceof PDFTextField) {
        f.setText(String(v ?? ""));
        if (/[^\x00-\xff]/.test(String(v ?? ""))) needsUnicode = true;
      } else if (f instanceof PDFCheckBox) v ? f.check() : f.uncheck();
      else if (f instanceof PDFRadioGroup) { if (v) f.select(v); }
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (v) f.select(v); }
    } catch { /* unknown or unusual field: leave it */ }
  }
  try {
    if (needsUnicode) form.updateFieldAppearances(await embedUnicodeFont(doc));
    form.flatten();
  } catch { /* forms pdf-lib can't flatten keep their (filled) fields */ }
  return doc.save();
}
