// Signatures: a dialog to create one by drawing, typing (handwriting font) or
// uploading a photo of a paper signature. Returns a trimmed transparent PNG
// as a data URL. Saved signatures stay in this browser (localStorage).

const STORE = "fc-sign";
export const savedSigns = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { return {}; } };
export const saveSign = (kind, url) => { const s = savedSigns(); if (url) s[kind] = url; else delete s[kind]; localStorage.setItem(STORE, JSON.stringify(s)); };

let fontReady = null;
function loadFont() {
  fontReady ??= new FontFace("FcSignature", `url(${new URL("../vendor/fonts/DancingScript.ttf", import.meta.url).href})`).load().then((f) => { document.fonts.add(f); return true; }).catch(() => false);
  return fontReady;
}

/** Crop a canvas to its non-transparent pixels (with a small margin). */
function trim(c) {
  const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const m = 6, out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + m * 2; out.height = y1 - y0 + 1 + m * 2;
  out.getContext("2d").drawImage(c, x0 - m, y0 - m, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** A photo of a signature on paper: make the paper transparent, keep the ink. */
async function fromPhoto(file, color) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const g = c.getContext("2d"); g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  // Paper brightness: a high percentile of luminance; ink is anything clearly darker.
  const lum = new Float32Array(d.length / 4);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const paper = Float32Array.from(lum).sort()[Math.floor(lum.length * 0.9)];
  const [r, gg, b] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
  for (let i = 0; i < lum.length; i++) {
    const a = Math.max(0, Math.min(1, (paper - 25 - lum[i]) / 60)); // soft edge between paper and ink
    d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return trim(c);
}

/** Open the dialog. kind: "signature" | "initials". Resolves to a data URL, or null if cancelled. */
export function createSignature(kind = "signature") {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "signdlg";
    dlg.innerHTML = `
      <form method="dialog" class="dlg">
        <h2>Create your ${kind}</h2>
        <div class="seg tabs" role="tablist"><button type="button" role="tab" data-tab="draw" class="on">Draw</button><button type="button" role="tab" data-tab="type">Type</button><button type="button" role="tab" data-tab="upload">Upload</button></div>
        <div class="pane" data-pane="draw"><canvas class="pad" width="900" height="300" aria-label="Draw your ${kind} here"></canvas><p class="hint">Draw with your mouse, trackpad or finger.</p></div>
        <div class="pane" data-pane="type" hidden><input type="text" class="typed" placeholder="Type your ${kind === "initials" ? "initials" : "name"}" autocomplete="name"><div class="typed-preview" aria-hidden="true"></div></div>
        <div class="pane" data-pane="upload" hidden><input type="file" accept="image/*" class="upfile"><p class="hint">A photo or scan of your ${kind} on white paper. The paper is removed automatically.</p><img class="up-preview" alt=""></div>
        <div class="row ink"><span>Ink</span>${["#1d1d1f", "#1a3fa0"].map((c, i) => `<button type="button" class="sw${i ? "" : " on"}" data-ink="${c}" aria-label="${i ? "Blue" : "Black"} ink" style="background:${c}"></button>`).join("")}<button type="button" class="clear">Clear</button></div>
        <label class="checkbox"><input type="checkbox" class="remember" checked> Remember on this device (stays in your browser, never uploaded)</label>
        <div class="row-end"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok">Use ${kind}</button></div>
      </form>`;
    document.body.append(dlg);
    const $ = (s) => dlg.querySelector(s);
    let tab = "draw", ink = "#1d1d1f", uploaded = null, drawn = false;
    const pad = $(".pad"), pg = pad.getContext("2d");
    const resetPad = () => { pg.clearRect(0, 0, pad.width, pad.height); pg.strokeStyle = "#ccc"; pg.lineWidth = 2; pg.beginPath(); pg.moveTo(40, 230); pg.lineTo(860, 230); pg.stroke(); drawn = false; };
    resetPad();
    // Drawing: smooth strokes with pointer events (mouse, pen, touch).
    const strokes = [];
    let cur = null;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height]; };
    const redraw = () => {
      resetPad(); pg.strokeStyle = ink; pg.lineWidth = 5; pg.lineCap = pg.lineJoin = "round";
      for (const s of strokes) { pg.beginPath(); s.forEach(([x, y], i) => (i ? pg.lineTo(x, y) : pg.moveTo(x, y))); if (s.length === 1) pg.lineTo(s[0][0] + 0.1, s[0][1]); pg.stroke(); }
      drawn = strokes.length > 0;
    };
    pad.addEventListener("pointerdown", (e) => { pad.setPointerCapture(e.pointerId); cur = [pos(e)]; strokes.push(cur); redraw(); });
    pad.addEventListener("pointermove", (e) => { if (!cur) return; const p = pos(e), l = cur.at(-1); if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) { cur.push(p); redraw(); } });
    pad.addEventListener("pointerup", () => { cur = null; });
    const typed = $(".typed"), prev = $(".typed-preview");
    loadFont().then((ok) => { prev.style.fontFamily = ok ? "FcSignature, cursive" : "cursive"; });
    const showTyped = () => { prev.textContent = typed.value || ""; prev.style.color = ink; };
    typed.addEventListener("input", showTyped);
    $(".upfile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; uploaded = await fromPhoto(f, ink).catch(() => null); $(".up-preview").src = uploaded || ""; });
    dlg.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { tab = t.dataset.tab; dlg.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === t)); dlg.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== tab; }); if (tab === "type") typed.focus(); }
      const i = e.target.closest("[data-ink]");
      if (i) { ink = i.dataset.ink; dlg.querySelectorAll("[data-ink]").forEach((b) => b.classList.toggle("on", b === i)); redraw(); showTyped(); const f = $(".upfile").files[0]; if (f) fromPhoto(f, ink).then((u) => { uploaded = u; $(".up-preview").src = u || ""; }); }
      if (e.target.closest(".clear")) { strokes.length = 0; redraw(); typed.value = ""; showTyped(); uploaded = null; $(".upfile").value = ""; $(".up-preview").removeAttribute("src"); }
    });
    dlg.addEventListener("close", async () => {
      let url = null;
      if (dlg.returnValue === "ok") {
        if (tab === "draw" && drawn) { const c = document.createElement("canvas"); c.width = pad.width; c.height = pad.height; const g = c.getContext("2d"); g.strokeStyle = ink; g.lineWidth = 5; g.lineCap = g.lineJoin = "round"; for (const s of strokes) { g.beginPath(); s.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1]); g.stroke(); } url = trim(c); }
        else if (tab === "type" && typed.value.trim()) {
          await loadFont();
          const c = document.createElement("canvas"), g = c.getContext("2d"), px = 120;
          g.font = `${px}px FcSignature, cursive`; c.width = Math.ceil(g.measureText(typed.value).width + 40); c.height = Math.ceil(px * 1.6);
          g.font = `${px}px FcSignature, cursive`; g.fillStyle = ink; g.textBaseline = "middle"; g.fillText(typed.value, 20, c.height / 2);
          url = trim(c);
        } else if (tab === "upload") url = uploaded;
        if (url && $(".remember").checked) saveSign(kind, url);
      }
      dlg.remove();
      resolve(url);
    });
    dlg.showModal();
  });
}
