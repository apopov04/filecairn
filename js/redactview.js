// Redaction view: one page shown large. Drag to mark areas, or search the
// document's text (or built-in patterns) to mark every match. Marks are
// burned in when the PDF is saved (see engine.js addRedacted).

import * as P from "./pages.js";
import { renderPage, textItems, rectToViewport, toUserSpace } from "./engine.js";
import { PRESETS, textQuery, findOnPage, normRect } from "./redact.js";
import { ph } from "./icons.js";

export function createRedactView(ctx) {
  const { S, commit, toast, root } = ctx;
  let id = null, canvas = null, selMark = -1, drawing = null, found = null, renderToken = 0;

  const el = document.createElement("section");
  el.className = "rview"; el.hidden = true; el.setAttribute("aria-label", "Redact");
  el.innerHTML = `
    <div class="rbar">
      <button data-a="back" title="Back to pages (Esc)">${ph("arrow-left")}<span class="lbl">Pages</span></button>
      <button class="icon" data-a="prev" title="Previous page (←)" aria-label="Previous page">${ph("caret-left")}</button>
      <span class="rpage" aria-live="polite"></span>
      <button class="icon" data-a="next" title="Next page (→)" aria-label="Next page">${ph("caret-right")}</button>
    </div>
    <div class="rbody">
      <div class="rstage"><div class="rpagebox"><div class="rmarks"></div></div></div>
      <aside class="rpanel">
        <h2>Redact</h2>
        <p class="hint">Drag on the page to black out an area. Click a box to select it, Delete removes it.</p>
        <form class="rsearch">
          <label for="r-q">Find text to black out</label>
          <div class="row"><input id="r-q" type="search" placeholder="Name, number, word…" autocomplete="off"><button class="icon" aria-label="Search" title="Search">${ph("magnifying-glass")}</button></div>
          <div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button type="button" class="chip" data-preset="${k}">${v.label}</button>`).join("")}</div>
        </form>
        <div class="rfound" hidden></div>
        <div class="rcount"></div>
        <div class="row wrap"><button data-a="clearpage">Clear this page</button><button data-a="clearall" class="danger">Clear all marks</button></div>
        <label class="rq">Quality of redacted pages
          <select id="r-dpi"><option value="150">Standard (150 dpi)</option><option value="200">High (200 dpi)</option><option value="300">Print (300 dpi)</option></select></label>
        <p class="note">When you save, pages with marks are turned into images with the boxes burned in, so nothing underneath can be recovered: not the text, not images, not links. Text on those pages can't be selected or searched afterwards. Other pages are left as they are.</p>
      </aside>
    </div>`;
  root.append(el);
  const $ = (s) => el.querySelector(s);
  const box = $(".rpagebox"), marksEl = $(".rmarks");
  $("#r-dpi").value = String(S.dpi);
  $("#r-dpi").onchange = (e) => { S.dpi = +e.target.value; localStorage.setItem("fc-dpi", S.dpi); };

  const page = () => S.pages.find((p) => p.id === id);
  const pos = () => S.pages.findIndex((p) => p.id === id);

  async function show() {
    const p = page();
    if (!p) return close();
    const i = pos();
    $(".rpage").textContent = `Page ${i + 1} of ${S.pages.length}`;
    $("[data-a=prev]").disabled = i === 0; $("[data-a=next]").disabled = i === S.pages.length - 1;
    const total = S.pages.reduce((n, q) => n + (q.marks?.length || 0), 0), pagesWith = S.pages.filter((q) => q.marks?.length).length;
    $(".rcount").textContent = total ? `${p.marks?.length || 0} on this page · ${total} in total on ${pagesWith} page${pagesWith === 1 ? "" : "s"}` : "No marks yet.";
    if (p.blank) { box.replaceChildren(marksEl); box.classList.add("blank"); canvas = null; drawMarks(); return; }
    box.classList.remove("blank");
    // Render to fit the stage (width and height); re-render only when the page or size changes.
    const stage = $(".rstage"), key = `${p.src}:${p.index}:${p.rot}:${stage.clientWidth}:${stage.clientHeight}`;
    if (!canvas || canvas.key !== key) {
      const tok = ++renderToken;
      const own = S.sources[p.src].pages[p.index].own || 0, rot = P.norm(own + p.rot) % 180;
      const pw = rot ? p.h : p.w, phh = rot ? p.w : p.h;
      const fit = Math.max(100, Math.min(stage.clientWidth - 32, ((stage.clientHeight - 32) * pw) / phh));
      const c = await renderPage(S.sources[p.src], p.index, p.rot, fit);
      if (tok !== renderToken) return;
      c.key = key; c.style.width = `${fit}px`;
      canvas = c; box.replaceChildren(c, marksEl);
    }
    drawMarks();
  }

  // Map between user space (marks) and CSS pixels on the canvas.
  const scale = () => canvas.width / parseFloat(canvas.style.width);
  const toCss = (m) => rectToViewport(canvas.viewport, m).map((v) => v / scale());
  const toUser = (x, y) => toUserSpace(canvas.viewport, x * scale(), y * scale());

  function drawMarks() {
    const p = page();
    marksEl.replaceChildren();
    if (!canvas || !p) return;
    (p.marks || []).forEach((m, i) => {
      const [x, y, w, h] = toCss(m);
      const d = document.createElement("button");
      d.className = `rmark${i === selMark ? " sel" : ""}`;
      d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      d.setAttribute("aria-label", `Redaction mark ${i + 1}${i === selMark ? ", selected" : ""}`);
      d.onpointerdown = (e) => e.stopPropagation();
      d.onclick = (e) => { e.stopPropagation(); selMark = i; drawMarks(); };
      marksEl.append(d);
    });
    if (drawing?.css) {
      const r = document.createElement("div"); r.className = "rmark drawing";
      const [x, y, w, h] = drawing.css; r.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      marksEl.append(r);
    }
  }

  // Drag to mark.
  box.addEventListener("pointerdown", (e) => {
    if (!canvas || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    drawing = { x: e.clientX - r.left, y: e.clientY - r.top, r };
    selMark = -1;
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const x = Math.max(0, Math.min(drawing.r.width, e.clientX - drawing.r.left)), y = Math.max(0, Math.min(drawing.r.height, e.clientY - drawing.r.top));
    drawing.x2 = x; drawing.y2 = y;
    drawing.css = [Math.min(drawing.x, x), Math.min(drawing.y, y), Math.abs(x - drawing.x), Math.abs(y - drawing.y)];
    drawMarks();
  });
  box.addEventListener("pointerup", () => {
    const d = drawing; drawing = null;
    if (!d?.css || d.css[2] < 3 || d.css[3] < 3) return drawMarks();
    const [x1, y1] = toUser(d.x, d.y), [x2, y2] = toUser(d.x2, d.y2);
    const p = page();
    commit(P.setMarks(S.pages, p.id, [...(p.marks || []), normRect([x1, y1, x2, y2])]), "mark area");
    selMark = (page().marks?.length || 1) - 1;
  });

  function removeSelected() {
    const p = page();
    if (selMark < 0 || !p.marks?.[selMark]) return false;
    commit(P.setMarks(S.pages, p.id, p.marks.filter((_, i) => i !== selMark)), "remove mark");
    selMark = -1; return true;
  }

  // Search the whole document.
  async function search(re, label) {
    const res = $(".rfound"); res.hidden = false; res.textContent = "Searching…";
    const byId = new Map(); let n = 0, withText = 0;
    for (const p of S.pages) {
      if (p.blank) continue;
      const items = await textItems(S.sources[p.src], p.index);
      if (items.some((it) => it.str.trim())) withText++;
      const m = findOnPage(items, re);
      if (m.length) { byId.set(p.id, m.flatMap((x) => x.boxes)); n += m.length; }
    }
    found = byId;
    if (!withText) { res.innerHTML = "No selectable text in this document (it may be scanned). Mark areas by dragging instead."; return; }
    if (!n) { res.textContent = `No matches for ${label}.`; return; }
    const pages = byId.size;
    res.innerHTML = `<p><b>${n}</b> match${n === 1 ? "" : "es"} for ${label} on ${pages} page${pages === 1 ? "" : "s"}.</p>`;
    const btn = document.createElement("button"); btn.className = "primary"; btn.textContent = `Mark all ${n}`;
    btn.onclick = () => { commit(P.addMarks(S.pages, found), `mark ${n} match${n === 1 ? "" : "es"}`); res.hidden = true; toast(`Marked ${n} match${n === 1 ? "" : "es"}. They're blacked out when you save.`); };
    res.append(btn);
  }
  $(".rsearch").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#r-q").value, re = textQuery(q);
    if (re) search(re, `“${q.trim()}”`);
  });
  el.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => search(PRESETS[b.dataset.preset].re, PRESETS[b.dataset.preset].label.toLowerCase())));

  const go = (d) => { const i = pos() + d; if (S.pages[i]) { id = S.pages[i].id; selMark = -1; canvas = null; show(); } };
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "back") close();
    else if (a === "prev") go(-1);
    else if (a === "next") go(1);
    else if (a === "clearpage") { const p = page(); if (p.marks) commit(P.setMarks(S.pages, p.id, []), "clear marks"); }
    else if (a === "clearall") { if (S.pages.some((p) => p.marks)) commit(P.clearMarks(S.pages), "clear all marks"); }
  });
  new ResizeObserver(() => { if (!el.hidden) show(); }).observe($(".rstage"));

  function open(pageId) { id = pageId ?? S.pages[0]?.id; selMark = -1; canvas = null; el.hidden = false; ctx.onToggle(true); show(); }
  function close() { el.hidden = true; ctx.onToggle(false); }

  return {
    open, close,
    get isOpen() { return !el.hidden; },
    refresh() { if (!el.hidden) show(); },
    keydown(e) {
      if (e.target.closest?.("input, select")) return false;
      if (e.key === "Escape") { if (selMark >= 0) { selMark = -1; drawMarks(); } else close(); return true; }
      if (e.key === "Delete" || e.key === "Backspace") return removeSelected() || true;
      if (e.key === "ArrowLeft") { go(-1); return true; }
      if (e.key === "ArrowRight") { go(1); return true; }
      return false;
    },
  };
}
