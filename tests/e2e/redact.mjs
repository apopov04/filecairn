// Browser test for redaction: marks by search, by preset and by dragging,
// then checks the saved PDF really no longer contains the redacted text.
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/redact.mjs
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

const b64 = fs.readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)).toString("base64");
await page.evaluate((s) => filecairn.open(`data:application/pdf;base64,${s}`), b64);
await page.waitForFunction(() => document.querySelectorAll(".card .page canvas").length >= 5, { timeout: 20000 });

// API: preset + plain text.
let r = await page.evaluate(() => filecairn.markText({ preset: "email" }));
check("email preset finds 1 match on page 2", r.matches === 1 && r.pages.join() === "2", r);
r = await page.evaluate(() => filecairn.markText("john smith"));
check("text search finds 'John Smith' on page 4", r.matches === 1 && r.pages.join() === "4", r);

// UI: open page 1 by double-click, drag a box over the big "1".
const c1 = await page.evaluate(() => { const r = document.querySelectorAll(".card")[0].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.click(...c1, { count: 2 });
await page.waitForSelector(".rpagebox canvas", { timeout: 10000 });
await new Promise((res) => setTimeout(res, 300));
const box = await page.evaluate(() => { const r = document.querySelector(".rpagebox canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(box.x + box.w * .3, box.y + box.h * .35); await page.mouse.down();
await page.mouse.move(box.x + box.w * .7, box.y + box.h * .65, { steps: 6 }); await page.mouse.up();
check("dragging marks an area on page 1", (await page.evaluate(() => filecairn.info().pages[0].redactions)) === 1, null);

// UI search: phone numbers preset -> Mark all.
await page.evaluate(() => [...document.querySelectorAll(".chip")].find((b) => b.dataset.preset === "phone").click());
await page.waitForFunction(() => document.querySelector(".rfound button.primary"), { timeout: 10000 });
await shot("R1-redact-view");
await page.evaluate(() => document.querySelector(".rfound button.primary").click());
check("phone preset marked on page 2", (await page.evaluate(() => filecairn.info().pages[1].redactions)) >= 2, await page.evaluate(() => filecairn.info().pages[1]));

// Undo works for marks.
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
check("Ctrl+Z removes the last marks", (await page.evaluate(() => filecairn.info().pages[1].redactions)) === 1, null);
await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.press("z"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
await page.keyboard.press("Escape");
await shot("R2-grid-with-marks");

// Export and read the text back with pdf.js: redacted pages must have no text left.
const text = await page.evaluate(async () => {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
  const bytes = await filecairn.exportPdf({ as: "bytes" });
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    out.push({ text: (await p.getTextContent()).items.map((it) => it.str).join(" "), rotate: p.rotate });
  }
  return out;
});
const all = text.map((t) => t.text).join(" | ");
check("exported PDF has 5 pages", text.length === 5, text.length);
check("email is gone from the file", !all.includes("jane.doe"), all);
check("phone number is gone", !all.includes("1234 5678"), all);
check("'John Smith' is gone", !/john smith/i.test(all), all);
check("redacted pages carry no text at all", !text[0].text.trim() && !text[1].text.trim() && !text[3].text.trim(), text.map((t) => t.text.slice(0, 30)));
check("unredacted page 3 keeps its real text", text[2].text.includes("Page 3"), text[2].text);
check("pre-rotated page 5 keeps its rotation", text[4].rotate === 90, text[4].rotate);
check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
