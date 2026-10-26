/**
 * The pure glue between a round's stored row and its stage (2A):
 * src/modules/bunuan/core/stage-sync.ts, core/counter.ts and
 * src/lib/orders/gb-line-status.ts.
 *
 *   npm run test:gb-stage-sync
 *
 *   • effective stage — a round the old editor closed reads Closed even while
 *     its stored stage is still Open/Bunuan; an Open round whose endsAt passed
 *     says so (windowEnded) instead of pretending to be Closed.
 *   • the stage row writes — Start Bunuan clears the timer (Bunuan has none),
 *     Close closes, Reopen re-activates and drops a lapsed endsAt, Payment
 *     time keeps the round closed.
 *   • the old round editor (status save) keeps the stage in step, and refuses
 *     to reopen a round once Ligwak is locked or Payment time started.
 *   • the Bunuan counter / cap counts every placed order's vials (a pay_first
 *     order awaiting its check still HOLDS its vials, or two buyers could take
 *     the same last vials), and reports those pending vials separately.
 *   • line statuses — Pending until the lock, then Success / Partial / Cancelled.
 */
import assert from "node:assert";

import {
  effectiveStage,
  stageForStatusSave,
  stageMoveEligible,
  stageRowWrite,
  windowEnded,
} from "../src/modules/bunuan/core/stage-sync";
import { bunuanClaimsTally, bunuanCounter } from "../src/modules/bunuan/core/counter";
import { gbLineStatuses } from "../src/lib/orders/gb-line-status";
import { kitKey, type KitOrder, type KitProduct } from "../src/lib/storefront/gb-kits";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const NOW = new Date("2026-10-27T08:00:00.000Z");
const PAST = new Date("2026-10-26T08:00:00.000Z");
const FUTURE = new Date("2026-10-30T08:00:00.000Z");
const row = (over: Record<string, unknown> = {}) => ({
  status: "active",
  stage: "open",
  startsAt: null,
  endsAt: FUTURE,
  closedAt: null,
  ligwakLockedAt: null,
  ...over,
});

console.log("\neffective stage\n");

check("a live open round is Open, window not ended", () => {
  assert.equal(effectiveStage(row(), NOW), "open");
  assert.equal(windowEnded(row(), NOW), false);
});
check("Open whose endsAt passed: still Open for the admin, windowEnded says why nobody can order", () => {
  assert.equal(effectiveStage(row({ endsAt: PAST }), NOW), "open");
  assert.equal(windowEnded(row({ endsAt: PAST }), NOW), true);
});
check("a round the old editor closed reads Closed, even with a stored Open/Bunuan stage", () => {
  for (const status of ["closed", "cancelled", "archived"]) {
    assert.equal(effectiveStage(row({ status }), NOW), "closed", status);
    assert.equal(effectiveStage(row({ status, stage: "bunuan" }), NOW), "closed", status);
  }
});
check("Payment time stays Payment time on a closed row", () => {
  assert.equal(effectiveStage(row({ status: "closed", stage: "payment" }), NOW), "payment");
});
check("junk stage reads Open", () => assert.equal(effectiveStage(row({ stage: "ligwak" }), NOW), "open"));
check("drafts, cancelled / archived rounds and scheduled rounds that haven't started take no stage moves", () => {
  assert.equal(stageMoveEligible(row({ status: "draft" }), NOW), false);
  assert.equal(stageMoveEligible(row({ status: "cancelled" }), NOW), false);
  assert.equal(stageMoveEligible(row({ status: "archived" }), NOW), false);
  assert.equal(stageMoveEligible(row({ status: "scheduled", startsAt: FUTURE }), NOW), false);
  assert.equal(stageMoveEligible(row({ status: "scheduled", startsAt: PAST }), NOW), true);
  assert.equal(stageMoveEligible(row(), NOW), true);
  assert.equal(stageMoveEligible(row({ status: "closed", stage: "closed" }), NOW), true);
});

console.log("\nstage row writes\n");

check("Start Bunuan: stage + active, the timer cleared (Bunuan has no end date)", () => {
  assert.deepEqual(stageRowWrite("bunuan", row({ endsAt: PAST }), NOW, {}), {
    stage: "bunuan",
    stageChangedAt: NOW,
    status: "active",
    endsAt: null,
  });
});
check("Close: closed + closedAt stamped once", () => {
  assert.deepEqual(stageRowWrite("closed", row(), NOW, {}), { stage: "closed", stageChangedAt: NOW, status: "closed", closedAt: NOW });
  const earlier = new Date("2026-10-20T00:00:00.000Z");
  assert.equal(stageRowWrite("closed", row({ closedAt: earlier }), NOW, {}).closedAt, earlier);
});
check("Reopen: active again; a lapsed endsAt is dropped, a future one kept", () => {
  assert.deepEqual(stageRowWrite("open", row({ status: "closed", stage: "closed", endsAt: PAST }), NOW, {}), {
    stage: "open",
    stageChangedAt: NOW,
    status: "active",
    endsAt: null,
  });
  assert.equal(stageRowWrite("open", row({ status: "closed", stage: "closed" }), NOW, {}).endsAt, FUTURE);
});
check("Payment time: stays closed, records the optional due date", () => {
  assert.deepEqual(stageRowWrite("payment", row({ status: "closed", stage: "closed" }), NOW, { paymentDueAt: FUTURE }), {
    stage: "payment",
    stageChangedAt: NOW,
    paymentDueAt: FUTURE,
  });
  assert.equal(stageRowWrite("payment", row({ status: "closed" }), NOW, {}).paymentDueAt, null);
});

