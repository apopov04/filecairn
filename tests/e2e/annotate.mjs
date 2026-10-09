// Browser test for annotations: each tool, select/move/delete, undo, then the
// saved PDF is read back (text boxes are real text, notes are real comments).
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/annotate.mjs
import puppeteer from "puppeteer-core";
import fs from "fs";

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
check("text box is real text in the saved PDF", res[1].text.includes("Hello Filecairn"), res[1].text);
check("original text is still there", res[1].text.includes("jane.doe@example.com"), res[1].text);
check("sticky note is a real PDF comment", res[1].annots.some((x) => x.sub === "Text" && x.contents === "Check this"), res[1].annots);
const rot = res[4].items.find((it) => it.s === "Rotated OK");
check("text on the rotated page is upright as typed (runs along +y in user space)", rot && Math.abs(rot.t[0]) < 0.01 && rot.t[1] > 0, rot);
check("non-Latin text is embedded with a Unicode font", res[0].text.includes("Zażółć gęślą jaźń"), res[0].text);
check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
