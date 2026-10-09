// Page editor: one page shown large with a tool strip. Annotate (highlight,
// underline, strike, pen, shapes, text boxes, sticky notes) and redact.
// Annotations live on page.annots and redaction marks on page.marks, both in
// PDF user space; everything is undoable through commit().

import * as P from "./pages.js";
import { renderPage, textItems, rectToViewport, toUserSpace } from "./engine.js";
import { PRESETS, textQuery, findOnPage, normRect } from "./redact.js";
import { COLORS, drawAnnots, hit, translate, textRects, cssFont } from "./annots.js";
import { ph } from "./icons.js";

const TOOLS = [
  { id: "select", icon: "cursor", label: "Select & move", key: "v", hint: "Click an annotation or redaction box to select it; drag to move it. Double-click text or a note to edit. Delete removes." },
  { id: "highlight", icon: "highlighter", label: "Highlight", key: "h", hint: "Drag over text to highlight it. Over pictures or scans, the dragged area is highlighted." },
  { id: "underline", icon: "text-underline", label: "Underline", key: "u", hint: "Drag over text to underline it." },
  { id: "strike", icon: "text-strikethrough", label: "Strikethrough", key: "s", hint: "Drag over text to strike it through." },
  { id: "ink", icon: "pencil-simple", label: "Pen", key: "p", hint: "Draw freehand." },
  { id: "rect", icon: "rectangle", label: "Rectangle", key: "r", hint: "Drag to draw a rectangle." },
  { id: "ellipse", icon: "circle", label: "Ellipse", key: "o", hint: "Drag to draw an ellipse." },
  { id: "line", icon: "line-segment", label: "Line", key: "l", hint: "Drag to draw a line." },
  { id: "arrow", icon: "arrow-up-right", label: "Arrow", key: "a", hint: "Drag to draw an arrow." },
  { id: "text", icon: "text-t", label: "Text box", key: "t", hint: "Click where the text should start, then type. Click elsewhere or press Esc when done." },
  { id: "note", icon: "chat-centered-text", label: "Sticky note", key: "n", hint: "Click to place a note and type your comment. It's saved as a real PDF comment." },
  { id: "redact", icon: "eye-slash", label: "Redact", key: "x", hint: "Drag on the page to black out an area for good, or search below." },
];
const MARKUP = new Set(["highlight", "underline", "strike"]);

