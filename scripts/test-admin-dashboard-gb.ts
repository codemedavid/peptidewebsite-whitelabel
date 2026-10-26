/**
 * Self-contained test for the dashboard's Group Buy panel:
 *
 *   - src/lib/storefront/admin-dashboard-gb.ts
 *       pickFocusRound()      — live round first, else the latest finished one
 *       buildGroupBuyPanel()  — round stats, kit fill per product, supplier line
 *       buildGroupBuyAlerts() — join requests / unpaid / short kits, live only
 *
 * Runs the REAL modules (no DB, no Next runtime, no browser):
 *
 *   npm run test:admin-dashboard-gb
 */

import assert from "node:assert";

import {
  buildGroupBuyAlerts,
  buildGroupBuyPanel,
  countUnpaidOrders,
  pickFocusRound,
  pickNextRound,
  roundTiming,
  GB_VIEW_JOINS,
  GB_VIEW_ROUND,
  type FocusRound,
  type GbCatalogEntry,
} from "../src/lib/storefront/admin-dashboard-gb";
import { buildRoundAnalytics } from "../src/lib/storefront/group-buy-analytics";
import { buildRoundOrderRows, type LinkableOrder } from "../src/lib/storefront/group-buy-orders";
import type { GroupBuy } from "../src/lib/storefront/group-buy";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-10-26T12:00:00.000Z");
const day = (n: number): string => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const round = (over: Partial<GroupBuy> = {}): GroupBuy => ({
  id: "gb5",
  name: "GB #5",
  description: "",
  status: "active",
  startsAt: day(-7),
  endsAt: day(3),
  deliveryEta: "",
  productIds: [],
  slotGoal: 0,
  batchNumber: "",
  minVials: null,
  maxVials: null,
  moqVials: null,
  paidJoin: false,
  joinFeeCents: 0,
  closedAt: null,
  createdAt: day(-8),
  updatedAt: day(-1),
  ...over,
});

const order = (
  n: string,
  items: { productId: string; qty: number; variation?: string }[],
  over: Partial<LinkableOrder> = {},
): LinkableOrder => ({
  orderNumber: n,
  date: day(-1),
  status: "new",
  paymentStatus: "pending",
  groupBuyId: "gb5",
  customer: { name: `Buyer ${n}`, email: `${n}@x.test` },
  items: items.map((i) => ({ name: i.productId.toUpperCase(), price: 100, ...i })),
  ...over,
});

const CATALOG = new Map<string, GbCatalogEntry>([
  ["bpc", { name: "BPC-157 10mg", vialsPerKit: 10 }],
  ["reta", { name: "Retatrutide 20mg", vialsPerKit: 10 }],
  ["ghk", { name: "GHK-Cu 50mg", vialsPerKit: 10 }],
  ["nad", { name: "NAD+ 500mg", vialsPerKit: 10 }],
  ["bac", { name: "Bac Water 10ml" }], // no kit size
]);

const ORDERS: LinkableOrder[] = [
  order("A-1", [{ productId: "bpc", qty: 5 }, { productId: "nad", qty: 10 }], { paymentStatus: "paid" }),
  order("A-2", [{ productId: "bpc", qty: 3, variation: "5mg" }, { productId: "ghk", qty: 2 }]),
  order("A-3", [{ productId: "reta", qty: 6 }, { productId: "bac", qty: 6 }]),
  order("A-4", [{ productId: "ghk", qty: 9 }], { status: "cancelled" }),
];

function panelFor(orders: LinkableOrder[], focus: FocusRound, joins: number | null = null, showMoney = true) {
  return buildGroupBuyPanel({
    focus,
    analytics: buildRoundAnalytics(focus.round, orders),
    orderRows: buildRoundOrderRows(focus.round, orders),
    catalog: CATALOG,
    joinsWaiting: joins,
    showMoney,
    now: NOW,
  });
}

const LIVE: FocusRound = { round: round(), mode: "live" };

// ═══════════════════════════ pickFocusRound ══════════════════════════════════
console.log("pickFocusRound");

check("the live round wins over a finished one", () => {
  const f = pickFocusRound([round({ id: "old", status: "closed", closedAt: day(-20) }), round()], true, NOW);
  assert.equal(f?.round.id, "gb5");
  assert.equal(f?.mode, "live");
});

check("no live round → the most recently finished round as a recap", () => {
  const f = pickFocusRound(
    [
      round({ id: "gb3", status: "closed", closedAt: day(-30) }),
      round({ id: "gb4", status: "closed", closedAt: day(-5) }),
      round({ id: "gb2", status: "archived", closedAt: day(-1) }),
    ],
    true,
    NOW,
  );
  assert.equal(f?.round.id, "gb4");
  assert.equal(f?.mode, "recap");
});

check("an active round whose window lapsed reads as finished, not live", () => {
  assert.equal(pickFocusRound([round({ endsAt: day(-1) })], true, NOW)?.mode, "recap");
});

check("nothing but drafts → null", () => {
  assert.equal(pickFocusRound([round({ status: "draft" })], true, NOW), null);
});

check("pickNextRound returns the soonest scheduled round", () => {
  const next = pickNextRound(
    [round({ id: "b", status: "scheduled", startsAt: day(9) }), round({ id: "a", status: "scheduled", startsAt: day(4) })],
    true,
    NOW,
  );
  assert.equal(next?.id, "a");
});

