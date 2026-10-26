import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import { imageUrl } from "@/lib/media/image-url";
import { formatMoney } from "@/lib/storefront/currency";
import { isMadeToOrder } from "@/lib/storefront/made-to-order";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { LOW_STOCK_AT, productUnits } from "@/lib/storefront/admin-dashboard";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { loadCatalogRows } from "@/lib/storefront/storefront-brand";
import type { Product } from "@/storefront/types";
import type { ProductRow } from "./contract";
import type { MobileContext } from "./auth";

/**
 * Catalog reads + the two quick edits the app offers (availability, stock).
 *
 * The quick edits write exactly the columns saveProductAction derives from
 * those fields (productToDbWrite: available → status "active"/"draft" + active;
 * stock → clamped whole number) and nothing else — metadata (variations,
 * reseller prices, made-to-order) is never touched, so the website's full
 * product editor stays the only place those change. Products whose stock lives
 * on their variations, and made-to-order products, get availability only.
 */

const THUMB_PX = 96;
const MAX_STOCK = 1_000_000;

function symbolOf(ctx: MobileContext): string {
  const config = ctx.tenant.branding?.config as Record<string, unknown> | null | undefined;
  return typeof config?.currency === "string" && config.currency.trim() ? config.currency : "₱";
}

/** True when stock is tracked on the variations rather than the product. */
function stockOnVariations(p: Product): boolean {
  return (p.variations ?? []).some((v) => typeof v.stock === "number");
}

function toRow(p: Product, updatedAt: Date, symbol: string): ProductRow {
  const madeToOrder = isMadeToOrder(p);
  const units = productUnits(p);
  return {
    id: p.id,
    name: p.name,
    imageUrl: p.image ? imageUrl(p.image, { width: THUMB_PX, height: THUMB_PX }) : null,
    priceLabel: formatMoney(p.price, symbol),
    stock: madeToOrder ? null : units,
    available: p.available !== false,
    hasVariations: (p.variations ?? []).length > 0 && stockOnVariations(p),
    stockTone: madeToOrder ? "untracked" : units === 0 ? "out" : units <= LOW_STOCK_AT ? "low" : "ok",
    updatedAt: updatedAt.toISOString(),
  };
}

// Reads the storefront's cached catalog rows (same non-archived set) instead of
// re-reading every product per open; every product/stock writer — including
// updateProduct below — busts that cache. Cached Dates come back as strings.
export async function listProducts(ctx: MobileContext): Promise<ProductRow[]> {
  const symbol = symbolOf(ctx);
  const rows = (await loadCatalogRows(ctx.tenantId))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((r) =>
    toRow(dbProductToStorefront(r as DbProductRow, symbol), new Date(r.updatedAt), symbol),
  );
}

export type ProductUpdateOutcome =
  | { kind: "ok"; product: ProductRow }
  | { kind: "conflict"; current: ProductRow }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string };

export async function updateProduct(
  ctx: MobileContext,
  id: string,
  body: Record<string, unknown>,
): Promise<ProductUpdateOutcome> {
  const expected = new Date(typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "");
  if (Number.isNaN(expected.getTime())) return { kind: "invalid", message: "Reload and try again." };
  const symbol = symbolOf(ctx);

  const outcome = await withTenant(ctx.tenantId, async (db): Promise<ProductUpdateOutcome> => {
    const row = await db.product.findFirst({ where: { id, status: { not: "archived" } } });
    if (!row) return { kind: "not_found" };
    const product = dbProductToStorefront(row as DbProductRow, symbol);
    if (row.updatedAt.getTime() !== expected.getTime()) {
      return { kind: "conflict", current: toRow(product, row.updatedAt, symbol) };
    }

    const data: { status?: string; active?: boolean; stock?: number } = {};
    if (typeof body.available === "boolean") {
      data.status = body.available ? "active" : "draft";
      data.active = body.available;
    }
    if (body.stock !== undefined) {
      const n = Number(body.stock);
      if (!Number.isInteger(n) || n < 0 || n > MAX_STOCK) {
        return { kind: "invalid", message: "Stock must be a whole number, 0 or more." };
      }
      if (isMadeToOrder(product) || stockOnVariations(product)) {
        return { kind: "invalid", message: "Edit this product's stock on the website." };
      }
      data.stock = n;
    }
    if (Object.keys(data).length === 0) return { kind: "invalid", message: "Nothing to save." };

    const written = await db.product.updateMany({ where: { id, updatedAt: row.updatedAt }, data });
    const fresh = await db.product.findFirst({ where: { id } });
    if (!fresh) return { kind: "not_found" };
    const view = toRow(dbProductToStorefront(fresh as DbProductRow, symbol), fresh.updatedAt, symbol);
    return written.count === 1 ? { kind: "ok", product: view } : { kind: "conflict", current: view };
  });

  // Same cache bust saveProductAction performs, so the storefront reflects it.
  if (outcome.kind === "ok") revalidateTenant(ctx.tenantId, ctx.slug);
  return outcome;
}
