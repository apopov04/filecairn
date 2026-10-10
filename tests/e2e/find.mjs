// Browser test for Ctrl+F find in document: open from the page grid, type,
// step through matches across pages, check tool keys don't fire, Esc closes.
//   CHROME=/path/to/chrome URL=http://localhost:8090/ node tests/e2e/find.mjs
import puppeteer from "puppeteer-core";
import fs from "fs";

const URL_ = process.env.URL || "http://localhost:8090/";
const shots = new URL("./shots/", import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL_, { waitUntil: "networkidle0" });
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bar = () => page.evaluate(() => ({ open: !document.querySelector(".rfind").hidden, count: document.querySelector(".fcount").textContent, page: document.querySelector(".rpage").textContent, tool: document.querySelector(".rrail .tool[aria-pressed=true]")?.dataset.tool, focused: document.activeElement?.className }));

const b64 = fs.readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)).toString("base64");
await page.evaluate((s) => filecairn.open(`data:application/pdf;base64,${s}`), b64);
await page.waitForFunction(() => document.querySelectorAll(".card .page canvas").length >= 5, { timeout: 20000 });

// Ctrl+F from the grid opens the editor with the find bar focused.
await page.keyboard.down("Control"); await page.keyboard.press("f"); await page.keyboard.up("Control");
await page.waitForSelector(".rfind:not([hidden])", { timeout: 5000 });
let b = await bar();
check("Ctrl+F opens the editor with the find bar focused", b.open && b.focused.includes("finput"), b);
const tool0 = b.tool;

await page.keyboard.type("john smith"); await sleep(600);
b = await bar();
check("typing finds John Smith on page 4 and jumps there", b.count === "1 of 1" && b.page.startsWith("Page 4"), b);
check("letters typed in the box don't switch tools", b.tool === tool0, b);
const lit = await page.evaluate(() => { const c = document.querySelectorAll(".rpagebox canvas.rover")[1], d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
check("the match is highlighted on the page", lit > 50, lit);
await page.screenshot({ path: `${shots}find-1.png` });

// A word on several pages: Enter / Shift+Enter step through and switch pages.
await page.click(".finput", { count: 3 }); await page.keyboard.type("page"); await sleep(600);
let st;
b = await bar();
const total = +b.count.split(" of ")[1], start = +b.count.split(" of ")[0];
check("search starts from the current page (page 4)", b.page.startsWith("Page 4"), b);
check("common word has several matches", total >= 2, b);
const pages = new Set([b.page]);
for (let i = 0; i < total; i++) { await page.keyboard.press("Enter"); await sleep(250); pages.add((await bar()).page); }
b = await bar();
check("Enter cycles through every match and wraps", b.count === `${start} of ${total}`, b);
check("matches on more than one page are visited", pages.size >= 2, [...pages]);
await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift"); await sleep(250);
b = await bar();
check("Shift+Enter goes back", b.count === `${start === 1 ? total : start - 1} of ${total}`, b);

await page.click(".finput", { count: 3 }); await page.keyboard.type("zzqqxx"); await sleep(600);
check("no matches is reported", (await bar()).count === "No matches", await bar());

// API.
st = await page.evaluate(() => filecairn.find("john smith"));
check("filecairn.find() returns the match", st.count === 1 && st.current === 1 && st.page === 4, st);

// Esc closes the find bar but keeps the editor open.
await page.focus(".finput"); await page.keyboard.press("Escape"); await sleep(150);
b = await bar();
check("Esc closes the find bar, editor stays", !b.open && (await page.evaluate(() => filecairn.info() && !document.querySelector(".rview").hidden)), b);
check("no page errors", !errors.length, errors);
await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
