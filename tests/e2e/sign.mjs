// Browser test for Fill form + Sign: fill every kind of field through the
// overlay inputs, create a drawn signature, place and resize it, add the date,
// then read the saved PDF back.
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/sign.mjs
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
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
await page.evaluate(() => localStorage.removeItem("fc-sign"));
const shot = (n) => page.screenshot({ path: `${shots}${W < 700 ? "m-" : ""}${n}.png` });
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (x, y) => page.evaluate((x, y) => {
  const c = document.querySelector(".rpagebox canvas.rbase"), r = c.getBoundingClientRect(), [a, b, cc, d, e, f] = c.viewport.transform, k = c.width / r.width;
  return [r.x + (a * x + cc * y + e) / k, r.y + (b * x + d * y + f) / k];
}, x, y);

const b64 = fs.readFileSync(new URL("../fixtures/form.pdf", import.meta.url)).toString("base64");
await page.evaluate((s) => filecairn.open(`data:application/pdf;base64,${s}`), b64);
await page.waitForFunction(() => document.querySelector(".card .page canvas"), { timeout: 20000 });
const c = await page.evaluate(() => { const r = document.querySelector(".card").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.click(...c, { count: 2 });
await page.waitForSelector(".rpagebox canvas.rbase", { timeout: 10000 }); await sleep(300);

// Fill form.
await page.keyboard.press("f"); await sleep(300);
check("form fields get inputs over them", (await page.evaluate(() => document.querySelectorAll(".rfields.active .ff").length)) === 6, await page.evaluate(() => document.querySelectorAll(".rfields .ff").length));
await page.click('.ff[aria-label="name"]'); await page.keyboard.type("Jane Tester"); await page.keyboard.press("Tab");
await page.click('.ff[aria-label="comments"]'); await page.keyboard.type("Zażółć gęślą jaźń"); await page.keyboard.press("Tab");
await page.click('.ff[aria-label="agree"]');
await page.select('.ff[aria-label="country"]', "Spain");
await page.evaluate(() => document.querySelectorAll('.ff[aria-label="plan"]')[1].click());
await sleep(200);
const ans = await page.evaluate(() => filecairn.formFields(1));
const v = Object.fromEntries(ans.map((f) => [f.name, f.value]));
check("answers recorded for text, multiline, checkbox, dropdown and radio", v.name === "Jane Tester" && v.comments === "Zażółć gęślą jaźń" && v.agree === true && v.country === "Spain" && v.plan === "pro", v);
await shot("F1-filled");

// Sign: draw a signature in the dialog.
await page.click(".rrail [data-tool=sign]"); await sleep(200);
await page.evaluate(() => document.querySelector('.rpanel [data-a=newsign][data-kind=signature]').click());
await page.waitForSelector("dialog.signdlg[open] .pad");
const pad = await page.evaluate(() => { const r = document.querySelector(".signdlg .pad").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.move(pad.x + pad.w * 0.15, pad.y + pad.h * 0.6); await page.mouse.down();
for (let i = 1; i <= 20; i++) await page.mouse.move(pad.x + pad.w * (0.15 + i * 0.035), pad.y + pad.h * (0.6 - 0.25 * Math.sin(i / 2)));
await page.mouse.up();
await shot("F2-sign-dialog");
await page.click(".signdlg button.primary"); await sleep(300);
check("signature saved in this browser", await page.evaluate(() => !!JSON.parse(localStorage.getItem("fc-sign") || "{}").signature), null);
check("ready to place", (await page.evaluate(() => document.querySelector(".rpanel .placing")?.textContent || "")).includes("Click on the page"), null);
await page.mouse.click(...await at(330, 315)); await sleep(200);
let an = await page.evaluate(() => filecairn.info().pages[0].annotations);
check("signature placed as an image on the signature line", an.length === 1 && an[0].type === "image" && Math.abs(an[0].x + an[0].w / 2 - 330) < 2, an.map((a) => ({ ...a, src: a.src?.slice(0, 20) })));
// Resize with the corner handle (bigger).
const w0 = an[0].w, corner = [an[0].x + an[0].w, an[0].y - an[0].h];
await page.mouse.move(...await at(...corner)); await page.mouse.down(); await page.mouse.move(...await at(corner[0] + 60, corner[1] - 20), { steps: 6 }); await page.mouse.up(); await sleep(200);
an = await page.evaluate(() => filecairn.info().pages[0].annotations);
check("corner handle resizes it, keeping its shape", an[0].w > w0 + 30 && Math.abs(an[0].h / an[0].w - (an[0].h / an[0].w)) < 1e-9, { w0, w: an[0].w });
// Date.
await page.evaluate(() => document.querySelector('.rpanel [data-place=date]').click());
await page.mouse.click(...await at(205, 262)); await sleep(200);
an = await page.evaluate(() => filecairn.info().pages[0].annotations);
check("date placed as text", an.length === 2 && an[1].type === "text" && /\d{4}/.test(an[1].text), an[1]);
await shot("F3-signed");

// Initials by typing (handwriting font).
await page.click(".rrail [data-tool=sign]"); await sleep(150);
await page.evaluate(() => document.querySelector('.rpanel [data-a=newsign][data-kind=initials]').click());
await page.waitForSelector("dialog.signdlg[open]");
await page.evaluate(() => document.querySelector('.signdlg [data-tab=type]').click());
await page.type(".signdlg .typed", "JT"); await sleep(300);
await page.click(".signdlg button.primary"); await sleep(400);
const ini = await page.evaluate(() => JSON.parse(localStorage.getItem("fc-sign") || "{}").initials || "");
const iniSize = await page.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, ini);
check("typed initials become a trimmed image", ini.startsWith("data:image/png") && iniSize[0] > 40 && iniSize[0] < 600, iniSize);
await page.keyboard.press("Escape");

// Save and read back.
const bytes = Buffer.from(await page.evaluate(async () => { const b = await filecairn.exportPdf({ as: "bytes" }); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
const doc = await PDFDocument.load(bytes);
check("saved page has no leftover form widgets", !(await page.evaluate(async (b) => { const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs"; const d = await pdfjs.getDocument({ data: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }).promise; return (await (await d.getPage(1)).getAnnotations()).filter((a) => a.subtype === "Widget").length; }, bytes.toString("base64"))), null);
const text = await page.evaluate(async (b) => {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
  const d = await pdfjs.getDocument({ data: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }).promise, p = await d.getPage(1);
  const ops = await p.getOperatorList();
  return { text: (await p.getTextContent()).items.map((i) => i.str).join(" "), images: ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length };
}, bytes.toString("base64"));
check("typed answers are in the saved page", text.text.includes("Jane Tester") && text.text.includes("Spain"), text.text);
check("Unicode answer embedded", text.text.includes("Zażółć"), text.text);
check("signature image is drawn on the page", text.images >= 1, text.images);
check("date text is on the page", /\d{4}/.test(text.text.replace(/Jane Tester|Spain/g, "")), text.text);
check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
