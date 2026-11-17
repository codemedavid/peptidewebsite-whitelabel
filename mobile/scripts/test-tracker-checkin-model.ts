// Unit tests for features/tracker/components/checkin-model.ts. Run: npm run test:tracker
import assert from "node:assert/strict";
import { EMPTY_FORM, formFrom, formToValues, hasAnswer, lastWeight, NO_EFFECTS, otherEffects, toggleEffect } from "../src/features/tracker/components/checkin-model";
import type { CheckIn } from "../src/features/tracker/lib/types";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker check-in model");

const STAMP = "2026-01-01T00:00:00.000Z";
const checkin = (over: Partial<CheckIn> = {}): CheckIn => ({
  id: "c1", createdAt: STAMP, updatedAt: STAMP, deletedAt: null,
  date: "2026-10-12", energy: null, mood: null, appetite: null, sleep: null, effects: [], note: null, weightKg: null, ...over,
});

test("'No side effects' and real effects exclude each other", () => {
  assert.deepEqual(toggleEffect(["Nausea", "Headache"], NO_EFFECTS), [NO_EFFECTS]);
  assert.deepEqual(toggleEffect([NO_EFFECTS], "Nausea"), ["Nausea"]);
  assert.deepEqual(toggleEffect(["Nausea"], "Nausea"), []);
  assert.deepEqual(toggleEffect([NO_EFFECTS], NO_EFFECTS), []);
});

test("'Other' splits on commas, trims, drops duplicates and known chips", () => {
  assert.deepEqual(otherEffects(" Itchy site, itchy site ,, Nausea, Hot flush"), ["Itchy site", "Hot flush"]);
});

test("a saved day round-trips through the form (weight in the user's unit)", () => {
  const saved = checkin({ energy: 4, effects: ["Nausea", "Itchy site"], weightKg: 72.5, note: "ok" });
  const form = formFrom(saved, "kg");
  assert.deepEqual(form.effects, ["Nausea"]);
  assert.equal(form.other, "Itchy site");
  assert.equal(form.weight, "72.5");
  const r = formToValues(form, "kg");
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.values.effects, ["Nausea", "Itchy site"]);
    assert.equal(r.values.weightKg, 72.5);
    assert.equal(r.values.energy, 4);
  }
  assert.equal(formFrom(checkin({ weightKg: 72.5 }), "lb").weight, "159.8");
});

test("'None' stored explicitly; typed 'Other' is ignored with it", () => {
  const r = formToValues({ ...EMPTY_FORM, effects: [NO_EFFECTS], other: "Rash" }, "kg");
  assert.ok(r.ok && r.values.effects.length === 1 && r.values.effects[0] === NO_EFFECTS);
  assert.deepEqual(formFrom(checkin({ effects: [NO_EFFECTS] }), "kg").effects, [NO_EFFECTS]);
});

test("weight is validated and converted to kg", () => {
  assert.equal(formToValues({ ...EMPTY_FORM, weight: "abc" }, "kg").ok, false);
  assert.equal(formToValues({ ...EMPTY_FORM, weight: "5" }, "kg").ok, false);
  const lb = formToValues({ ...EMPTY_FORM, weight: "160" }, "lb");
  assert.ok(lb.ok && lb.values.weightKg === 72.57);
  const blank = formToValues(EMPTY_FORM, "kg");
  assert.ok(blank.ok && blank.values.weightKg === null && blank.values.note === null);
});

test("an empty form has nothing to save", () => {
  assert.equal(hasAnswer(EMPTY_FORM), false);
  assert.equal(hasAnswer({ ...EMPTY_FORM, effects: [NO_EFFECTS] }), true);
  assert.equal(hasAnswer({ ...EMPTY_FORM, other: " , " }), false);
});

test("last weight is the newest weigh-in before the day", () => {
  const list = [checkin({ id: "a", date: "2026-10-01", weightKg: 70 }), checkin({ id: "b", date: "2026-10-05", weightKg: 71 }), checkin({ id: "c", date: "2026-10-12", weightKg: 72 }), checkin({ id: "d", date: "2026-10-08" })];
  assert.equal(lastWeight(list, "2026-10-12")?.id, "b");
  assert.equal(lastWeight(list, "2026-10-01"), null);
});

done();
