import "server-only";

import type { TenantTx } from "@/lib/db/tenant-client";
import { FEATURES } from "@/lib/features/catalog";
import { imageUrl } from "@/lib/media/image-url";
import { formatMoney } from "@/lib/storefront/currency";
import { availableUnits, effectiveStock } from "@/lib/storefront/inventory";
import { stripMadeToOrder, isMadeToOrder } from "@/lib/storefront/made-to-order";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { protocolKey } from "@/lib/storefront/protocol-import";
import { resolveProtocolImages } from "@/lib/storefront/protocol-images";
import { effectiveBasePrice } from "@/lib/storefront/sale";
import type { TenantContext } from "@/lib/tenant/context";
import type { Product, Protocol } from "@/storefront/types";
import type { ProductCard, ProtocolCard } from "@/lib/mobile/contract";

/**
 * Product + protocol cards, ALWAYS rebuilt from the tenant's own data — the
 * client only ever sends ids. Pricing and stock go through the storefront's
 * helpers (sale.ts, inventory.ts, made-to-order.ts), so a card shows the same
 * price and availability the website would charge.
 *
 *   variationId = the variation's name (variations carry no separate id; the
 *                 cart keys them the same way — checkout.variationEntryId).
 *   protocolId  = "p-" + the protocol's name key (protocols live in
 *                 branding.config and have no id of their own).
 */

const THUMB_PX = 240;

export type ProductRef = { productId: string; variationId: string | null };

export const refKey = (r: ProductRef) => `${r.productId}|${r.variationId ?? ""}`;

function currencySymbol(tenant: TenantContext): string {
  const config = tenant.branding?.config as Record<string, unknown> | null | undefined;
  return typeof config?.currency === "string" && config.currency.trim() ? config.currency : "₱";
}

function toCard(p: Product, variationId: string | null, symbol: string): ProductCard | null {
  const variation = variationId ? (p.variations ?? []).find((v) => v.name === variationId) : null;
  if (variationId && !variation) return null;
  const madeToOrder = isMadeToOrder(p);
  const price = variation ? variation.price : effectiveBasePrice(p);
  const units = variation ? effectiveStock(p, variation.name) : availableUnits(p);
  const image = variation?.image || p.image;
  return {
    id: p.id,
    name: p.name,
    imageUrl: image ? imageUrl(image, { width: THUMB_PX, height: THUMB_PX }) : null,
    price,
    priceLabel: formatMoney(price, symbol),
    variationId: variation ? variation.name : null,
    variationName: variation ? variation.name : null,
    hasVariations: (p.variations ?? []).length > 0,
    inStock: p.available !== false && units > 0,
    stockLeft: madeToOrder ? null : units,
  };
}

/** Cards for many refs in ONE query. Missing / archived products are absent. */
export async function loadProductCards(
  db: TenantTx,
  tenant: TenantContext,
  refs: ProductRef[],
): Promise<Map<string, ProductCard>> {
  const out = new Map<string, ProductCard>();
  const ids = [...new Set(refs.map((r) => r.productId))];
  if (ids.length === 0) return out;
  const symbol = currencySymbol(tenant);
  // Customer-visible cards and drops: published products only (never draft/archived).
  const rows = await db.product.findMany({ where: { id: { in: ids }, status: { notIn: ["draft", "archived"] } } });
  const products = stripMadeToOrder(
    rows.map((r) => dbProductToStorefront(r as DbProductRow, symbol)),
    tenant.has(FEATURES.STORE_MADE_TO_ORDER),
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const r of refs) {
    const p = byId.get(r.productId);
    const card = p ? toCard(p, r.variationId, symbol) : null;
    if (card) out.set(refKey(r), card);
  }
  return out;
}

// ── protocols ────────────────────────────────────────────────────────────────

export function protocolIdFor(name: string): string {
  return `p-${protocolKey(name).replace(/ /g, "-")}`;
}

function toProtocolCard(p: Protocol): ProtocolCard {
  const images = resolveProtocolImages(p);
  return {
    id: protocolIdFor(p.name),
    name: p.name,
    mode: p.mode === "image" ? "image" : "text",
    dose: p.dosage ?? "",
    frequency: p.frequency ?? "",
    cycle: p.duration ?? "",
    imageUrl: images[0] ? imageUrl(images[0], { width: 640 }) : null,
    fileUrl: null,
  };
}

/** The store's protocol guide as cards, keyed by id. Empty without STORE_PROTOCOLS. */
export function loadProtocolCards(tenant: TenantContext): Map<string, ProtocolCard> {
  const out = new Map<string, ProtocolCard>();
  if (!tenant.has(FEATURES.STORE_PROTOCOLS)) return out;
  const config = tenant.branding?.config as Record<string, unknown> | null | undefined;
  const list = Array.isArray(config?.protocols) ? (config!.protocols as Protocol[]) : [];
  for (const p of list) {
    if (p && typeof p.name === "string" && p.name.trim()) {
      const card = toProtocolCard(p);
      if (!out.has(card.id)) out.set(card.id, card);
    }
  }
  return out;
}