// ═══════════════════════════ buildGroupBuyPanel ══════════════════════════════
console.log("buildGroupBuyPanel");

check("headline counts exclude the cancelled order", () => {
  const p = panelFor(ORDERS, LIVE);
  assert.equal(p.orders, 3);
  assert.equal(p.buyers, 3);
  assert.equal(p.vials, 5 + 10 + 3 + 2 + 6 + 6);
});

check("unpaid counts distinct orders, never lines, never cancelled", () => {
  assert.equal(panelFor(ORDERS, LIVE).unpaidOrders, 2); // A-2 + A-3, two lines each
});

check("unpaid amount is hidden without money access", () => {
  assert.equal(panelFor(ORDERS, LIVE, null, false).unpaidAmount, null);
  assert.equal(panelFor(ORDERS, LIVE, null, true).unpaidAmount, (3 + 2 + 6 + 6) * 100);
});

check("variations fill their product's kit together", () => {
  const bpc = panelFor(ORDERS, LIVE).kits.find((k) => k.id === "bpc");
  assert.ok(bpc);
  assert.equal(bpc.vials, 8);
  assert.equal(bpc.remaining, 2);
  assert.equal(bpc.tone, "close");
});

check("kits sort closest-to-full first, full kits last", () => {
  assert.deepEqual(
    panelFor(ORDERS, LIVE).kits.map((k) => k.id),
    ["bpc", "reta", "ghk", "nad"],
  );
});

check("a barely-started kit is at risk; a full one is full", () => {
  const kits = panelFor(ORDERS, LIVE).kits;
  assert.equal(kits.find((k) => k.id === "ghk")?.tone, "risk");
  assert.equal(kits.find((k) => k.id === "nad")?.tone, "full");
  assert.equal(kits.find((k) => k.id === "reta")?.tone, "filling");
});

check("products without a kit size are counted, not drawn", () => {
  const p = panelFor(ORDERS, LIVE);
  assert.equal(p.untrackedProducts, 1);
  assert.ok(!p.kits.some((k) => k.id === "bac"));
});

check("supplier line: full kits + partial kits + how short they are", () => {
  assert.deepEqual(panelFor(ORDERS, LIVE).supplier, { fullKits: 1, partialKits: 3, shortBy: 2 + 4 + 8 });
});

check("no kit sizes anywhere → no supplier line", () => {
  const p = panelFor([order("B-1", [{ productId: "bac", qty: 4 }])], LIVE);
  assert.equal(p.supplier, null);
  assert.deepEqual(p.kits, []);
});

// ═══════════════════════════════ roundTiming ═════════════════════════════════
console.log("roundTiming");

check("days left, warn inside the closing window", () => {
  const t = roundTiming(LIVE, NOW);
  assert.equal(t.label, "Closes in 3 days");
  assert.equal(t.tone, "warn");
});

check("under a day reads in hours and is urgent", () => {
  const t = roundTiming({ round: round({ endsAt: day(0.25) }), mode: "live" }, NOW);
  assert.equal(t.label, "Closes in 6 hours");
  assert.equal(t.tone, "bad");
});

check("open-ended round has no countdown", () => {
  assert.equal(roundTiming({ round: round({ endsAt: null }), mode: "live" }, NOW).daysLeft, null);
});

// ═══════════════════════════ buildGroupBuyAlerts ═════════════════════════════
console.log("buildGroupBuyAlerts");

check("join requests waiting → an alert that opens the approval queue", () => {
  const joins = buildGroupBuyAlerts(panelFor(ORDERS, LIVE, 4)).find((x) => x.id === "gb-joins");
  assert.ok(joins);
  assert.equal(joins.view, GB_VIEW_JOINS);
  assert.match(joins.title, /^4 join requests are waiting/);
});

check("no paid join (null) or zero waiting → no join alert", () => {
  assert.ok(!buildGroupBuyAlerts(panelFor(ORDERS, LIVE, null)).some((x) => x.id === "gb-joins"));
  assert.ok(!buildGroupBuyAlerts(panelFor(ORDERS, LIVE, 0)).some((x) => x.id === "gb-joins"));
});

check("unpaid and short-kit alerts open the round", () => {
  const a = buildGroupBuyAlerts(panelFor(ORDERS, LIVE));
  assert.equal(a.find((x) => x.id === "gb-unpaid")?.view, GB_VIEW_ROUND);
  assert.equal(a.find((x) => x.id === "gb-short-kits")?.view, GB_VIEW_ROUND);
});

check("short kits only nag inside the closing window", () => {
  const far: FocusRound = { round: round({ endsAt: day(10) }), mode: "live" };
  assert.ok(!buildGroupBuyAlerts(panelFor(ORDERS, far)).some((x) => x.id === "gb-short-kits"));
});

check("a recap never raises alerts", () => {
  const recap: FocusRound = { round: round({ status: "closed", closedAt: day(-2) }), mode: "recap" };
  assert.deepEqual(buildGroupBuyAlerts(panelFor(ORDERS, recap, 3)), []);
});

check("countUnpaidOrders ignores paid and cancelled rows", () => {
  assert.equal(countUnpaidOrders(buildRoundOrderRows(round(), ORDERS)), 2);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
