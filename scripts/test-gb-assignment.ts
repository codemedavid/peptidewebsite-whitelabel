/**
 * Tests for group buy ASSIGNMENT DRIFT — src/lib/storefront/group-buy-assignment.ts.
 *
 * WHY THIS EXISTS (k-glow, 2026-07-30)
 * The "july 28" round assigned 5 products. Customers ordered 3 completely
 * different ones. Zero overlap, so groupBuyForOrder() stamped groupBuyId = NULL
 * on every order AND those buyers silently missed group-buy pricing at checkout.
 *
 * The admin showed nothing wrong: the round listed 5 perfectly valid products.
 * The mechanical cause was duplicate catalog rows — the round was assigned an
 * OLD "Tirzepatide" id (stock 0) while customers bought a NEWER row with the
 * same NAME and a different id. Nothing in the UI can distinguish those by eye.
 *
 * So drift has to be detected from BEHAVIOUR (what is actually being ordered),
 * never from the assignment list alone. This module is that detector.
 *
 *   npm run test:gb-assignment
 */

import assert from "node:assert";

import {
  detectAssignmentDrift,
  productsToAssign,
  type DriftRound,
} from "../src/lib/storefront/group-buy-assignment";
import type { LinkableOrder } from "../src/lib/storefront/group-buy-orders";

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

// ──────────────────────────── fixtures ───────────────────────────────────────
// The k-glow shape: an assignment that covers nothing anyone bought.

const P_OLD_TIRZ = "p-tirz-old"; // assigned, stock 0, nobody buys it
const P_NEW_TIRZ = "p-tirz-new"; // what customers actually order
const P_BACWATER = "p-bacwater";
const P_TESA = "p-tesa";
const P_GONE = "p-deleted"; // assigned but the product row is gone

/** Ids that exist in the catalog. Anything assigned but absent here is dangling. */
const CATALOG = new Set([P_OLD_TIRZ, P_NEW_TIRZ, P_BACWATER, P_TESA]);

const round = (productIds: string[]): DriftRound => ({
  id: "gb-1",
  name: "july 28",
  productIds,
});

const order = (
  items: Array<{ productId?: string; name: string; qty: number }>,
  status = "confirmed",
): LinkableOrder => ({
  date: new Date().toISOString(),
  status,
  paymentStatus: "paid",
  items: items.map((i) => ({ ...i, price: 1000 })),
});

const KGLOW_ORDERS: LinkableOrder[] = [
  order([
    { productId: P_NEW_TIRZ, name: "Tirzepatide", qty: 2 },
    { productId: P_BACWATER, name: "Bacteriostatic Water", qty: 3 },
  ]),
  order([{ productId: P_TESA, name: "Tesamorelin", qty: 1 }]),
];

