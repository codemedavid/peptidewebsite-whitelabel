/**
 * Group-buy kits — identity, size and the ONE counting rule
 * (src/lib/storefront/gb-kits.ts).
 *
 *   npm run test:gb-kits
 *
 * A kit is per VARIATION: "Tirzepatide — 30mg" fills its own kit, never the
 * 15mg one. Its size is the variation's kitSize, falling back to the product's
 * vialsPerKit. Which orders count depends on the round's payment mode, and the
 * counter, the Bunuan cap, Ligwak and the supplier report all read tallyKits.
 */
import assert from "node:assert";

import {
  countsTowardKits,
  kitKey,
  kitMath,
  kitSizeFor,
  normalizeKitSize,
  readKitLines,
  tallyKits,
  withLineKitColumns,
  type KitOrder,
  type KitProduct,
} from "../src/lib/storefront/gb-kits";
import { orderCountsAsDemand, productLineKey } from "../src/lib/storefront/group-buy";

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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const tirz: KitProduct = {
  id: "tirz",
  vialsPerKit: 10,
  variations: [{ name: "15mg" }, { name: "30mg", kitSize: 5 }],
};
const reta: KitProduct = { id: "reta", variations: [{ name: "10mg", kitSize: 10 }] };
const bac: KitProduct = { id: "bac" };
const key = (productId: string, variation?: string) => kitKey({ name: "", productId, variation });

function order(id: string, items: unknown, extra: Partial<KitOrder> = {}): KitOrder {
  return { id, placedAt: "2026-10-01T00:00:00Z", status: "new", items, ...extra };
}

console.log("\nkitKey\n");

check("is exactly productLineKey (the supplier report's SKU identity)", () => {
  const lines = [
    { name: "Tirz — 30mg", productId: "tirz", variation: "30mg" },
    { name: "Tirz", productId: "tirz" },
    { name: "Legacy line" },
  ];
  for (const l of lines) assert.equal(kitKey(l), productLineKey(l));
});
check("two variations of one product are two kits", () => {
  assert.notEqual(key("tirz", "15mg"), key("tirz", "30mg"));
});

console.log("\nnormalizeKitSize\n");

check("positive whole numbers pass, strings are read, decimals floor", () => {
  assert.equal(normalizeKitSize(10), 10);
  assert.equal(normalizeKitSize(" 5 "), 5);
  assert.equal(normalizeKitSize(7.9), 7);
});
check("zero, negatives, junk and blanks are 'not set'", () => {
  for (const raw of [0, -1, "abc", "", null, undefined, NaN, {}]) {
    assert.equal(normalizeKitSize(raw), undefined, String(raw));
  }
});
check("absurd sizes are capped", () => {
  assert.equal(normalizeKitSize(99999), 1000);
});

console.log("\nkitSizeFor\n");

check("the variation's own kitSize wins over the product's", () => {
  assert.equal(kitSizeFor(tirz, "30mg"), 5);
});
check("a variation without one falls back to the product's vialsPerKit", () => {
  assert.equal(kitSizeFor(tirz, "15mg"), 10);
});
check("the product's base option uses the product's size", () => {
  assert.equal(kitSizeFor(tirz), 10);
  assert.equal(kitSizeFor(tirz, ""), 10);
});
check("no size anywhere → null (not part of kits)", () => {
  assert.equal(kitSizeFor(bac), null);
  assert.equal(kitSizeFor(reta), null);
});
check("a variation-only size applies to that variation alone", () => {
  assert.equal(kitSizeFor(reta, "10mg"), 10);
});
check("an unknown variation name falls back to the product", () => {
  assert.equal(kitSizeFor(tirz, "60mg"), 10);
});
check("variation names match after trimming", () => {
  assert.equal(kitSizeFor(tirz, " 30mg "), 5);
});
check("a junk variation kitSize falls back instead of breaking", () => {
  assert.equal(kitSizeFor({ id: "x", vialsPerKit: 4, variations: [{ name: "a", kitSize: "zero" }] }, "a"), 4);
});