export function createPageView(ctx) {
  const { S, commit, toast, root } = ctx;
  const saved = JSON.parse(localStorage.getItem("fc-tools") || "{}");
  const opt = {
    tool: saved.tool || "highlight",
    color: { highlight: "#ffd400", underline: "#d93f3f", strike: "#d93f3f", ink: "#d93f3f", rect: "#d93f3f", ellipse: "#d93f3f", line: "#d93f3f", arrow: "#d93f3f", text: "#1d1d1f", note: "#ffd400", ...saved.color },
    width: saved.width || 2, size: saved.size || 14,
    font: saved.font || "sans", bold: !!saved.bold, italic: !!saved.italic,
  };
  const save = () => localStorage.setItem("fc-tools", JSON.stringify(opt));
  let id = null, base = null, over = null, sel = null, drag = null, editor = null, renderToken = 0;
  let zoom = 1, anchor = null; // zoom relative to "fit"; anchor keeps a point under the cursor
  let live = null; // { i, a }: an annotation being restyled (slider/picker drag), not yet committed
  // sel: { kind: "annot" | "mark", i }

  const el = document.createElement("section");
  el.className = "rview"; el.hidden = true; el.setAttribute("aria-label", "Edit page");
  el.innerHTML = `
    <div class="rbar">
      <button data-a="back" title="Back to pages (Esc)">${ph("arrow-left")}<span class="lbl">Pages</span></button>
      <button class="icon" data-a="prev" title="Previous page (←)" aria-label="Previous page">${ph("caret-left")}</button>
      <span class="rpage" aria-live="polite"></span>
      <button class="icon" data-a="next" title="Next page (→)" aria-label="Next page">${ph("caret-right")}</button>
      <span class="zoom"><button class="icon" data-a="zout" title="Zoom out (−)" aria-label="Zoom out">${ph("magnifying-glass-minus")}</button><button class="zlabel" data-a="zfit" title="Fit to screen (0)" aria-label="Fit to screen">100%</button><button class="icon" data-a="zin" title="Zoom in (+)" aria-label="Zoom in">${ph("magnifying-glass-plus")}</button></span>
      <div class="tools" role="toolbar" aria-label="Tools">${TOOLS.map((t) => `<button class="icon tool" data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})" aria-label="${t.label}" aria-pressed="false">${ph(t.icon)}</button>`).join("")}</div>
    </div>
    <div class="rbody">
      <div class="rstage"><div class="rpagebox"></div></div>
      <aside class="rpanel"></aside>
    </div>`;
  root.append(el);
  const $ = (s) => el.querySelector(s);
  const box = $(".rpagebox"), panel = $(".rpanel");

  const page = () => S.pages.find((p) => p.id === id);
  const pos = () => S.pages.findIndex((p) => p.id === id);
  const annots = () => page()?.annots || [];
  const marks = () => page()?.marks || [];

  /* ---------------------------- rendering & mapping --------------------------- */

  async function show() {
    const p = page();
    if (!p) return close();
    const i = pos();
    $(".rpage").textContent = `Page ${i + 1} of ${S.pages.length}`;
    $("[data-a=prev]").disabled = i === 0; $("[data-a=next]").disabled = i === S.pages.length - 1;
    const stage = $(".rstage");
    const key = `${p.src}:${p.index}:${p.rot}:${p.blank ? `b${p.w}x${p.h}` : ""}:${stage.clientWidth}:${stage.clientHeight}:${zoom}`;
    if (!base || base.key !== key) {
      const tok = ++renderToken;
      const own = p.blank ? 0 : S.sources[p.src].pages[p.index].own || 0, turned = P.norm(own + p.rot) % 180;
      const pw = turned ? p.h : p.w, phh = turned ? p.w : p.h;
      const fit0 = Math.max(100, Math.min(stage.clientWidth - 32, ((stage.clientHeight - 32) * pw) / phh));
      // Zoom, capped so the canvas stays a sane size (~6000 device px wide).
      zoom = Math.min(zoom, 6000 / (fit0 * Math.min(2, devicePixelRatio || 1)));
      const fit = fit0 * zoom;
      const c = p.blank ? blankCanvas(p, fit) : await renderPage(S.sources[p.src], p.index, p.rot, fit);
      if (tok !== renderToken) return;
      c.key = key; c.style.width = `${fit}px`; c.className = "rbase";
      base = c;
      over = document.createElement("canvas"); over.className = "rover";
      over.width = c.width; over.height = c.height; over.style.width = c.style.width;
      box.replaceChildren(base, over);
      if (editor) box.append(editor.el);
      $(".zlabel").textContent = `${Math.round(zoom * 100)}%`;
      if (anchor) { // keep the document point under the cursor in place
        const r = box.getBoundingClientRect();
        stage.scrollLeft += r.left + anchor.fx * r.width - anchor.cx; stage.scrollTop += r.top + anchor.fy * r.height - anchor.cy;
        anchor = null;
      }
      if (editor) placeEditor();
    }
    draw();
    renderPanel();
  }

  // A blank page has no pdf.js viewport: make one (y flipped, like pdf.js).
  function blankCanvas(p, fit) {
    const dpr = Math.min(2, devicePixelRatio || 1), r = P.norm(p.rot);
    const turned = r % 180, W = turned ? p.h : p.w, H = turned ? p.w : p.h, k = (fit * dpr) / W;
    const c = document.createElement("canvas"); c.width = Math.ceil(W * k); c.height = Math.ceil(H * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    const t = { 0: [k, 0, 0, -k, 0, p.h * k], 90: [0, k, k, 0, 0, 0], 180: [-k, 0, 0, k, p.w * k, 0], 270: [0, -k, -k, 0, p.h * k, p.w * k] }[r];
    c.viewport = { transform: t };
    return c;
  }

  const scale = () => base.width / parseFloat(base.style.width); // device px per CSS px
  const toUser = (e) => { const r = over.getBoundingClientRect(); return toUserSpace(base.viewport, (e.clientX - r.left) * scale(), (e.clientY - r.top) * scale()); };
  const ptsPerCss = () => scale() / Math.hypot(base.viewport.transform[0], base.viewport.transform[1]);
  const pageRot = () => Math.round((Math.atan2(base.viewport.transform[1], base.viewport.transform[0]) * 180) / Math.PI + 360) % 360;

  function draw() {
    if (!over) return;
    const g = over.getContext("2d");
    g.clearRect(0, 0, over.width, over.height);
    let list = annots();
    if (live) list = list.map((a, i) => (i === live.i ? live.a : a));
    if (drag?.preview) list = drag.replace != null ? list.map((a, i) => (i === drag.replace ? drag.preview : a)) : [...list, drag.preview];
    // Redaction marks: dark with a red outline while editing (solid black once saved).
    const vp = base.viewport;
    marks().forEach((m, i) => {
      let r = m;
      if (drag?.markMove && i === drag.markMove.i) r = drag.markMove.r;
      const [x, y, w, h] = rectToViewport(vp, r);
      g.fillStyle = "rgba(0,0,0,.82)"; g.fillRect(x, y, w, h);
      g.strokeStyle = "#ff2d55"; g.lineWidth = sel?.kind === "mark" && sel.i === i ? 3 : 1.5; g.strokeRect(x, y, w, h);
    });
    if (drag?.markRect) { const [x, y, w, h] = rectToViewport(vp, drag.markRect); g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(x, y, w, h); g.strokeStyle = "#ff2d55"; g.setLineDash([6, 4]); g.strokeRect(x, y, w, h); g.setLineDash([]); }
    if (drag?.selRect) { const [x, y, w, h] = rectToViewport(vp, drag.selRect); g.strokeStyle = "#0F5468"; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeRect(x, y, w, h); g.setLineDash([]); }
    drawAnnots(g, vp, list.filter((a) => !(editor && a === editor.annot)), sel?.kind === "annot" ? sel.i : -1);
  }

  /* ---------------------------------- panel --------------------------------- */

  // The panel edits the selected annotation if there is one, else the tool's defaults.
  const target = () => (sel?.kind === "annot" ? annots()[sel.i] : null);
  const kind = () => target()?.type || opt.tool;
  const val = (k) => { const t = target(); return t && t[k] != null ? t[k] : k === "color" ? opt.color[kind()] : opt[k]; };
  const slider = (prop, label, min, max, step, unit) => `<label class="sl"><span class="sl-top"><span>${label}</span><span class="num"><input type="number" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${val(prop)}" inputmode="decimal" aria-label="${label}">${unit}</span></span><input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${val(prop)}" aria-label="${label}"></label>`;

  function renderPanel() {
    const t = TOOLS.find((x) => x.id === opt.tool), k = kind(), tgt = target();
    el.querySelectorAll(".tool").forEach((b) => { const on = b.dataset.tool === opt.tool; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    box.dataset.tool = opt.tool;
    const kt = TOOLS.find((x) => x.id === k);
    const parts = [tgt ? `<h2>Selected ${kt.label.toLowerCase()}</h2><p class="hint">Changes below apply to it. Drag to move, Delete removes${["text", "note"].includes(k) ? ", double-click to edit the text" : ""}.</p>` : `<h2>${t.label}</h2><p class="hint">${t.hint}</p>`];
    if (k !== "select" && k !== "redact") {
      const colors = k === "highlight" ? COLORS.highlight : k === "note" ? COLORS.note : COLORS.ink, cur = val("color");
      parts.push(`<div class="swatches" role="radiogroup" aria-label="Color">${colors.map((c) => `<button class="sw${cur === c ? " on" : ""}" role="radio" aria-checked="${cur === c}" aria-label="Color ${c}" data-color="${c}" style="background:${c}"></button>`).join("")}<label class="sw custom${colors.includes(cur) ? "" : " on"}" title="Custom color" style="--c:${cur}"><input type="color" data-prop="color" value="${cur}" aria-label="Custom color"></label></div>`);
    }
    if (["ink", "rect", "ellipse", "line", "arrow"].includes(k)) parts.push(slider("width", "Line width", 0.5, 20, 0.5, "pt"));
    if (k === "text") {
      parts.push(slider("size", "Text size", 6, 96, 1, "pt"));
      parts.push(`<div class="seg" role="radiogroup" aria-label="Font">${[["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]].map(([f, l]) => `<button role="radio" aria-checked="${val("font") === f}" class="${val("font") === f ? "on" : ""}" data-font="${f}" style="font-family:${f === "serif" ? "Times New Roman, serif" : f === "mono" ? "Courier New, monospace" : "inherit"}">${l}</button>`).join("")}</div>`);
      parts.push(`<div class="seg"><button aria-pressed="${!!val("bold")}" class="${val("bold") ? "on" : ""}" data-toggle="bold"><b>Bold</b></button><button aria-pressed="${!!val("italic")}" class="${val("italic") ? "on" : ""}" data-toggle="italic"><i>Italic</i></button></div>`);
    }
    const n = annots().length;
    if (opt.tool !== "redact") {
      parts.push(`<div class="rcount">${n ? `${n} annotation${n === 1 ? "" : "s"} on this page` : "No annotations on this page yet."}</div>`);
      parts.push(`<div class="row wrap">${sel ? '<button data-a="delsel" class="danger">Delete selected</button>' : ""}${n ? '<button data-a="clearannots">Clear page annotations</button>' : ""}</div>`);
      parts.push(`<p class="note">When you save, highlights, drawings, shapes and text are added to the page so they look the same in every PDF viewer. Highlights on text go underneath it, so the text keeps its color. Sticky notes become comments you can open in Acrobat, Preview and others.</p>`);
    } else parts.push(redactPanel());
    panel.innerHTML = parts.join("");
    const q = panel.querySelector("#r-q"); if (q && lastQuery) q.value = lastQuery;
    const dpi = panel.querySelector("#r-dpi"); if (dpi) dpi.value = String(S.dpi);
  }

  // Apply a style change: to the selected annotation (live while dragging, committed on change) and to the defaults.
  function setProp(prop, value, final) {
    const k = kind();
    if (prop === "color") opt.color[k] = value; else opt[prop] = value;
    save();
    const t = target();
    if (t) {
      const a = { ...t, [prop]: value };
      if (final) { live = null; const list = annots().slice(); list[sel.i] = a; setAnnots(list, prop === "color" ? "recolor" : "restyle"); }
      else { live = { i: sel.i, a }; draw(); }
    }
    if (editor && editor.annot.type === "text") { editor.annot = { ...editor.annot, [prop]: value }; styleEditor(); }
  }

  let lastQuery = "", found = null;
  function redactPanel() {
    const total = S.pages.reduce((n, q) => n + (q.marks?.length || 0), 0), pagesWith = S.pages.filter((q) => q.marks?.length).length;
    return `<form class="rsearch">
        <label for="r-q">Find text to black out</label>
        <div class="row"><input id="r-q" type="search" placeholder="Name, number, word…" autocomplete="off"><button class="icon" aria-label="Search" title="Search">${ph("magnifying-glass")}</button></div>
        <div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button type="button" class="chip" data-preset="${k}">${v.label}</button>`).join("")}</div>
      </form>
      <div class="rfound" hidden></div>
      <div class="rcount">${total ? `${marks().length} on this page · ${total} in total on ${pagesWith} page${pagesWith === 1 ? "" : "s"}` : "No marks yet."}</div>
      <div class="row wrap">${sel?.kind === "mark" ? '<button data-a="delsel" class="danger">Delete selected</button>' : ""}<button data-a="clearpage">Clear this page</button><button data-a="clearall" class="danger">Clear all marks</button></div>
      <label class="rq">Quality of redacted pages
        <select id="r-dpi"><option value="150">Standard (150 dpi)</option><option value="200">High (200 dpi)</option><option value="300">Print (300 dpi)</option></select></label>
      <p class="note">When you save, pages with marks are turned into images with the boxes burned in, so nothing underneath can be recovered: not the text, not images, not links. Text on those pages can't be selected or searched afterwards. Other pages are left as they are.</p>`;
  }

  async function search(re, label) {
    const res = panel.querySelector(".rfound"); res.hidden = false; res.textContent = "Searching…";
    const byId = new Map(); let n = 0, withText = 0;
    for (const p of S.pages) {
      if (p.blank) continue;
      const items = await textItems(S.sources[p.src], p.index);
      if (items.some((it) => it.str.trim())) withText++;
      const m = findOnPage(items, re);
      if (m.length) { byId.set(p.id, m.flatMap((x) => x.boxes)); n += m.length; }
    }
    found = byId;
    if (!withText) { res.textContent = "No selectable text in this document (it may be scanned). Mark areas by dragging instead."; return; }
    if (!n) { res.textContent = `No matches for ${label}.`; return; }
    res.innerHTML = `<p><b>${n}</b> match${n === 1 ? "" : "es"} for ${label} on ${byId.size} page${byId.size === 1 ? "" : "s"}.</p>`;
    const btn = document.createElement("button"); btn.className = "primary"; btn.textContent = `Mark all ${n}`;
    btn.onclick = () => { commit(P.addMarks(S.pages, found), `mark ${n} match${n === 1 ? "" : "es"}`); toast(`Marked ${n} match${n === 1 ? "" : "es"}. They're blacked out when you save.`); };
    res.append(btn);
  }

  panel.addEventListener("submit", (e) => { e.preventDefault(); const q = panel.querySelector("#r-q").value; lastQuery = q; const re = textQuery(q); if (re) search(re, `“${q.trim()}”`); });
  panel.addEventListener("change", (e) => { if (e.target.id === "r-dpi") { S.dpi = +e.target.value; localStorage.setItem("fc-dpi", S.dpi); } });
  panel.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.preset) return search(PRESETS[t.dataset.preset].re, PRESETS[t.dataset.preset].label.toLowerCase());
    if (t.dataset.color) { setProp("color", t.dataset.color, true); return renderPanel(); }
    if (t.dataset.font) { setProp("font", t.dataset.font, true); return renderPanel(); }
    if (t.dataset.toggle) { setProp(t.dataset.toggle, !val(t.dataset.toggle), true); return renderPanel(); }
  });
  // Sliders, number fields and the color picker: live on input, committed on change.
  const num = (inp) => { const v = +inp.value; return Math.min(+inp.max, Math.max(+inp.min, Number.isFinite(v) ? v : +inp.min)); };
  panel.addEventListener("input", (e) => {
    const p = e.target.dataset.prop; if (!p) return;
    const v = p === "color" ? e.target.value : num(e.target);
    panel.querySelectorAll(`[data-prop="${p}"]`).forEach((x) => { if (x !== e.target) x.value = v; });
    if (p === "color") e.target.closest(".custom")?.style.setProperty("--c", v);
    if (e.target.type !== "number" || e.target.value !== "") setProp(p, v, false);
  });
  panel.addEventListener("change", (e) => {
    const p = e.target.dataset.prop; if (!p) return;
    const v = p === "color" ? e.target.value : num(e.target);
    e.target.value = v;
    setProp(p, v, true); renderPanel();
  });

  /* --------------------------------- editing -------------------------------- */

  const setAnnots = (list, label) => commit(P.setAnnots(S.pages, id, list), label);
  const addAnnot = (a, label) => { setAnnots([...annots(), a], label); sel = { kind: "annot", i: annots().length - 1 }; draw(); renderPanel(); };
  function removeSelected() {
    if (!sel) return false;
    if (sel.kind === "annot") setAnnots(annots().filter((_, i) => i !== sel.i), "delete annotation");
    else commit(P.setMarks(S.pages, id, marks().filter((_, i) => i !== sel.i)), "remove mark");
    sel = null; draw(); renderPanel(); return true;
  }

  box.addEventListener("pointerdown", async (e) => {
    if (!base || e.button !== 0 || e.target.closest(".tbox")) return;
    if (editor) { finishEditor(); return; }
    const [x, y] = toUser(e), tool = opt.tool, color = opt.color[tool];
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (tool === "select") {
      const i = hit(annots(), x, y, 6 * ptsPerCss());
      if (i >= 0) { sel = { kind: "annot", i }; drag = { mode: "move", x, y, orig: annots()[i], replace: i }; }
      else {
        const m = marks().findIndex((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
        if (m >= 0) { sel = { kind: "mark", i: m }; drag = { mode: "movemark", x, y, orig: marks()[m] }; } else sel = null;
      }
      draw(); renderPanel(); return;
    }
    sel = null;
    if (tool === "text") {
      // Clicking an existing text box edits it; elsewhere starts a new one.
      const i = hit(annots(), x, y, 4 * ptsPerCss());
      if (i >= 0 && annots()[i].type === "text") { sel = { kind: "annot", i }; openEditor(annots()[i], false, i); renderPanel(); return; }
      openEditor({ type: "text", color, size: opt.size, font: opt.font, bold: opt.bold, italic: opt.italic, x, y, text: "", rot: pageRot() }, true); return;
    }
    if (tool === "note") { openEditor({ type: "note", color, x, y, text: "" }, true); return; }
    drag = { mode: tool, x, y, pts: [x, y] };
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = toUser(e), c = opt.color[drag.mode], w = opt.width;
    switch (drag.mode) {
      case "move": drag.preview = translate(drag.orig, x - drag.x, y - drag.y); break;
      case "movemark": { const dx = x - drag.x, dy = y - drag.y, r = drag.orig; drag.markMove = { i: sel.i, r: [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy] }; break; }
      case "ink": { const p = drag.pts, lx = p[p.length - 2], ly = p[p.length - 1]; if (Math.hypot(x - lx, y - ly) > 0.8 * ptsPerCss()) p.push(x, y); drag.preview = { type: "ink", color: c, width: w, paths: [p.slice()] }; break; }
      case "rect": case "ellipse": drag.preview = { type: drag.mode, color: c, width: w, rect: normRect([drag.x, drag.y, x, y]) }; break;
      case "line": case "arrow": drag.preview = { type: drag.mode, color: c, width: w, from: [drag.x, drag.y], to: [x, y] }; break;
      case "redact": drag.markRect = normRect([drag.x, drag.y, x, y]); break;
      default: if (MARKUP.has(drag.mode)) drag.selRect = normRect([drag.x, drag.y, x, y]);
    }
    draw();
  });
  box.addEventListener("pointerup", async () => {
    const d = drag; drag = null;
    if (!d) return;
    const small = (r) => Math.abs(r[2] - r[0]) < 2 * ptsPerCss() || Math.abs(r[3] - r[1]) < 2 * ptsPerCss();
    if (d.mode === "move") { if (d.preview) { const list = annots().slice(); list[d.replace] = d.preview; setAnnots(list, "move annotation"); } }
    else if (d.mode === "movemark") { if (d.markMove) { const list = marks().slice(); list[d.markMove.i] = d.markMove.r; commit(P.setMarks(S.pages, id, list), "move mark"); } }
    else if (d.mode === "redact") { if (d.markRect && !small(d.markRect)) { commit(P.setMarks(S.pages, id, [...marks(), d.markRect]), "mark area"); sel = { kind: "mark", i: marks().length - 1 }; } }
    else if (d.mode === "ink") addAnnot({ type: "ink", color: opt.color.ink, width: opt.width, paths: [d.pts] }, "draw");
    else if (d.preview) { const r = d.preview.rect || [...d.preview.from, ...d.preview.to]; if (!small(normRect(r)) || d.preview.from) addAnnot(d.preview, `draw ${d.mode}`); }
    else if (MARKUP.has(d.mode) && d.selRect) {
      const p = page();
      let rects = p.blank ? [] : textRects(await textItems(S.sources[p.src], p.index), d.selRect);
      if (!rects.length) {
        if (d.mode !== "highlight") { toast("No text there to " + (d.mode === "strike" ? "strike through." : "underline.")); draw(); return; }
        if (small(d.selRect)) { draw(); return; }
        rects = [d.selRect]; // area highlight (pictures, scans)
      }
      addAnnot({ type: d.mode, color: opt.color[d.mode], rects, ...(rects[0] !== d.selRect && { onText: true }) }, d.mode);
    }
    draw(); renderPanel();
  });
  box.addEventListener("dblclick", (e) => {
    if (!base || opt.tool !== "select") return;
    const [x, y] = toUser(e), i = hit(annots(), x, y, 6 * ptsPerCss());
    if (i >= 0 && ["text", "note"].includes(annots()[i].type)) openEditor(annots()[i], false, i);
  });

  // Inline editor for text boxes and sticky notes.
  function openEditor(annot, isNew, index = -1) {
    finishEditor();
    const wrap = document.createElement("div"); wrap.className = `tbox ${annot.type}`;
    const ta = document.createElement("textarea"); ta.value = annot.text || ""; ta.setAttribute("aria-label", annot.type === "note" ? "Note text" : "Text");
    ta.placeholder = annot.type === "note" ? "Write a comment…" : "Type here";
    const grow = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; ta.style.width = "auto"; ta.style.width = `${Math.max(120, Math.min(900, ta.scrollWidth + 8))}px`; };
    ta.addEventListener("input", grow);
    ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); finishEditor(); } });
    wrap.append(ta); box.append(wrap);
    editor = { el: wrap, ta, annot, isNew, index, grow };
    placeEditor(); styleEditor();
    draw();
    requestAnimationFrame(() => { grow(); ta.focus(); });
    ta.addEventListener("blur", () => setTimeout(() => { if (editor?.ta === ta) finishEditor(); }, 0));
  }
  function placeEditor() {
    const a = editor.annot, [x, y] = rectToViewport(base.viewport, [a.x, a.y, a.x, a.y]).map((v) => v / scale());
    editor.el.style.left = `${x}px`; editor.el.style.top = `${y}px`;
    if (a.type === "text") editor.el.style.transform = `rotate(${pageRot() - (a.rot || 0)}deg)`;
    styleEditor();
  }
  function styleEditor() {
    const a = editor.annot, ta = editor.ta;
    if (a.type === "text") { ta.style.font = cssFont(a, a.size / ptsPerCss()); ta.style.lineHeight = "1.2"; ta.style.color = a.color; }
    else editor.el.style.setProperty("--note", a.color);
    editor.grow();
  }
  function finishEditor() {
    const ed = editor; if (!ed) return;
    editor = null; ed.el.remove();
    const text = ed.ta.value.replace(/\s+$/, "");
    if (ed.isNew) { if (text) addAnnot({ ...ed.annot, text }, ed.annot.type === "note" ? "add note" : "add text"); }
    else {
      const list = annots().slice();
      if (!text) list.splice(ed.index, 1); else list[ed.index] = { ...ed.annot, text };
      if (text !== ed.annot.text) setAnnots(list, "edit text");
    }
    draw(); renderPanel();
  }

  /* --------------------------------- chrome --------------------------------- */

  const go = (dlt) => { const i = pos() + dlt; if (S.pages[i]) { finishEditor(); id = S.pages[i].id; sel = null; base = null; show(); } };
  const setTool = (t) => { finishEditor(); opt.tool = t; sel = null; save(); draw(); renderPanel(); };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tool) return setTool(b.dataset.tool);
    const a = b.dataset.a;
    if (a === "back") close();
    else if (a === "prev") go(-1);
    else if (a === "next") go(1);
    else if (a === "zin") zoomBy(1.25);
    else if (a === "zout") zoomBy(0.8);
    else if (a === "zfit") zoomBy(0);
    else if (a === "delsel") removeSelected();
    else if (a === "clearannots") { if (annots().length) { setAnnots([], "clear annotations"); sel = null; } }
    else if (a === "clearpage") { if (marks().length) commit(P.setMarks(S.pages, id, []), "clear marks"); }
    else if (a === "clearall") { if (S.pages.some((p) => p.marks)) commit(P.clearMarks(S.pages), "clear all marks"); }
  });
  // Zoom (0 = fit). With a pointer event, the point under the cursor stays put.
  function zoomBy(f, e) {
    const next = f ? Math.max(0.25, Math.min(8, zoom * f)) : 1;
    if (next === zoom) return;
    if (e && base) { const r = box.getBoundingClientRect(); anchor = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, cx: e.clientX, cy: e.clientY }; }
    zoom = next; show();
  }
  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as Ctrl+wheel) zooms.
  $(".rstage").addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.01), e); }, { passive: false });

  // Re-render only when the stage size really changes (show() compares the key).
  new ResizeObserver(() => { if (!el.hidden) show(); }).observe($(".rstage"));

  function open(pageId, tool) { id = pageId ?? S.pages[0]?.id; if (tool) opt.tool = tool; sel = null; base = null; zoom = 1; el.hidden = false; ctx.onToggle(true); show(); }
  function close() { finishEditor(); el.hidden = true; ctx.onToggle(false); }

  return {
    open, close,
    lastMarkup: () => (opt.tool === "redact" ? "highlight" : opt.tool),
    get isOpen() { return !el.hidden; },
    refresh() { if (!el.hidden) { if (sel && (sel.kind === "annot" ? !annots()[sel.i] : !marks()[sel.i])) sel = null; show(); } },
    keydown(e) {
      if (e.target.closest?.("input, select, textarea")) return false;
      if (e.key === "Escape") { if (sel) { sel = null; draw(); renderPanel(); } else close(); return true; }
      if (e.key === "Delete" || e.key === "Backspace") return removeSelected() || true;
      if (e.key === "+" || e.key === "=") { zoomBy(1.25); return true; }
      if (e.key === "-") { zoomBy(0.8); return true; }
      if (e.key === "0") { zoomBy(0); return true; }
      if (e.key === "ArrowLeft") { go(-1); return true; }
      if (e.key === "ArrowRight") { go(1); return true; }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) { setTool(t.id); return true; }
      return false;
    },
  };
}
