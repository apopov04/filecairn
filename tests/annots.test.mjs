import { test } from "node:test";
import assert from "node:assert/strict";
import { bbox, hit, translate, textRects, handles, resized } from "../js/annots.js";

const item = (str, x, y) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12, hasEOL: true });

test("textRects picks the characters under the drag box, one rect per line", () => {
  const items = [item("Hello brave world", 100, 500), item("second line", 100, 480)];
  // Box over "brave world" on the first line only (chars 6..16 -> x 136..202).
  const r = textRects(items, [130, 495, 210, 512]);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0][0] - 136) < 2 && Math.abs(r[0][2] - 202) < 2, JSON.stringify(r));
  // Tall box over both lines -> two rects.
  assert.equal(textRects(items, [90, 470, 300, 520]).length, 2);
  // Empty area -> no text.
  assert.equal(textRects(items, [400, 100, 450, 150]).length, 0);
});

test("bbox, hit and translate work across annotation types", () => {
  const annots = [
    { type: "rect", rect: [10, 10, 50, 40], color: "#000", width: 2 },
    { type: "ink", paths: [[100, 100, 120, 130, 140, 110]], color: "#000", width: 2 },
    { type: "line", from: [0, 200], to: [100, 150], color: "#000", width: 2 },
    { type: "text", x: 300, y: 300, size: 10, text: "Hi\nthere", rot: 0 },
  ];
  assert.deepEqual(bbox(annots[1]), [100, 100, 140, 130]);
  assert.equal(hit(annots, 30, 25), 0);
  assert.equal(hit(annots, 130, 120), 1);
  assert.equal(hit(annots, 302, 295), 3); // inside the text box (top-left at 300,300, going down)
  assert.equal(hit(annots, 600, 600), -1);
  assert.deepEqual(translate(annots[2], 5, -5).to, [105, 145]);
  assert.deepEqual(translate(annots[1], 1, 2).paths[0].slice(0, 2), [101, 102]);
  // Text typed on a page shown rotated 90°: its box extends along +y (screen right) and +x (screen down).
  const b = bbox({ type: "text", x: 100, y: 100, size: 10, text: "abcd", rot: 90 });
  assert.ok(b[0] === 100 && b[1] === 100 && b[2] > 100 && b[3] > 100, JSON.stringify(b));
});

test("resize handles: rectangles, lines, pen drawings, text", () => {
  const r = { type: "rect", rect: [10, 10, 50, 40] };
  assert.equal(handles(r).length, 4);
  assert.deepEqual(resized(r, 2, 80, 70).rect, [10, 10, 80, 70]); // drag bottom-right (x2, y2)
  assert.deepEqual(resized(r, 0, 60, 50).rect, [50, 40, 60, 50]); // dragging past the opposite corner flips cleanly
  const l = { type: "arrow", from: [0, 0], to: [10, 10] };
  assert.deepEqual(resized(l, 1, 30, 5).to, [30, 5]);
  assert.deepEqual(resized(l, 0, -5, 2).from, [-5, 2]);
  const ink = { type: "ink", paths: [[0, 0, 10, 10, 20, 0]] };
  const big = resized(ink, 2, 40, 20); // corner (20, 10) -> (40, 20): twice as big from (0, 0)
  assert.deepEqual(big.paths[0], [0, 0, 20, 20, 40, 0]);
  const t = { type: "text", x: 100, y: 300, size: 10, text: "Hello", rot: 0 };
  const [cx, cy] = handles(t)[0];
  assert.ok(cx > 100 && cy < 300); // bottom-right as seen on screen (y goes down on screen = smaller user y)
  assert.equal(resized(t, 0, 100 + (cx - 100) * 2, 300 + (cy - 300) * 2).size, 20);
  assert.equal(handles({ type: "note", x: 0, y: 0 }).length, 0);
});