console.log("\nthe old round editor keeps the stage in step\n");

check("closing an Open / Bunuan round moves the stage to Closed", () => {
  for (const stage of ["open", "bunuan"]) {
    const r = stageForStatusSave({ status: "active", stage, ligwakLockedAt: null }, "closed", NOW);
    assert.deepEqual(r, { ok: true, write: { stage: "closed", stageChangedAt: NOW }, move: { from: stage, to: "closed" } });
  }
});
check("reopening a Closed round (before the lock) moves the stage back to Open", () => {
  const r = stageForStatusSave({ status: "closed", stage: "closed", ligwakLockedAt: null }, "active", NOW);
  assert.deepEqual(r, { ok: true, write: { stage: "open", stageChangedAt: NOW }, move: { from: "closed", to: "open" } });
});
check("reopening after the Ligwak lock or at Payment time is refused", () => {
  const locked = stageForStatusSave({ status: "closed", stage: "closed", ligwakLockedAt: PAST }, "active", NOW);
  assert.ok(!locked.ok && /locked/i.test(locked.error), JSON.stringify(locked));
  const pay = stageForStatusSave({ status: "closed", stage: "payment", ligwakLockedAt: null }, "active", NOW);
  assert.ok(!pay.ok && /payment time/i.test(pay.error), JSON.stringify(pay));
});
check("a save that doesn't cross open ↔ closed leaves the stage alone", () => {
  assert.deepEqual(stageForStatusSave({ status: "active", stage: "open", ligwakLockedAt: null }, "active", NOW), {
    ok: true,
    write: {},
    move: null,
  });
  assert.deepEqual(stageForStatusSave({ status: "closed", stage: "closed", ligwakLockedAt: PAST }, "archived", NOW), {
    ok: true,
    write: {},
    move: null,
  });
});

console.log("\nthe Bunuan counter (claims)\n");

const tirz: KitProduct = { id: "tirz", vialsPerKit: 10, variations: [{ name: "15mg" }] };
const k15 = kitKey({ name: "", productId: "tirz", variation: "15mg" });
const line = (qty: number) => ({ name: "Tirz — 15mg", qty, productId: "tirz", variation: "15mg" });
const o = (id: string, qty: number, status: string, paymentStatus = "pending"): KitOrder => ({
  id,
  placedAt: `2026-10-2${id.length}T00:00:00Z`,
  status,
  paymentStatus,
  items: [line(qty)],
});

check("every placed, non-cancelled order holds its vials — paid or not", () => {
  const t = bunuanClaimsTally([o("a", 8, "confirmed", "paid"), o("bb", 4, "new"), o("ccc", 9, "cancelled")], [tirz]);
  assert.deepEqual([t[k15].vials, t[k15].vialsNeeded], [12, 8]);
});
check("pay_first: vials still awaiting a payment check are reported as pending", () => {
  const c = bunuanCounter([o("a", 8, "confirmed", "paid"), o("bb", 4, "new")], [tirz], "pay_first");
  assert.deepEqual(
    c.kits.map((k) => [k.key, k.vials, k.vialsNeeded, k.pendingVials]),
    [[k15, 12, 8, 4]],
  );
  assert.deepEqual([c.openCount, c.allFilled], [1, false]);
});
check("pay_later: nothing is pending", () => {
  const c = bunuanCounter([o("a", 8, "new"), o("bb", 2, "new")], [tirz], "pay_later");
  assert.deepEqual(c.kits.map((k) => [k.vials, k.vialsNeeded, k.pendingVials]), [[10, 0, 0]]);
  assert.deepEqual([c.openCount, c.allFilled], [0, true]);
});

console.log("\nline statuses\n");

const items = [
  { name: "A", qty: 5, price: 100 },
  { name: "B", qty: 5, price: 100, cancelledQty: 3 },
  { name: "C", qty: 2, price: 100, cancelledQty: 2 },
];
check("a store without Ligwak shows no line status", () => {
  assert.deepEqual(gbLineStatuses({ items }, { enabled: false }), [null, null, null]);
});
check("before the lock every line is Pending", () => {
  assert.deepEqual(
    gbLineStatuses({ items }, { enabled: true }).map((s) => s?.label),
    ["Pending", "Pending", "Pending"],
  );
});
check("after the lock: Success, '2 Success · 3 Cancelled', Cancelled", () => {
  const s = gbLineStatuses({ items, adjustedTotal: 400 }, { enabled: true });
  assert.deepEqual(
    s.map((x) => [x?.lineStatus, x?.successQty, x?.cancelledQty, x?.label]),
    [
      ["success", 5, 0, "Success"],
      ["partial", 2, 3, "2 Success · 3 Cancelled"],
      ["cancelled", 0, 2, "Cancelled"],
    ],
  );
});
check("a re-totalled order shows its line statuses even if the store later loses Ligwak", () => {
  assert.equal(gbLineStatuses({ items, adjustedTotal: 400 }, { enabled: false })[1]?.lineStatus, "partial");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
