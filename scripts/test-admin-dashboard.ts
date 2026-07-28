/**
 * Self-contained test for the redesigned store-admin dashboard core:
 *
 *   - src/lib/storefront/admin-dashboard.ts
 *       dashboardCapabilities() — the ONE gate deciding what the dashboard may
 *                                 show (analytics / orders / inventory / …),
 *                                 combining the tenant entitlement
 *                                 (isAdminViewVisible) with the staff grant
 *                                 (isViewAllowed)
 *       dashboardLayoutFor()    — "analytics" (revenue chart) vs "operations"
 *                                 (stock levels + recent orders) — the fallback
 *                                 for tenants without the Sales Analytics feature
 *       buildMetricTiles()      — the 4 KPI tiles; NEVER money without analytics
 *       buildRevenueSeries()    — the 14-day sparkline; null without analytics
 *       buildStockPanel()       — on-hand levels, variation-aware, worst first
 *       buildRecentOrders()     — recent-order rows; empty without the grant
 *       buildAttentionAlerts()  — "needs attention" list; only reachable views
 *       buildCategoryShares()   — category distribution bars
 *
 *   - src/storefront/admin/admin-nav.ts
 *       ADMIN_NAV / visibleNavGroups() / searchNavItems() — the sidebar registry
 *       and its drift guard against the staff permission registry.
 *
 * Runs the REAL modules (no DB, no Next runtime, no browser):
 *
 *   npm run test:admin-dashboard
 */

import assert from "node:assert";

import {
  dashboardCapabilities,
  dashboardLayoutFor,
  buildMetricTiles,
  buildRevenueSeries,
  buildStockPanel,
  buildRecentOrders,
  buildAttentionAlerts,
  buildCategoryShares,
  productUnits,
  orderTotal,
  LOW_STOCK_AT,
  type DashboardCaps,
} from "../src/lib/storefront/admin-dashboard";

import {
  ADMIN_NAV,
  ADMIN_NAV_GROUPS,
  visibleNavGroups,
  searchNavItems,
} from "../src/storefront/admin/admin-nav";

import {
  STAFF_MODULE_KEYS,
  ALWAYS_ALLOWED_VIEWS,
  isViewAllowed,
  type StaffActor,
} from "../src/storefront/admin/staff-permissions";

import type { Brand, Category, Order, Product } from "../src/storefront/types";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

// ──────────────────────────────── fixtures ──────────────────────────────────
const OWNER: StaffActor = { kind: "owner" };
const staff = (...permissions: string[]): StaffActor => ({
  kind: "staff",
  id: "staff-1",
  permissions,
});

/** Minimal Brand — only the fields the dashboard gate reads. */
const brandOf = (over: Partial<Brand> = {}): Brand => ({ ...(over as Brand) });

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Peptide A",
  description: "",
  price: 1000,
  currency: "PHP",
  category: "weight",
  featured: false,
  image: null,
  stock: 10,
  ...over,
});

const NOW = new Date("2026-07-28T12:00:00.000Z");
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    orderNumber: "ABC-1001",
    status: "new",
    paymentStatus: "pending",
    paymentMethod: "gcash",
    date: daysAgo(0),
    customer: { name: "Ava Reyes", email: "ava@mail.com", phone: "", contactMethod: "" },
    shipping: {
      address: "",
      barangay: "",
      city: "",
      province: "",
      postal: "",
      country: "",
      region: "",
      fee: 100,
    },
    courier: "",
    trackingNumber: "",
    shippingNote: "",
    items: [{ name: "Peptide A", qty: 2, price: 500 }],
    paymentProof: null,
    ...over,
  }) as Order;

const CATEGORIES: Category[] = [
  { id: "all", label: "All" },
  { id: "weight", label: "Weight Management" },
  { id: "beauty", label: "Beauty" },
  { id: "empty", label: "Medical Supplies" },
];

const capsOf = (over: Partial<DashboardCaps> = {}): DashboardCaps => ({
  analytics: true,
  orders: true,
  inventory: true,
  products: true,
  categories: true,
  ...over,
});

/** Every string a tile renders — used to prove no money leaks without analytics. */
const tileText = (tiles: ReturnType<typeof buildMetricTiles>): string =>
  tiles.map((t) => `${t.label} ${t.value} ${t.sub} ${t.delta?.label ?? ""}`).join(" | ");

// ═══════════════════════ dashboardCapabilities ═══════════════════════════════
console.log("dashboardCapabilities");

