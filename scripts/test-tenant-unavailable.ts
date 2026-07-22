/**
 * A deactivated (suspended) tenant's storefront must show a dedicated
 * "Website currently not available" page instead of the generic
 * "Site not found" unknown-tenant bounce.
 *
 *   - lib/tenant/gate.ts
 *       storefrontBouncePath(tenant) — pure core: given the resolved tenant
 *       (or null), decide where the storefront request bounces:
 *         null           → "/unknown-tenant"   (host not configured)
 *         suspended      → "/site-unavailable" (operator kill-switch)
 *         pending_setup  → "/unknown-tenant"   (kept dark until published)
 *         active | trial → null                (storefront serves)
 *   - lib/tenant/headers.ts — getTenantId()/getTenantIdOrNull() route through it.
 *   - app/site-unavailable/page.tsx — the visitor-facing unavailable page.
 *
 *   npm run test:tenant-unavailable
 */

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
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

async function main() {
  console.log("\nDeactivated tenant → 'Website currently not available'\n");

  // ───────────── pure core: storefrontBouncePath ─────────────
  console.log("storefrontBouncePath (pure core)");

  type GateModule = {
    storefrontBouncePath: (tenant: { status: string } | null) => string | null;
  };
  const mod = (await import("../src/lib/tenant/gate").catch(() => null)) as GateModule | null;

  check("pure core exists (src/lib/tenant/gate.ts)", () => {
    assert.ok(mod?.storefrontBouncePath, "storefrontBouncePath is not implemented");
  });

  check("suspended tenant bounces to /site-unavailable (not /unknown-tenant)", () => {
    assert.equal(mod!.storefrontBouncePath({ status: "suspended" }), "/site-unavailable");
  });

  check("unresolved host still bounces to /unknown-tenant", () => {
    assert.equal(mod!.storefrontBouncePath(null), "/unknown-tenant");
  });

  check("pending_setup stays dark on /unknown-tenant (not yet published)", () => {
    assert.equal(mod!.storefrontBouncePath({ status: "pending_setup" }), "/unknown-tenant");
  });

  check("active tenant serves the storefront (no bounce)", () => {
    assert.equal(mod!.storefrontBouncePath({ status: "active" }), null);
  });

  check("trial tenant serves the storefront (no bounce)", () => {
    assert.equal(mod!.storefrontBouncePath({ status: "trial" }), null);
  });

  // ───────────── the request gate routes through the pure core ─────────────
  console.log("lib/tenant/headers.ts");

  const headersSrc = readFileSync(join(ROOT, "src/lib/tenant/headers.ts"), "utf8");

  check("getTenantId/getTenantIdOrNull decide via storefrontBouncePath", () => {
    assert.ok(
      /storefrontBouncePath/.test(headersSrc),
      "headers.ts doesn't use the gate's pure core — suspended and unknown still share one bounce",
    );
  });

  // ───────────── the visitor-facing page ─────────────
  console.log("app/site-unavailable/page.tsx");

  const pagePath = join(ROOT, "src/app/site-unavailable/page.tsx");

  check("the unavailable page exists as a root route (reachable on tenant hosts)", () => {
    assert.ok(existsSync(pagePath), "src/app/site-unavailable/page.tsx is missing");
  });

  check('the page says "currently not available"', () => {
    const src = readFileSync(pagePath, "utf8");
    assert.ok(/currently not available/i.test(src), "page copy doesn't say 'currently not available'");
  });

  check("the page is noindexed and carries its own title", () => {
    const src = readFileSync(pagePath, "utf8");
    assert.ok(/export const metadata/.test(src), "page exports no metadata");
    assert.ok(/index:\s*false/.test(src), "page isn't robots-noindexed — a suspended store can be indexed as 'not available'");
    assert.ok(/title/.test(src), "page has no title — tab shows the root default");
  });

  // ───────────── summary ─────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