console.log("\nkitMath — the spec formulas\n");

check("143 vials @ 10 → 14 kits, 3 leftover, 7 needed", () => {
  assert.deepEqual(kitMath(143, 10), { fullKits: 14, leftover: 3, vialsNeeded: 7 });
});
check("an exact multiple needs nothing", () => {
  assert.deepEqual(kitMath(140, 10), { fullKits: 14, leftover: 0, vialsNeeded: 0 });
});
check("no demand needs nothing (never opens a fresh kit)", () => {
  assert.deepEqual(kitMath(0, 10), { fullKits: 0, leftover: 0, vialsNeeded: 0 });
});
check("no kit size → no kits, nothing needed", () => {
  assert.deepEqual(kitMath(7, null), { fullKits: 0, leftover: 0, vialsNeeded: 0 });
});

console.log("\ncountsTowardKits — one rule per payment mode\n");

const statuses = ["new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled", "canceled", "refunded"];

check("pay_later: every placed order except cancelled / refunded (= supplier DEMAND)", () => {
  for (const status of statuses) {
    assert.equal(countsTowardKits({ status }, "pay_later"), orderCountsAsDemand(status), status);
  }
});
check("pay_first: an unchecked new order does NOT count", () => {
  assert.equal(countsTowardKits({ status: "new", paymentStatus: "pending" }, "pay_first"), false);
});
check("pay_first: a confirmed or later order counts", () => {
  for (const status of ["confirmed", "processing", "shipped", "delivered"]) {
    assert.equal(countsTowardKits({ status }, "pay_first"), true, status);
  }
});
check("pay_first: payment marked paid counts even before the status moves", () => {
  assert.equal(countsTowardKits({ status: "new", paymentStatus: "paid" }, "pay_first"), true);
});
check("pay_first: a paid order that was cancelled or refunded does not count", () => {
  assert.equal(countsTowardKits({ status: "cancelled", paymentStatus: "paid" }, "pay_first"), false);
  assert.equal(countsTowardKits({ status: "Refunded", paymentStatus: "paid" }, "pay_first"), false);
});
check("status casing does not matter", () => {
  assert.equal(countsTowardKits({ status: "CONFIRMED" }, "pay_first"), true);
  assert.equal(countsTowardKits({ status: "Cancelled" }, "pay_later"), false);
});

console.log("\nreadKitLines — untrusted items JSON\n");

check("keeps good lines, drops junk", () => {
  const lines = readKitLines([
    { name: "A", qty: 2, productId: "a", variation: "5mg" },
    { name: "B", qty: "3" },
    { name: "bad", qty: -1 },
    { name: "nan", qty: "x" },
    null,
    "str",
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.qty, l.productId, l.variation]),
    [
      ["A", 2, "a", "5mg"],
      ["B", 3, undefined, undefined],
    ],
  );
});
check("lines keep their original index (so results map back to the order)", () => {
  const lines = readKitLines([null, { name: "B", qty: 1 }]);
  assert.equal(lines[0].index, 1);
});
check("a non-array is no lines", () => {
  assert.deepEqual(readKitLines({ name: "x" }), []);
  assert.deepEqual(readKitLines(undefined), []);
});
check("cancelledQty is read and clamped to the line's qty", () => {
  const [l] = readKitLines([{ name: "A", qty: 4, cancelledQty: 9 }]);
  assert.equal(l.cancelledQty, 4);
});
check("a line-level placedAt (store-added vials) is kept", () => {
  const [l] = readKitLines([{ name: "A", qty: 1, placedAt: "2026-10-05T00:00:00Z" }]);
  assert.equal(l.placedAt, "2026-10-05T00:00:00Z");
});

console.log("\ntallyKits\n");

