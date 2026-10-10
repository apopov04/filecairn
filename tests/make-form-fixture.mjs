// Builds tests/fixtures/form.pdf: a one-page form with a text field, a
// multi-line field, a checkbox, a dropdown and a radio group.
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "fs";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([595, 842]);
const form = doc.getForm();
const label = (t, y) => page.drawText(t, { x: 60, y, size: 13, font });
page.drawText("Membership application", { x: 60, y: 770, size: 22, font });
label("Full name", 712); form.createTextField("name").addToPage(page, { x: 200, y: 700, width: 300, height: 24 });
label("Comments", 652); const c = form.createTextField("comments"); c.enableMultiline(); c.addToPage(page, { x: 200, y: 580, width: 300, height: 80 });
label("I agree to the terms", 532); form.createCheckBox("agree").addToPage(page, { x: 200, y: 526, width: 18, height: 18 });
label("Country", 482); const dd = form.createDropdown("country"); dd.addOptions(["Netherlands", "Spain", "United States"]); dd.addToPage(page, { x: 200, y: 472, width: 200, height: 24 });
label("Plan", 432); const rg = form.createRadioGroup("plan");
rg.addOptionToPage("basic", page, { x: 200, y: 426, width: 16, height: 16 }); page.drawText("Basic", { x: 222, y: 429, size: 12, font });
rg.addOptionToPage("pro", page, { x: 300, y: 426, width: 16, height: 16 }); page.drawText("Pro", { x: 322, y: 429, size: 12, font });
label("Signature", 300); page.drawLine({ start: { x: 200, y: 296 }, end: { x: 460, y: 296 }, thickness: 1 });
label("Date", 250); page.drawLine({ start: { x: 200, y: 246 }, end: { x: 360, y: 246 }, thickness: 1 });
fs.writeFileSync(new URL("./fixtures/form.pdf", import.meta.url), await doc.save());
console.log("wrote tests/fixtures/form.pdf");