check("owner on an analytics-entitled tenant may see analytics", () => {
  const caps = dashboardCapabilities(brandOf(), OWNER);
  assert.equal(caps.analytics, true);
  assert.equal(caps.orders, true);
});

check("showAdminAnalytics === false revokes analytics for the OWNER too", () => {
  const caps = dashboardCapabilities(brandOf({ showAdminAnalytics: false }), OWNER);
  assert.equal(caps.analytics, false);
  // The rest of the dashboard is unaffected.
  assert.equal(caps.orders, true);
  assert.equal(caps.inventory, true);
});

check("staff without the analytics grant may not see analytics", () => {
  const caps = dashboardCapabilities(brandOf(), staff("orders", "inv"));
  assert.equal(caps.analytics, false);
  assert.equal(caps.orders, true);
  assert.equal(caps.inventory, true);
});

check("staff WITH the analytics grant on an entitled tenant may see it", () => {
  const caps = dashboardCapabilities(brandOf(), staff("analytics"));
  assert.equal(caps.analytics, true);
});

check("the tenant entitlement beats the staff grant (both must hold)", () => {
  const caps = dashboardCapabilities(brandOf({ showAdminAnalytics: false }), staff("analytics"));
  assert.equal(caps.analytics, false);
});

check("staff with no grants sees no orders / inventory / categories", () => {
  const caps = dashboardCapabilities(brandOf(), staff());
  assert.deepEqual(caps, {
    analytics: false,
    orders: false,
    inventory: false,
    products: false,
    categories: false,
  });
});

// ═══════════════════════════ dashboardLayoutFor ══════════════════════════════
console.log("dashboardLayoutFor");

check("analytics capability → the revenue-chart layout", () => {
  assert.equal(dashboardLayoutFor(capsOf({ analytics: true })), "analytics");
});

check("NO analytics → the operations layout (stock + recent orders)", () => {
  assert.equal(dashboardLayoutFor(capsOf({ analytics: false })), "operations");
});

check("no analytics and no orders still resolves to operations", () => {
  assert.equal(dashboardLayoutFor(capsOf({ analytics: false, orders: false })), "operations");
});

// ═════════════════════════════ buildMetricTiles ══════════════════════════════
console.log("buildMetricTiles");

const PRODUCTS: Product[] = [
  product({ id: "p1", name: "Peptide A", stock: 12, category: "weight" }),
  product({ id: "p2", name: "Peptide B", stock: 2, category: "weight" }),
  product({ id: "p3", name: "Collagen", stock: 0, category: "beauty" }),
];

const ORDERS: Order[] = [
  order({ id: "o1", date: daysAgo(0), status: "new" }),
  order({ id: "o2", date: daysAgo(0), status: "confirmed" }),
  order({ id: "o3", date: daysAgo(3), status: "shipped" }),
  order({
    id: "o4",
    date: daysAgo(4),
    status: "cancelled",
    items: [{ name: "x", qty: 1, price: 9999 }],
  }),
];

check("analytics layout yields exactly 4 tiles including revenue", () => {
  const tiles = buildMetricTiles({ caps: capsOf(), products: PRODUCTS, orders: ORDERS, now: NOW });
  assert.equal(tiles.length, 4);
  assert.ok(tiles.some((t) => t.id === "revenue-today"));
});

check("NO analytics → no revenue tile and no money anywhere in the tiles", () => {
  const tiles = buildMetricTiles({
    caps: capsOf({ analytics: false }),
    products: PRODUCTS,
    orders: ORDERS,
    now: NOW,
  });
  assert.equal(tiles.length, 4);
  assert.ok(!tiles.some((t) => t.id === "revenue-today"), "revenue tile must be absent");
  const text = tileText(tiles);
  assert.ok(!text.includes("₱"), `no peso amount may render: ${text}`);
});

check("operations tiles report catalog + stock instead", () => {
  const tiles = buildMetricTiles({
    caps: capsOf({ analytics: false }),
    products: PRODUCTS,
    orders: ORDERS,
    now: NOW,
  });
  const ids = tiles.map((t) => t.id);
  assert.ok(ids.includes("products"), `expected a products tile, got ${ids.join(",")}`);
  assert.ok(ids.includes("units"), `expected a stock-units tile, got ${ids.join(",")}`);
  const units = tiles.find((t) => t.id === "units");
  assert.equal(units?.value, "14"); // 12 + 2 + 0
});

