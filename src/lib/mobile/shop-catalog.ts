import "server-only";

import { loadStorefrontBrand } from "@/lib/storefront/storefront-brand";
import { isGroupBuyProduct, isInGroupBuyScope, type GroupBuyPriceScope } from "@/lib/storefront/two-ways";
import { isGroupBuyPreorder } from "@/lib/storefront/two-ways-cart";
import { isOnHandBlocked } from "@/lib/storefront/group-buy";
import { isGroupBuyBuyable, TWO_WAYS_MODE_DEFAULT, type TwoWaysMode } from "@/lib/storefront/two-ways-mode";
import { effectiveStock, productOutOfStock } from "@/lib/storefront/inventory";
import { isMadeToOrder, MADE_TO_ORDER_LABEL } from "@/lib/storefront/made-to-order";
import { percentOff, saleBadgeLabel } from "@/lib/storefront/sale";
import { buildProductOptions } from "@/lib/storefront/variations";
import { normalizeStoreStatus, STORE_CLOSED_BLOCK_MESSAGE } from "@/lib/storefront/store-status";
import { makeVariationEntry, unitPrice } from "@/storefront/checkout";
import { SEED_CATEGORIES } from "@/storefront/data";
import type { Brand, Category, Product } from "@/storefront/types";
import { buildShopGroupBuy } from "./group-buy-share";
import type { ShopCatalog, ShopCategory, ShopProduct, ShopVariation } from "./shop-contract";
import { readCheckoutConfig } from "./shop-checkout";
import { getTenantContext } from "@/lib/tenant/context";
import type { ShopStore } from "./shop";
import type { GroupBuyViewer } from "@/lib/storefront/gb-access";

/**
 * GET /shop/catalog — the store as a SIGNED-OUT website visitor sees it,
 * projected into shopper-safe fields (docs/mobile-admin/SHOP.md).
 *
 * Built from loadStorefrontBrand — the object the storefront itself renders —
 * with reseller pricing locked (no reseller session), so display and the
 * server-side re-price agree. Every price goes through the cart's own
 * unitPrice / makeVariationEntry, and stock through the inventory engine. The
 * mapping is an ALLOW-list: promo codes, reseller / wholesale tiers, access
 * credentials and the rest of branding.config never reach the phone.
 */

type MapContext = {
  scope: GroupBuyPriceScope | null;
  gate: Brand["groupBuyGate"];
  open: boolean;
  /** The owner's per-way switches: a paused group buy sells nothing. */
  ways: TwoWaysMode;
};

/** Units left for a pool, or null when the item isn't stock-limited. */
function stockOf(p: Product, ctx: MapContext, variation?: string): number | null {
  if (isMadeToOrder(p) || isGroupBuyPreorder(p, ctx.scope)) return null;
  return effectiveStock(p, variation);
}

function markdown(list: number, price: number): number | null {
  return price < list ? list : null;
}

function toVariation(p: Product, v: NonNullable<Product["variations"]>[number], ctx: MapContext): ShopVariation {
  const price = unitPrice(makeVariationEntry(p, v), 1, ctx.scope);
  return {
    name: v.name,
    price,
    compareAtPrice: markdown(v.price, price),
    stock: stockOf(p, ctx, v.name),
    image: v.image ?? null,
  };
}

function isBuyable(p: Product, ctx: MapContext): boolean {
  if (!ctx.open || p.priceOnRequest === true || p.purchasable === false) return false;
  if (isOnHandBlocked(p.id, ctx.gate)) return false;
  if (isGroupBuyPreorder(p, ctx.scope)) return isGroupBuyBuyable(ctx.ways);
  return !productOutOfStock(p);
}

function badgeOf(p: Product, price: number, compareAt: number | null, ctx: MapContext): string | undefined {
  if (p.priceOnRequest === true) return "Message for price";
  if (!isGroupBuyPreorder(p, ctx.scope) && productOutOfStock(p)) return "Sold out";
  if (isMadeToOrder(p)) return MADE_TO_ORDER_LABEL;
  if (compareAt !== null) return saleBadgeLabel(percentOff(compareAt, price));
  return undefined;
}