const orders: KitOrder[] = [
  order("o1", [
    { name: "Tirz — 15mg", qty: 8, productId: "tirz", variation: "15mg" },
    { name: "Tirz — 30mg", qty: 3, productId: "tirz", variation: "30mg" },
  ]),
  order("o2", [{ name: "Tirz — 15mg", qty: 5, productId: "tirz", variation: "15mg" }]),
  order("o3", [{ name: "Tirz — 15mg", qty: 50, productId: "tirz", variation: "15mg" }], { status: "cancelled" }),
  order("o4", [{ name: "Bac water", qty: 2, productId: "bac" }]),
];

check("sums vials per variation and applies each variation's kit size", () => {
  const t = tallyKits(orders, [tirz, bac], "pay_later");
  const k15 = t[key("tirz", "15mg")];
  const k30 = t[key("tirz", "30mg")];
  assert.deepEqual(
    [k15.vials, k15.kitSize, k15.fullKits, k15.leftover, k15.vialsNeeded],
    [13, 10, 1, 3, 7],
  );
  assert.deepEqual([k30.vials, k30.kitSize, k30.vialsNeeded], [3, 5, 2]);
  assert.deepEqual([k15.productId, k15.variation, k15.name], ["tirz", "15mg", "Tirz — 15mg"]);
});
check("cancelled orders are not counted", () => {
  assert.equal(tallyKits(orders, [tirz], "pay_later")[key("tirz", "15mg")].vials, 13);
});
check("a product with no kit size is tallied with kitSize null and needs nothing", () => {
  const b = tallyKits(orders, [tirz, bac], "pay_later")[key("bac")];
  assert.deepEqual([b.vials, b.kitSize, b.vialsNeeded], [2, null, 0]);
});
check("pay_first counts only checked orders", () => {
  const mixed = [
    order("p1", [{ name: "T", qty: 8, productId: "tirz", variation: "15mg" }], { status: "confirmed" }),
    order("p2", [{ name: "T", qty: 5, productId: "tirz", variation: "15mg" }], { status: "new" }),
  ];
  assert.equal(tallyKits(mixed, [tirz], "pay_first")[key("tirz", "15mg")].vials, 8);
});
check("ligwak'd vials (cancelledQty) come off the count", () => {
  const t = tallyKits(
    [order("l1", [{ name: "T", qty: 15, cancelledQty: 5, productId: "tirz", variation: "15mg" }])],
    [tirz],
    "pay_later",
  );
  const k = t[key("tirz", "15mg")];
  assert.deepEqual([k.vials, k.fullKits, k.vialsNeeded], [10, 1, 0]);
});
check("lines of a product not in the catalog still tally, with no kit", () => {
  const t = tallyKits([order("x", [{ name: "Gone", qty: 3, productId: "gone" }])], [tirz], "pay_later");
  assert.equal(t[key("gone")].kitSize, null);
});
check("never mutates its inputs", () => {
  const copy = deepFreeze(JSON.parse(JSON.stringify(orders)) as KitOrder[]);
  const before = JSON.stringify(copy);
  tallyKits(copy, [deepFreeze(JSON.parse(JSON.stringify(tirz)) as KitProduct)], "pay_later");
  assert.equal(JSON.stringify(copy), before);
});

console.log("\nwithLineKitColumns — supplier rows per variation\n");

check("each variation row gets its own kit size", () => {
  const rows = [
    { productId: "tirz", variation: "15mg", name: "Tirz — 15mg", vials: 13 },
    { productId: "tirz", variation: "30mg", name: "Tirz — 30mg", vials: 3 },
    { productId: "bac", variation: null, name: "Bac", vials: 2 },
  ];
  const out = withLineKitColumns(rows, [tirz, bac]);
  assert.deepEqual(
    out.map((r) => [r.vialsPerKit, r.kits, r.shortBy]),
    [
      [10, 2, 7],
      [5, 1, 2],
      [null, null, null],
    ],
  );
  assert.equal("kits" in rows[0], false, "input rows untouched");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
