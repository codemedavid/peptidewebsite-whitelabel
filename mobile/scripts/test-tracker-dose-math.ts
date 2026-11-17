// Unit tests for features/tracker/lib/dose-math.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { computeDraw, doseInVialUnit, formatMl, formatTriple, formatUnits, inputWarnings, parseAmount, parseDoseText } from "../src/features/tracker/lib/dose-math";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker dose maths");

test("5 mg + 2 mL water + 250 mcg = 0.10 mL = 10 units, 20 doses", () => {
  const draw = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 250, unit: "mcg" }, "u100_1ml");
  assert.equal(draw.kind, "ok");
  if (draw.kind !== "ok") return;
  assert.ok(Math.abs(draw.volumeMl - 0.1) < 1e-9);
  assert.ok(Math.abs(draw.units - 10) < 1e-9);
  assert.equal(draw.dosesPerVial, 20);
  assert.deepEqual(draw.warnings, []);
  assert.equal(formatTriple({ value: 250, unit: "mcg" }, { vialAmount: 5, vialUnit: "mg", waterMl: 2 }), "250 mcg · 0.10 mL · 10 u");
});

test("mg ↔ mcg convert (2 mg dose from a 10 mg vial in 2 mL)", () => {
  const draw = computeDraw({ vialAmount: 10, vialUnit: "mg", waterMl: 2 }, { value: 2, unit: "mg" }, "u100_1ml");
  assert.ok(draw.kind === "ok" && Math.abs(draw.units - 40) < 1e-9 && draw.dosesPerVial === 5);
  const mcgVial = computeDraw({ vialAmount: 5000, vialUnit: "mcg", waterMl: 2 }, { value: 0.25, unit: "mg" }, null);
  assert.ok(mcgVial.kind === "ok" && Math.abs(mcgVial.units - 10) < 1e-9);
});

test("IU only with IU; IU against mg blocks saving", () => {
  const iu = computeDraw({ vialAmount: 100, vialUnit: "iu", waterMl: 1 }, { value: 10, unit: "iu" }, null);
  assert.ok(iu.kind === "ok" && Math.abs(iu.units - 10) < 1e-9);
  const mixed = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 10, unit: "iu" }, null);
  assert.equal(mixed.kind, "invalid");
  assert.ok(mixed.kind === "invalid" && mixed.isBlocked && mixed.warnings.includes("iuMismatch"));
});

test("warnings: under 2 u, over syringe capacity, over the whole vial", () => {
  const tiny = computeDraw({ vialAmount: 10, vialUnit: "mg", waterMl: 1 }, { value: 100, unit: "mcg" }, "u100_1ml");
  assert.ok(tiny.kind === "ok" && tiny.warnings.includes("tiny") && !tiny.isBlocked);
  const big = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 1, unit: "mg" }, "u100_03ml");
  assert.ok(big.kind === "ok" && big.warnings.includes("overSyringe") && !big.isBlocked);
  const over = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 6, unit: "mg" }, "u100_1ml");
  assert.ok(over.kind === "ok" && over.warnings.includes("overVial") && over.isBlocked);
});

test("v1 surfaces only input checks (whole vial, IU vs mg) — never syringe-unit ones", () => {
  const tiny = computeDraw({ vialAmount: 10, vialUnit: "mg", waterMl: 1 }, { value: 100, unit: "mcg" }, "u100_1ml");
  assert.deepEqual(inputWarnings(tiny), []);
  const big = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 1, unit: "mg" }, "u100_03ml");
  assert.deepEqual(inputWarnings(big), []);
  const over = computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 6, unit: "mg" }, "u100_1ml");
  assert.deepEqual(inputWarnings(over), ["overVial"]);
  assert.deepEqual(inputWarnings(computeDraw({ vialAmount: 5, vialUnit: "mg", waterMl: 2 }, { value: 10, unit: "iu" }, null)), ["iuMismatch"]);
  assert.deepEqual(inputWarnings(computeDraw(null, null, null)), []);
});

test("empty and zero fields give the empty state", () => {
  assert.equal(computeDraw({ vialAmount: 0, vialUnit: "mg", waterMl: 2 }, { value: 250, unit: "mcg" }, null).kind, "empty");
  assert.equal(computeDraw({ vialAmount: 5, vialUnit: "mg" }, { value: 250, unit: "mcg" }, null).kind, "empty");
  assert.equal(computeDraw(null, { value: 250, unit: "mcg" }, null).kind, "empty");
  assert.equal(formatTriple({ value: 250, unit: "mcg" }, null), "250 mcg");
});

test("rounding shows ≈; mL to 2 places, units to 1", () => {
  assert.equal(formatMl(0.1), "0.10 mL");
  assert.equal(formatMl(0.125), "≈0.13 mL");
  assert.equal(formatUnits(12.5), "12.5 u");
  assert.equal(formatUnits(12.345), "≈12.3 u");
});

test("vial deduction converts doses into the vial unit, legacy units through the mix", () => {
  assert.equal(doseInVialUnit({ value: 250, unit: "mcg" }, "mg", null), 0.25);
  assert.equal(doseInVialUnit({ value: 10, unit: "units" }, "mg", { vialAmount: 5, waterMl: 2 }), 0.25);
  assert.equal(doseInVialUnit({ value: 1, unit: "caps" }, "mg", null), null);
});

test("typed numbers and dose text parse", () => {
  assert.equal(parseAmount("2,5"), 2.5);
  assert.equal(parseAmount("0.25"), 0.25);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
  assert.deepEqual(parseDoseText("250mcg"), { value: 250, unit: "mcg" });
  assert.deepEqual(parseDoseText("0.25 mg"), { value: 0.25, unit: "mg" });
  assert.deepEqual(parseDoseText("5000 IU"), { value: 5000, unit: "iu" });
  assert.equal(parseDoseText("As directed"), null);
});

done();
