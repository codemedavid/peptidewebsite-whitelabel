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
 *   3. CATALOG      — display rows cached for 1h (writers already bust).
 *
 * Run:
 *   npm run test:db-read-budget
 */

import assert from "node:assert";
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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
