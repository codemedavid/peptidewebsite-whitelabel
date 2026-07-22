/**
 * Deactivate / reactivate of a tenant storefront (the Super Admin suspend
 * toggle) must take effect on the NEXT storefront request, not after the
 * 5-minute host-resolver cache TTL (lib/tenant/resolve.ts caches host → tenant
 * with tag `tenant-host:<host>` + revalidate: 300).
 *
 * Reproducer for: suspendTenantAction flips Tenant.status but only busts the
 * admin caches — it never calls revalidateTenant(), so a deactivated store
 * stays publicly live (and a reactivated one stays dark) for up to 5 minutes.
 * Custom domains were never busted anywhere, not even by setTenantPlanAction.
 *
 *   - lib/tenant/cache-tags.ts
 *       tenantCacheTags(id, slug, customHosts, root) — pure core: every cache
 *       tag that must be busted so a visibility flip is immediately visible.
 *   - lib/tenant/revalidate.ts — maps those tags over revalidateTag().
 *   - actions/admin.ts — suspendTenantAction / setTenantPlanAction call it
 *       with the tenant's custom-domain hostnames included.
 *
 *   npm run test:tenant-suspend
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

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

/**
 * Slice one exported function out of an actions source file. The body ends at
 * the next doc comment or export so a neighbouring function's JSDoc (which may
 * mention the same identifiers) can't produce a false pass.
 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const rest = src.slice(start);
  const ends = ["\n/**", "\nexport "]
    .map((m) => rest.indexOf(m, 1))
    .filter((i) => i !== -1);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

async function main() {
  console.log("\nTenant deactivate/reactivate — kill-switch cache busting\n");

  // ───────────── the action really busts the storefront caches ─────────────
  console.log("actions/admin.ts");

  const adminSrc = readFileSync(join(ROOT, "src/actions/admin.ts"), "utf8");
  const suspend = fnBody(adminSrc, "suspendTenantAction");
  const setPlan = fnBody(adminSrc, "setTenantPlanAction");

  check("suspendTenantAction busts the tenant + host-resolver caches (revalidateTenant)", () => {
    assert.ok(
      /revalidateTenant\(/.test(suspend),
      "suspendTenantAction never calls revalidateTenant() — the storefront stays cached (live/dark) for up to 5 min after the toggle",
    );
  });

  check("suspendTenantAction loads the tenant's custom-domain hostnames", () => {
    assert.ok(
      /domains\s*:/.test(suspend),
      "suspendTenantAction doesn't select domains — custom-domain storefronts are never busted",
    );
  });

  check("setTenantPlanAction busts custom-domain hosts too", () => {
    assert.ok(
      /domains\s*:/.test(setPlan),
      "setTenantPlanAction doesn't select domains — a suspend via the status dropdown leaves custom domains stale",
    );
  });

  // ───────────── revalidateTenant covers custom hosts ─────────────
  console.log("lib/tenant/revalidate.ts");

  const revalidateSrc = readFileSync(join(ROOT, "src/lib/tenant/revalidate.ts"), "utf8");

  check("revalidateTenant accepts custom hostnames and derives tags from the pure core", () => {
    assert.ok(/customHosts/.test(revalidateSrc), "revalidateTenant has no customHosts parameter");
    assert.ok(/cache-tags/.test(revalidateSrc), "revalidateTenant doesn't use lib/tenant/cache-tags");
  });

  // ───────────── pure core: tenantCacheTags ─────────────
  console.log("tenantCacheTags (pure core)");

  type CacheTagsModule = {
    tenantCacheTags: (
      tenantId: string,
      slug?: string | null,
      customHosts?: readonly string[],
      root?: string,
    ) => string[];
  };
  const mod = (await import("../src/lib/tenant/cache-tags").catch(() => null)) as CacheTagsModule | null;

  check("pure core exists (src/lib/tenant/cache-tags.ts)", () => {
    assert.ok(mod?.tenantCacheTags, "tenantCacheTags is not implemented");
  });

  check("always busts the tenant-scoped tag", () => {
    const tags = mod!.tenantCacheTags("t1", "acme", [], "jonina.store");
    assert.ok(tags.includes("tenant:t1"), `missing tenant:t1 in ${JSON.stringify(tags)}`);
  });

  check("busts the platform-subdomain host entry (port stripped from root)", () => {
    const tags = mod!.tenantCacheTags("t1", "acme", [], "lvh.me:3100");
    assert.ok(tags.includes("tenant-host:acme.lvh.me"), `missing platform host tag in ${JSON.stringify(tags)}`);
  });

  check("busts every custom-domain host entry, normalized to lowercase", () => {
    const tags = mod!.tenantCacheTags("t1", "acme", ["Shop.Acme.com", "peptides.ph"], "jonina.store");
    assert.ok(tags.includes("tenant-host:shop.acme.com"), `missing custom host tag in ${JSON.stringify(tags)}`);
    assert.ok(tags.includes("tenant-host:peptides.ph"), `missing custom host tag in ${JSON.stringify(tags)}`);
  });

  check("no slug → tenant tag + custom hosts only (no phantom platform tag)", () => {
    const tags = mod!.tenantCacheTags("t1", null, ["shop.acme.com"], "jonina.store");
    assert.deepEqual(tags.sort(), ["tenant-host:shop.acme.com", "tenant:t1"].sort());
  });

  check("deduplicates a custom host that equals the platform host", () => {
    const tags = mod!.tenantCacheTags("t1", "acme", ["acme.jonina.store"], "jonina.store");
    assert.equal(tags.filter((t) => t === "tenant-host:acme.jonina.store").length, 1);
  });

  check("ignores blank custom-host entries", () => {
    const tags = mod!.tenantCacheTags("t1", "acme", ["  ", ""], "jonina.store");
    assert.equal(tags.filter((t) => t.startsWith("tenant-host:")).length, 1);
  });

  // ───────────── summary ─────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
