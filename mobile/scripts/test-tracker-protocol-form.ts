// Unit tests for features/tracker/lib/protocol-form.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { emptyForm, formFromGuide, formFromProtocol, formToProtocol, vialFromStrength } from "../src/features/tracker/lib/protocol-form";
import { makeTest, protocol } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker protocol form");

const base = () => ({ ...emptyForm("2026-10-12", "u100_1ml"), name: "BPC-157", vialAmount: "5", waterMl: "2", doseValue: "250" });

test("the dose starts empty and Save stays off until it is entered", () => {
  const form = emptyForm("2026-10-12", "u100_1ml");
  assert.equal(form.doseValue, "");
  assert.equal(formToProtocol({ ...form, name: "BPC-157" }).ok, false);
});

test("the first-run example saves: 5 mg + 2 mL + 250 mcg, every other day", () => {
  const r = formToProtocol({ ...base(), scheduleKind: "everyOther" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.protocol.mix, { vialAmount: 5, vialUnit: "mg", waterMl: 2 });
  assert.deepEqual(r.protocol.schedule, { kind: "interval", everyDays: 2 });
  assert.equal(r.protocol.route, "injection");
});

test("a dose bigger than the vial, or IU against mg, blocks saving", () => {
  assert.equal(formToProtocol({ ...base(), doseValue: "6", doseUnit: "mg" }).ok, false);
  assert.equal(formToProtocol({ ...base(), doseUnit: "iu" }).ok, false);
});

test("pens and orals have no mix or syringe", () => {
  const r = formToProtocol({ ...base(), routeGroup: "pen", doseValue: "0.25", doseUnit: "mg" });
  assert.ok(r.ok && r.protocol.mix === null && r.protocol.syringe === null && r.protocol.route === "pen");
});

test("catalog strength fills the vial size", () => {
  assert.deepEqual(vialFromStrength("5mg"), { vialAmount: "5", vialUnit: "mg" });
  assert.deepEqual(vialFromStrength("10mg · 5mg"), { vialAmount: "10", vialUnit: "mg" });
  assert.equal(vialFromStrength(""), null);
});

test("custom cycles in weeks, and edit round-trips", () => {
  const r = formToProtocol({ ...base(), cycleKey: "custom", cycleOn: "6", cycleOff: "2", cycleInWeeks: true });
  assert.ok(r.ok && r.protocol.cycle?.onDays === 42 && r.protocol.cycle.offDays === 14);
  const p = protocol({ schedule: { kind: "interval", everyDays: 5 }, cycle: { onDays: 56, offDays: 28 } });
  const again = formToProtocol(formFromProtocol(p, "u100_1ml"));
  assert.ok(again.ok);
  if (!again.ok) return;
  assert.deepEqual(again.protocol.schedule, p.schedule);
  assert.deepEqual(again.protocol.cycle, p.cycle);
  assert.deepEqual(again.protocol.dose, p.dose);
});

// ── PepWorld additions ──

test("half-life is optional, user-typed and round-trips", () => {
  const blank = formToProtocol(base());
  assert.ok(blank.ok && blank.protocol.halfLifeHours === null);
  const set = formToProtocol({ ...base(), halfLifeHours: "4.5" });
  assert.ok(set.ok && set.protocol.halfLifeHours === 4.5);
  assert.equal(formToProtocol({ ...base(), halfLifeHours: "abc" }).ok, false);
  assert.equal(formToProtocol({ ...base(), halfLifeHours: "0" }).ok, false);
  assert.equal(formFromProtocol(protocol({ halfLifeHours: 4.5 }), "u100_1ml").halfLifeHours, "4.5");
  assert.equal(formFromProtocol(protocol(), "u100_1ml").halfLifeHours, "");
});

test("a guide copies into an editable draft: name, plain dose, source — no schedule", () => {
  const start = emptyForm("2026-10-12", "u100_1ml");
  const form = formFromGuide({ name: " BPC-157  Healing ", category: "Recovery", dosage: "250mcg once daily" }, start);
  assert.equal(form.name, "BPC-157 Healing");
  assert.equal(form.category, "Recovery");
  assert.equal(form.doseValue, "250");
  assert.equal(form.doseUnit, "mcg");
  assert.deepEqual(form.source, { kind: "guide", name: "BPC-157 Healing" });
  assert.equal(form.scheduleKind, start.scheduleKind);
  assert.deepEqual(form.times, start.times);
  // No plain dose in the guide → the dose stays for the user to enter.
  assert.equal(formFromGuide({ name: "TB-500", dosage: "see your doctor" }, start).doseValue, "");
  const saved = formToProtocol({ ...form, vialAmount: "5", waterMl: "2" });
  assert.ok(saved.ok && saved.protocol.source?.kind === "guide");
});

done();
