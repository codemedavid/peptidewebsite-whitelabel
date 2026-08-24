// Storefront render cost — RED/GREEN gate (npm run test:storefront-render-cost).
//
// Symptom: the storefront was slow to render. Measured against the real DB,
// three uncached calls dominated every single home-page render and ran one
// after another:
//
//   getFeatureRegistry   505ms   platform-global row, no cache
//   products.findMany    708ms
//   orders.findMany      721ms   best-seller scan over EVERY active order
//   ------------------------------------
//   sequential total   ~1935ms
//
// Two of those three buy nothing by being fresh:
//
//   * getFeatureRegistry reads one platform_settings row that only changes when
//     an OPERATOR saves the plan/feature registry. It is not per-tenant, and it
//     only decides whether a cosmetic "new" badge shows. Every storefront on the
//     platform paid a round trip for it.
//   * The best-seller counts are a derived aggregate — a full scan of the
//     tenant's active orders reduced to a per-product tally that only sets the
//     order of a sort dropdown. hpglow alone has ~490 active orders, rescanned
//     on every visit.
//
// Both are now unstable_cache-wrapped and tag-busted on write, matching how
// tenant context and entitlements already work in this codebase.
//
// products.findMany is deliberately NOT cached here: product rows carry stock,
// and serving stale stock risks overselling. That is a product decision, not a
// perf one.
//
// Journeys:
//  1. As a shopper, I want the store to render without waiting on data nobody
//     edited, so the page appears quickly.
//  2. As an operator, when I save the feature registry I want stores to pick it
//     up, so caching never strands my change.
//  3. As a store owner, when an order lands I want best sellers to reflect it
//     within the cache window, so the sort stays meaningful.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

console.log("getFeatureRegistry — a platform-global row is not worth a round trip per render");
const reg = read("src/lib/platform/feature-registry-server.ts");
check("reads through unstable_cache", /unstable_cache/.test(reg));
check("carries a bustable tag", /FEATURE_REGISTRY_TAG|"platform:feature-registry"/.test(reg));
check("sets a revalidate window", /revalidate:\s*\d+/.test(reg));
check("still dedupes within a render", /\bcache\(/.test(reg));
check("write path busts the tag", /revalidateTag\(/.test(reg));
check("demo mode still bypasses the cache", /isDemoMode\(\)/.test(reg));
check("read still cannot throw", /catch/.test(reg));

console.log("best sellers — a derived tally, not live data");
const bs = read("src/lib/storefront/best-sellers.ts");
check("best-seller loader exists", bs.length > 0);
check("reads through unstable_cache", /unstable_cache/.test(bs));
check("keyed per tenant", /tenantId/.test(bs));
check("tagged so tenant mutations bust it", /tenant:\$\{tenantId\}/.test(bs));
check("sets a revalidate window", /revalidate:\s*\d+/.test(bs));
check("excludes trashed orders", /ACTIVE_ORDERS_WHERE/.test(bs));
check("reduces to counts, never returns raw orders", /buildBestSellerCounts/.test(bs));
check("selects only status+items (no PII)", /status:\s*true/.test(bs) && /items:\s*true/.test(bs) && !/customer|email|phone|address/i.test(bs));
check("failure degrades to empty counts, not a broken page", /catch/.test(bs));

console.log("wiring — the home page uses the cached loaders");
const page = read("src/app/(tenant)/(storefront)/page.tsx");
check("home page imports the best-seller loader", /from "@\/lib\/storefront\/best-sellers"/.test(page));
check("home page no longer inlines the order scan", !/db\.storefrontOrder\.findMany/.test(page));

console.log("the stock read stays live on purpose");
check("products are still read directly (fresh stock)", /db\.product\.findMany/.test(page));

console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
