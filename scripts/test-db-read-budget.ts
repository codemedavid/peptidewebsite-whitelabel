/**
 * DB READ BUDGET — the hottest Postgres reads are served from cache for an hour
 * and refreshed by the writes that change them, not by a short timer.
 *
 * Grounding (pg_stat_statements since 2026-05-26): the storefront catalog
 * (~243k calls), platform_settings (~168k, never cached) and the per-tenant
 * entitlement joins (~92k each) were the top application queries. All three
 * change only when someone saves, and every such save busts a tag — so a
 * 5-minute timer was re-reading identical rows ~12× an hour per tenant.
 *
 * What this suite locks:
 *   1. SETTINGS     — plan config, plan features and package payment read
 *                     through one cached helper; each save busts its tag.
 *   2. ENTITLEMENTS — 1h window, a platform-wide tag that plan saves bust, and
 *                     a resolver that survives cached Dates coming back as
 *                     strings (the unstable_cache Date→string trap).
 *   3. CATALOG      — display rows cached for 1h (writers already bust); the
 *                     article summaries and the app's product list ride it too.
 *   4. ORDERS       — one cached order book shared by the website and the app.
 *   5. GROUP BUYS   — display rounds cached; every round writer busts them.
 *
 * Run:
 *   npm run test:db-read-budget
 */

import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveEntitlementSet } from "../src/lib/features/entitlement-set";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** Source with comments stripped, so a comment can't satisfy an assertion. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const ONE_HOUR = 3600;

// ─────────────────────────────── 1. settings ────────────────────────────────
console.log("\n1. PLATFORM SETTINGS");

const helper = code("src/lib/platform/platform-setting-cache.ts");

