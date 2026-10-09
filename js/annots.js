// Annotations: the model (pure geometry, unit-tested) and the canvas renderer
// used for thumbnails and the page editor. Everything is in PDF user space
// (points, y up), like redaction marks. A page carries them as page.annots:
//   { type: "highlight" | "underline" | "strike", color, rects: [[x1,y1,x2,y2]], onText }   (onText: made from selected text)
//   { type: "ink", color, width, paths: [[x, y, x, y, ...]] }
//   { type: "rect" | "ellipse", color, width, rect: [x1,y1,x2,y2] }
//   { type: "line" | "arrow", color, width, from: [x, y], to: [x, y] }
//   { type: "text", color, size, x, y, text, rot, font, bold, italic }   (x, y = top-left; rot = page rotation when typed; font: sans|serif|mono)
//   { type: "note", color, x, y, text }                 (a sticky note / comment)

import { indexText, boxesFor } from "./redact.js";

export const COLORS = {
  highlight: ["#ffd400", "#7dffa6", "#7fd6ff", "#ff9bd2", "#ffa45c"],
  ink: ["#d93f3f", "#0F5468", "#1d1d1f", "#2f7d32", "#7b3fd9", "#ffffff"],
  note: ["#ffd400", "#7fd6ff", "#ff9bd2", "#7dffa6"],
};

/** Bounding box [x1, y1, x2, y2] of an annotation (for hit-testing and moving). */
export function bbox(a) {
  switch (a.type) {
    case "highlight": case "underline": case "strike": return union(a.rects);
    case "ink": { const xs = [], ys = []; for (const p of a.paths) for (let i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); } return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    case "rect": case "ellipse": return a.rect;
    case "line": case "arrow": return [Math.min(a.from[0], a.to[0]), Math.min(a.from[1], a.to[1]), Math.max(a.from[0], a.to[0]), Math.max(a.from[1], a.to[1])];
    case "text": { const w = a.w ?? textWidth(a), h = textHeight(a); return textBox(a, w, h); }
    case "note": return [a.x, a.y - 18, a.x + 18, a.y];
  }
  return [0, 0, 0, 0];
}
const union = (rs) => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];

// Text boxes: rough metrics (Helvetica-ish), good enough for hit-testing.
const lines = (a) => String(a.text || "").split("\n");
export const textWidth = (a) => Math.max(20, ...lines(a).map((l) => l.length * a.size * 0.52));
export const textHeight = (a) => lines(a).length * a.size * 1.2;
// The box in user space, turning with the page rotation the text was typed at.
function textBox(a, w, h) {
  const r = ((a.rot || 0) % 360 + 360) % 360;
  // Directions (in user space) of "right" and "down" as seen on screen.
  const right = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[r], down = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] }[r];
  const xs = [a.x, a.x + right[0] * w, a.x + down[0] * h, a.x + right[0] * w + down[0] * h];
  const ys = [a.y, a.y + right[1] * w, a.y + down[1] * h, a.y + right[1] * w + down[1] * h];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Index of the topmost annotation at user-space point (x, y), or -1. tol in points. */
export function hit(annots, x, y, tol = 4) {
  for (let i = annots.length - 1; i >= 0; i--) {
    const [a, b, c, d] = bbox(annots[i]);
    if (x >= a - tol && x <= c + tol && y >= b - tol && y <= d + tol) return i;
  }
  return -1;
}

