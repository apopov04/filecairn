// Browser test of the page organiser. Usage:
//   node tests/serve.mjs &   (or PORT=…)
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/smoke.mjs
// Screenshots go to tests/e2e/shots/. Exits non-zero on failure.
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
const shot = (n) => page.screenshot({ path: `${shots}${W < 700 ? "m-" : ""}${n}.png` });
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const info = () => page.evaluate(() => window.filecairn.info());
const pdfPages = async (as) => (await PDFDocument.load(Buffer.from(as.split(",")[1], "base64"))).getPages();

await shot("01-welcome");
const b64 = fs.readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)).toString("base64");
// Open the same file twice = merge.
let i = await page.evaluate(async (s) => { const u = `data:application/pdf;base64,${s}`; await filecairn.open(u); return filecairn.open(u); }, b64);
check("merge two files -> 10 pages", i.pageCount === 10, i.pageCount);
await page.waitForFunction(() => document.querySelectorAll(".card .page canvas").length >= 6, { timeout: 20000 });
await shot("02-opened");
check("rotated source page reports its size", i.pages[4].width === 595 && i.pages[2].width === 842, i.pages.slice(2, 5));

// Click page 2, Shift+click page 4 -> 3 selected.
const center = (n) => page.evaluate((n) => { const r = document.querySelectorAll(".card")[n - 1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, n);
await page.mouse.click(...await center(2));
await page.keyboard.down("Shift"); await page.mouse.click(...await center(4)); await page.keyboard.up("Shift");
check("click + shift-click selects a range", JSON.stringify((await info()).selected) === "[2,3,4]", (await info()).selected);

// Rotate right with R, then undo.
await page.keyboard.press("r");
check("R rotates the selection", (await info()).pages[1].rotation === 90, (await info()).pages[1].rotation);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
check("Ctrl+Z undoes", (await info()).pages[1].rotation === 0, (await info()).pages[1].rotation);

// Drag page 1 to after page 3.
const idsNow = () => page.evaluate(() => [...document.querySelectorAll(".card")].map((c) => c.dataset.id));
const before = await idsNow();
await page.mouse.click(...await center(1));
const a = await center(1), b = await page.evaluate(() => { const r = document.querySelectorAll(".card")[2].getBoundingClientRect(); return [r.right - 8, r.y + r.height / 2]; });
await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(a[0] + 20, a[1], { steps: 3 }); await page.mouse.move(...b, { steps: 10 });
await shot("03-dragging");
await page.mouse.up();
i = await info();
const after = await idsNow();
check("drag moves page 1 after page 3", after.slice(0, 4).join() === [before[1], before[2], before[0], before[3]].join(), { before: before.slice(0, 4), after: after.slice(0, 4) });
const order = await page.evaluate(async () => { const d = await filecairn.exportPdf({ as: "dataurl", pages: [1, 2, 3] }); return d; });
check("exported first 3 pages are 3 pages", (await pdfPages(order)).length === 3, null);

// Delete via toolbar, blank page, duplicate.
await page.mouse.click(...await center(10));
await page.keyboard.press("Delete");
check("Delete removes the selected page", (await info()).pageCount === 9, (await info()).pageCount);
await page.evaluate(() => [...document.querySelectorAll("#actions button")].find((b) => b.dataset.key === "blank").click());
i = await info();
check("blank page inserted after selection", i.pageCount === 10 && i.pages[9].blank, i.pages[9]);
await shot("04-edited");

// Full export: rotation applied, metadata not carried over.
const full = await page.evaluate(() => filecairn.exportPdf({ as: "dataurl" }));
const doc = await PDFDocument.load(Buffer.from(full.split(",")[1], "base64"));
check("export has 10 pages", doc.getPageCount() === 10, doc.getPageCount());
check("source author not carried over", !doc.getAuthor(), doc.getAuthor());
const rots = doc.getPages().map((pg) => pg.getRotation().angle);
check("pre-rotated pages keep their rotation", rots.includes(90) && rots.every((r) => r === 0 || r === 90), rots);

// Split dialog: every 4 pages -> zip download.
const dl = "/tmp/fc-dl"; fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
const cdp = await page.createCDPSession(); await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
await page.evaluate(() => [...document.querySelectorAll("#actions button")].find((b) => b.dataset.key === "split").click());
await page.evaluate(() => { document.querySelector("#split-every").value = "4"; });
await shot("05-split");
await page.click("#split-go");
await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("split.zip"), { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 800));
const files = fs.readdirSync(dl);
check("split downloads a zip", files.some((f) => f.endsWith("-split.zip")), files);
if (files[0]) { const z = fs.readFileSync(`${dl}/${files[0]}`); check("zip has 3 PDFs (4+4+2)", (z.toString("latin1").match(/\.pdfPK/g) || []).length >= 1 && (z.toString("latin1").split("PK\x01\x02").length - 1) === 3, null); }

check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
