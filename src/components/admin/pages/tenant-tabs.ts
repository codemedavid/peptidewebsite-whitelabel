// The tenant workspace tab bar — one ordered list shared by the header
// (TenantWorkspaceHeader), the detail page and the tests. Four tabs are views of
// the detail route picked by ?tab=; four are sub-routes with their own page.
// Admin URLs are bare (no /admin prefix) — see the super-admin-ui notes.

export const TENANT_DETAIL_TABS = ["overview", "orders", "billing", "activity"] as const;
export type TenantDetailTab = (typeof TENANT_DETAIL_TABS)[number];

const SUB_ROUTE_TABS = ["branding", "features", "settings", "integrations"] as const;
type TenantSubRouteTab = (typeof SUB_ROUTE_TABS)[number];

export type TenantTabId = TenantDetailTab | TenantSubRouteTab;

export type TenantTab = { id: TenantTabId; label: string; href: string; count?: string };

const ORDER: { id: TenantTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "billing", label: "Billing" },
  { id: "branding", label: "Branding" },
  { id: "features", label: "Features" },
  { id: "settings", label: "Settings" },
  { id: "integrations", label: "Integrations" },
  { id: "activity", label: "Activity" },
];

const COMPACT_COUNT_AT = 1000;

function isDetailTab(v: string): v is TenantDetailTab {
  return (TENANT_DETAIL_TABS as readonly string[]).includes(v);
}

function isSubRouteTab(v: string): v is TenantSubRouteTab {
  return (SUB_ROUTE_TABS as readonly string[]).includes(v);
}

/** Untrusted ?tab= in → a known in-page tab. Anything else (including the
 *  retired "usage" / "features" values) falls back to Overview. */
export function parseTenantDetailTab(value: unknown): TenantDetailTab {
  return typeof value === "string" && isDetailTab(value) ? value : "overview";
}

function compactCount(n: number): string {
  return n >= COMPACT_COUNT_AT ? "1k+" : String(n);
}

export function buildTenantTabs(slug: string, counts: { orders: number; features: number }): TenantTab[] {
  const base = `/tenants/${encodeURIComponent(slug)}`;
  return ORDER.map(({ id, label }) => {
    const href = id === "overview" ? base : isDetailTab(id) ? `${base}?tab=${id}` : `${base}/${id}`;
    const count = id === "orders" ? compactCount(counts.orders) : id === "features" ? String(counts.features) : undefined;
    return count === undefined ? { id, label, href } : { id, label, href, count };
  });
}

/** Which tab is lit: the sub-route segment after /tenants/<slug>/, else ?tab=. */
export function activeTenantTab(pathname: string, tabParam: string | null): TenantTabId {
  const [, root, , section] = pathname.split("/");
  if (root === "tenants" && section && isSubRouteTab(section)) return section;
  return parseTenantDetailTab(tabParam);
}
