// Unit tests for features/tracker/lib/level.ts (new in PepWorld). Run: npm run test:tracker
import assert from "node:assert/strict";
import { convertDose, levelCurve, MAX_LEVEL_POINTS } from "../src/features/tracker/lib/level";
import { dose, makeTest, oct } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker level curve");

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("one dose halves every half-life", () => {
  const pts = levelCurve([dose(oct(12, 8))], 12, oct(12, 8), oct(13, 8), 12);
  assert.deepEqual(
    pts.map((p) => p.t),
    [oct(12, 8).getTime(), oct(12, 20).getTime(), oct(13, 8).getTime()],
  );
  assert.ok(close(pts[0].level, 250));
  assert.ok(close(pts[1].level, 125));
  assert.ok(close(pts[2].level, 62.5));
});

test("doses add up; nothing before the first dose", () => {
  const pts = levelCurve([dose(oct(12, 8)), dose(oct(12, 20))], 12, oct(12, 0), oct(12, 20), 4);
  assert.equal(pts[0].level, 0); // 00:00
  assert.ok(close(pts[pts.length - 1].level, 125 + 250)); // 20:00
});

test("normalized to the protocol unit; unconvertible and deleted doses are left out", () => {
  const doses = [
    dose(oct(12, 8), { dose: { value: 0.5, unit: "mg" } }),
    dose(oct(12, 8), { dose: { value: 5, unit: "iu" } }),
    dose(oct(12, 8), { deletedAt: "2026-10-12T09:00:00.000Z" }),
  ];
  const [p] = levelCurve(doses, 24, oct(12, 8), oct(12, 8), 1, "mcg");
  assert.ok(close(p.level, 500));
  assert.equal(convertDose(2, "mg", "mcg"), 2000);
  assert.equal(convertDose(5, "iu", "mg"), null);
  assert.equal(convertDose(3, "caps", "caps"), 3);
});

test("the unit defaults to the newest dose's", () => {
  const doses = [dose(oct(11, 8), { dose: { value: 250, unit: "mcg" } }), dose(oct(12, 8), { dose: { value: 1, unit: "mg" } })];
  const [p] = levelCurve(doses, 1e9, oct(12, 8), oct(12, 8), 1);
  assert.ok(close(p.level, 1.25));
});

test("bad input gives no points; long ranges are capped", () => {
  assert.equal(levelCurve([dose(oct(12))], 0, oct(12), oct(13), 1).length, 0);
  assert.equal(levelCurve([dose(oct(12))], 12, oct(12), oct(13), 0).length, 0);
  assert.equal(levelCurve([dose(oct(12))], 12, oct(13), oct(12), 1).length, 0);
  const many = levelCurve([dose(oct(1))], 12, oct(1), oct(31), 0.001);
  assert.ok(many.length <= MAX_LEVEL_POINTS + 1);
  assert.equal(many[many.length - 1].t, oct(31).getTime());
});

done();
