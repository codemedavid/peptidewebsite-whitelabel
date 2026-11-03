/**
 * Self-contained test for one customer's order history + the dashboard's Top
 * customers panel:
 *
 *   - src/lib/storefront/customer-profile.ts
 *       customerKeyOf()           — email → phone → name identity
 *       parseCustomerLookup()     — untrusted server-action input → lookup | null
 *       summarizeCustomerOrders() — orders / spent / avg / first & last; cancelled never count
 *       rankTopCustomers()        — best buyers by spend or by order count
 *   - src/lib/storefront/admin-dashboard.ts
 *       buildTopCustomers()       — empty without the orders grant; always ranked by spend
 *   - src/storefront/admin/staff-permissions.ts
 *       the customer-profile view is gated by the Orders grant
 *
 *   npm run test:customer-profile
 */

import assert from "node:assert";
import {
  customerKeyOf,
  parseCustomerLookup,
  rankTopCustomers,
  summarizeCustomerOrders,
} from "../src/lib/storefront/customer-profile";
import { buildTopCustomers, orderTotal, type DashboardCaps } from "../src/lib/storefront/admin-dashboard";
import { isViewAllowed, permissionViewFor } from "../src/storefront/admin/staff-permissions";
import type { Order } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

const NOW = new Date("2026-10-29T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const order = (over: Partial<Order> & { email?: string; name?: string; phone?: string; total?: number } = {}): Order => {
  const { email = "ava@mail.com", name = "Ava Reyes", phone = "", total = 1000, ...rest } = over;
  return {
    id: `o-${Math.random().toString(36).slice(2)}`,
    orderNumber: "ABC-1001",
    status: "delivered",
    paymentStatus: "paid",
    paymentMethod: "gcash",
    date: daysAgo(1),
    customer: { name, email, phone, contactMethod: "" },
    shipping: { address: "", barangay: "", city: "", province: "", postal: "", country: "", region: "", fee: 0 },
    courier: "",
    trackingNumber: "",
    shippingNote: "",
    items: [{ name: "Peptide A", qty: 1, price: total }],
    paymentProof: null,
    ...rest,
  } as Order;
};

const caps = (over: Partial<DashboardCaps> = {}): DashboardCaps => ({
  analytics: true,
  orders: true,
  inventory: true,
  products: true,
  categories: true,
  ...over,
});

console.log("\ncustomerKeyOf");
check("email wins, trimmed + lower-cased", () => {
  assert.equal(customerKeyOf(order({ email: " Ava@Mail.COM " })), "e:ava@mail.com");
});
check("falls back to phone digits, then name, then null", () => {
  assert.equal(customerKeyOf(order({ email: "", phone: "+63 917-555-0101" })), "p:639175550101");
  assert.equal(customerKeyOf(order({ email: "", phone: "123", name: " Ben  Tan " })), "n:ben tan");
  assert.equal(customerKeyOf(order({ email: "", phone: "", name: " " })), null);
});

console.log("\nparseCustomerLookup");
check("accepts an account id (cuid) and a normalized email", () => {
  assert.deepEqual(parseCustomerLookup({ kind: "account", id: "clx9abc123def456" }), { kind: "account", id: "clx9abc123def456" });
  assert.deepEqual(parseCustomerLookup({ kind: "email", email: "  Ava@Mail.com " }), { kind: "email", email: "ava@mail.com" });
});
check("rejects junk, injection-shaped ids and non-emails", () => {
  for (const bad of [
    null,
    "ava@mail.com",
    {},
    { kind: "account", id: "short" },
    { kind: "account", id: "abc'; DROP TABLE x;--" },
    { kind: "account", id: 42 },
    { kind: "email", email: "not-an-email" },
    { kind: "email", email: `${"a".repeat(250)}@x.co` },
    { kind: "admin", id: "clx9abc123def456" },
  ]) {
    assert.equal(parseCustomerLookup(bad), null, JSON.stringify(bad));
  }
});