check("low-stock tile counts products at or below the threshold", () => {
  const tiles = buildMetricTiles({ caps: capsOf(), products: PRODUCTS, orders: ORDERS, now: NOW });
  const low = tiles.find((t) => t.id === "low-stock");
  assert.equal(low?.value, "2"); // stock 2 and stock 0
  assert.ok(LOW_STOCK_AT >= 1);
});

check("unfulfilled tile excludes shipped / delivered / cancelled orders", () => {
  const tiles = buildMetricTiles({ caps: capsOf(), products: PRODUCTS, orders: ORDERS, now: NOW });
  const unfulfilled = tiles.find((t) => t.id === "unfulfilled");
  assert.equal(unfulfilled?.value, "2"); // new + confirmed
});

check("without the orders grant no order-derived tile is emitted", () => {
  const tiles = buildMetricTiles({
    caps: capsOf({ analytics: false, orders: false }),
    products: PRODUCTS,
    orders: ORDERS,
    now: NOW,
  });
  assert.ok(!tiles.some((t) => t.id === "unfulfilled" || t.id === "orders-today"));
  assert.equal(tiles.length, 4);
});

check("empty catalog and no orders does not throw or emit NaN", () => {
  const tiles = buildMetricTiles({ caps: capsOf(), products: [], orders: [], now: NOW });
  assert.ok(!tileText(tiles).includes("NaN"));
});

// ═════════════════════════════ buildRevenueSeries ════════════════════════════
console.log("buildRevenueSeries");

check("returns null when the tenant has no analytics capability", () => {
  const series = buildRevenueSeries({
    caps: capsOf({ analytics: false }),
    orders: ORDERS,
    now: NOW,
  });
  assert.equal(series, null);
});

check("14-day series has one point per day, oldest first", () => {
  const series = buildRevenueSeries({ caps: capsOf(), orders: ORDERS, now: NOW });
  assert.ok(series);
  assert.equal(series!.points.length, 14);
});

check("cancelled orders never contribute revenue", () => {
  const cancelledOnly = [
    order({
      id: "c1",
      status: "cancelled",
      date: daysAgo(1),
      items: [{ name: "x", qty: 1, price: 5000 }],
    }),
  ];
  const series = buildRevenueSeries({ caps: capsOf(), orders: cancelledOnly, now: NOW });
  assert.equal(series!.total, 0);
});

check("total sums items − discount + shipping + admin fee", () => {
  const one = [
    order({
      id: "t1",
      status: "delivered",
      date: daysAgo(1),
      items: [{ name: "x", qty: 2, price: 500 }],
      shipping: { ...order().shipping, fee: 100 },
      adminFee: { label: "Service", amount: 50 },
      discount: { code: "SAVE", label: "Save", amount: 200 },
    }),
  ];
  const series = buildRevenueSeries({ caps: capsOf(), orders: one, now: NOW });
  assert.equal(series!.total, 950); // 1000 − 200 + 100 + 50
  assert.equal(orderTotal(one[0]), 950);
});

check("deltaPct is null (not Infinity/NaN) when the previous window earned nothing", () => {
  const series = buildRevenueSeries({ caps: capsOf(), orders: ORDERS, now: NOW });
  assert.ok(series!.deltaPct === null || Number.isFinite(series!.deltaPct));
});

// ══════════════════════════════ buildStockPanel ══════════════════════════════
console.log("buildStockPanel");

check("worst stock first — out of stock, then low, then healthy", () => {
  const rows = buildStockPanel(PRODUCTS);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Collagen", "Peptide B", "Peptide A"],
  );
  assert.equal(rows[0].tone, "out");
  assert.equal(rows[1].tone, "low");
  assert.equal(rows[2].tone, "ok");
});

check("percentage bars stay within 0..100 and are never NaN", () => {
  for (const row of buildStockPanel(PRODUCTS)) {
    assert.ok(Number.isFinite(row.pct), `pct must be finite, got ${row.pct}`);
    assert.ok(row.pct >= 0 && row.pct <= 100, `pct out of range: ${row.pct}`);
  }
});

check("an all-zero catalog does not divide by zero", () => {
  const rows = buildStockPanel([product({ id: "z", stock: 0 })]);
  assert.equal(rows[0].pct, 0);
});

check("respects the row limit", () => {
  const many = Array.from({ length: 20 }, (_, i) => product({ id: `p${i}`, stock: i }));
  assert.equal(buildStockPanel(many, 6).length, 6);
});

check("empty catalog yields an empty panel", () => {
  assert.deepEqual(buildStockPanel([]), []);
});

