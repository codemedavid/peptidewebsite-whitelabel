/**
 * Order lines are priced from the live catalog, and a line that matches no live
 * product (or option) is REFUSED — never kept at the price the browser sent.
 *
 *   npm run test:reprice-items
 */
import assert from "node:assert/strict";
import { repriceOrderItems } from "../src/lib/orders/reprice";
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

function product(p: Partial<Product> & { id: string }): Product {
  return {
    name: "Product",
    description: "",
    price: 0,
    currency: "₱",
    category: "all",
    featured: false,
    image: null,
    stock: 10,
    ...p,
  };
}

const plain = product({ id: "p1", name: "BPC-157", price: 1500 });
const withOptions = product({
  id: "p2",
  name: "Tirzepatide",
  price: 2000,
  variations: [{ name: "10mg", price: 2500 }],
} as Partial<Product> & { id: string });
const catalog = [plain, withOptions];

console.log("\nrepriceOrderItems\n");

check("a tampered price on a real product is replaced by the catalog price", () => {
  const items: OrderItem[] = [{ productId: "p1", name: "BPC-157", qty: 2, price: 0.01 }];
  const r = repriceOrderItems(items, catalog);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.items[0].price, 1500);
});

check("a variation line is priced at its option's price", () => {
  const items: OrderItem[] = [{ productId: "p2", name: "Tirzepatide 10mg", qty: 1, price: 1, variation: "10mg" }];
  const r = repriceOrderItems(items, catalog);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.items[0].price, 2500);
});

check("an invented product is refused, not kept at the sent price", () => {
  const items: OrderItem[] = [
    { productId: "p1", name: "BPC-157", qty: 1, price: 1500 },
    { productId: "nope", name: "Free stuff", qty: 5, price: 0.01 },
  ];
  const r = repriceOrderItems(items, catalog);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Free stuff/);
});

check("a line with no productId and an unknown name is refused", () => {
  const r = repriceOrderItems([{ name: "Anything", qty: 1, price: 1 }], catalog);
  assert.equal(r.ok, false);
});

check("a real product with a removed/bogus variation is refused", () => {
  const items: OrderItem[] = [{ productId: "p2", name: "Tirzepatide", qty: 1, price: 1, variation: "99mg" }];
  const r = repriceOrderItems(items, catalog);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /99mg/);
});

check("refusal leaves the input untouched; success never mutates it", () => {
  const bad: OrderItem[] = [
    { productId: "p1", name: "BPC-157", qty: 1, price: 0.01 },
    { productId: "nope", name: "X", qty: 1, price: 0.01 },
  ];
  repriceOrderItems(bad, catalog);
  assert.equal(bad[0].price, 0.01);
  const good: OrderItem[] = [{ productId: "p1", name: "BPC-157", qty: 1, price: 0.01 }];
  const r = repriceOrderItems(good, catalog);
  assert.equal(good[0].price, 0.01);
  assert.ok(r.ok && r.items[0] !== good[0]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
