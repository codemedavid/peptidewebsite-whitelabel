/**
 * Pure-core gate for the Pepweb Admin Insights + Customers views
 * (src/lib/mobile/insights.ts, src/lib/mobile/customers.ts). No DB, no network.
 *
 *   npm run test:mobile-insights
 */
import assert from "node:assert";

import { buildInsights, parseRange, windowFor } from "../src/lib/mobile/insights";
import {
  aggregateCustomers,
  customerKeyOf,
  queryCustomers,
  summarizeCustomers,
} from "../src/lib/mobile/customers";
import type { Order } from "../src/storefront/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split("\n").slice(0, 3).join("\n    ")}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

// 2026-09-29 12:00 in Manila (UTC+8)
const NOW = new Date("2026-09-29T04:00:00.000Z");

let seq = 0;
function order(p: {
  at: string;
  price?: number;
  qty?: number;
  name?: string;
  status?: Order["status"];
  email?: string;
  phone?: string;
  customer?: string;
  fee?: number;
  discount?: number;
  paid?: boolean;
  proof?: string;
  method?: string;
  province?: string;
}): Order {
  seq++;
  return {
    id: `o${seq}`,
    orderNumber: `T-${1000 + seq}`,
    status: p.status ?? "new",
    paymentStatus: p.paid ? "paid" : "pending",
    paymentMethod: p.method ?? "GCash",
    paymentProof: p.proof ?? "",
    date: p.at,
    customer: {
      name: p.customer ?? "Ana Cruz",
      email: p.email ?? "ana@example.com",
      phone: p.phone ?? "",
      contactMethod: "messenger",
    },
    shipping: {
      address: "1 Rizal St",
      barangay: "",
      city: "Makati",
      province: p.province ?? "Metro Manila",
      postal: "",
      country: "PH",
      region: "NCR",
      fee: p.fee ?? 0,
    },
    courier: "",
    trackingNumber: "",
    shippingNote: "",
    items: [{ productId: "p1", name: p.name ?? "BPC-157", price: p.price ?? 1000, qty: p.qty ?? 1 }],
    ...(p.discount ? { discount: { code: "X", amount: p.discount } } : {}),
  } as unknown as Order;
}

// ── range parsing & windows ──────────────────────────────────────────────────
section("windows");
test("parseRange accepts the four ranges and defaults to 7d", () => {
  assert.equal(parseRange("today"), "today");
  assert.equal(parseRange("30d"), "30d");
  assert.equal(parseRange("90d"), "90d");
  assert.equal(parseRange("12m"), "7d");
  assert.equal(parseRange(null), "7d");
});
test("7d window = six full Manila days + today, ending tomorrow 00:00 Manila", () => {
  const w = windowFor("7d", NOW);
  assert.equal(w.start.toISOString(), "2026-09-22T16:00:00.000Z"); // Sep 23 00:00 +08
  assert.equal(w.end.toISOString(), "2026-09-29T16:00:00.000Z"); // Sep 30 00:00 +08
  assert.equal(w.prevStart.toISOString(), "2026-09-15T16:00:00.000Z");
  assert.equal(w.prevEnd.toISOString(), w.start.toISOString());
});
test("today compares with yesterday up to the same time of day", () => {
  const w = windowFor("today", NOW);
  assert.equal(w.start.toISOString(), "2026-09-28T16:00:00.000Z");
  assert.equal(w.prevStart.toISOString(), "2026-09-27T16:00:00.000Z");
  assert.equal(w.prevEnd.toISOString(), "2026-09-28T04:00:00.000Z");
});

