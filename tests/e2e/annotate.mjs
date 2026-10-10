// Browser test for annotations: each tool, select/move/delete, undo, then the
// saved PDF is read back (text boxes are real text, notes are real comments).
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/annotate.mjs
import puppeteer from "puppeteer-core";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import zlib from "zlib";

const URL_ = process.env.URL || "http://localhost:8090/";
const W = +process.env.W || 1280, H = +process.env.H || 800;
const shots = new URL("./shots/", import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, isMobile: W < 700, hasTouch: W < 700 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL_, { waitUntil: "networkidle0" });
const shot = (n) => page.screenshot({ path: `${shots}${W < 700 ? "m-" : ""}${n}.png` });
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const annotsOf = (n) => page.evaluate((n) => filecairn.info().pages[n - 1].annotations, n);

const b64 = fs.readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)).toString("base64");
await page.evaluate((s) => filecairn.open(`data:application/pdf;base64,${s}`), b64);
await page.waitForFunction(() => document.querySelectorAll(".card .page canvas").length >= 5, { timeout: 20000 });

// Screen point for a user-space point on the open page (via the base canvas viewport).
const at = (x, y) => page.evaluate((x, y) => {
  const c = document.querySelector(".rpagebox canvas.rbase"), r = c.getBoundingClientRect(), [a, b, cc, d, e, f] = c.viewport.transform, k = c.width / r.width;
  return [r.x + (a * x + cc * y + e) / k, r.y + (b * x + d * y + f) / k];
}, x, y);
const dragUser = async (x1, y1, x2, y2, steps = 8) => { await page.mouse.move(...await at(x1, y1)); await page.mouse.down(); await page.mouse.move(...await at(x2, y2), { steps }); await page.mouse.up(); await sleep(150); };
const openPage = async (n) => {
  const c = await page.evaluate((n) => { const r = document.querySelectorAll(".card")[n - 1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, n);
  await page.mouse.click(...c, { count: 2 });
  await page.waitForSelector(".rpagebox canvas.rbase", { timeout: 10000 }); await sleep(300);
};

// Page 2 has "Contact: jane.doe@example.com, phone +31 6 1234 5678" at y=120.
await openPage(2);
await page.keyboard.press("h");
await dragUser(55, 112, 300, 140);
let a = await annotsOf(2);
check("highlight over text makes a highlight", a.length === 1 && a[0].type === "highlight", a);
// What you see in the editor: the text under the highlight must stay dark and readable.
await sleep(200);
const [hx1, hy1] = await at(60, 132), [hx2, hy2] = await at(200, 116);
const clip = await page.screenshot({ encoding: "base64", clip: { x: hx1, y: hy1, width: hx2 - hx1, height: hy2 - hy1 } });
const px = await page.evaluate(async (b64) => {
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let dark = 0, yellow = 0;
  for (let i = 0; i < d.length; i += 4) { const [r, gg, b] = [d[i], d[i + 1], d[i + 2]]; if (0.299 * r + 0.587 * gg + 0.114 * b < 150) dark++; if (r > 200 && gg > 170 && b < 90) yellow++; }
  return { dark, yellow, total: d.length / 4 };
}, clip);
check("in the editor the highlighted text stays dark (not covered)", px.dark > px.total * 0.03 && px.yellow > px.total * 0.3, px);
await page.keyboard.press("u"); await dragUser(55, 112, 140, 140);
await page.keyboard.press("p"); await dragUser(100, 300, 300, 400, 12);
await page.keyboard.press("a"); await dragUser(400, 500, 300, 420);
await page.keyboard.press("o"); await dragUser(80, 600, 250, 700);
a = await annotsOf(2);
check("underline, pen, arrow, ellipse added", a.map((x) => x.type).join() === "highlight,underline,ink,arrow,ellipse", a.map((x) => x.type));

// Text box: click, type, Esc.
await page.keyboard.press("t");
await page.mouse.click(...await at(60, 780)); await sleep(150);
await page.keyboard.type("Hello Filecairn");
await page.keyboard.press("Escape"); await sleep(150);
// Sticky note.
await page.keyboard.press("n");
await page.mouse.click(...await at(500, 780)); await sleep(150);
await page.keyboard.type("Check this");
await page.keyboard.press("Escape"); await sleep(150);
a = await annotsOf(2);
check("text box and note added with their text", a.length === 7 && a[5].type === "text" && a[5].text === "Hello Filecairn" && a[6].type === "note" && a[6].text === "Check this", a.slice(5));
await shot("A1-annotated");

// Select the arrow, move it, delete it, undo.
await page.keyboard.press("v");
await page.mouse.click(...await at(350, 460)); await sleep(100);
await dragUser(350, 460, 380, 440);
a = await annotsOf(2);
check("select + drag moves the arrow", a[3].type === "arrow" && Math.abs(a[3].to[0] - 330) < 3, a[3]);
await page.keyboard.press("Delete");
check("Delete removes it", (await annotsOf(2)).length === 6, null);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
check("Ctrl+Z brings it back", (await annotsOf(2)).length === 7, null);
// History panel: rows for every step, click to jump back and forward.
const rows = () => page.evaluate(() => [...document.querySelectorAll(".history .hrow")].map((b) => `${b.querySelector(".hlabel").textContent}:${b.className.split(" ")[1]}`));
let hr = await rows();
check("history lists each step, current marked, undone step dimmed", hr[0] === "Open:past" && hr.at(-2) === "Move annotation:current" && hr.at(-1) === "Delete annotation:future" && hr.length === 10, hr);
const clickRow = (i) => page.evaluate((i) => document.querySelectorAll(".history .hrow")[i].click(), i);
await clickRow(5); await sleep(200);
check("clicking an earlier step goes back (5 annotations)", (await annotsOf(2)).length === 5, (await annotsOf(2)).length);
await clickRow(8); await sleep(200);
check("clicking a later step goes forward again (7)", (await annotsOf(2)).length === 7 && (await rows()).at(-1) === "Delete annotation:future", await rows());
// Drag the divider between the tool panel and History.
const dock = () => page.evaluate(() => document.querySelector(".history-dock")?.getBoundingClientRect().height || 0);
if (W >= 700) {
  const h0 = await dock(), sp = await page.evaluate(() => { const r = document.querySelector(".rside .split").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(...sp); await page.mouse.down(); await page.mouse.move(sp[0], sp[1] - 120, { steps: 6 }); await page.mouse.up();
  const h1 = await dock();
  check("dragging the divider makes History taller", h1 > h0 + 100, { h0, h1 });
  await shot("A0-layout");
} else {
  await page.evaluate(() => document.querySelector('.rside-tabs [data-tab=history]').click());
  check("phone: History tab shows the list", await page.evaluate(() => document.querySelector(".history-dock").offsetHeight > 50 && document.querySelector(".rpanel").offsetHeight === 0), null);
  await shot("A0-layout");
  await page.evaluate(() => document.querySelector('.rside-tabs [data-tab=tool]').click());
}

// Restyle the selected text box: custom color, size via the number field, serif + bold.
await page.mouse.click(...await at(70, 772)); await sleep(150); // select "Hello Filecairn"
check("clicking text selects it and the panel edits it", (await page.evaluate(() => document.querySelector(".rpanel h2").textContent)) === "Selected text box", await page.evaluate(() => document.querySelector(".rpanel h2").textContent));
// Color comes from the well in the left rail (not the panel).
check("the panel has no color row", !(await page.evaluate(() => document.querySelector(".rpanel .swatches, .rpanel input[type=color]"))), null);
await page.click(".cwell"); await sleep(150);
check("the rail color well opens a palette showing the selected text's color", await page.evaluate(() => !document.querySelector(".cpop").hidden && !!document.querySelector(".cpop .sw")), null);
await shot("A1c-color-pop");
await page.evaluate(() => { const c = document.querySelector('.cpop input[type=color]'); c.value = "#123456"; c.dispatchEvent(new Event("input", { bubbles: true })); c.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => { const n = document.querySelector('.rpanel input[type=number][data-prop=size]'); n.value = "28"; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); });
await page.click(".rpanel .fontbtn"); await sleep(150);
await page.evaluate(() => document.querySelector('.fpop [data-font-id=serif]').click());
await page.evaluate(() => document.querySelector('.rpanel [data-toggle=bold]').click());
a = (await annotsOf(2))[5];
check("custom color, typed size, serif and bold applied to the selected text", a.color === "#123456" && a.size === 28 && a.font === "serif" && a.bold === true, a);
// Font library: search "Calibri" -> Carlito.
await page.click(".rpanel .fontbtn"); await sleep(150);
await page.type(".fpop .fsearch", "Calibri"); await sleep(100);
const found = await page.evaluate(() => [...document.querySelectorAll(".fpop .fitem")].map((b) => b.textContent));
check("searching 'Calibri' finds its stand-in", found.length === 1 && found[0].includes("Carlito") && found[0].includes("like Calibri"), found);
await page.evaluate(() => document.querySelector(".fpop .fitem").click()); await sleep(600);
check("text box now uses Carlito, loaded on demand", (await annotsOf(2))[5].font === "carlito" && await page.evaluate(() => document.fonts.check('bold 16px "fc-carlito"')), (await annotsOf(2))[5].font);
// Upload a font file (a library TTF under another name).
const ttf = new URL("../../vendor/fonts/library/great-vibes/regular.ttf", import.meta.url).pathname;
await page.click(".rpanel .fontbtn"); await sleep(150);
const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => document.querySelector('.fpop [data-fa=upload]').click())]);
fs.copyFileSync(ttf, "/tmp/MyHand-Regular.ttf"); await chooser.accept(["/tmp/MyHand-Regular.ttf"]); await sleep(800);
check("uploaded font is added and applied", (await annotsOf(2))[5].font === "upload:MyHand", (await annotsOf(2))[5].font);
await page.click(".rpanel .fontbtn"); await sleep(150);
check("uploaded font listed under Uploaded", await page.evaluate(() => [...document.querySelectorAll(".fpop .fgroup")].some((g) => g.textContent === "Uploaded")), null);
await shot("A1d-fonts");
await page.keyboard.press("Escape");
// Put Carlito back for the saved-file check.
await page.click(".rpanel .fontbtn"); await sleep(100); await page.type(".fpop .fsearch", "Carlito"); await page.evaluate(() => document.querySelector(".fpop .fitem").click()); await sleep(300);
// Text tool on existing text edits it.
await page.keyboard.press("t");
await page.mouse.click(...await at(70, 772)); await sleep(150);
check("Text tool on existing text opens it for editing", (await page.evaluate(() => document.querySelector(".tbox textarea")?.value)) === "Hello Filecairn", null);
await page.keyboard.press("End"); await page.keyboard.type("!"); await page.keyboard.press("Escape"); await sleep(150);
check("edit saved", (await annotsOf(2))[5].text === "Hello Filecairn!", (await annotsOf(2))[5].text);
check("highlight on text is flagged to go under the text", (await annotsOf(2))[0].onText === true, (await annotsOf(2))[0]);
// Zoom.
const w0 = await page.evaluate(() => document.querySelector(".rbase").getBoundingClientRect().width);
await page.evaluate(() => document.querySelector("[data-a=zin]").click()); await sleep(400);
await page.evaluate(() => document.querySelector("[data-a=zin]").click()); await sleep(400);
const z = await page.evaluate(() => [document.querySelector(".zlabel").textContent, document.querySelector(".rbase").getBoundingClientRect().width]);
check("zoom in twice -> 156% and a bigger page", z[0] === "156%" && Math.abs(z[1] / w0 - 1.5625) < 0.02, { w0, z });
await shot("A1b-zoomed");
await page.keyboard.press("0"); await sleep(300);
check("0 fits again", (await page.evaluate(() => document.querySelector(".zlabel").textContent)) === "100%", null);

// Text on the pre-rotated page 5 (rotated 90°) and non-Latin text on page 1.
await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await sleep(400);
await page.keyboard.press("t");
const r5 = await page.evaluate(() => { const r = document.querySelector(".rpagebox canvas.rbase").getBoundingClientRect(); return [r.x + 40, r.y + 40]; });
await page.mouse.click(...r5); await sleep(150);
await page.keyboard.type("Rotated OK"); await page.keyboard.press("Escape"); await sleep(150);
check("text added on rotated page", (await annotsOf(5)).some((x) => x.text === "Rotated OK"), await annotsOf(5));
await shot("A2-rotated-text");
await page.evaluate(() => filecairn.addAnnotation(1, { type: "text", x: 60, y: 760, size: 18, color: "#0F5468", text: "Zażółć gęślą jaźń" }));
await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await sleep(300);
await shot("A3-grid");

// Read the saved PDF back.
const res = await page.evaluate(async () => {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await filecairn.exportPdf({ as: "bytes" }) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i), tc = await p.getTextContent();
    out.push({ text: tc.items.map((it) => it.str).join(" "), items: tc.items.map((it) => ({ s: it.str, t: it.transform })), annots: (await p.getAnnotations()).map((an) => ({ sub: an.subtype, contents: an.contentsObj?.str ?? an.contents })) });
  }
  return out;
});
check("text box is real text in the saved PDF", res[1].text.includes("Hello Filecairn!"), res[1].text);
{ const d2 = await PDFDocument.load(Buffer.from(await page.evaluate(async () => { const b = await filecairn.exportPdf({ as: "bytes" }); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64"));
  const raw = Buffer.from(await d2.save({ useObjectStreams: false })).toString("latin1");
  check("Carlito is embedded in the saved PDF", /\/BaseFont\s*\/(?:[A-Z]{6}\+)?Carlito/.test(raw), (raw.match(/\/BaseFont\s*\/[^\s/]+/g) || []).slice(0, 8)); }
// The text highlight must be the first content stream on page 2 (drawn under the text).
const bytes = Buffer.from(await page.evaluate(async () => { const b = await filecairn.exportPdf({ as: "bytes" }); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
const pd = await PDFDocument.load(bytes), p2 = pd.getPages()[1];
p2.node.normalize();
const streams = p2.node.Contents().asArray().map((ref) => { const raw = Buffer.from(pd.context.lookup(ref).getContents()); return (raw[0] === 0x78 ? zlib.inflateSync(raw) : raw).toString("latin1"); });
const hl = streams.findIndex((t) => /1 0\.8\d* 0 rg/.test(t) && / re\b/.test(t)), txt = streams.findIndex((t) => /Tj|TJ/.test(t));
check("highlight is painted before (under) the page text", hl >= 0 && hl < txt, { hl, txt, starts: streams.map((t) => t.slice(0, 30)) });
check("original text is still there", res[1].text.includes("jane.doe@example.com"), res[1].text);
check("sticky note is a real PDF comment", res[1].annots.some((x) => x.sub === "Text" && x.contents === "Check this"), res[1].annots);
const rot = res[4].items.find((it) => it.s === "Rotated OK");
check("text on the rotated page is upright as typed (runs along +y in user space)", rot && Math.abs(rot.t[0]) < 0.01 && rot.t[1] > 0, rot);
check("non-Latin text is embedded with a Unicode font", res[0].text.includes("Zażółć gęślą jaźń"), res[0].text);
check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
