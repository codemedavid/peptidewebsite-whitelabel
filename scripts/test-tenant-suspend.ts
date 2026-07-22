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
 * Slice one exported function out of an actions source file by matching the
 * function's braces, so neither a neighbouring function's JSDoc nor a comment
 * inside the function can truncate the slice or produce a false pass.
 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    if (depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

async function main() {
  console.log("\nTenant deactivate/reactivate — kill-switch cache busting\n");

  // ───────────── the action really busts the storefront caches ─────────────
  console.log("actions/admin.ts");

  const adminSrc = readFileSync(join(ROOT, "src/actions/admin.ts"), "utf8");
  const suspend = fnBody(adminSrc, "suspendTenantAction");
  const setPlan = fnBody(adminSrc, "setTenantPlanAction");

  check("suspendTenantAction busts every host via revalidateTenantVisibility", () => {
    assert.ok(
      /revalidateTenantVisibility\(/.test(suspend),
      "suspendTenantAction doesn't use the can't-forget helper — the storefront stays cached (live/dark) for up to 5 min after the toggle",
    );
  });

  check("setTenantPlanAction busts every host via revalidateTenantVisibility", () => {
    assert.ok(
      /revalidateTenantVisibility\(/.test(setPlan),
      "setTenantPlanAction doesn't use the can't-forget helper — a suspend via the status dropdown leaves custom domains stale",
    );
  });

  check("demo mode reports plan/status changes as unsupported (no phantom success)", () => {
    assert.ok(
      /demo tenants isn't supported/i.test(setPlan),
      "setTenantPlanAction demo branch still fakes { ok, status } — the dropdown shows a suspend that never persisted",
    );
  });

  const del = fnBody(adminSrc, "deleteTenantAction");

  check("deleteTenantAction busts the deleted tenant's host caches (hosts captured before delete)", () => {
    assert.ok(
      /revalidateTenant\(/.test(del) && /domains\s*:/.test(del),
      "deleteTenantAction never busts tenant-host caches — a deleted tenant's hosts keep resolving (then 500) for up to 5 min",
    );
  });

  check("suspend flip is conditional on the status it read (no concurrent double-flip)", () => {
    assert.ok(
      /updateMany/.test(suspend) && /status:\s*tenant\.status/.test(suspend),
      "suspendTenantAction uses a blind read-then-write — two concurrent toggles can double-flip",
    );
  });

  check("demo mode reports suspend as unsupported instead of a phantom 'active' status", () => {
    assert.ok(
      /demo tenants isn't supported/i.test(suspend) && !/status:\s*"active"\s*\}/.test(suspend),
      "demo branch still fakes { ok, status: 'active' } — the UI toasts 'reactivated' after clicking Suspend",
    );
  });

  // ───────────── publish/unpublish flips bust custom domains too ─────────────
  console.log("actions/admin-onboarding.ts");

  const onbSrc = readFileSync(join(ROOT, "src/actions/admin-onboarding.ts"), "utf8");

  check("publishTenantAction busts every host via revalidateTenantVisibility", () => {
    assert.ok(
      /revalidateTenantVisibility\(/.test(fnBody(onbSrc, "publishTenantAction")),
      "go-live still calls revalidateTenant(id, slug) — a tenant with a custom domain goes live there up to 5 min late",
    );
  });

  check("unpublishTenantAction busts every host via revalidateTenantVisibility", () => {
    assert.ok(
      /revalidateTenantVisibility\(/.test(fnBody(onbSrc, "unpublishTenantAction")),
      "unpublish still leaves custom-domain storefronts serving from cache",
    );
  });

  check("publish/unpublish no longer select the dead submission slug", () => {
    assert.ok(
      !/slug: true/.test(fnBody(onbSrc, "publishTenantAction")) &&
        !/slug: true/.test(fnBody(onbSrc, "unpublishTenantAction")),
      "the selects still fetch sub.slug whose only consumer was the replaced revalidateTenant call",
    );
  });

  // ───────────── revalidateTenant covers custom hosts ─────────────
  console.log("lib/tenant/revalidate.ts");

  const revalidateSrc = readFileSync(join(ROOT, "src/lib/tenant/revalidate.ts"), "utf8");

  check("revalidateTenant accepts custom hostnames and derives tags from the pure core", () => {
    assert.ok(/customHosts/.test(revalidateSrc), "revalidateTenant has no customHosts parameter");
    assert.ok(/cache-tags/.test(revalidateSrc), "revalidateTenant doesn't use lib/tenant/cache-tags");
  });

  check("revalidateTenantVisibility self-fetches slug + domains so callers can't forget them", () => {
    assert.ok(
      /export async function revalidateTenantVisibility/.test(revalidateSrc) && /domains/.test(revalidateSrc),
      "no self-fetching visibility helper — every future status-flipping action must remember to enumerate domains",
    );
  });

  check("resolve.ts shares normalizeHost with cache-tags (cache key and bust tag can't drift)", () => {
    const resolveSrc = readFileSync(join(ROOT, "src/lib/tenant/resolve.ts"), "utf8");
    assert.ok(
      /import \{[^}]*normalizeHost[^}]*\} from "\.\/cache-tags"/.test(resolveSrc),
      "resolve.ts keeps its own host normalization — a divergence silently breaks cache busting",
    );
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
    normalizeHost?: (host: string) => string;
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

  check("exports normalizeHost (trim + lowercase + strip port)", () => {
    assert.ok(mod?.normalizeHost, "normalizeHost is not exported from cache-tags");
    assert.equal(mod!.normalizeHost!(" Shop.Acme.com:443 "), "shop.acme.com");
  });

  check("normalizeHost strips a trailing FQDN dot (matches admin's normalizeHostname)", () => {
    assert.equal(
      mod!.normalizeHost!("shop.acme.com."),
      "shop.acme.com",
      "'shop.acme.com.' resolves as a distinct cache key that misses the Domain lookup",
    );
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
