// Resize handles: rectangle corner, arrow end, pen drawing corner, text box corner (font size).
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/resize.mjs
import puppeteer from "puppeteer-core";
import fs from "fs";
const URL_ = process.env.URL || "http://localhost:8090/";
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL_, { waitUntil: "networkidle0" });
let failed = 0; const check = (n, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate((s) => filecairn.open(`data:application/pdf;base64,${s}`), fs.readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)).toString("base64"));
await page.evaluate(async () => {
  await filecairn.addAnnotation(1, { type: "rect", rect: [100, 600, 200, 700], color: "#d93f3f", width: 3 });
  await filecairn.addAnnotation(1, { type: "arrow", from: [300, 600], to: [400, 700], color: "#d93f3f", width: 3 });
  await filecairn.addAnnotation(1, { type: "ink", paths: [[100, 300, 150, 350, 200, 300]], color: "#d93f3f", width: 3 });
  await filecairn.addAnnotation(1, { type: "text", x: 300, y: 400, size: 14, text: "Resize me", rot: 0 });
});
await page.waitForFunction(() => document.querySelector(".card .page canvas"));
const c = await page.evaluate(() => { const r = document.querySelector(".card").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.click(...c, { count: 2 }); await page.waitForSelector(".rbase"); await sleep(300);
await page.keyboard.press("v");
const at = (x, y) => page.evaluate((x, y) => { const cv = document.querySelector(".rbase"), r = cv.getBoundingClientRect(), [a, b, cc, d, e, f] = cv.viewport.transform, k = cv.width / r.width; return [r.x + (a * x + cc * y + e) / k, r.y + (b * x + d * y + f) / k]; }, x, y);
const drag = async (x1, y1, x2, y2) => { await page.mouse.move(...await at(x1, y1)); await page.mouse.down(); await page.mouse.move(...await at(x2, y2), { steps: 6 }); await page.mouse.up(); await sleep(150); };
const A = () => page.evaluate(() => filecairn.info().pages[0].annotations);
// Rectangle: select by clicking its edge, then drag the top-right handle (200, 700) out to (260, 760).
await page.mouse.click(...await at(150, 600)); await sleep(100);
await drag(200, 700, 260, 760);
let a = await A();
check("rectangle corner handle resizes it", JSON.stringify(a[0].rect.map(Math.round)) === "[100,600,260,760]", a[0].rect);
// Arrow: select, drag its tip.
await page.mouse.click(...await at(350, 650)); await sleep(100);
await drag(400, 700, 450, 720);
a = await A();
check("arrow end handle moves the tip", Math.round(a[1].to[0]) === 450 && Math.round(a[1].to[1]) === 720 && a[1].from[0] === 300, a[1]);
// Pen drawing: bbox corners (100,300)-(200,350); drag (200,350) to (300,400) = twice as big.
await page.mouse.click(...await at(150, 345)); await sleep(100);
await drag(200, 350, 300, 400);
a = await A();
check("pen drawing stretches from the opposite corner", a[2].paths[0].map(Math.round).join() === "100,300,200,400,300,300", a[2].paths[0]);
// Text: select, drag the bottom-right handle twice as far from the top-left -> double size.
await page.mouse.click(...await at(345, 392)); await sleep(100);
const h = await page.evaluate(async () => { const { handles } = await import("./js/annots.js"); return handles(filecairn.info().pages[0].annotations[3])[0]; });
await drag(h[0], h[1], 300 + (h[0] - 300) * 2, 400 + (h[1] - 400) * 2);
a = await A();
check("text corner handle scales the font size", Math.abs(a[3].size - 28) <= 1, a[3].size);
await page.screenshot({ path: new URL("./shots/RZ1-resized.png", import.meta.url).pathname });
check("history names the resizes", (await page.evaluate(() => [...document.querySelectorAll(".history .hlabel")].map((e) => e.textContent).slice(-4).join(", "))) === "Resize rectangle, Resize arrow, Resize pen, Resize text box", await page.evaluate(() => [...document.querySelectorAll(".history .hlabel")].map((e) => e.textContent).slice(-4)));
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(100);
check("undo restores the size", (await A())[3].size === 14, (await A())[3].size);
check("no page errors", !errors.length, errors);
await browser.close(); console.log(failed ? `${failed} failed` : "all passed"); process.exit(failed ? 1 : 0);
