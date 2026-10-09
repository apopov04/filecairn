import { test } from "node:test";
import assert from "node:assert/strict";
import { bbox, hit, translate, textRects } from "../js/annots.js";

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
