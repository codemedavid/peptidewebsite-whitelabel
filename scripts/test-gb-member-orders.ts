/**
 * Self-contained test for "orders per customer" (src/lib/storefront/
 * gb-member-orders.ts): every checkout a member makes in one group buy folds
 * into one consolidated order with total value, amount paid and balance.
 *
 *   npm run test:gb-member-orders
 */

import assert from "node:assert";

import { buildMemberOrders, memberOrderTotals, type MemberOrderInput } from "../src/lib/storefront/gb-member-orders";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

const FEE = { label: "Admin fee", amount: 250 };
let n = 0;
function order(over: Partial<MemberOrderInput> & { email?: string; phone?: string; name?: string }): MemberOrderInput {
  n++;
  return {
    orderNumber: over.orderNumber ?? `MNM-${1000 + n}`,
    date: over.date ?? `2026-11-0${Math.min(9, n)}T08:00:00.000Z`,
    status: over.status ?? "new",
    paymentStatus: over.paymentStatus ?? "paid",
    customerAccountId: over.customerAccountId ?? null,
    customer: over.customer ?? { name: over.name ?? "Bea Cruz", email: over.email ?? "", phone: over.phone ?? "" },
    shipping: over.shipping ?? { address: "1 Rizal St", city: "Makati", fee: 0 },
    items: over.items ?? [{ name: "TR30", productId: "tr30", qty: 1, price: 2000 }],
    adminFee: "adminFee" in over ? over.adminFee : null,
    discount: over.discount ?? null,
    paymentFee: over.paymentFee ?? null,
  };
}

console.log("\nOrders per customer (gb-member-orders)\n");

check("three checkouts by one member become ONE consolidated order", () => {
  const members = buildMemberOrders([
    order({ email: "bea@x.com", phone: "09171234567", adminFee: FEE, items: [{ name: "TR30", productId: "tr30", qty: 2, price: 2000 }] }),
    order({ email: "bea@x.com", phone: "09171234567", items: [{ name: "TR15", productId: "tr15", qty: 1, price: 1200 }] }),
    order({ email: "", phone: "+63 917 123 4567", items: [{ name: "TR30", productId: "tr30", qty: 1, price: 2000 }] }),
  ]);
  assert.equal(members.length, 1);
  const [bea] = members;
  assert.equal(bea.checkouts.length, 3);
  assert.deepEqual(
    bea.products.map((p) => [p.product, p.qty, p.amount]),
    [["TR30", 3, 6000], ["TR15", 1, 1200]],
    "same product across checkouts merges",
  );
  assert.equal(bea.adminFee, 250, "fee counted once");
  assert.equal(bea.total, 6000 + 1200 + 250);
});

check("paid and balance: only the checkouts marked paid count as paid", () => {
  const [bea] = buildMemberOrders([
    order({ email: "bea@x.com", adminFee: FEE, paymentStatus: "paid" }),
    order({ email: "bea@x.com", paymentStatus: "pending", items: [{ name: "TR15", productId: "tr15", qty: 1, price: 1200 }] }),
  ]);
  assert.equal(bea.total, 2000 + 250 + 1200);
  assert.equal(bea.paid, 2250);
  assert.equal(bea.balance, 1200);
  assert.deepEqual(bea.checkouts.map((c) => c.paid), [true, false]);
});

check("links chain: email ties A to B, phone ties B to C → one member", () => {
  const members = buildMemberOrders([
    order({ email: "bea@x.com", phone: "" }),
    order({ email: "bea@x.com", phone: "09171234567" }),
    order({ email: "other@x.com", phone: "09171234567" }),
  ]);
  assert.equal(members.length, 1);
});

check("different members stay apart; the one who owes sorts first", () => {
  const members = buildMemberOrders([
    order({ email: "bea@x.com", name: "Bea" }),
    order({ email: "cal@x.com", name: "Cal", paymentStatus: "pending" }),
  ]);
  assert.deepEqual(members.map((m) => m.name), ["Cal", "Bea"]);
});

check("cancelled checkouts are left out entirely", () => {
  const [bea] = buildMemberOrders([
    order({ email: "bea@x.com" }),
    order({ email: "bea@x.com", status: "cancelled", items: [{ name: "TR15", productId: "tr15", qty: 5, price: 1200 }] }),
  ]);
  assert.equal(bea.checkouts.length, 1);
  assert.equal(bea.total, 2000);
});

check("sizes of one product stay separate lines", () => {
  const [bea] = buildMemberOrders([
    order({ email: "bea@x.com", items: [{ name: "Tirz", productId: "tz", variation: "15mg", qty: 1, price: 1200 }] }),
    order({ email: "bea@x.com", items: [{ name: "Tirz", productId: "tz", variation: "30mg", qty: 1, price: 2000 }] }),
  ]);
  assert.deepEqual(bea.products.map((p) => p.variation), ["15mg", "30mg"]);
});

check("totals use the Orders-screen math (discount off, shipping + fees on)", () => {
  const [m] = buildMemberOrders([
    order({
      email: "bea@x.com",
      adminFee: FEE,
      shipping: { fee: 100 },
      discount: { code: "MNM", label: "Discount", amount: 300 },
      paymentFee: { label: "QR PH fee", amount: 40 },
    }),
  ]);
  assert.equal(m.total, 2000 - 300 + 100 + 250 + 40);
});

check("no contact at all: only the exact same name merges", () => {
  const members = buildMemberOrders([
    order({ customer: { name: "Ana" } }),
    order({ customer: { name: "ana " } }),
    order({ customer: { name: "Ben" } }),
  ]);
  assert.equal(members.length, 2);
});

check("round totals add up the member rows", () => {
  const members = buildMemberOrders([
    order({ email: "bea@x.com", paymentStatus: "paid" }),
    order({ email: "cal@x.com", paymentStatus: "pending" }),
  ]);
  assert.deepEqual(memberOrderTotals(members), { total: 4000, paid: 2000, balance: 2000 });
});

check("the newest checkout's name and address win", () => {
  const [m] = buildMemberOrders([
    order({ email: "bea@x.com", name: "Bea", date: "2026-11-01T00:00:00.000Z", shipping: { address: "Old St", fee: 0 } }),
    order({ email: "bea@x.com", name: "Bea Cruz", date: "2026-11-05T00:00:00.000Z", shipping: { address: "New St", fee: 0 } }),
  ]);
  assert.equal(m.name, "Bea Cruz");
  assert.ok(m.address.startsWith("New St"), m.address);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