// ═══════════════════════════════ productUnits ════════════════════════════════
console.log("productUnits");

check("plain product uses its base stock", () => {
  assert.equal(productUnits(product({ stock: 7 })), 7);
});

check("negative / missing stock clamps to zero", () => {
  assert.equal(productUnits(product({ stock: -5 })), 0);
  assert.equal(productUnits(product({ stock: undefined })), 0);
});

check("tracked variations sum their own pools, not the base column", () => {
  const p = product({
    stock: 99,
    variations: [
      { name: "5mg", price: 100, stock: 3 },
      { name: "10mg", price: 200, stock: 4 },
    ],
  });
  assert.equal(productUnits(p), 7);
});

check("an untracked variation still draws on the shared base column (counted once)", () => {
  const p = product({
    stock: 10,
    variations: [
      { name: "5mg", price: 100, stock: 3 },
      { name: "10mg", price: 200 }, // untracked → shares the base pool
    ],
  });
  assert.equal(productUnits(p), 13);
});

// ═════════════════════════════ buildRecentOrders ═════════════════════════════
console.log("buildRecentOrders");

check("no orders grant → no rows (a staff member can't peek via the dashboard)", () => {
  const rows = buildRecentOrders({ caps: capsOf({ orders: false }), orders: ORDERS });
  assert.deepEqual(rows, []);
});

