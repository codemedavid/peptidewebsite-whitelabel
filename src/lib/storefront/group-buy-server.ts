// Server-side Group Buy helpers shared by actions/group-buys.ts (the store
// admin's manager) and actions/orders.ts (checkout attribution). Kept out of
// lib/storefront/group-buy.ts so that file stays importable from client
// components — everything here touches entitlements, the DB or the demo files.

import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { withTenant } from "@/lib/db/tenant-client";
import { isDemoMode, getDemoGroupBuys } from "@/lib/demo/fixtures";
import {
  normalizeGroupBuy,
  dbGroupBuyToStorefront,
  type DbGroupBuyRow,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "./group-buy";

/** The tenant's resolved groupbuy.* entitlements as one capabilities object.
 *  Every capability is ANDed with the module master switch, so revoking
 *  groupbuy.module alone turns the whole feature off. */
export async function resolveGroupBuyCaps(tenantId: string): Promise<GroupBuyCapabilities> {
  const set = await getEntitlements(tenantId);
  const on = set.has(FEATURES.GB_MODULE);
  const has = (key: (typeof FEATURES)[keyof typeof FEATURES]) => on && set.has(key);
  return {
    enabled: on,
    canCreate: has(FEATURES.GB_CREATE),
    canEdit: has(FEATURES.GB_EDIT),
    canDuplicate: has(FEATURES.GB_DUPLICATE),
    canArchive: has(FEATURES.GB_ARCHIVE),
    scheduled: has(FEATURES.GB_SCHEDULED),
    productAssignment: has(FEATURES.GB_PRODUCT_ASSIGNMENT),
    supplierReports: has(FEATURES.GB_SUPPLIER_REPORTS),
    reports: {
      excel: has(FEATURES.GB_REPORT_EXCEL),
      csv: has(FEATURES.GB_REPORT_CSV),
      pdf: has(FEATURES.GB_REPORT_PDF),
      autoOnClose: has(FEATURES.GB_REPORT_AUTO_ON_CLOSE),
      customerBreakdown: has(FEATURES.GB_REPORT_CUSTOMER_BREAKDOWN),
      productBreakdown: has(FEATURES.GB_REPORT_PRODUCT_BREAKDOWN),
      supplierSummary: has(FEATURES.GB_REPORT_SUPPLIER_SUMMARY),
    },
  };
}

/**
 * The tenant's group buys, normalized and newest-first. Demo mode reads the
 * file-backed store (keyed by slug, like demo orders); otherwise the
 * tenant-scoped group_buys table.
 */
export async function loadGroupBuys(tenantId: string, demoSlug: string): Promise<GroupBuy[]> {
  if (isDemoMode()) {
    return getDemoGroupBuys(demoSlug)
      .map(normalizeGroupBuy)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = await withTenant(tenantId, (db) =>
    db.groupBuy.findMany({ orderBy: { createdAt: "desc" } }),
  );
  return rows.map((r) => dbGroupBuyToStorefront(r as DbGroupBuyRow));
}
