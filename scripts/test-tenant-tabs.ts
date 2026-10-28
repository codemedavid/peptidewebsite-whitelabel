// Tenant workspace tabs — RED/GREEN gate (npm run test:tenant-tabs).
//
// The platform admin's tenant pages share one header + tab bar
// (src/app/(platform)/admin/tenants/[slug]/layout.tsx). Four tabs are in-page
// views of the detail route selected by ?tab=, four are their own sub-routes.
// The pure helpers in src/components/admin/pages/tenant-tabs.ts decide:
//   - parseTenantDetailTab: untrusted ?tab= in → a known in-page tab, failing
//     closed to "overview" (so an old ?tab=usage / ?tab=features link still lands).
//   - buildTenantTabs: the ordered tab list with hrefs for one tenant.
//   - activeTenantTab: which tab is lit for a given pathname + ?tab=.
//
// Journeys covered:
//  1. Unset / garbage / retired tab values → "overview".
//  2. Every in-page tab round-trips.
//  3. Tab order and hrefs (overview has no ?tab=, sub-routes are paths).
//  4. Active tab for the detail route with and without ?tab=.
//  5. Active tab for each sub-route, including a nested path under it.
//  6. A slug that looks like a sub-route name doesn't confuse the matcher.
//  7. The admin-host rewrite keeps the query string — ?tab= (and the calendar's
//     ?y=&m=) silently vanished before, so Billing showed Overview.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeTenantTab,
  buildTenantTabs,
  parseTenantDetailTab,
  TENANT_DETAIL_TABS,
} from "../src/components/admin/pages/tenant-tabs";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

console.log("parseTenantDetailTab — untrusted ?tab= in, known tab out");
{
  check("unset → overview", parseTenantDetailTab(undefined) === "overview");
  check("garbage → overview", parseTenantDetailTab("<script>") === "overview");
  check("retired 'usage' → overview", parseTenantDetailTab("usage") === "overview");
  check("retired 'features' → overview", parseTenantDetailTab("features") === "overview");
  check("array → overview", parseTenantDetailTab(["billing"]) === "overview");
  for (const t of TENANT_DETAIL_TABS) check(`'${t}' round-trips`, parseTenantDetailTab(t) === t);
}

console.log("buildTenantTabs — order and hrefs");
{
  const tabs = buildTenantTabs("acme", { orders: 12, features: 5 });
  const ids = tabs.map((t) => t.id);
  check(
    "order",
    JSON.stringify(ids) ===
      JSON.stringify(["overview", "orders", "billing", "branding", "features", "settings", "integrations", "activity"]),
    ids,
  );
  const href = (id: string) => tabs.find((t) => t.id === id)?.href;
  check("overview href has no ?tab=", href("overview") === "/tenants/acme", href("overview"));
  check("orders href uses ?tab=", href("orders") === "/tenants/acme?tab=orders", href("orders"));
  check("activity href uses ?tab=", href("activity") === "/tenants/acme?tab=activity", href("activity"));
  check("branding is a sub-route", href("branding") === "/tenants/acme/branding", href("branding"));
  check("settings is a sub-route", href("settings") === "/tenants/acme/settings", href("settings"));
  check("orders count carried", tabs.find((t) => t.id === "orders")?.count === "12");
  check("features count carried", tabs.find((t) => t.id === "features")?.count === "5");
  check(
    "big order count compacts to 1k+",
    buildTenantTabs("acme", { orders: 1500, features: 0 }).find((t) => t.id === "orders")?.count === "1k+",
  );
  check("slug is URL-encoded", buildTenantTabs("a b", { orders: 0, features: 0 })[0].href === "/tenants/a%20b");
}

console.log("activeTenantTab — detail route");
{
  check("bare detail → overview", activeTenantTab("/tenants/acme", null) === "overview");
  check("?tab=billing → billing", activeTenantTab("/tenants/acme", "billing") === "billing");
  check("?tab=nonsense → overview", activeTenantTab("/tenants/acme", "nonsense") === "overview");
  check("trailing slash → overview", activeTenantTab("/tenants/acme/", null) === "overview");
}

console.log("activeTenantTab — sub-routes");
{
  check("branding", activeTenantTab("/tenants/acme/branding", null) === "branding");
  check("features", activeTenantTab("/tenants/acme/features", null) === "features");
  check("settings", activeTenantTab("/tenants/acme/settings", null) === "settings");
  check("integrations", activeTenantTab("/tenants/acme/integrations", null) === "integrations");
  check("nested under settings", activeTenantTab("/tenants/acme/settings/domains", null) === "settings");
  check("?tab= ignored on a sub-route", activeTenantTab("/tenants/acme/branding", "billing") === "branding");
  check("slug named 'settings'", activeTenantTab("/tenants/settings", null) === "overview");
}

console.log("middleware — admin rewrite keeps the query string");
{
  const mw = readFileSync(join(__dirname, "..", "src", "middleware.ts"), "utf8");
  const rewrite = mw.match(/NextResponse\.rewrite\(new URL\(`\/admin\$\{path\}([^`]*)`/);
  check("admin rewrite found", !!rewrite);
  check("admin rewrite appends url.search", rewrite?.[1] === "${url.search}", rewrite?.[1]);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall tenant-tab checks passed");
