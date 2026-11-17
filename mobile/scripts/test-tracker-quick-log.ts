// Unit tests for features/tracker/lib/quick-log.ts (new in PepWorld). Run: npm run test:tracker
import assert from "node:assert/strict";
import { typedAmounts, quickDose, siteFor } from "../src/features/tracker/lib/quick-log";
import { DEFAULT_SETTINGS } from "../src/features/tracker/lib/types";
import { dose, makeTest, oct, protocol, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker quick log");

const data = (over: Partial<{ doses: ReturnType<typeof dose>[]; vials: ReturnType<typeof vial>[] }> = {}) => ({
  doses: [],
  vials: [],
  settings: DEFAULT_SETTINGS,
  ...over,
});

test("one tap logs now, the protocol's dose as entered (no computed mL/units), for the scheduled slot", () => {
  const now = oct(12, 8, 10);
  const draft = quickDose(protocol(), oct(12, 8), data(), now);
  assert.equal(draft.protocolId, "p1");
  assert.equal(draft.name, "BPC-157");
  assert.equal(draft.takenAt, now.toISOString());
  assert.equal(draft.scheduledFor, oct(12, 8).toISOString());
  assert.deepEqual(draft.dose, { value: 250, unit: "mcg" });
  assert.equal(draft.volumeMl, null);
  assert.equal(draft.units, null);
  assert.equal(draft.note, null);
  assert.equal(quickDose(protocol(), null, data(), now).scheduledFor, null);
});

test("the open vial is attached (so the dose comes off it); no draw is computed from its mix", () => {
  const open = vial({ id: "v-open", amount: 10, waterMl: 2 });
  const draft = quickDose(protocol(), null, data({ vials: [open] }), oct(12, 9));
  assert.equal(draft.vialId, "v-open");
  assert.equal(draft.units, null);
  assert.equal(draft.volumeMl, null);
  const shelf = vial({ id: "v-shelf", unopened: true, mixedOn: null });
  assert.equal(quickDose(protocol(), null, data({ vials: [shelf] }), oct(12, 9)).vialId, null);
});

test("sites rotate for injections only, and only when switched on", () => {
  const recent = [dose(oct(11), { site: "belly_ll" })];
  assert.equal(siteFor(protocol(), data({ doses: recent }), oct(12)), "belly_lr");
  assert.equal(siteFor(protocol({ rotateSites: false }), data(), oct(12)), null);
  assert.equal(siteFor(protocol({ route: "oral" }), data(), oct(12)), null);
  assert.equal(siteFor(protocol(), { doses: [], settings: { ...DEFAULT_SETTINGS, suggestSites: false } }, oct(12)), null);
});

test("only amounts the user typed are recorded: mL / units doses keep theirs, mass doses get none", () => {
  assert.deepEqual(typedAmounts({ value: 250, unit: "mcg" }), { volumeMl: null, units: null });
  assert.deepEqual(typedAmounts({ value: 12, unit: "units" }), { volumeMl: null, units: 12 });
  assert.deepEqual(typedAmounts({ value: 0.2, unit: "ml" }), { volumeMl: 0.2, units: null });
  const p = protocol({ dose: { value: 10, unit: "units" } });
  assert.equal(quickDose(p, null, data({ vials: [vial({ amount: 10, waterMl: 2 })] }), oct(12, 9)).units, 10);
});

done();
