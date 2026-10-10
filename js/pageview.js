// Page editor: one page shown large with a tool strip. Annotate (highlight,
// underline, strike, pen, shapes, text boxes, sticky notes) and redact.
// Annotations live on page.annots and redaction marks on page.marks, both in
// PDF user space; everything is undoable through commit().

import * as P from "./pages.js";
import { renderPage, textItems, rectToViewport, toUserSpace } from "./engine.js";
import { PRESETS, textQuery, findOnPage, normRect } from "./redact.js";
import { COLORS, drawAnnots, hit, translate, textRects, cssFont, imageCorner, onImageLoad } from "./annots.js";
import { fieldsOf } from "./forms.js";
import { createSignature, savedSigns, saveSign } from "./sign.js";
import { BASIC, library, allFonts, cssFamily, ensureFont, onFontLoad, canUseLocalFonts, addLocalFonts, addUploadedFont, restoreUploads } from "./fonts.js";
import { ph } from "./icons.js";
import { historyPanel, splitter } from "./history.js";

const TOOLS = [
  { id: "select", icon: "cursor", label: "Select & move", key: "v", hint: "Click an annotation or redaction box to select it; drag to move it. Double-click text or a note to edit. Delete removes." },
  { id: "highlight", icon: "highlighter", label: "Highlight", key: "h", hint: "Drag over text to highlight it. Over pictures or scans, the dragged area is highlighted." },
  { id: "underline", icon: "text-underline", label: "Underline", key: "u", hint: "Drag over text to underline it." },
  { id: "strike", icon: "text-strikethrough", label: "Strikethrough", key: "s", hint: "Drag over text to strike it through." },
  { id: "redact", icon: "eye-slash", label: "Redact", key: "x", hint: "Drag on the page to black out an area for good, or search below." },
  { id: "ink", icon: "pencil-simple", label: "Pen", key: "p", hint: "Draw freehand." },
  { id: "rect", icon: "rectangle", label: "Rectangle", key: "r", hint: "Drag to draw a rectangle." },
  { id: "ellipse", icon: "circle", label: "Ellipse", key: "o", hint: "Drag to draw an ellipse." },
  { id: "line", icon: "line-segment", label: "Line", key: "l", hint: "Drag to draw a line." },
  { id: "arrow", icon: "arrow-up-right", label: "Arrow", key: "a", hint: "Drag to draw an arrow." },
  { id: "text", icon: "text-t", label: "Text box", key: "t", hint: "Click where the text should start, then type. Click elsewhere or press Esc when done." },
  { id: "note", icon: "chat-centered-text", label: "Sticky note", key: "n", hint: "Click to place a note and type your comment. It's saved as a real PDF comment." },
  { id: "form", icon: "textbox", label: "Fill form", key: "f", hint: "Click a form field and type, tick boxes and pick options. Tab moves to the next field." },
  { id: "sign", icon: "signature", label: "Sign", key: "g", hint: "Create your signature or initials, then click the page to place it. Drag the corner handle to resize, drag the signature to move it." },
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
  let id = null, base = null, over = null, hl = null, sel = null, drag = null, editor = null, renderToken = 0;
  let zoom = 1, anchor = null; // zoom relative to "fit"; anchor keeps a point under the cursor
  let live = null;
  let placing = null; // Sign tool: { kind: "signature" | "initials" | "date", src, ratio } waiting for a click on the page // { i, a }: an annotation being restyled (slider/picker drag), not yet committed
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
    </div>
    <div class="rbody">
      <nav class="rrail" role="toolbar" aria-label="Tools" aria-orientation="vertical">${TOOLS.map((t, i) => `${i === 1 || i === 5 || i === 10 ? '<span class="rsep"></span>' : ""}<button class="tool" data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})" aria-label="${t.label}" aria-pressed="false">${ph(t.icon)}</button>`).join("")}
        <span class="rsep"></span>
        <button class="cwell" title="Color (click to change)" aria-label="Color" aria-haspopup="dialog" aria-expanded="false"><span></span></button>
      </nav>
      <div class="cpop" role="dialog" aria-label="Choose a color" hidden></div>
      <div class="rstage"><div class="rpagebox"></div></div>
      <aside class="rside" data-tab="tool">
        <div class="rside-tabs" role="tablist" aria-label="Sidebar"><button role="tab" data-tab="tool" aria-selected="true">Tool</button><button role="tab" data-tab="history" aria-selected="false">History</button></div>
        <div class="rpanel"></div>
        <div class="history-dock"></div>
      </aside>
    </div>`;
  root.append(el);
  const $ = (s) => el.querySelector(s);
  const box = $(".rpagebox"), panel = $(".rpanel");
  // History under the tool panel, with a drag handle between them (tabs on phones).
  const hist = historyPanel(ctx.steps, (i) => { finishEditor(); ctx.goTo(i); });
  $(".history-dock").append(hist.el);
  $(".rside").insertBefore(splitter(panel, $(".history-dock")), $(".history-dock"));
  $(".rside-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    $(".rside").dataset.tab = b.dataset.tab;
    $(".rside-tabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  });

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
      // Highlights get their own layer, blended (multiply) with the page under
      // it so text stays visible, like a real highlighter. Everything else is on top.
      const layer = (cls) => { const l = document.createElement("canvas"); l.className = cls; l.width = c.width; l.height = c.height; l.style.width = c.style.width; return l; };
      hl = layer("rover rhl"); over = layer("rover");
      fieldsEl = document.createElement("div"); fieldsEl.className = "rfields";
      box.replaceChildren(base, hl, over, fieldsEl);
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
    hist.render();
    renderFields();
  }

  /* ------------------------------- form fields ------------------------------ */

  // Real inputs over the page's form fields. Active with the Fill form tool;
  // otherwise they just show the answers.
  let fieldsEl = null, fieldsToken = 0;
  async function renderFields() {
    const p = page(); if (!fieldsEl || !p) return;
    const tok = ++fieldsToken, fields = p.blank ? [] : await fieldsOf(S.sources[p.src], p.index);
    if (tok !== fieldsToken || !fieldsEl) return;
    const active = opt.tool === "form", k = scale(), answers = p.fields || {};
    fieldsEl.classList.toggle("active", active);
    if (fieldsEl.contains(document.activeElement)) return; // don't rebuild under the user's typing
    fieldsEl.replaceChildren(...fields.map((f) => {
      const [x, y, w, h] = rectToViewport(base.viewport, f.rect).map((v) => v / k);
      const v = f.name in answers ? answers[f.name] : f.value;
      let inp;
      if (f.kind === "select") {
        inp = document.createElement("select");
        inp.innerHTML = `<option value=""></option>${f.options.map((o) => `<option value="${o.value.replace(/"/g, "&quot;")}">${o.label.replace(/</g, "&lt;")}</option>`).join("")}`;
        inp.value = v || "";
        inp.style.fontSize = `${Math.max(5, Math.min(h * 0.6, 12 / ptsPerCss()))}px`;
      } else if (f.kind === "check" || f.kind === "radio") {
        inp = document.createElement("input"); inp.type = f.kind === "check" ? "checkbox" : "radio";
        if (f.kind === "radio") { inp.name = `fc-${id}-${f.name}`; inp.checked = v === f.on; } else inp.checked = !!v;
      } else {
        inp = document.createElement(f.kind === "multiline" ? "textarea" : "input");
        if (inp.tagName === "INPUT") inp.type = "text";
        inp.value = v ?? ""; if (f.maxLen) inp.maxLength = f.maxLen;
        // Text scales with the page (about 11 pt on paper), so it fits at any zoom.
        const pt = 1 / ptsPerCss();
        inp.style.fontSize = `${Math.max(5, f.kind === "multiline" ? 11 * pt : Math.min(h * 0.62, 12 * pt))}px`;
      }
      inp.className = `ff ff-${f.kind}`;
      inp.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      inp.setAttribute("aria-label", f.name);
      inp.disabled = f.readOnly; inp.tabIndex = active ? 0 : -1;
      const commitVal = () => {
        const val = f.kind === "check" ? inp.checked : f.kind === "radio" ? f.on : inp.value;
        const cur = page().fields || {};
        if (cur[f.name] === val || (!(f.name in cur) && val === f.value)) return;
        commit(P.setFields(S.pages, id, { ...cur, [f.name]: val }), "fill form");
      };
      inp.addEventListener("change", commitVal);
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && inp.tagName === "INPUT") inp.blur(); });
      return inp;
    }));
    if (active && !fields.length && !p.blank) toastOnce("This page has no form fields. Type on the lines with the Text box tool, and sign with Sign.");
  }
  let toasted = new Set();
  const toastOnce = (m) => { if (!toasted.has(m)) { toasted.add(m); toast(m, 4500); } };

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
    const gh = hl.getContext("2d");
    gh.clearRect(0, 0, hl.width, hl.height);
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
    const shown = list.filter((a) => !(editor && a === editor.annot)), isHl = (a) => a.type === "highlight";
    drawAnnots(gh, vp, shown, -1, (a) => !isHl(a));
    drawAnnots(g, vp, shown, sel?.kind === "annot" ? sel.i : -1, isHl);
    // Resize handle on a selected signature.
    const sa = sel?.kind === "annot" ? (live?.i === sel.i ? live.a : drag?.replace === sel.i && drag.preview ? drag.preview : annots()[sel.i]) : null;
    if (sa?.type === "image") {
      const [cx, cy] = imageCorner(sa), [a, b, c, d, e, f] = vp.transform, hx = a * cx + c * cy + e, hy = b * cx + d * cy + f, hs = 7 * scale();
      g.fillStyle = "#fff"; g.strokeStyle = "#0F5468"; g.lineWidth = 2 * scale(); g.fillRect(hx - hs, hy - hs, hs * 2, hs * 2); g.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2);
    }
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
    const kt = TOOLS.find((x) => x.id === k) || { label: k === "image" ? "Signature" : k };
    const parts = [tgt ? `<h2>Selected ${kt.label.toLowerCase()}</h2><p class="hint">Changes below apply to it. Drag to move, Delete removes${["text", "note"].includes(k) ? ", double-click to edit the text" : ""}.</p>` : `<h2>${t.label}</h2><p class="hint">${t.hint}</p>`];
    if (["ink", "rect", "ellipse", "line", "arrow"].includes(k)) parts.push(slider("width", "Line width", 0.5, 20, 0.5, "pt"));
    if (k === "text") {
      parts.push(slider("size", "Text size", 6, 96, 1, "pt"));
      parts.push(`<label class="fontrow"><span>Font</span><button class="fontbtn" data-a="fontpick" aria-haspopup="dialog" style="font-family:${cssFamily(val("font")).replace(/"/g, "'")}">${fontLabel(val("font"))}</button></label>`);
      parts.push(`<div class="seg"><button aria-pressed="${!!val("bold")}" class="${val("bold") ? "on" : ""}" data-toggle="bold"><b>Bold</b></button><button aria-pressed="${!!val("italic")}" class="${val("italic") ? "on" : ""}" data-toggle="italic"><i>Italic</i></button></div>`);
    }
    if (k === "sign" || (k === "image" && opt.tool === "sign")) parts.push(signPanel());
    if (k === "form") parts.push('<p class="note">Your answers are written into the saved PDF and become part of the page, so the form can\'t be changed afterwards.</p>');
    const n = annots().length;
    if (opt.tool !== "redact") {
      parts.push(`<div class="rcount">${n ? `${n} annotation${n === 1 ? "" : "s"} on this page` : "No annotations on this page yet."}</div>`);
      parts.push(`<div class="row wrap">${sel ? '<button data-a="delsel" class="danger">Delete selected</button>' : ""}${n ? '<button data-a="clearannots">Clear page annotations</button>' : ""}</div>`);
      parts.push(`<p class="note">When you save, highlights, drawings, shapes and text are added to the page so they look the same in every PDF viewer. Highlights on text go underneath it, so the text keeps its color. Sticky notes become comments you can open in Acrobat, Preview and others.</p>`);
    } else parts.push(redactPanel());
    panel.innerHTML = parts.join("");
    updateWell();
    const q = panel.querySelector("#r-q"); if (q && lastQuery) q.value = lastQuery;
    const dpi = panel.querySelector("#r-dpi"); if (dpi) dpi.value = String(S.dpi);
  }

  /* ---------------------------------- fonts --------------------------------- */

  // Font picker: built-in basics, the bundled library (grouped), fonts on this
  // computer and uploaded files, with search. Fonts download only when used.
  let fontList = [];
  const refreshFonts = async () => { await restoreUploads(); fontList = await allFonts(); };
  refreshFonts().then(() => renderPanel());
  onFontLoad(() => { draw(); if (editor) styleEditor(); });
  const fontLabel = (id) => (!id || id in BASIC ? BASIC[id || "sans"].name : fontList.find((f) => f.id === id)?.name || String(id).replace(/^(local|upload):/, ""));
  const GROUPS = [["basic", "Built in (no download)"], ["alias", "Like Microsoft & Apple fonts"], ["sans", "Sans serif"], ["serif", "Serif"], ["mono", "Monospace"], ["display", "Display"], ["script", "Handwriting"], ["local", "On this computer"], ["upload", "Uploaded"]];
  const fpop = document.createElement("div"); fpop.className = "fpop"; fpop.hidden = true; fpop.setAttribute("role", "dialog"); fpop.setAttribute("aria-label", "Choose a font");
  el.append(fpop);
  const upInput = Object.assign(document.createElement("input"), { type: "file", accept: ".ttf,.otf,font/ttf,font/otf", multiple: true, hidden: true });
  el.append(upInput);
  function openFonts(anchor) {
    const cur = val("font") || "sans";
    const items = [
      ...Object.entries(BASIC).map(([id, b]) => ({ id, name: b.name, group: "basic" })),
      ...fontList.map((f) => ({ id: f.id, name: f.name, group: f.alias ? "alias" : f.category, alias: f.alias })),
    ];
    const render = (q = "") => {
      const ql = q.trim().toLowerCase();
      const match = (it) => !ql || it.name.toLowerCase().includes(ql) || (it.alias || "").toLowerCase().includes(ql);
      fpop.querySelector(".flist").innerHTML = GROUPS.map(([g, label]) => {
        const list = items.filter((it) => it.group === g && match(it));
        return list.length ? `<div class="fgroup">${label}</div>` + list.map((it) => `<button class="fitem${it.id === cur ? " on" : ""}" data-font-id="${it.id.replace(/"/g, "&quot;")}" ${it.group === "basic" ? `style="font-family:${BASIC[it.id].css.replace(/"/g, "'")}"` : ""}><span>${it.name}</span>${it.alias ? `<small>like ${it.alias}</small>` : ""}</button>`).join("") : "";
      }).join("") || `<p class="hint">No fonts match “${q}”.</p>`;
    };
    fpop.innerHTML = `<input type="search" class="fsearch" placeholder="Search fonts (e.g. Calibri, Garamond)" aria-label="Search fonts"><div class="flist"></div>
      <div class="factions">${canUseLocalFonts() ? '<button data-fa="local">Use fonts on this computer</button>' : ""}<button data-fa="upload">Upload font file…</button></div>`;
    render();
    const r = anchor.getBoundingClientRect(), host = el.getBoundingClientRect();
    const w = 280, left = Math.max(8, Math.min(r.left - host.left, host.width - w - 8));
    const below = r.bottom - host.top + 6, room = host.height - below - 8;
    fpop.style.left = `${left}px`; fpop.style.width = `${w}px`;
    if (room > 260) { fpop.style.top = `${below}px`; fpop.style.bottom = ""; fpop.style.maxHeight = `${room}px`; }
    else { fpop.style.top = ""; fpop.style.bottom = `${host.bottom - r.top + 6}px`; fpop.style.maxHeight = `${r.top - host.top - 14}px`; }
    fpop.hidden = false;
    const qi = fpop.querySelector(".fsearch");
    qi.addEventListener("input", () => render(qi.value));
    qi.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") closeFonts(); });
    qi.focus();
  }
  const closeFonts = () => { fpop.hidden = true; };
  // Hovering a font shows its name in that font (downloads just that one).
  fpop.addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-font-id]"); if (!b || b.dataset.preview) return;
    b.dataset.preview = "1";
    const id = b.dataset.fontId;
    if (!(id in BASIC)) ensureFont(id).then((ok) => { if (ok) b.style.fontFamily = cssFamily(id).replace(/"/g, "'"); });
  });
  fpop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-font-id]");
    if (b) { setProp("font", b.dataset.fontId, true); closeFonts(); renderPanel(); return; }
    const a = e.target.closest("[data-fa]")?.dataset.fa;
    if (a === "local") {
      try { const n = await addLocalFonts(); await refreshFonts(); toast(n ? `Added ${n} font famil${n === 1 ? "y" : "ies"} from this computer.` : "No fonts were shared."); openFonts(panel.querySelector(".fontbtn") || el); }
      catch { toast("The browser didn't allow access to your fonts."); }
    }
    if (a === "upload") upInput.click();
  });
  upInput.addEventListener("change", async () => {
    let last = null, bad = 0;
    for (const f of upInput.files) { try { last = await addUploadedFont(f); } catch { bad++; } }
    upInput.value = "";
    await refreshFonts();
    if (bad) toast(`${bad} file${bad === 1 ? "" : "s"} couldn't be read as a font (use .ttf or .otf).`);
    if (last) { setProp("font", last, true); closeFonts(); renderPanel(); toast("Font added. It's kept in this browser for next time."); }
  });
  document.addEventListener("pointerdown", (e) => { if (!fpop.hidden && !fpop.contains(e.target) && !e.target.closest(".fontbtn")) closeFonts(); }, true);

  // The color well in the left rail: shows the color of the selected annotation
  // (or the current tool) and opens a palette with a custom picker.
  const well = $(".cwell"), pop = $(".cpop");
  const hasColor = () => !["select", "redact", "form", "sign", "image"].includes(kind());
  function updateWell() {
    const on = hasColor();
    well.disabled = !on;
    well.firstElementChild.style.background = on ? val("color") : "transparent";
    well.title = on ? `Color: ${val("color")} (click to change)` : "Pick a drawing tool, or select an annotation, to choose its color";
    if (!on) closePop();
  }
  function openPop() {
    const k = kind(), cur = val("color"), colors = k === "highlight" ? COLORS.highlight : k === "note" ? COLORS.note : COLORS.ink;
    pop.innerHTML = `<div class="swatches">${colors.map((c) => `<button class="sw${cur === c ? " on" : ""}" aria-label="Color ${c}" aria-pressed="${cur === c}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>
      <label class="custom-row"><input type="color" value="${cur}" aria-label="Custom color"> Custom color</label>`;
    const r = well.getBoundingClientRect(), host = el.getBoundingClientRect();
    // Beside the rail on desktop; below the button when the rail is a top strip (phones).
    const side = r.right - host.left + 8 + 196 <= host.width;
    pop.style.left = `${side ? r.right - host.left + 8 : Math.max(8, Math.min(r.left - host.left, host.width - 204))}px`;
    pop.style.top = `${side ? Math.max(8, r.bottom - host.top - 120) : r.bottom - host.top + 6}px`;
    pop.hidden = false; well.setAttribute("aria-expanded", "true");
    pop.querySelector(".sw.on, .sw")?.focus();
  }
  function closePop() { if (pop.hidden) return; pop.hidden = true; well.setAttribute("aria-expanded", "false"); }
  well.addEventListener("click", () => (pop.hidden ? openPop() : closePop()));
  pop.addEventListener("click", (e) => { const b = e.target.closest("[data-color]"); if (b) { setProp("color", b.dataset.color, true); closePop(); renderPanel(); } });
  pop.addEventListener("input", (e) => { if (e.target.type === "color") { setProp("color", e.target.value, false); well.firstElementChild.style.background = e.target.value; } });
  pop.addEventListener("change", (e) => { if (e.target.type === "color") { setProp("color", e.target.value, true); renderPanel(); } });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); well.focus(); } });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !well.contains(e.target)) closePop(); }, true);

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

  // Sign tool: saved signature and initials, plus today's date.
  const DATE_FORMATS = { long: { day: "numeric", month: "long", year: "numeric" }, short: { day: "2-digit", month: "2-digit", year: "numeric" }, iso: null };
  const today = (f = opt.dateFmt || "long") => (f === "iso" ? new Date().toISOString().slice(0, 10) : new Date().toLocaleDateString(undefined, DATE_FORMATS[f]));
  function signPanel() {
    const s = savedSigns(), row = (kind, label) => s[kind]
      ? `<div class="signrow"><button class="signthumb${placing?.kind === kind ? " on" : ""}" data-place="${kind}" title="Click, then click the page to place it"><img src="${s[kind]}" alt="Your ${kind}"></button><div class="col"><button data-a="newsign" data-kind="${kind}">Redo</button><button data-a="delsign" data-kind="${kind}" class="danger">Delete</button></div></div>`
      : `<button class="primary" data-a="newsign" data-kind="${kind}">Create ${label}</button>`;
    return `<div class="signbox"><h3>Signature</h3>${row("signature", "signature")}<h3>Initials</h3>${row("initials", "initials")}
      <h3>Date</h3><div class="row"><select id="date-fmt" aria-label="Date format">${Object.keys(DATE_FORMATS).map((f) => `<option value="${f}"${(opt.dateFmt || "long") === f ? " selected" : ""}>${today(f)}</option>`).join("")}</select><button data-place="date" class="${placing?.kind === "date" ? "on" : ""}">Place date</button></div>
      ${placing ? `<p class="placing">Click on the page to place the ${placing.kind}. Esc cancels.</p>` : ""}
      <p class="note">This is a visual signature, like signing a printout. It's not a certificate-based digital signature. Saved signatures stay in this browser.</p></div>`;
  }
  async function arm(kind) {
    if (kind === "date") { placing = { kind }; return renderPanel(); }
    const src = savedSigns()[kind]; if (!src) return;
    const img = new Image(); img.src = src; await img.decode().catch(() => {});
    placing = { kind, src, ratio: img.naturalHeight / img.naturalWidth || 0.35 };
    renderPanel();
  }
  panel.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.place) return placing?.kind === b.dataset.place ? ((placing = null), renderPanel()) : arm(b.dataset.place);
    if (b.dataset.a === "newsign") { const url = await createSignature(b.dataset.kind); if (url) await armUrl(b.dataset.kind, url); } // saved only if "Remember" was ticked
    if (b.dataset.a === "delsign") { saveSign(b.dataset.kind, null); if (placing?.kind === b.dataset.kind) placing = null; renderPanel(); }
  });
  async function armUrl(kind, src) { const img = new Image(); img.src = src; await img.decode().catch(() => {}); placing = { kind, src, ratio: img.naturalHeight / img.naturalWidth || 0.35 }; renderPanel(); }
  panel.addEventListener("change", (e) => { if (e.target.id === "date-fmt") { opt.dateFmt = e.target.value; save(); } });
  onImageLoad(() => { draw(); });

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
    if (t.dataset.a === "fontpick") return fpop.hidden ? openFonts(t) : closeFonts();
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
    if (!base || e.button !== 0 || e.target.closest(".tbox") || e.target.closest(".rfields.active")) return;
    if (editor) { finishEditor(); return; }
    const [x, y] = toUser(e), tool = opt.tool, color = opt.color[tool];
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Resize handle of a selected signature (Select and Sign tools).
    const selA = sel?.kind === "annot" ? annots()[sel.i] : null;
    if (selA?.type === "image" && (tool === "select" || tool === "sign")) {
      const [cx, cy] = imageCorner(selA);
      if (Math.hypot(cx - x, cy - y) <= 9 * ptsPerCss()) { drag = { mode: "resize", x, y, orig: selA, replace: sel.i }; return; }
    }
    if (tool === "sign") {
      if (placing) {
        const r = pageRot(), right = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[r], down = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[r];
        if (placing.kind === "date") addAnnot({ type: "text", color: "#1d1d1f", size: 12, font: "sans", x, y: y, text: today(), rot: r }, "add date");
        else {
          const p = page(), pw = P.norm((p.own || 0) + p.rot) % 180 ? p.h : p.w, w = Math.min(placing.kind === "initials" ? 60 : 160, pw * 0.4), h = w * placing.ratio;
          addAnnot({ type: "image", src: placing.src, w, h, rot: r, x: x - right[0] * w / 2 - down[0] * h / 2, y: y - right[1] * w / 2 - down[1] * h / 2 }, placing.kind === "initials" ? "add initials" : "add signature");
        }
        placing = null; renderPanel(); return;
      }
      const i = hit(annots(), x, y, 6 * ptsPerCss());
      if (i >= 0 && annots()[i].type === "image") { sel = { kind: "annot", i }; drag = { mode: "move", x, y, orig: annots()[i], replace: i }; draw(); renderPanel(); return; }
      sel = null; draw(); renderPanel();
      if (!savedSigns().signature && !savedSigns().initials) toastOnce("Create your signature first (in the panel on the right).");
      return;
    }
    if (tool === "form") return;
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
      case "resize": { // keep the aspect ratio; scale by how far the corner moved
        const o = drag.orig, [cx, cy] = imageCorner(o), d0 = Math.hypot(cx - o.x, cy - o.y), d1 = Math.hypot(x - o.x, y - o.y);
        const f = Math.max(12 / o.w, d1 / (d0 || 1));
        drag.preview = { ...o, w: o.w * f, h: o.h * f }; break;
      }
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
    if (d.mode === "move" || d.mode === "resize") { if (d.preview) { const list = annots().slice(); list[d.replace] = d.preview; setAnnots(list, d.mode === "resize" ? "resize signature" : "move annotation"); } }
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
  const setTool = (t) => { finishEditor(); opt.tool = t; sel = null; placing = null; save(); draw(); renderPanel(); renderFields(); };
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
      if (e.key === "Escape" && placing) { placing = null; renderPanel(); return true; }
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