check("newest first and capped at the limit", () => {
  const rows = buildRecentOrders({ caps: capsOf(), orders: ORDERS, limit: 2 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "o1");
});

check("rows carry the tenant-facing order code, not the internal id", () => {
  const rows = buildRecentOrders({
    caps: capsOf(),
    orders: [order({ id: "internal", orderNumber: "ABC-1042" })],
  });
  assert.equal(rows[0].code, "ABC-1042");
});

check("an order with no orderNumber falls back to a readable code", () => {
  const rows = buildRecentOrders({
    caps: capsOf(),
    orders: [order({ id: "abc123", orderNumber: undefined })],
  });
  assert.ok(rows[0].code.length > 0);
});

check("item count sums line quantities", () => {
  const rows = buildRecentOrders({
    caps: capsOf(),
    orders: [
      order({
        items: [
          { name: "a", qty: 2, price: 1 },
          { name: "b", qty: 3, price: 1 },
        ],
      }),
    ],
  });
  assert.equal(rows[0].items, 5);
});

// ═══════════════════════════ buildAttentionAlerts ════════════════════════════
console.log("buildAttentionAlerts");

check("every alert points at a view the actor is allowed to open", () => {
  const actor = staff("orders");
  const caps = dashboardCapabilities(brandOf(), actor);
  const alerts = buildAttentionAlerts({ caps, products: PRODUCTS, orders: ORDERS });
  for (const a of alerts) {
    assert.ok(isViewAllowed(actor, a.view), `alert "${a.id}" links to forbidden view "${a.view}"`);
  }
});

check("low-stock alert is suppressed without the inventory capability", () => {
  const alerts = buildAttentionAlerts({
    caps: capsOf({ inventory: false }),
    products: PRODUCTS,
    orders: ORDERS,
  });
  assert.ok(!alerts.some((a) => a.view === "inv"));
});

check("a healthy store with nothing pending produces no alerts", () => {
  const alerts = buildAttentionAlerts({
    caps: capsOf(),
    products: [product({ stock: 50 })],
    orders: [order({ status: "delivered" })],
  });
  assert.deepEqual(alerts, []);
});

check("unfulfilled orders raise an alert pointing at the orders view", () => {
  const alerts = buildAttentionAlerts({ caps: capsOf(), products: PRODUCTS, orders: ORDERS });
  assert.ok(alerts.some((a) => a.view === "orders"));
});

// ═══════════════════════════ buildCategoryShares ═════════════════════════════
console.log("buildCategoryShares");

check('the synthetic "all" category is never listed', () => {
  const shares = buildCategoryShares(CATEGORIES, PRODUCTS);
  assert.ok(!shares.some((c) => c.id === "all"));
});

check("counts products per category, busiest first", () => {
  const shares = buildCategoryShares(CATEGORIES, PRODUCTS);
  assert.equal(shares[0].id, "weight");
  assert.equal(shares[0].count, 2);
});

check("an empty category renders at 0% rather than NaN", () => {
  const shares = buildCategoryShares(CATEGORIES, PRODUCTS);
  const empty = shares.find((c) => c.id === "empty");
  assert.equal(empty?.count, 0);
  assert.equal(empty?.pct, 0);
});

check("no products at all keeps every share finite", () => {
  for (const c of buildCategoryShares(CATEGORIES, [])) {
    assert.ok(Number.isFinite(c.pct));
  }
});

// ═════════════════════════════ admin nav registry ════════════════════════════
console.log("admin-nav registry");

check("every nav item id is unique", () => {
  const seen = new Set<string>();
  for (const item of ADMIN_NAV) {
    assert.ok(!seen.has(item.view), `duplicate nav view "${item.view}"`);
    seen.add(item.view);
  }
});

check("every nav item belongs to a declared group", () => {
  const groups = new Set(ADMIN_NAV_GROUPS.map((g) => g.id));
  for (const item of ADMIN_NAV) {
    assert.ok(groups.has(item.group), `nav item "${item.view}" has unknown group "${item.group}"`);
  }
});

check("no staff-reachable nav item escapes the permission registry", () => {
  for (const item of ADMIN_NAV) {
    if (item.ownerOnly) continue;
    const gated = STAFF_MODULE_KEYS.includes(item.view) || ALWAYS_ALLOWED_VIEWS.has(item.view);
    assert.ok(gated, `nav item "${item.view}" is reachable by staff but is not a gated module`);
  }
});

check("the sidebar opens with the dashboard in the first group", () => {
  assert.equal(ADMIN_NAV[0].view, "dashboard");
  assert.equal(ADMIN_NAV[0].group, ADMIN_NAV_GROUPS[0].id);
});

check("owner sees grouped items with no empty groups", () => {
  const groups = visibleNavGroups(brandOf(), OWNER);
  assert.ok(groups.length > 0);
  for (const g of groups) assert.ok(g.items.length > 0, `group "${g.label}" rendered empty`);
});

check("staff with no grants sees only the always-allowed views", () => {
  const groups = visibleNavGroups(brandOf(), staff());
  const views = groups.flatMap((g) => g.items.map((i) => i.view));
  for (const v of views) assert.ok(ALWAYS_ALLOWED_VIEWS.has(v), `ungranted view leaked: ${v}`);
});

check("staff granted Orders sees Orders but not Products", () => {
  const views = visibleNavGroups(brandOf(), staff("orders")).flatMap((g) =>
    g.items.map((i) => i.view),
  );
  assert.ok(views.includes("orders"));
  assert.ok(!views.includes("products"));
});

check("owner-only items never reach a staff member", () => {
  const ownerOnly = ADMIN_NAV.filter((i) => i.ownerOnly).map((i) => i.view);
  const views = visibleNavGroups(brandOf(), staff(...STAFF_MODULE_KEYS)).flatMap((g) =>
    g.items.map((i) => i.view),
  );
  for (const v of ownerOnly) assert.ok(!views.includes(v), `owner-only view leaked to staff: ${v}`);
});

check("a hidden module (super-admin toggle off) drops out of the sidebar", () => {
  const views = visibleNavGroups(brandOf({ showAdminAnalytics: false }), OWNER).flatMap((g) =>
    g.items.map((i) => i.view),
  );
  assert.ok(!views.includes("analytics"));
});

check("business-exclusive modules stay visible but flagged locked during a trial", () => {
  const trialBrand = brandOf({
    trial: { active: true, expired: false, daysLeft: 3, plan: "trial" },
    adminFeeEntitled: true,
  } as Partial<Brand>);
  const fee = visibleNavGroups(trialBrand, OWNER)
    .flatMap((g) => g.items)
    .find((i) => i.view === "fee");
  assert.ok(fee, "the Checkout Fee tile must stay visible");
  assert.equal(fee!.locked, true);
});

check("search matches on label, case-insensitively", () => {
  const items = visibleNavGroups(brandOf(), OWNER).flatMap((g) => g.items);
  const hits = searchNavItems(items, "ORD");
  assert.ok(hits.some((h) => h.view === "orders"));
});

check("search never returns an item the actor cannot open", () => {
  const items = visibleNavGroups(brandOf(), staff("orders")).flatMap((g) => g.items);
  const hits = searchNavItems(items, "product");
  assert.ok(!hits.some((h) => h.view === "products"));
});

check("an empty query returns nothing (the sidebar stays authoritative)", () => {
  const items = visibleNavGroups(brandOf(), OWNER).flatMap((g) => g.items);
  assert.deepEqual(searchNavItems(items, "   "), []);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