export function toShopProduct(p: Product, ctx: MapContext): ShopProduct {
  const price = unitPrice(p, 1, ctx.scope);
  const compareAtPrice = markdown(p.price, price);
  const badge = badgeOf(p, price, compareAtPrice, ctx);
  const options = buildProductOptions(p);
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? "",
    description: p.description ?? "",
    image: p.image ?? null,
    extraImages: p.extraImages ?? [],
    price,
    compareAtPrice,
    stock: stockOf(p, ctx),
    purchasable: isBuyable(p, ctx),
    ...(badge ? { badge } : {}),
    isGroupBuy: isGroupBuyProduct(p) && isInGroupBuyScope(p.id, ctx.scope),
    baseSelectable: options.length === 0 || options.some((o) => !o.variation),
    variations: (p.variations ?? []).map((v) => toVariation(p, v, ctx)),
  };
}

/** The owner's categories (the website's seed list when none are saved),
 *  keeping only those that label at least one listed product. */
function categoriesFor(brand: Brand, products: ShopProduct[]): ShopCategory[] {
  const saved = (brand as { categories?: Category[] }).categories;
  const all = Array.isArray(saved) ? saved : SEED_CATEGORIES;
  const used = new Set(products.map((p) => p.category));
  return all
    .filter((c) => c && typeof c.id === "string" && used.has(c.id))
    .map((c) => ({ id: c.id, label: String(c.label ?? c.id) }));
}

function closedCopy(brand: Brand): { open: boolean; closedMessage: string } {
  const status = normalizeStoreStatus(brand.storeStatus);
  if (status.open) return { open: true, closedMessage: "" };
  const copy = [status.headline, status.message].filter(Boolean).join(" — ");
  return { open: false, closedMessage: copy || STORE_CLOSED_BLOCK_MESSAGE };
}

/** The shopper behind a ShopStore: its signed-in customer, else anonymous. */
function shopViewer(store: ShopStore): GroupBuyViewer {
  return store.customer ? { kind: "customer", customerId: store.customer.customer.id } : { kind: "anonymous" };
}

export async function loadShopCatalog(
  store: ShopStore,
  /** Override for the store team's own preview (admin/storefront) only. */
  opts: { viewer?: GroupBuyViewer } = {},
): Promise<ShopCatalog> {
  const viewer = opts.viewer ?? shopViewer(store);
  const { brand, products } = await loadStorefrontBrand({
    tenantId: store.tenantId,
    slug: store.slug,
    // The app never holds a reseller session: public price list only.
    isResellerUnlocked: async () => false,
    groupBuyViewer: async () => viewer,
  });
  const { branding } = await getTenantContext(store.tenantId);
  const { open, closedMessage } = closedCopy(brand);
  const banner = brand.groupBuyBanner ?? null;
  const ctx: MapContext = {
    scope: banner ? { coversAll: banner.coversAll, productIds: banner.productIds } : null,
    gate: brand.groupBuyGate,
    open,
    ways: brand.twoWaysMode ?? TWO_WAYS_MODE_DEFAULT,
  };
  // The storefront grid's own filter (StorefrontApp → visibleProducts).
  const listed = products.filter((p) => p.available !== false).map((p) => toShopProduct(p, ctx));
  return {
    store: {
      slug: store.slug,
      name: brand.name,
      logoUrl: brand.logoUrl || null,
      currency: brand.currency || "₱",
    },
    open,
    closedMessage,
    private: false,
    categories: categoriesFor(brand, listed),
    products: listed,
    checkout: readCheckoutConfig(brand as unknown as Record<string, unknown>, brand.qrphFeeEntitled === true),
    groupBuy: buildShopGroupBuy({
      banner,
      content: brand.groupBuyContent,
      liveBanner: brand.groupBuyLiveBanner,
      invoice: ((branding?.config ?? {}) as Record<string, unknown>).groupBuyInvoice,
      ways: ctx.ways,
      products: listed,
    }),
    groupBuyTeaser: brand.groupBuyTeaser ?? null,
  };
}
