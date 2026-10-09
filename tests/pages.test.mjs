import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/pages.js";
import { zip, crc32 } from "../js/zip.js";

const doc = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, src: 0, index: i, rot: 0, w: 1, h: 1 }));
const ids = (pages) => pages.map((p) => p.id);

test("move keeps the moved pages' order and lands before the target", () => {
  const d = doc(5); // 100..104
  assert.deepEqual(ids(P.move(d, new Set([100]), 3)), [101, 102, 100, 103, 104]);
  assert.deepEqual(ids(P.move(d, new Set([103, 101]), 0)), [101, 103, 100, 102, 104]);
  assert.deepEqual(ids(P.move(d, new Set([100, 101]), 5)), [102, 103, 104, 100, 101]);
  assert.deepEqual(ids(P.move(d, new Set([102]), 2)), ids(d)); // dropping in place
});

test("remove, rotate, duplicate, insertBlank", () => {
  const d = doc(3);
  assert.deepEqual(ids(P.remove(d, new Set([101]))), [100, 102]);
  const r = P.rotate(d, new Set([100]), -90);
  assert.equal(r[0].rot, 270);
  assert.equal(P.rotate(r, new Set([100]), 180)[0].rot, 90);
  const dup = P.duplicate(d, new Set([101]));
  assert.equal(dup.pages.length, 4);
  assert.equal(dup.pages[2].index, 1);
  assert.equal(dup.pages[2].id, dup.added[0]);
  const b = P.insertBlank(d, 1);
  assert.equal(b.pages[1].blank, true);
  assert.equal(P.insertBlank(d, 99).pages[3].blank, true);
});

test("parseRanges reads lists and open ranges, rejects bad input", () => {
  assert.deepEqual(P.parseRanges("1-3, 5", 6), [[0, 1, 2], [4]]);
  assert.deepEqual(P.parseRanges("5-", 6), [[4, 5]]);
  assert.deepEqual(P.parseRanges("-2", 6), [[0, 1]]);
  assert.throws(() => P.parseRanges("7", 6), /outside/);
  assert.throws(() => P.parseRanges("4-2", 6), /backwards/);
  assert.throws(() => P.parseRanges("abc", 6), /isn't a page/);
  assert.throws(() => P.parseRanges(" ", 6), /at least one/);
});

test("chunks splits evenly with a remainder", () => {
  assert.deepEqual(P.chunks(5, 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(P.chunks(3, 10), [[0, 1, 2]]);
});

test("zip writes a valid stored archive", () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
  const z = zip([{ name: "a.txt", data: new TextEncoder().encode("hi") }, { name: "b.txt", data: new Uint8Array(0) }]);
  const v = new DataView(z.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
});

test("marks: set, add, clear, and duplicates keep them", () => {
  const d = doc(2);
  let r = P.setMarks(d, 100, [[0, 0, 10, 10]]);
  assert.equal(r[0].marks.length, 1);
  r = P.addMarks(r, new Map([[100, [[1, 1, 2, 2]]], [101, [[3, 3, 4, 4]]]]));
  assert.deepEqual([r[0].marks.length, r[1].marks.length], [2, 1]);
  assert.equal(P.duplicate(r, new Set([100])).pages[1].marks.length, 2);
  assert.equal(P.setMarks(r, 100, [])[0].marks, undefined);
  assert.ok(P.clearMarks(r).every((p) => !p.marks));
  assert.equal(P.clearMarks(r, new Set([101]))[0].marks.length, 2);
});
