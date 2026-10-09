import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, textQuery, indexText, findOnPage, normRect } from "../js/redact.js";

// A pdf.js-like text item: 12pt text at (x, y), 6pt per character.
const item = (str, x, y, eol = false) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12, hasEOL: eol });

test("indexText joins items with spaces and keeps offsets", () => {
  const ix = indexText([item("Hello", 0, 0), item("world", 40, 0, true), item("next", 0, -20)]);
  assert.equal(ix.text, "Hello world next");
  assert.deepEqual(ix.spans.map((s) => [s.start, s.end]), [[0, 5], [6, 11], [12, 16]]);
});

test("a plain-text match inside one item gets a box over just those characters", () => {
  const m = findOnPage([item("Call me at secret now", 100, 500)], textQuery("secret"));
  assert.equal(m.length, 1);
  const [x1, y1, x2, y2] = m[0].boxes[0];
  // "secret" = chars 11..17 -> x 166..202 (6pt/char), padded ~1pt.
  assert.ok(Math.abs(x1 - 166) < 2 && Math.abs(x2 - 202) < 2, `${x1}..${x2}`);
  assert.ok(y1 < 500 && y2 > 500 + 9, `${y1}..${y2}`); // covers below and above the baseline
});

test("matches spanning items give one box per item; case-insensitive", () => {
  const m = findOnPage([item("John", 0, 0), item("SMITH", 40, 0)], textQuery("john smith"));
  assert.equal(m.length, 1);
  assert.equal(m[0].boxes.length, 2);
});

test("presets find emails, phone numbers and IBANs", () => {
  const items = [item("Mail jane.doe@example.com or call +31 6 1234 5678.", 0, 0), item("IBAN NL91 ABNA 0417 1643 00 thanks", 0, -20)];
  const texts = (re) => findOnPage(items, re).map((m) => m.text);
  assert.deepEqual(texts(PRESETS.email.re), ["jane.doe@example.com"]);
  assert.ok(texts(PRESETS.phone.re).some((t) => t.includes("1234 5678")));
  assert.deepEqual(texts(PRESETS.iban.re), ["NL91 ABNA 0417 1643 00"]);
});

test("textQuery escapes regex characters and rejects empty input", () => {
  assert.equal(textQuery("  "), null);
  assert.equal(findOnPage([item("cost $5.00 (approx)", 0, 0)], textQuery("$5.00 (approx)")).length, 1);
  assert.deepEqual(normRect([10, 20, 0, 5]), [0, 5, 10, 20]);
});

