"use server";

/**
 * Owner data export — "if I ever decide not to continue with Pepweb, can I
 * export my products, customer data and order history?".
 *
 * This action is the yes. It gathers everything the tenant owns and hands back a
 * ready-to-download bundle (four CSVs + one JSON dump) built by the pure core in
 * lib/storefront/data-export.
 *
 * OWNER-ONLY, deliberately. Every other admin capability is delegable to staff
 * through the Staff Accounts module, but "download the entire customer list and
 * sales history in one click" is exactly the capability a store owner would not
 * hand to a part-time assistant — so it is guarded by requireStoreOwner() and is
 * NOT registered as a staff-grantable module.
 *
 * Tenant scoping: the data is read through the existing tenant-scoped list
 * actions rather than a second set of queries, so the export inherits the same
 * forTenant()/RLS path — and can never disagree with the admin screens about
 * what an order contains or what it totalled.
 */

import { requireStoreOwner } from "@/lib/auth/staff-guard";
import { getTenantSlug } from "@/lib/tenant/headers";
import { isDemoMode, getDemoBranding } from "@/lib/demo/fixtures";
import { prisma } from "@/lib/db/prisma";
import { listProductsAction } from "./products";
import { listStorefrontOrdersAction } from "./orders";
import { buildDataExport, type DataExportBundle } from "@/lib/storefront/data-export";

export type ExportStoreDataResult = { ok: true; bundle: DataExportBundle } | { error: string };

const NO_ACCESS = "Only the store owner can export the store's data.";

/** Tenant display name + currency symbol, so the files identify the store. */
async function readStoreMeta(tenantId: string): Promise<{ name: string; currency: string }> {
  if (isDemoMode()) {
    const branding = getDemoBranding(tenantId);
    const config = (branding?.config ?? {}) as Record<string, unknown>;
    return { name: String(config.storeName ?? "") || tenantId, currency: String(config.currency ?? "") || "₱" };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, branding: { select: { config: true } } },
  });
  const config = (tenant?.branding?.config ?? {}) as Record<string, unknown>;
  return {
    name: String(config.storeName ?? "") || tenant?.name || "",
    currency: String(config.currency ?? "") || "₱",
  };
}

/**
 * Build the owner's full data export. Trashed orders ride along (flagged
 * `Deleted`) — an export taken on the way out is the last chance to keep them.
 */
export async function exportStoreDataAction(): Promise<ExportStoreDataResult> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };

  try {
    const slug = (await getTenantSlug()) ?? tenantId;
    const { name, currency } = await readStoreMeta(tenantId);

    const [products, active, trashed] = await Promise.all([
      listProductsAction(currency),
      listStorefrontOrdersAction("active"),
      listStorefrontOrdersAction("trash"),
    ]);

    if ("error" in products) return { error: products.error };
    if ("error" in active) return { error: active.error };
    // The trash is a nice-to-have, not a reason to fail the whole export.
    const trashedOrders = "error" in trashed ? [] : trashed.orders;

    return {
      ok: true,
      bundle: buildDataExport({
        store: { name: name || slug, slug, currency },
        products: products.products,
        orders: active.orders,
        trashedOrders,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't build the export." };
  }
}