console.log("\nsummarizeCustomerOrders");
check("counts, spend, average and first/last; cancelled excluded from all money", () => {
  const s = summarizeCustomerOrders(
    [
      order({ total: 1000, date: daysAgo(10) }),
      order({ total: 3000, date: daysAgo(2) }),
      order({ total: 9999, status: "cancelled", date: daysAgo(0) }),
    ],
    orderTotal,
  );
  assert.equal(s.orders, 2);
  assert.equal(s.cancelled, 1);
  assert.equal(s.spent, 4000);
  assert.equal(s.avg, 2000);
  assert.equal(s.firstAt, daysAgo(10));
  assert.equal(s.lastAt, daysAgo(2), "a cancelled order is not their last order");
});
check("no orders → zeros and null dates (no divide-by-zero)", () => {
  const s = summarizeCustomerOrders([], orderTotal);
  assert.deepEqual(s, { orders: 0, cancelled: 0, spent: 0, avg: 0, firstAt: null, lastAt: null });
});

console.log("\nrankTopCustomers");
const book = [
  order({ email: "ava@mail.com", total: 500, date: daysAgo(5) }),
  order({ email: "AVA@mail.com", name: "Ava R.", total: 500, date: daysAgo(1) }),
  order({ email: "ben@mail.com", name: "Ben", total: 5000, date: daysAgo(3) }),
  order({ email: "cy@mail.com", name: "Cy", total: 100, date: daysAgo(2) }),
  order({ email: "cy@mail.com", name: "Cy", total: 100, date: daysAgo(9) }),
  order({ email: "cy@mail.com", name: "Cy", total: 100, date: daysAgo(8) }),
  order({ email: "dee@mail.com", name: "Dee", total: 99_999, status: "cancelled" }),
];
check("by spend: biggest spender first; cancelled orders never rank anyone", () => {
  const rows = rankTopCustomers(book, { by: "spent", limit: 5, totalOf: orderTotal });
  assert.deepEqual(rows.map((r) => r.email), ["ben@mail.com", "ava@mail.com", "cy@mail.com"]);
});
check("by orders: most orders first, ties broken by most recent", () => {
  const rows = rankTopCustomers(book, { by: "orders", limit: 5, totalOf: orderTotal });
  assert.deepEqual(rows.map((r) => r.email), ["cy@mail.com", "ava@mail.com", "ben@mail.com"]);
});
check("one buyer across email casing; newest order's name wins; lastAt is the newest", () => {
  const ava = rankTopCustomers(book, { by: "spent", limit: 5, totalOf: orderTotal }).find((r) => r.email === "ava@mail.com");
  assert.ok(ava);
  assert.equal(ava.orders, 2);
  assert.equal(ava.spent, 1000);
  assert.equal(ava.name, "Ava R.");
  assert.equal(ava.lastAt, daysAgo(1));
});
check("respects the limit; a buyer without an email has email '' (not openable)", () => {
  assert.equal(rankTopCustomers(book, { by: "spent", limit: 2, totalOf: orderTotal }).length, 2);
  const [row] = rankTopCustomers([order({ email: "", phone: "09175550101" })], { by: "orders", limit: 5, totalOf: orderTotal });
  assert.equal(row.email, "");
});

console.log("\nbuildTopCustomers (dashboard gate)");
check("empty without the orders capability", () => {
  assert.deepEqual(buildTopCustomers({ caps: caps({ orders: false }), orders: book }), []);
});
check("without analytics: still ranked by spend, spend present (per-customer money is order money)", () => {
  const rows = buildTopCustomers({ caps: caps({ analytics: false }), orders: book });
  assert.equal(rows[0].email, "ben@mail.com");
  assert.equal(rows[0].spent, 5000);
});
check("with analytics: ranked by spend, spend present; caps at 5 by default", () => {
  const many = Array.from({ length: 8 }, (_, i) => order({ email: `b${i}@mail.com`, total: 100 * (i + 1) }));
  const rows = buildTopCustomers({ caps: caps(), orders: many });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].email, "b7@mail.com");
  assert.equal(rows[0].spent, 800);
});

console.log("\ncustomer-profile view permission");
check("folds into the Orders grant", () => {
  assert.equal(permissionViewFor("customer-profile"), "orders");
  assert.equal(isViewAllowed({ kind: "staff", id: "s", permissions: ["orders"] }, "customer-profile"), true);
  assert.equal(isViewAllowed({ kind: "staff", id: "s", permissions: ["customers"] }, "customer-profile"), false);
  assert.equal(isViewAllowed({ kind: "owner" }, "customer-profile"), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
