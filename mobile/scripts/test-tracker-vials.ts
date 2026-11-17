// Unit tests for features/tracker/lib/vials.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { quickDose } from "../src/features/tracker/lib/quick-log";
import { DEFAULT_SETTINGS } from "../src/features/tracker/lib/types";
import {
  activeVial,
  addedOrderKeys,
  effectiveMix,
  vialExpiry,
  vialForDose,
  vialFromOrder,
  vialStatus,
  withVialMix,
} from "../src/features/tracker/lib/vials";
import { dose, makeTest, oct, protocol, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker vials");

test("a fresh 5 mg vial at 250 mcg holds 20 doses", () => {
  const s = vialStatus(vial(), [], protocol(), oct(12, 9));
  assert.equal(s.pct, 100);
  assert.equal(s.dosesLeft, 20);
  assert.equal(s.isLow, false);
  assert.equal(s.daysSinceMixed, 12);
});

test("logs against the vial deduct; others do not", () => {
  const doses = [dose(oct(10), { vialId: "v1" }), dose(oct(11), { vialId: "v1" }), dose(oct(11), { vialId: "other" })];
  const s = vialStatus(vial(), doses, protocol(), oct(12, 9));
  assert.equal(s.used, 0.5);
  assert.equal(s.dosesLeft, 18);
  assert.equal(s.pct, 90);
});

test("deleting a dose gives it back", () => {
  const doses = [dose(oct(10), { vialId: "v1", deletedAt: "2026-10-11T00:00:00.000Z" })];
  assert.equal(vialStatus(vial(), doses, protocol(), oct(12, 9)).dosesLeft, 20);
});

test("low at 3 doses or fewer, run-out date follows the schedule", () => {
  const doses = Array.from({ length: 17 }, (_, i) => dose(new Date(2026, 8, 20 + i, 8), { vialId: "v1" }));
  const s = vialStatus(vial(), doses, protocol(), oct(12, 9));
  assert.equal(s.dosesLeft, 3);
  assert.equal(s.isLow, true);
  assert.equal(s.runOutDate?.getDate(), 15);
});

test("the newest active vial is in use", () => {
  const vials = [
    vial({ id: "old", mixedOn: "2026-09-01" }),
    vial({ id: "new", mixedOn: "2026-10-01" }),
    vial({ id: "done", status: "finished", mixedOn: "2026-10-05" }),
  ];
  assert.equal(activeVial(vials, "p1")?.id, "new");
});

test("units follow the vial in use, else the protocol mix", () => {
  const p = protocol();
  const remixed = vial({ amount: 10, waterMl: 2 });
  assert.deepEqual(effectiveMix(p, [remixed]), { vialAmount: 10, vialUnit: "mg", waterMl: 2 });
  assert.deepEqual(effectiveMix(p, [vial({ waterMl: null })]), p.mix);
  assert.deepEqual(effectiveMix(p, [vial({ status: "finished", amount: 10 })]), p.mix);
  assert.equal(withVialMix(p, []), p);
  // Taken: the dose comes off the vial in use; no syringe units / mL are computed (App Store 1.4.2).
  const draft = quickDose(p, null, { doses: [], vials: [remixed], settings: DEFAULT_SETTINGS }, oct(12, 9));
  assert.equal(draft.units, null);
  assert.equal(draft.volumeMl, null);
  assert.equal(draft.vialId, remixed.id);
});

test("a back-dated dose comes off the vial mixed on or before that day", () => {
  const old = vial({ id: "v-old", mixedOn: "2026-09-01", status: "finished" });
  const current = vial({ id: "v-new", mixedOn: "2026-10-01", status: "active" });
  const vials = [old, current];
  assert.equal(vialForDose(vials, "p1", oct(5))?.id, "v-new");
  assert.equal(vialForDose(vials, "p1", new Date(2026, 8, 15, 8))?.id, "v-old");
  assert.equal(vialForDose(vials, "p1", new Date(2026, 7, 20, 8)), null);
  assert.equal(vialForDose(vials, "p1", oct(1))?.id, "v-new");
  assert.equal(vialForDose(vials, "other", oct(5)), null);
  // Same-day tie: the vial in use wins.
  const sameDay = vial({ id: "v-same", mixedOn: "2026-10-01", status: "finished", createdAt: "2026-10-02T00:00:00.000Z" });
  assert.equal(vialForDose([sameDay, current], "p1", oct(5))?.id, "v-new");
});

// ── PepWorld additions ──

test("an order line becomes an unopened vial that never takes a dose or replaces the one in use", () => {
  const draft = vialFromOrder({ key: "ord-1:line-2", strength: { value: 10, unit: "mg" } }, "p1");
  assert.deepEqual(draft?.source, { kind: "order", key: "ord-1:line-2" });
  assert.equal(draft?.unopened, true);
  assert.equal(draft?.waterMl, null);
  const shelf = vial({ ...draft, id: "v-shelf", mixedOn: null, createdAt: "2026-10-11T00:00:00.000Z" });
  const inUse = vial();
  assert.equal(activeVial([inUse, shelf], "p1")?.id, "v1");
  assert.equal(vialForDose([inUse, shelf], "p1", oct(12))?.id, "v1");
  assert.equal(vialStatus(shelf, [], protocol(), oct(12)).isLow, false);
  assert.equal(vialFromOrder({ key: "x", strength: null }, "p1"), null);
});

test("order keys already added hide their lines (deleted vials offer them again)", () => {
  const added = vial({ id: "a", source: { kind: "order", key: "k1" } });
  const gone = vial({ id: "b", source: { kind: "order", key: "k2" }, deletedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual([...addedOrderKeys([added, gone, vial({ id: "c" })])], ["k1"]);
});

test("expiry defaults to 28 days after mixing and can be set", () => {
  assert.equal(vialExpiry({ mixedOn: "2026-09-30", expiresOn: null }), "2026-10-28");
  assert.equal(vialExpiry({ mixedOn: null, expiresOn: null }), null);
  assert.equal(vialExpiry({ mixedOn: "2026-09-30", expiresOn: "2026-10-05" }), "2026-10-05");
  assert.equal(vialStatus(vial(), [], protocol(), oct(28, 9)).isExpired, false);
  assert.equal(vialStatus(vial(), [], protocol(), oct(29, 9)).isExpired, true);
});

done();