// ── insights ─────────────────────────────────────────────────────────────────
section("insights");
test("revenue uses the checkout total (items − discount + shipping) and skips cancelled", () => {
  const orders = [
    order({ at: "2026-09-29T01:00:00Z", price: 1000, qty: 2, fee: 150, discount: 100 }), // 2050
    order({ at: "2026-09-28T20:00:00Z", price: 500 }), // 500 (Sep 29 04:00 Manila)
    order({ at: "2026-09-29T02:00:00Z", price: 9999, status: "cancelled" }),
  ];
  const r = buildInsights(orders, orders, { range: "today", now: NOW, currency: "₱" });
  assert.equal(r.kpis.revenue.value, 2550);
  assert.equal(r.kpis.orders.value, 2);
  assert.equal(r.kpis.aov.value, 1275);
  assert.equal(r.kpis.itemsSold.value, 3);
  assert.equal(r.cancelled, 1);
  assert.ok(r.kpis.revenue.label.includes("2,550"));
});
test("today → 24 hourly points; an order at 01:00 UTC lands in the 9am Manila bucket", () => {
  const orders = [order({ at: "2026-09-29T01:15:00Z", price: 700 })];
  const r = buildInsights(orders, orders, { range: "today", now: NOW, currency: "₱" });
  assert.equal(r.series.length, 24);
  assert.equal(r.series[9].revenue, 700);
  assert.equal(r.series[9].orders, 1);
  assert.equal(r.peak?.label, r.series[9].longLabel);
});
test("7d → 7 daily points, oldest first, Manila calendar days", () => {
  const orders = [
    order({ at: "2026-09-22T17:00:00Z", price: 100 }), // Sep 23 01:00 +08 → first bucket
    order({ at: "2026-09-22T15:00:00Z", price: 100 }), // Sep 22 23:00 +08 → previous window
  ];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.equal(r.series.length, 7);
  assert.equal(r.series[0].revenue, 100);
  assert.equal(r.kpis.orders.value, 1);
  assert.equal(r.kpis.orders.delta, 0); // 1 vs 1
});
test("90d → weekly buckets covering the window", () => {
  const r = buildInsights([], [], { range: "90d", now: NOW, currency: "₱" });
  assert.equal(r.series.length, 13);
  assert.equal(r.peak, null);
});
test("delta is a percentage vs the previous window, null without a baseline", () => {
  const orders = [
    order({ at: "2026-09-25T04:00:00Z", price: 300 }),
    order({ at: "2026-09-18T04:00:00Z", price: 200 }),
  ];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.equal(r.kpis.revenue.delta, 50);
  const lone = buildInsights([orders[0]], [orders[0]], { range: "7d", now: NOW, currency: "₱" });
  assert.equal(lone.kpis.revenue.delta, null);
});
test("a future-dated order counts as now instead of vanishing", () => {
  const orders = [order({ at: "2027-01-01T00:00:00Z", price: 400 })];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.equal(r.kpis.revenue.value, 400);
  assert.equal(r.series[6].revenue, 400);
});
test("top products rank by revenue with a share of the window", () => {
  const orders = [
    order({ at: "2026-09-28T04:00:00Z", name: "Tirz", price: 3000 }),
    order({ at: "2026-09-27T04:00:00Z", name: "BPC", price: 500, qty: 2 }),
  ];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.deepEqual(r.topProducts.map((p) => p.name), ["Tirz", "BPC"]);
  assert.equal(r.topProducts[0].share, 0.75);
  assert.equal(r.topProducts[1].detail, "2 sold");
});
test("new vs returning customers use the whole order history", () => {
  const history = [
    order({ at: "2026-08-01T04:00:00Z", email: "old@x.com" }),
    order({ at: "2026-09-28T04:00:00Z", email: "OLD@x.com" }),
    order({ at: "2026-09-28T05:00:00Z", email: "fresh@x.com" }),
  ];
  const r = buildInsights(history.slice(1), history, { range: "7d", now: NOW, currency: "₱" });
  assert.deepEqual(r.customerMix, { new: 1, returning: 1 });
  assert.equal(r.kpis.customers.value, 2);
});
test("collection splits paid/proof money from money still awaited", () => {
  const orders = [
    order({ at: "2026-09-28T04:00:00Z", price: 600, paid: true }),
    order({ at: "2026-09-28T04:00:00Z", price: 300, proof: "https://x/p.jpg", paid: true }),
    order({ at: "2026-09-28T04:00:00Z", price: 300 }),
  ];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.equal(r.collection.collectedShare, 0.75);
});
test("status mix includes cancelled orders", () => {
  const orders = [
    order({ at: "2026-09-28T04:00:00Z", status: "shipped" }),
    order({ at: "2026-09-28T04:00:00Z", status: "cancelled" }),
  ];
  const r = buildInsights(orders, orders, { range: "7d", now: NOW, currency: "₱" });
  assert.deepEqual(
    r.statusMix.map((s) => s.status).sort(),
    ["cancelled", "shipped"],
  );
});

