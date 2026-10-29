/**
 * Self-contained test for "My Group Buy Order" (src/lib/storefront/
 * my-groupbuy-order.ts): a buyer's email + phone lookup of their own orders in
 * each group-buy round — matching, merged lines, totals, round ordering — plus
 * source checks that the server action and the feature flag stay wired.
 *
 *   npm run test:my-groupbuy-order
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMyGroupBuyOrder,
  matchesBuyer,
  mergeBuyerLines,
  parseBuyerLookup,
  sumBuyerTotals,
  LOOKUP_INPUT_ERROR,
  type BuyerKeys,
  type BuyerOrder,
} from "../src/lib/storefront/my-groupbuy-order";
import type { RoundRow } from "../src/lib/mobile/order-rounds";
import { FEATURES, OPERATOR_GRANTABLE, PLAN_FEATURES, FEATURE_META } from "../src/lib/features/catalog";
import { isPageVisible } from "../src/storefront/visibility";
import { buildStorefrontNav } from "../src/lib/storefront/nav";
import type { Brand } from "../src/storefront/types";

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

const NOW = new Date("2026-11-10T00:00:00.000Z");
const BEA = { email: "bea@x.com", phone: "09171234567" };
const KEYS: BuyerKeys = (() => {
  const p = parseBuyerLookup(BEA);
  if (!p.ok) throw new Error("fixture keys failed to parse");
  return p.keys;
})();

let n = 0;
function order(over: Partial<BuyerOrder> & { email?: string; phone?: string } = {}): BuyerOrder {
  n++;
  return {
    id: over.id ?? `o${n}`,
    orderNumber: over.orderNumber ?? `MNM-${1000 + n}`,
    date: over.date ?? `2026-11-0${Math.min(9, n)}T08:00:00.000Z`,
    status: over.status ?? "new",
    paymentStatus: over.paymentStatus ?? "pending",
    customer: over.customer ?? {
      name: "Bea Cruz",
      email: over.email ?? BEA.email,
      phone: over.phone ?? BEA.phone,
      contactMethod: "",
    },
    groupBuyId: "groupBuyId" in over ? over.groupBuyId : "gb1",
    groupBuyName: over.groupBuyName ?? "Batch 1",
    ...(over.deletedAt ? { deletedAt: over.deletedAt } : {}),
    items: over.items ?? [{ name: "TR30", productId: "tr30", qty: 1, price: 2000 }],
    shipping: over.shipping ?? ({ fee: 0 } as BuyerOrder["shipping"]),
    adminFee: over.adminFee,
    paymentFee: over.paymentFee,
    discount: over.discount,
    ...(over.gbTotals ? { gbTotals: over.gbTotals, adjustedTotal: over.adjustedTotal } : {}),
  };
}

function round(over: Partial<RoundRow> & { id: string }): RoundRow {
  return {
    name: "Batch",
    batchNumber: null,
    status: "closed",
    startsAt: null,
    endsAt: null,
    closedAt: null,
    deliveryEta: "",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    stage: "closed",
    paymentDueAt: null,
    ligwakLockedAt: null,
    ...over,
  };
}

const GB1 = round({ id: "gb1", name: "Batch 1", status: "active", stage: "open", deliveryEta: "3–4 weeks after close" });

console.log("\nMy Group Buy Order (my-groupbuy-order)\n");

// ── Input + matching ─────────────────────────────────────────────────────────

check("both fields are required to look anything up", () => {
  assert.deepEqual(parseBuyerLookup({ email: "bea@x.com", phone: "" }), { ok: false, error: LOOKUP_INPUT_ERROR });
  assert.deepEqual(parseBuyerLookup({ email: "", phone: "09171234567" }), { ok: false, error: LOOKUP_INPUT_ERROR });
  assert.deepEqual(parseBuyerLookup({ email: "not-an-email", phone: "09171234567" }), { ok: false, error: LOOKUP_INPUT_ERROR });
  assert.deepEqual(parseBuyerLookup({ email: "bea@x.com", phone: "123" }), { ok: false, error: LOOKUP_INPUT_ERROR });
  assert.deepEqual(parseBuyerLookup(null), { ok: false, error: LOOKUP_INPUT_ERROR });
  assert.deepEqual(parseBuyerLookup({ email: 5, phone: ["0917"] }), { ok: false, error: LOOKUP_INPUT_ERROR });
});

check("an order matches only when email AND phone both agree", () => {
  assert.equal(matchesBuyer({ email: "bea@x.com", phone: "09171234567" }, KEYS), true);
  assert.equal(matchesBuyer({ email: "bea@x.com", phone: "09999999999" }, KEYS), false, "right email, wrong phone");
  assert.equal(matchesBuyer({ email: "other@x.com", phone: "09171234567" }, KEYS), false, "right phone, wrong email");
  assert.equal(matchesBuyer({ email: "bea@x.com" }, KEYS), false, "order with no phone");
  assert.equal(matchesBuyer({ phone: "09171234567" }, KEYS), false, "order with no email");
  assert.equal(matchesBuyer(null, KEYS), false);
});

check("email is case/space-insensitive; phone compares its last 10 digits", () => {
  const p = parseBuyerLookup({ email: "  Bea@X.com ", phone: "+63 917-123-4567" });
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.deepEqual(p.keys, KEYS, "typed +63 form normalizes to the stored 09… form");
  assert.equal(matchesBuyer({ email: "BEA@x.COM", phone: "639171234567" }, p.keys), true);
  assert.equal(matchesBuyer({ email: "bea@x.com", phone: "(0917) 123 4567" }, p.keys), true);
});

check("a buyer who only knows someone's email (or phone) sees nothing", () => {
  const orders = [order({}), order({})];
  const wrongPhone = parseBuyerLookup({ email: BEA.email, phone: "09170000000" });
  const wrongEmail = parseBuyerLookup({ email: "guess@x.com", phone: BEA.phone });
  assert.ok(wrongPhone.ok && wrongEmail.ok);
  if (!wrongPhone.ok || !wrongEmail.ok) return;
  assert.deepEqual(buildMyGroupBuyOrder(orders, [GB1], wrongPhone.keys, { now: NOW }), []);
  assert.deepEqual(buildMyGroupBuyOrder(orders, [GB1], wrongEmail.keys, { now: NOW }), []);
});

// ── Scope ────────────────────────────────────────────────────────────────────

check("trashed orders, on-hand orders and other buyers' orders are excluded", () => {
  const rounds = buildMyGroupBuyOrder(
    [
      order({ orderNumber: "KEEP" }),
      order({ orderNumber: "TRASHED", deletedAt: "2026-11-05T00:00:00.000Z" }),
      order({ orderNumber: "ONHAND", groupBuyId: null }),
      order({ orderNumber: "STRANGER", email: "zed@x.com", phone: "09180000000" }),
    ],
    [GB1],
    KEYS,
    { now: NOW },
  );
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].checkouts.map((c) => c.orderNumber), ["KEEP"]);
});

check("orders from other rounds land in their own round, not merged", () => {
  const gb2 = round({ id: "gb2", name: "Batch 2", status: "closed", stage: "payment", closedAt: new Date("2026-10-20T00:00:00.000Z") });
  const rounds = buildMyGroupBuyOrder(
    [order({ orderNumber: "A" }), order({ orderNumber: "B", groupBuyId: "gb2" })],
    [GB1, gb2],
    KEYS,
    { now: NOW },
  );
  assert.deepEqual(rounds.map((r) => r.id), ["gb1", "gb2"]);
  assert.deepEqual(rounds[0].checkouts.map((c) => c.orderNumber), ["A"]);
  assert.deepEqual(rounds[1].checkouts.map((c) => c.orderNumber), ["B"]);
});

// ── Lines ────────────────────────────────────────────────────────────────────

check("variations of one product never collapse into one line", () => {
  const lines = mergeBuyerLines([
    order({ items: [
      { name: "Bac Water - 5ml", productId: "bac", variation: "5ml", qty: 2, price: 100 },
      { name: "Bac Water - 10ml", productId: "bac", variation: "10ml", qty: 1, price: 150 },
    ] }),
    order({ items: [{ name: "Bac Water - 5ml", productId: "bac", variation: "5ml", qty: 3, price: 100 }] }),
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.qty, l.amount]),
    [["Bac Water - 5ml", 5, 500], ["Bac Water - 10ml", 1, 150]],
  );
});

check("the same product across checkouts merges; variation shown only when the name lacks it", () => {
  const lines = mergeBuyerLines([
    order({ items: [{ name: "TR30", productId: "tr30", variation: "10 vials", qty: 1, price: 2000 }] }),
    order({ items: [{ name: "TR30", productId: "tr30", variation: "10 vials", qty: 2, price: 2000 }] }),
    order({ items: [{ name: "BPC — 10mg", productId: "bpc", variation: "10mg", qty: 1, price: 900 }] }),
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.variation, l.qty, l.amount]),
    [["TR30", "10 vials", 3, 6000], ["BPC — 10mg", null, 1, 900]],
  );
});

check("cancelled checkouts are listed but add no lines or money", () => {
  const [r] = buildMyGroupBuyOrder(
    [order({ orderNumber: "OK" }), order({ orderNumber: "X", status: "cancelled", items: [{ name: "TR15", productId: "tr15", qty: 9, price: 1000 }] })],
    [GB1],
    KEYS,
    { now: NOW },
  );
  assert.deepEqual(r.checkouts.map((c) => [c.orderNumber, c.status]).sort(), [["OK", "new"], ["X", "cancelled"]]);
  assert.deepEqual(r.items.map((l) => l.name), ["TR30"]);
  assert.equal(r.totals.total, 2000);
});

// ── Money ────────────────────────────────────────────────────────────────────

check("totals sum computeOrderTotals per checkout; paid = paid checkouts; balance = the rest", () => {
  const t = sumBuyerTotals([
    order({
      paymentStatus: "paid",
      adminFee: { label: "Admin fee", amount: 250 },
      shipping: { fee: 150 } as BuyerOrder["shipping"],
      discount: { code: "GB10", label: "GB10", amount: 100 },
      items: [{ name: "TR30", productId: "tr30", qty: 2, price: 2000 }],
    }),
    order({ paymentStatus: "pending", items: [{ name: "TR15", productId: "tr15", qty: 1, price: 1200 }] }),
  ]);
  assert.deepEqual(t, {
    subtotal: 5200,
    adminFee: 250,
    paymentFee: 0,
    shipping: 150,
    discount: 100,
    total: 4000 - 100 + 150 + 250 + 1200,
    paid: 4300,
    balance: 1200,
  });
});

check("fully paid → balance 0; a QR PH fee counts in the total", () => {
  const t = sumBuyerTotals([
    order({ paymentStatus: "paid", paymentFee: { label: "QR PH fee", amount: 40 } }),
  ]);
  assert.equal(t.paymentFee, 40);
  assert.equal(t.total, 2040);
  assert.equal(t.paid, 2040);
  assert.equal(t.balance, 0);
});

check("a Ligwak re-totalled order counts at its adjusted total", () => {
  const t = sumBuyerTotals([
    order({
      paymentStatus: "pending",
      adjustedTotal: 1500,
      gbTotals: { subtotal: 2000, successSubtotal: 1250, discount: 0, shipping: 0, adminFee: 250, paymentFee: 0, originalTotal: 2250, newTotal: 1500, amountDue: 1500, refundDue: 0 },
    }),
  ]);
  assert.equal(t.total, 1500);
  assert.equal(t.subtotal, 1250);
  assert.equal(t.balance, 1500);
});

// ── Rounds ───────────────────────────────────────────────────────────────────

check("live round first, then newest; stage label, ETA, due date and batch carried", () => {
  const old = round({ id: "old", name: "Batch 0", closedAt: new Date("2026-08-01T00:00:00.000Z") });
  const recent = round({
    id: "recent",
    name: "Batch 1.5",
    batchNumber: "TR30-B2",
    stage: "payment",
    closedAt: new Date("2026-10-25T00:00:00.000Z"),
    paymentDueAt: new Date("2026-11-15T00:00:00.000Z"),
  });
  const rounds = buildMyGroupBuyOrder(
    [order({ groupBuyId: "old" }), order({ groupBuyId: "recent" }), order({ groupBuyId: "gb1" })],
    [old, recent, GB1],
    KEYS,
    { now: NOW },
  );
  assert.deepEqual(rounds.map((r) => r.id), ["gb1", "recent", "old"]);
  assert.equal(rounds[0].state, "live");
  assert.equal(rounds[0].stateLabel, "Open");
  assert.equal(rounds[0].deliveryEta, "3–4 weeks after close");
  assert.equal(rounds[1].stateLabel, "Payment time");
  assert.equal(rounds[1].paymentDueAt, "2026-11-15T00:00:00.000Z");
  assert.equal(rounds[1].batch, "TR30-B2");
  assert.equal(rounds[2].paymentDueAt, null);
});

check("a round whose row is gone keeps its snapshot name and sorts last", () => {
  const rounds = buildMyGroupBuyOrder(
    [order({ groupBuyId: "ghost", groupBuyName: "Old Batch" }), order({ groupBuyId: "gb1" })],
    [GB1],
    KEYS,
    { now: NOW },
  );
  assert.deepEqual(rounds.map((r) => [r.id, r.name, r.state]), [["gb1", "Batch 1", "live"], ["ghost", "Old Batch", "closed"]]);
});

check("checkouts list newest first", () => {
  const [r] = buildMyGroupBuyOrder(
    [order({ orderNumber: "FIRST", date: "2026-11-01T00:00:00.000Z" }), order({ orderNumber: "SECOND", date: "2026-11-03T00:00:00.000Z" })],
    [GB1],
    KEYS,
    { now: NOW },
  );
  assert.deepEqual(r.checkouts.map((c) => c.orderNumber), ["SECOND", "FIRST"]);
});

// ── Wiring (source + catalog) ─────────────────────────────────────────────────

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

check("feature is operator-grantable, default OFF, outside every plan ceiling, with metadata", () => {
  assert.equal(FEATURES.STORE_MY_GROUPBUY_ORDER, "storefront.my_groupbuy_order");
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_MY_GROUPBUY_ORDER));
  for (const [plan, keys] of Object.entries(PLAN_FEATURES)) {
    assert.ok(!(keys as readonly string[]).includes(FEATURES.STORE_MY_GROUPBUY_ORDER), `in ${plan} ceiling`);
  }
  assert.equal(FEATURE_META[FEATURES.STORE_MY_GROUPBUY_ORDER].label, "My Group Buy Order");
});

check("the lookup action fails closed on the entitlement, is rate-limited, and excludes the trash", () => {
  const s = read("src/actions/my-groupbuy-order.ts");
  assert.match(s, /hasFeature\(tenantId, FEATURES\.STORE_MY_GROUPBUY_ORDER\)/);
  assert.match(s, /isDemoMode\(\)\) return null/);
  assert.match(s, /rateLimit\(/);
  assert.equal((s.match(/\.\.\.ACTIVE_ORDERS_WHERE/g) ?? []).length, 2, "both order reads spread ACTIVE_ORDERS_WHERE");
  const reads = (s.match(/\.findMany\(/g) ?? []).length;
  assert.ok(reads > 0 && (s.match(/\bselect: /g) ?? []).length === reads, "every read names a select list (no full rows)");
});

check("page, nav link and route exist only while the feature is on", () => {
  const off = { nav: [], twoWaysMode: { onHand: "hidden", groupBuy: "open" } } as unknown as Brand;
  const on = { ...off, myGroupBuyOrderEnabled: true } as Brand;
  assert.equal(isPageVisible(off, "my-groupbuy"), false);
  assert.equal(isPageVisible(on, "my-groupbuy"), true);
  assert.ok(!buildStorefrontNav(off).some((i) => i.href === "#my-groupbuy"));
  assert.ok(buildStorefrontNav(on).some((i) => i.href === "#my-groupbuy" && i.label === "My Group Buy Order"));
  const app = read("src/storefront/StorefrontApp.tsx");
  assert.ok(app.includes('"my-groupbuy"') && app.includes("<MyGroupBuyOrderPage"), "route + page wired in StorefrontApp");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
