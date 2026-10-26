/**
 * Admin order-line edits, re-priced on the server (src/lib/orders/gb-order-edit.ts).
 *
 *   npm run test:gb-reprice
 *
 * The admin sends the WHOLE edited line list. Lines it keeps hold their
 * snapshot price (what the customer was charged); lines it adds — including
 * extra vials on an existing line — are priced from the live catalog through
 * the checkout's own authoritativeItemPrice, never from the browser, and are
 * stamped placedAt/addedBy so Ligwak treats them as the newest vials.
 */
import assert from "node:assert";

import { repriceEditedLines, type EditedLine } from "../src/lib/orders/gb-order-edit";
import { kitKey } from "../src/lib/storefront/gb-kits";
import type { GroupBuyPriceScope } from "../src/lib/storefront/two-ways";
import type { OrderItem, Product } from "../src/storefront/types";

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

const catalog = [
  {
    id: "tirz",
    name: "Tirzepatide",
    price: 2000,
    productType: "gb",
    gbPrice: 1500,
    variations: [
      { name: "15mg", price: 2000, gbPrice: 1500 },
      { name: "30mg", price: 3000, gbPrice: 2500 },
    ],
  },
  { id: "bac", name: "Bac water", price: 50 },
] as unknown as Product[];
const round: GroupBuyPriceScope = { coversAll: true, productIds: [] };
const NOW = "2026-10-27T03:00:00.000Z";
const opts = { scope: round, now: NOW };

const current: OrderItem[] = [
  { name: "Tirzepatide — 15mg", qty: 5, price: 1400, productId: "tirz", variation: "15mg" },
  { name: "Bac water", qty: 2, price: 50, productId: "bac" },
];
const k15 = kitKey({ name: "", productId: "tirz", variation: "15mg" });
const k30 = kitKey({ name: "", productId: "tirz", variation: "30mg" });
const kBac = kitKey({ name: "", productId: "bac" });
const keep = (index: number): EditedLine => ({ index, qty: current[index].qty });

function ok(r: ReturnType<typeof repriceEditedLines>) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r;
}
function err(r: ReturnType<typeof repriceEditedLines>) {
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

console.log("\nkeeping and lowering\n");

check("unchanged list → same lines, no changes", () => {
  const r = ok(repriceEditedLines(current, [keep(0), keep(1)], catalog, opts));
  assert.deepEqual(r.items, current);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.kitDeltas, {});
});
check("lowering a line keeps its snapshot price", () => {
  const r = ok(repriceEditedLines(current, [{ index: 0, qty: 3 }, keep(1)], catalog, opts));
  assert.deepEqual([r.items[0].qty, r.items[0].price], [3, 1400]);
  assert.deepEqual(r.changes, [
    { kind: "qty", key: k15, name: "Tirzepatide — 15mg", variation: "15mg", fromQty: 5, toQty: 3, price: 1400 },
  ]);
  assert.deepEqual(r.kitDeltas, { [k15]: -2 });
});
check("a line left out (or set to 0) is removed", () => {
  const omitted = ok(repriceEditedLines(current, [keep(0)], catalog, opts));
  const zeroed = ok(repriceEditedLines(current, [keep(0), { index: 1, qty: 0 }], catalog, opts));
  for (const r of [omitted, zeroed]) {
    assert.deepEqual(r.items.map((i) => i.name), ["Tirzepatide — 15mg"]);
    assert.deepEqual(r.changes.map((c) => [c.kind, c.fromQty, c.toQty]), [["removed", 2, 0]]);
    assert.deepEqual(r.kitDeltas, { [kBac]: -2 });
  }
});

console.log("\nadding\n");

check("a new line is priced from the catalog at its variation's group-buy price", () => {
  const r = ok(repriceEditedLines(current, [keep(0), keep(1), { productId: "tirz", variation: "30mg", qty: 2 }], catalog, opts));
  const added = r.items[2];
  assert.deepEqual(
    [added.name, added.qty, added.price, added.productId, added.variation, added.placedAt, added.addedBy],
    ["Tirzepatide — 30mg", 2, 2500, "tirz", "30mg", NOW, "store"],
  );
  assert.deepEqual(r.kitDeltas, { [k30]: 2 });
  assert.deepEqual(r.changes.map((c) => c.kind), ["added"]);
});
check("raising a line appends the extra vials as a new, newer line at the live price", () => {
  const r = ok(repriceEditedLines(current, [{ index: 0, qty: 7 }, keep(1)], catalog, opts));
  assert.deepEqual(r.items.map((i) => [i.variation ?? null, i.qty, i.price, i.placedAt ?? null]), [
    ["15mg", 5, 1400, null],
    [null, 2, 50, null],
    ["15mg", 2, 1500, NOW],
  ]);
  assert.deepEqual(r.kitDeltas, { [k15]: 2 });
});
check("outside a live round the regular price applies", () => {
  const r = ok(repriceEditedLines(current, [keep(0), keep(1), { productId: "tirz", variation: "30mg", qty: 1 }], catalog, { now: NOW }));
  assert.equal(r.items[2].price, 3000);
});
check("a price sent by the browser is ignored", () => {
  const sneaky = { productId: "tirz", variation: "30mg", qty: 1, price: 1 } as EditedLine;
  const r = ok(repriceEditedLines(current, [keep(0), keep(1), sneaky], catalog, opts));
  assert.equal(r.items[2].price, 2500);
});
check("a product's base option can be added without a variation", () => {
  const r = ok(repriceEditedLines(current, [keep(0), keep(1), { productId: "bac", qty: 1 }], catalog, opts));
  assert.deepEqual([r.items[2].name, r.items[2].price, r.items[2].variation], ["Bac water", 50, undefined]);
});

console.log("\nrefusals\n");

check("a product that isn't in the catalog", () => {
  assert.ok(err(repriceEditedLines(current, [keep(0), { productId: "nope", qty: 1 }], catalog, opts)).includes("catalog"));
});
check("a variation the product doesn't have", () => {
  assert.ok(err(repriceEditedLines(current, [keep(0), { productId: "tirz", variation: "99mg", qty: 1 }], catalog, opts)));
});
check("a quantity that isn't a whole number from 0 to 999", () => {
  for (const qty of [-1, 1.5, "abc", 1000, null]) {
    err(repriceEditedLines(current, [{ index: 0, qty }], catalog, opts));
  }
});
check("a new line with qty 0 is refused (nothing to add)", () => {
  err(repriceEditedLines(current, [keep(0), { productId: "bac", qty: 0 }], catalog, opts));
});
check("an index that doesn't exist, or appears twice", () => {
  err(repriceEditedLines(current, [{ index: 5, qty: 1 }], catalog, opts));
  err(repriceEditedLines(current, [keep(0), { index: 0, qty: 1 }], catalog, opts));
});
check("removing every line — cancel the order instead", () => {
  assert.ok(err(repriceEditedLines(current, [], catalog, opts)).toLowerCase().includes("cancel"));
});
check("an absurd number of lines", () => {
  const many = Array.from({ length: 101 }, () => ({ productId: "bac", qty: 1 }));
  err(repriceEditedLines(current, many, catalog, opts));
});
check("never mutates the order lines, the edit or the catalog", () => {
  const items = Object.freeze(current.map((i) => Object.freeze({ ...i })));
  const edit = Object.freeze([Object.freeze({ index: 0, qty: 9 }), Object.freeze({ index: 1, qty: 0 })]);
  const before = JSON.stringify([items, catalog]);
  ok(repriceEditedLines(items, edit, catalog, opts));
  assert.equal(JSON.stringify([items, catalog]), before);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