function main() {
  console.log("\nGroup Buy assignment drift\n");

  // ── the k-glow case ────────────────────────────────────────────────────────
  console.log("the k-glow case");

  check("flags every ordered product the round does not cover", () => {
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), KGLOW_ORDERS, CATALOG);
    assert.deepEqual(d.orderedUnassigned.map((p) => p.name).sort(), [
      "Bacteriostatic Water",
      "Tesamorelin",
      "Tirzepatide",
    ]);
  });

  check("reports drift even though the assigned product is a VALID product", () => {
    // The whole trap: p-tirz-old exists and looks right in the admin.
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), KGLOW_ORDERS, CATALOG);
    assert.equal(d.hasDrift, true);
    assert.equal(d.danglingAssignments.length, 0, "nothing is dangling — it's a live product");
  });

  check("counts vials and orders per unassigned product", () => {
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), KGLOW_ORDERS, CATALOG);
    const tirz = d.orderedUnassigned.find((p) => p.productId === P_NEW_TIRZ);
    assert.equal(tirz?.vials, 2);
    assert.equal(tirz?.orders, 1);
    const water = d.orderedUnassigned.find((p) => p.productId === P_BACWATER);
    assert.equal(water?.vials, 3);
  });

  check("sorts the biggest sellers first — that's what to fix first", () => {
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), KGLOW_ORDERS, CATALOG);
    const vials = d.orderedUnassigned.map((p) => p.vials);
    assert.deepEqual(vials, [...vials].sort((a, b) => b - a));
  });

  check("reports assigned products nobody ordered", () => {
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), KGLOW_ORDERS, CATALOG);
    assert.deepEqual(
      d.assignedUnsold.map((p) => p.productId),
      [P_OLD_TIRZ],
    );
  });

  // ── no drift ───────────────────────────────────────────────────────────────
  console.log("no drift");

  check("a correctly assigned round reports nothing", () => {
    const d = detectAssignmentDrift(round([P_NEW_TIRZ, P_BACWATER, P_TESA]), KGLOW_ORDERS, CATALOG);
    assert.equal(d.hasDrift, false);
    assert.deepEqual(d.orderedUnassigned, []);
    assert.deepEqual(d.assignedUnsold, []);
  });

  check("a WHOLE-CATALOG round can never drift", () => {
    // Empty productIds means the round covers everything — flagging each ordered
    // product as "unassigned" would be a permanent false alarm.
    const d = detectAssignmentDrift(round([]), KGLOW_ORDERS, CATALOG);
    assert.equal(d.hasDrift, false);
    assert.deepEqual(d.orderedUnassigned, []);
    assert.equal(d.coversWholeCatalog, true);
  });

  check("a round with no orders yet reports no drift", () => {
    const d = detectAssignmentDrift(round([P_OLD_TIRZ]), [], CATALOG);
    assert.equal(d.hasDrift, false);
    assert.deepEqual(d.orderedUnassigned, []);
  });

  check("assigned-but-unsold ALONE is not drift", () => {
    // A round can legitimately list a product nobody bought yet. Only orders the
    // round fails to cover — or a dead id — are actionable.
    const d = detectAssignmentDrift(
      round([P_NEW_TIRZ, P_BACWATER, P_TESA, P_OLD_TIRZ]),
      KGLOW_ORDERS,
      CATALOG,
    );
    assert.deepEqual(
      d.assignedUnsold.map((p) => p.productId),
      [P_OLD_TIRZ],
    );
    assert.equal(d.hasDrift, false);
  });

  // ── dangling assignments ───────────────────────────────────────────────────
  console.log("dangling assignments");

  check("an assigned id with no product row is reported", () => {
    const d = detectAssignmentDrift(round([P_NEW_TIRZ, P_GONE]), KGLOW_ORDERS, CATALOG);
    assert.deepEqual(d.danglingAssignments, [P_GONE]);
  });

  check("a dangling id IS drift on its own", () => {
    const d = detectAssignmentDrift(
      round([P_NEW_TIRZ, P_BACWATER, P_TESA, P_GONE]),
      KGLOW_ORDERS,
      CATALOG,
    );
    assert.deepEqual(d.orderedUnassigned, [], "everything ordered is covered");
    assert.equal(d.hasDrift, true, "but a dead id still needs the owner's attention");
  });

  check("a dangling id is not also reported as unsold", () => {
    const d = detectAssignmentDrift(round([P_GONE]), KGLOW_ORDERS, CATALOG);
    assert.deepEqual(
      d.assignedUnsold.map((p) => p.productId),
      [],
    );
  });

  check("an empty catalog does not mass-flag every assignment", () => {
    // Defensive: a failed/empty product lookup must not claim every id is dead.
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), KGLOW_ORDERS, new Set());
    assert.deepEqual(d.danglingAssignments, []);
  });

  // ── cancelled orders ───────────────────────────────────────────────────────
  console.log("cancelled orders");

  check("a cancelled order does not create drift by itself", () => {
    const cancelled = [order([{ productId: P_TESA, name: "Tesamorelin", qty: 4 }], "cancelled")];
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), cancelled, CATALOG);
    assert.deepEqual(d.orderedUnassigned, [], "a cancelled order is not demand");
    assert.equal(d.hasDrift, false);
  });

  check("cancelled vials never inflate the drift counts", () => {
    const mixed = [
      order([{ productId: P_TESA, name: "Tesamorelin", qty: 1 }]),
      order([{ productId: P_TESA, name: "Tesamorelin", qty: 9 }], "cancelled"),
    ];
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), mixed, CATALOG);
    const tesa = d.orderedUnassigned.find((p) => p.productId === P_TESA);
    assert.equal(tesa?.vials, 1, "the cancelled 9 must not be counted");
    assert.equal(tesa?.orders, 1);
  });

  // ── legacy / malformed lines ───────────────────────────────────────────────
  console.log("legacy and malformed lines");

  check("a line with no productId is ignored, not reported as a dead id", () => {
    const legacy = [order([{ name: "Very old line item", qty: 3 }])];
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), legacy, CATALOG);
    assert.deepEqual(d.orderedUnassigned, []);
    assert.equal(d.hasDrift, false);
  });

  check("the same product across several orders aggregates", () => {
    const repeat = [
      order([{ productId: P_TESA, name: "Tesamorelin", qty: 2 }]),
      order([{ productId: P_TESA, name: "Tesamorelin", qty: 5 }]),
    ];
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), repeat, CATALOG);
    const tesa = d.orderedUnassigned.find((p) => p.productId === P_TESA);
    assert.equal(tesa?.vials, 7);
    assert.equal(tesa?.orders, 2);
  });

  check("one order listing a product twice counts as ONE order", () => {
    const twice = [
      order([
        { productId: P_TESA, name: "Tesamorelin", qty: 2 },
        { productId: P_TESA, name: "Tesamorelin 2mg", qty: 3 },
      ]),
    ];
    const d = detectAssignmentDrift(round([P_NEW_TIRZ]), twice, CATALOG);
    const tesa = d.orderedUnassigned.find((p) => p.productId === P_TESA);
    assert.equal(tesa?.vials, 5);
    assert.equal(tesa?.orders, 1);
  });

  // ── the one-click fix ──────────────────────────────────────────────────────
  console.log("the one-click fix");

  check("productsToAssign returns the round's ids plus the missing ones", () => {
    const r = round([P_OLD_TIRZ]);
    const d = detectAssignmentDrift(r, KGLOW_ORDERS, CATALOG);
    const next = productsToAssign(r, d);
    assert.equal(next.includes(P_OLD_TIRZ), true, "existing assignments are kept");
    assert.equal(next.includes(P_NEW_TIRZ), true);
    assert.equal(next.includes(P_BACWATER), true);
    assert.equal(next.includes(P_TESA), true);
  });

  check("productsToAssign never duplicates an id", () => {
    const r = round([P_OLD_TIRZ, P_OLD_TIRZ, P_NEW_TIRZ]);
    const next = productsToAssign(r, detectAssignmentDrift(r, KGLOW_ORDERS, CATALOG));
    assert.equal(new Set(next).size, next.length);
  });

  check("productsToAssign drops dangling ids while adding the real ones", () => {
    const r = round([P_GONE, P_OLD_TIRZ]);
    const next = productsToAssign(r, detectAssignmentDrift(r, KGLOW_ORDERS, CATALOG));
    assert.equal(next.includes(P_GONE), false, "a dead id must not be re-saved");
    assert.equal(next.includes(P_OLD_TIRZ), true);
  });

  check("productsToAssign is a no-op when there is no drift", () => {
    const r = round([P_NEW_TIRZ, P_BACWATER, P_TESA]);
    const next = productsToAssign(r, detectAssignmentDrift(r, KGLOW_ORDERS, CATALOG));
    assert.deepEqual(next.slice().sort(), [P_NEW_TIRZ, P_BACWATER, P_TESA].sort());
  });

  check("productsToAssign never returns an empty list for an assigned round", () => {
    // Empty means "whole catalog" — silently widening a targeted round to the
    // entire shop would change storefront pricing for every product.
    const r = round([P_GONE]);
    const next = productsToAssign(r, detectAssignmentDrift(r, KGLOW_ORDERS, CATALOG));
    assert.ok(next.length > 0, "must not collapse the round to whole-catalog");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