// ── customers ────────────────────────────────────────────────────────────────
section("customers");
test("customer identity: email (case-insensitive) → phone digits → name", () => {
  assert.equal(customerKeyOf(order({ at: NOW.toISOString(), email: " Ana@X.com " })), "e:ana@x.com");
  assert.equal(
    customerKeyOf(order({ at: NOW.toISOString(), email: "", phone: "+63 917-555-0101" })),
    "p:639175550101",
  );
  assert.equal(customerKeyOf(order({ at: NOW.toISOString(), email: "", phone: "", customer: " Ben  Tan " })), "n:ben tan");
  assert.equal(customerKeyOf(order({ at: NOW.toISOString(), email: "", phone: "", customer: " " })), null);
});
test("aggregation merges orders, skips cancelled, and takes the latest name", () => {
  const rows = aggregateCustomers(
    [
      order({ at: "2026-09-01T04:00:00Z", email: "a@x.com", customer: "Ana", price: 1000 }),
      order({ at: "2026-09-20T04:00:00Z", email: "A@x.com", customer: "Ana Cruz", price: 500 }),
      order({ at: "2026-09-21T04:00:00Z", email: "a@x.com", price: 9000, status: "cancelled" }),
    ],
    { now: NOW, currency: "₱" },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ana Cruz");
  assert.equal(rows[0].orders, 2);
  assert.equal(rows[0].spent, 1500);
  assert.equal(rows[0].segment, "returning");
  assert.equal(rows[0].firstAt, "2026-09-01T04:00:00.000Z");
  assert.match(rows[0].key, /^[a-f0-9]{20}$/);
});
test("segments: 1 order new, 2 returning, 3+ loyal; lapsed after 60 days", () => {
  const mk = (email: string, n: number, at: string) =>
    Array.from({ length: n }, () => order({ at, email }));
  const rows = aggregateCustomers(
    [...mk("n@x", 1, "2026-09-20T00:00:00Z"), ...mk("l@x", 3, "2026-05-01T00:00:00Z")],
    { now: NOW, currency: "₱" },
  );
  const by = Object.fromEntries(rows.map((r) => [r.email, r]));
  assert.equal(by["n@x"].segment, "new");
  assert.equal(by["n@x"].lapsed, false);
  assert.equal(by["l@x"].segment, "loyal");
  assert.equal(by["l@x"].lapsed, true);
});
test("query: search name/email/phone, sort by spend or recency", () => {
  const rows = aggregateCustomers(
    [
      order({ at: "2026-09-01T00:00:00Z", email: "big@x", customer: "Big Spender", price: 9000 }),
      order({ at: "2026-09-25T00:00:00Z", email: "late@x", customer: "Latest", price: 100, phone: "0917 111" }),
    ],
    { now: NOW, currency: "₱" },
  );
  assert.deepEqual(queryCustomers(rows, { sort: "spent" }).map((r) => r.name), ["Big Spender", "Latest"]);
  assert.deepEqual(queryCustomers(rows, { sort: "recent" }).map((r) => r.name), ["Latest", "Big Spender"]);
  assert.deepEqual(queryCustomers(rows, { q: "0917" }).map((r) => r.name), ["Latest"]);
  assert.deepEqual(queryCustomers(rows, { q: "BIG" }).map((r) => r.name), ["Big Spender"]);
});
test("summary: returning rate, new this month, lapsed", () => {
  const rows = aggregateCustomers(
    [
      order({ at: "2026-09-10T00:00:00Z", email: "a@x" }),
      order({ at: "2026-09-11T00:00:00Z", email: "a@x" }),
      order({ at: "2026-09-12T00:00:00Z", email: "b@x" }),
      order({ at: "2026-03-12T00:00:00Z", email: "c@x" }),
    ],
    { now: NOW, currency: "₱" },
  );
  const s = summarizeCustomers(rows, NOW);
  assert.equal(s.total, 3);
  assert.equal(s.returningRate, 1 / 3);
  assert.equal(s.newThisMonth, 2);
  assert.equal(s.lapsed, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