/** A copy of the annotation moved by (dx, dy) in user space. */
export function translate(a, dx, dy) {
  const r = (q) => [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy];
  switch (a.type) {
    case "highlight": case "underline": case "strike": return { ...a, rects: a.rects.map(r) };
    case "ink": return { ...a, paths: a.paths.map((p) => p.map((v, i) => v + (i % 2 ? dy : dx))) };
    case "rect": case "ellipse": return { ...a, rect: r(a.rect) };
    case "line": case "arrow": return { ...a, from: [a.from[0] + dx, a.from[1] + dy], to: [a.to[0] + dx, a.to[1] + dy] };
    default: return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/**
 * Text under a dragged rectangle (user space): characters whose centre is
 * inside it, merged into one rect per run within a text item. Returns [] when
 * the page has no text there (the caller then highlights the area itself).
 */
export function textRects(items, [x1, y1, x2, y2]) {
  const index = indexText(items), out = [];
  const inside = (r) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2; };
  for (const s of index.spans) {
    // First and last selected (non-space) character of this item; spaces in between are included.
    let first = -1, last = -1;
    for (let i = s.start; i < s.end; i++) {
      if (s.it.str[i - s.start] === " ") continue;
      if (inside(boxesFor(index, i, i + 1)[0])) { if (first < 0) first = i; last = i; }
    }
    if (first >= 0) out.push(boxesFor(index, first, last + 1)[0]);
  }
  return out;
}

/* ------------------------------ canvas renderer ----------------------------- */

/** CSS font for a text annotation at `px` pixels. */
export const FONTS = { sans: "Helvetica, Arial, sans-serif", serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
export const cssFont = (a, px) => `${a.italic ? "italic " : ""}${a.bold ? "bold " : ""}${px}px ${FONTS[a.font] || FONTS.sans}`;


/**
 * Draw annotations on a 2D context whose page was rendered with pdf.js
 * viewport `vp` (device pixels). selected: index to outline, or -1.
 */
export function drawAnnots(ctx, vp, annots, selected = -1) {
  if (!annots?.length) return;
  const [a, b, c, d, e, f] = vp.transform, k = Math.hypot(a, b); // device px per point
  const P = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const box = (r) => { const [x1, y1] = P(r[0], r[1]), [x2, y2] = P(r[2], r[3]); return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]; };
  ctx.save();
  annots.forEach((an, i) => {
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = an.color || "#000";
    ctx.lineWidth = Math.max(1, (an.width || 2) * k);
    switch (an.type) {
      case "highlight":
        // Like a real highlighter: multiply keeps dark text dark instead of tinting it.
        ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = an.color;
        for (const r of an.rects) ctx.fillRect(...box(r));
        break;
      case "underline": case "strike":
        ctx.lineWidth = Math.max(1, 1.2 * k);
        for (const r of an.rects) {
          const h = r[3] - r[1], y = an.type === "underline" ? r[1] + h * 0.18 : r[1] + h * 0.45;
          const [x1, y1] = P(r[0], y), [x2, y2] = P(r[2], y);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        break;
      case "ink":
        for (const p of an.paths) { ctx.beginPath(); for (let j = 0; j < p.length; j += 2) { const [x, y] = P(p[j], p[j + 1]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } if (p.length === 2) { const [x, y] = P(p[0], p[1]); ctx.lineTo(x + 0.01, y); } ctx.stroke(); }
        break;
      case "rect": { const [x, y, w, h] = box(an.rect); ctx.strokeRect(x, y, w, h); break; }
      case "ellipse": { const [x, y, w, h] = box(an.rect); ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); break; }
      case "line": case "arrow": {
        const [x1, y1] = P(...an.from), [x2, y2] = P(...an.to);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        if (an.type === "arrow") { const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.max(10, (an.width || 2) * k * 4); for (const s of [-0.45, 0.45]) { ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(ang + s), y2 - len * Math.sin(ang + s)); } }
        ctx.stroke(); break;
      }
      case "text": {
        // Keep the text upright as it was typed: turn by how much the page's
        // on-screen rotation differs from when it was typed (an.rot).
        const [x, y] = P(an.x, an.y), pageRot = Math.round((Math.atan2(b, a) * 180) / Math.PI);
        ctx.translate(x, y); ctx.rotate(((pageRot - (an.rot || 0)) * Math.PI) / 180);
        ctx.font = cssFont(an, an.size * k); ctx.textBaseline = "top";
        lines(an).forEach((l, j) => ctx.fillText(l, 0, j * an.size * 1.2 * k));
        break;
      }
      case "note": {
        const [x, y] = P(an.x, an.y), s = 18 * k;
        ctx.fillStyle = an.color || "#ffd400"; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = Math.max(1, k);
        ctx.beginPath(); ctx.roundRect?.(x, y, s, s * 0.85, s * 0.15) ?? ctx.rect(x, y, s, s * 0.85); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s * 0.3, y + s * 0.85); ctx.lineTo(x + s * 0.3, y + s * 1.1); ctx.lineTo(x + s * 0.55, y + s * 0.85); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,.5)";
        for (const t of [0.3, 0.5]) { ctx.beginPath(); ctx.moveTo(x + s * 0.22, y + s * t); ctx.lineTo(x + s * 0.78, y + s * t); ctx.stroke(); }
        break;
      }
    }
    ctx.restore();
    if (i === selected) {
      const [x, y, w, h] = box(bbox(an));
      ctx.save(); ctx.strokeStyle = "#0F5468"; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeRect(x - 4, y - 4, w + 8, h + 8); ctx.restore();
    }
  });
  ctx.restore();
}