check("one cached helper reads platform_settings", () => {
  assert.match(helper, /unstable_cache\(/);
  assert.match(helper, /platformSetting\.findUnique/);
  assert.match(helper, /export function platformSettingTag/);
});

check("helper caches for at least an hour", () => {
  const m = helper.match(/REVALIDATE_SECONDS\s*=\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= ONE_HOUR, "revalidate window");
});

const READERS = [
  ["src/lib/platform/plan-config-server.ts", "PLAN_CONFIG_KEY"],
  ["src/lib/platform/plan-feature-config-server.ts", "PLAN_FEATURES_CONFIG_KEY"],
  ["src/lib/platform/package-payment-server.ts", "PACKAGE_PAYMENT_KEY"],
] as const;

for (const [file, key] of READERS) {
  const src = code(file);
  check(`${file.split("/").pop()} reads through the cache`, () => {
    assert.match(src, new RegExp(`loadPlatformSettingValue\\(${key}\\)`));
    assert.doesNotMatch(src, /prisma\.platformSetting\.findUnique/);
  });
  check(`${file.split("/").pop()} keeps demo bypass + never throws`, () => {
    assert.match(src, /isDemoMode\(\)/);
    assert.match(src, /catch/);
  });
}

const WRITERS = [
  ["src/actions/admin-plan-config.ts", "PLAN_CONFIG_KEY"],
  ["src/actions/admin-plan-features.ts", "PLAN_FEATURES_CONFIG_KEY"],
  ["src/actions/admin-package-payment.ts", "PACKAGE_PAYMENT_KEY"],
] as const;

for (const [file, key] of WRITERS) {
  check(`${file.split("/").pop()} busts its setting tag after saving`, () => {
    const src = code(file);
    assert.match(src, new RegExp(`revalidateTag\\(platformSettingTag\\(${key}\\)\\)`));
  });
}

// ───────────────────────────── 2. entitlements ──────────────────────────────
console.log("\n2. ENTITLEMENTS");

const ent = code("src/lib/features/entitlements.ts");

check("entitlement cache window is at least an hour", () => {
  const m = ent.match(/tenant-entitlements[\s\S]{0,300}?revalidate:\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= ONE_HOUR, "revalidate window");
});

check("entitlements carry the platform-wide tag", () => {
  assert.match(ent, /ENTITLEMENTS_TAG/);
  assert.match(ent, /export const ENTITLEMENTS_TAG/);
});

for (const file of ["src/actions/admin-plan-config.ts", "src/actions/admin-plan-features.ts"]) {
  check(`${file.split("/").pop()} busts every tenant's entitlements (it re-syncs plans)`, () => {
    assert.match(code(file), /revalidateTag\(ENTITLEMENTS_TAG\)/);
  });
}

check("resolution is delegated to the pure resolver", () => {
  assert.match(ent, /resolveEntitlementSet\(/);
});

const row = (overrides: { enabled: boolean; expiresAt: Date | string | null; key: string }[]) => ({
  plan: { features: [{ feature: { key: "a" } }, { feature: { key: "b" } }] },
  featureOverrides: overrides.map((o) => ({ enabled: o.enabled, expiresAt: o.expiresAt, feature: { key: o.key } })),
});
const NOW = Date.parse("2026-10-15T00:00:00Z");

check("plan features ∪ enabled overrides − revocations", () => {
  const set = resolveEntitlementSet(
    row([
      { enabled: true, expiresAt: null, key: "c" },
      { enabled: false, expiresAt: null, key: "a" },
    ]),
    NOW,
  );
  assert.deepEqual([...set].sort(), ["b", "c"]);
});

check("a cached expiresAt STRING does not throw (cache-hit shape)", () => {
  const set = resolveEntitlementSet(
    row([{ enabled: true, expiresAt: "2027-01-01T00:00:00.000Z", key: "c" }]),
    NOW,
  );
  assert.ok((set as Set<string>).has("c"));
});

check("expired overrides (Date or string) are ignored", () => {
  const set = resolveEntitlementSet(
    row([
      { enabled: true, expiresAt: "2026-01-01T00:00:00.000Z", key: "c" },
      { enabled: false, expiresAt: new Date("2026-01-01T00:00:00Z"), key: "a" },
    ]),
    NOW,
  );
  assert.deepEqual([...set].sort(), ["a", "b"]);
});

check("unknown tenant resolves to nothing", () => {
  assert.equal(resolveEntitlementSet(null, NOW).size, 0);
});

// ──────────────────────────────── 3. catalog ────────────────────────────────
console.log("\n3. CATALOG");

check("storefront catalog rows cached for at least an hour", () => {
  const m = code("src/lib/storefront/storefront-brand.ts").match(/storefront-catalog-rows[\s\S]{0,200}?revalidate:\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= ONE_HOUR, "revalidate window");
});

check("storefront article summaries are cached, bodies never re-read per render", () => {
  const src = code("src/lib/storefront/storefront-brand.ts");
  assert.match(src, /storefront-article-summaries[\s\S]{0,200}?revalidate:\s*\d+/);
  const inline = src.slice(src.indexOf("export async function loadStorefrontBrand"));
  assert.doesNotMatch(inline, /blogPost\.findMany/, "loadStorefrontBrand must not read blog_posts directly");
});

check("the app's product list reuses the cached catalog rows", () => {
  const src = code("src/lib/mobile/products.ts");
  const list = src.slice(src.indexOf("export async function listProducts"), src.indexOf("export async function updateProduct"));
  assert.match(list, /loadCatalogRows\(/);
  assert.doesNotMatch(list, /product\.findMany/);
  assert.match(list, /new Date\(r\.updatedAt\)/, "cached dates are strings — re-hydrate before toISOString");
});

// ─────────────────────────────── 4. orders ──────────────────────────────────
console.log("\n4. ORDERS");

check("the order book is cached under the orders tag", () => {
  const m = code("src/lib/orders/order-list-cache.ts").match(/admin-order-list[\s\S]{0,200}?ordersTag\(tenantId\)/);
  assert.ok(m, "loadOrderList must read through the orders-tagged cache");
});

check("the website order list and the app's Insights / Customers share it", () => {
  assert.match(code("src/actions/orders.ts"), /loadOrderList\(tenantId, view\)/);
  const reports = code("src/lib/mobile/reports.ts");
  assert.match(reports, /loadOrderList\(ctx\.tenantId, "active"\)/);
  assert.doesNotMatch(reports, /storefrontOrder\.findMany/, "Customers search must not re-read every order");
});

check("app Home order stats are cached under the orders tag", () => {
  assert.match(code("src/lib/mobile/dashboard.ts"), /mobile-dashboard-orders[\s\S]{0,200}?ordersTag\(ctx\.tenantId\)/);
});

// A cached order list is only correct if EVERY writer busts it. Any file that
// writes storefront_orders must call revalidateOrders.
const ORDER_WRITERS = [
  "src/actions/orders.ts",
  "src/lib/orders/apply-status.ts",
  "src/lib/mobile/orders.ts",
  "src/lib/mobile/account-delete.ts",
  // Bunuan + Ligwak — each server function busts after its own commit.
  "src/modules/bunuan/server/order-edit.ts",
  "src/modules/ligwak/server/allocation.ts",
  "src/modules/ligwak/server/refund.ts",
];
for (const file of ORDER_WRITERS) {
  check(`${file} busts the orders cache after writing`, () => {
    assert.match(code(file), /revalidateOrders\(/);
  });
}

check("no unlisted file writes storefront orders", () => {
  const out = execSync(
    "grep -rlE 'storefrontOrder\\.(create|update|updateMany|delete|deleteMany|upsert|createMany)' src || true",
    { encoding: "utf8" },
  );
  const writers = out.split("\n").filter((f) => f && !f.includes(".test."));
  const unlisted = writers.filter((f) => !ORDER_WRITERS.includes(f));
  assert.deepEqual(unlisted, [], "new order writer — add revalidateOrders and list it here");
});

// ───────────────────────────── 5. group buys ────────────────────────────────
console.log("\n5. GROUP BUYS");

check("display rounds are cached under the group-buys tag", () => {
  const src = code("src/lib/storefront/group-buy-server.ts");
  assert.match(src, /storefront-group-buys[\s\S]{0,200}?groupBuysTag\(tenantId\)[\s\S]{0,120}?revalidate:/);
});

check("the storefront render reads the cached rounds, not the live ones", () => {
  const src = code("src/lib/storefront/storefront-brand.ts");
  assert.match(src, /loadGroupBuysForDisplay\(tenantId, slug\)/);
  assert.doesNotMatch(src, /\bloadGroupBuys\(/);
});

check("checkout still reads rounds live", () => {
  assert.match(code("src/actions/orders.ts"), /\bloadGroupBuys\(tenantId, demoSlug\)/);
  assert.doesNotMatch(code("src/actions/orders.ts"), /loadGroupBuysForDisplay/);
});

// Cached rounds are only correct if EVERY function that writes group_buys busts
// them — revalidateGroupBuys, or revalidateTenant (the loader carries the
// tenant tag too). (Paid Access keeps its join settings in its own tables and busts
// its own tag — see the check below.)
const ROUND_WRITERS = ["src/actions/group-buys.ts", "src/modules/bunuan/server/stage.ts", "src/modules/ligwak/server/allocation.ts"];
// Helpers that write group_buys INSIDE a caller's transaction: busting before
// the commit would let a re-read cache the old row, so the CALLER busts.
const IN_TX_ROUND_HELPERS = new Set(["writeStageMove"]);
for (const file of ROUND_WRITERS) {
  check(`${file}: every group_buys writer busts the rounds cache`, () => {
    const fns = code(file).split(/\n(?=export async function |async function )/);
    const unbusted = fns
      .filter((fn) => /groupBuy\.(create|update|updateMany|delete|deleteMany|upsert)\(/.test(fn))
      .filter((fn) => !/revalidateGroupBuys\(|revalidateTenant\(/.test(fn))
      .map((fn) => fn.match(/function (\w+)/)?.[1] ?? "?")
      .filter((name) => !IN_TX_ROUND_HELPERS.has(name));
    assert.deepEqual(unbusted, []);
  });
}
check("every caller of an in-transaction round helper busts the rounds cache", () => {
  const out = execSync("grep -rlE 'writeStageMove\\(|finishBunuanOrder\\(' src || true", { encoding: "utf8" });
  const callers = out.split("\n").filter((f) => f && !f.endsWith("/server/index.ts") && !f.endsWith("/server/cap.ts"));
  const unbusted = callers.filter((f) => !/revalidateGroupBuys\(/.test(code(f)));
  assert.deepEqual(unbusted, []);
});

check("Paid Access's cached gate policies are busted by every settings save", () => {
  const settings = code("src/modules/paid-access/server/settings.ts");
  assert.match(settings, /revalidateTag\(paidAccessTag\(/);
  assert.match(code("src/modules/paid-access/server/access.ts"), /tags: \[`tenant:\$\{tenantId\}`, paidAccessTag\(tenantId\)\]/);
});

check("no unlisted file writes group_buys", () => {
  const out = execSync(
    "grep -rlE 'groupBuy\\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\\(' src || true",
    { encoding: "utf8" },
  );
  const unlisted = out.split("\n").filter((f) => f && !ROUND_WRITERS.includes(f));
  assert.deepEqual(unlisted, [], "new round writer — bust revalidateGroupBuys and list it here");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
