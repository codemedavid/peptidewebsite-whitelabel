// Unit tests for features/tracker/lib/weight.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { formatWeight, regionOf, toKg, toUnit, weightUnitForLocale } from "../src/features/tracker/lib/weight";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker weight");

test("region from a locale tag", () => {
  assert.equal(regionOf("en-US"), "US");
  assert.equal(regionOf("en_PH"), "PH");
  assert.equal(regionOf("zh-Hant-TW"), "TW");
  assert.equal(regionOf("es-419"), "419");
  assert.equal(regionOf("en"), null);
  assert.equal(regionOf(null), null);
});

test("lb in the US, Liberia and Myanmar; kg everywhere else", () => {
  assert.equal(weightUnitForLocale("en-US"), "lb");
  assert.equal(weightUnitForLocale("en-LR"), "lb");
  assert.equal(weightUnitForLocale("my-MM"), "lb");
  assert.equal(weightUnitForLocale("en-PH"), "kg");
  assert.equal(weightUnitForLocale("en-GB"), "kg");
  assert.equal(weightUnitForLocale("fil"), "kg");
  assert.equal(weightUnitForLocale(undefined), "kg");
});

test("stored kg round-trips through either unit", () => {
  assert.equal(Math.round(toKg(toUnit(72.5, "lb"), "lb") * 1000) / 1000, 72.5);
  assert.equal(toUnit(72.5, "kg"), 72.5);
  assert.equal(formatWeight(72.5, "lb"), "159.8 lb");
});

done();
