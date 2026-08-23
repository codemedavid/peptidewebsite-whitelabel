"use server";

// Storefront orders — the DB write/read path behind manual checkout and the
// store admin's Orders screen. Two audiences, two gates:
//
//   • Checkout (uploadPaymentProofAction, placeStorefrontOrderAction) is PUBLIC:
//     the buyer is an anonymous customer, so the tenant is resolved from the
//     request host (never the client) and there's no admin session to check.
//   • The admin reads/mutations (list/update/delete) require a real
//     `sf_admin_session` for the current tenant, exactly like actions/products.
//
// Every DB call runs through withTenant(), so tenantId is stamped on creates and
// enforced on reads/writes (Layer 1) and the RLS policy on storefront_orders is
// the backstop (Layer 2). Proof of payment is uploaded to the tenant's ImageKit
// folder — never persisted as a base64 data URL. In demo mode (no DB / no
// ImageKit) the same operations round-trip against the file-backed demo store.

import type { Prisma } from "@prisma/client";
import { getTenantIdOrNull, getTenantSlug } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { prisma } from "@/lib/db/prisma";
import { requireStaffPermission } from "@/lib/auth/staff-guard";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { generateStorefrontOrderNumber } from "@/lib/orders/order-number";
import {
  ACTIVE_ORDERS_WHERE,
  MAX_TRASH_IDS,
  TRASHED_ORDERS_WHERE,
  activeOrders,
  isTrashed,
  normalizeTrashScope,
  ordersWhere,
  trashedOrders,
  type TrashScope,
} from "@/lib/orders/trash";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { classifyProofFile } from "@/lib/upload/image-file";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  isDemoMode,
  getDemoBranding,
  saveDemoBranding,
  getDemoProducts,
  getDemoStoreProducts,
  saveDemoStoreProducts,
  getDemoStoreOrders,
  addDemoStoreOrder,
  saveDemoStoreOrders,
  nextDemoOrderNumber,
} from "@/lib/demo/fixtures";
import {
  dbProductToStorefront,
  type DbProductRow as DbProductRowMap,
} from "@/lib/storefront/product-mapping";
import { effectiveStock, applyStockMoveToProducts } from "@/lib/storefront/inventory";
import {
  activeAdminFee,
  ADMIN_FEE_LABEL_DEFAULT,
  ADMIN_FEE_LABEL_MAX,
} from "@/lib/storefront/admin-fee";
import {
  checkoutRuleViolations,
  normalizeCheckoutRules,
} from "@/lib/storefront/checkout-rules";
import { groupBuyForOrder } from "@/lib/storefront/group-buy";
import { resolveGroupBuyCaps, loadGroupBuys } from "@/lib/storefront/group-buy-server";
import { evaluateOnHandGate, type OnHandGateItem } from "@/lib/storefront/on-hand-gate";
import { stripResellerPricing } from "@/lib/storefront/reseller-gate";
import { resolveResellerCaps } from "@/lib/storefront/reseller-caps";
import { orderWholesaleScope, type WholesaleScope } from "@/lib/storefront/wholesale";
import {
  groupBuyViolations,
  normalizeGroupBuyRules,
  ratioViolation,
  type RatioLine,
} from "@/lib/storefront/group-buy-rules";
import { hasFeature } from "@/lib/features/entitlements";
import { isBusinessExclusiveLocked, getTrialState } from "@/lib/trial/trial-info";
import { isTrialPaused } from "@/lib/trial/trial-state";
import { STORE_CLOSED_BLOCK_MESSAGE, isStoreClosed } from "@/lib/storefront/store-status";
import { FEATURES } from "@/lib/features/catalog";
import {
  isOrderStatus,
  cleanIdList,
  planStatusChange,
  type InventoryMove,
} from "@/lib/storefront/order-status";
import {
  planBulkStatusChange,
  bulkStatusFailureMessage,
  isTransactionTimeout,
  type BulkStatusChanged,
} from "@/lib/storefront/bulk-status";
import {
  applyOrderStockMovesBatched,
  type StockMoveDb,
} from "@/lib/storefront/stock-move-db";
import {
  findPromoCode,
  normalizePromoCodes,
  promoCodeError,
  promoDiscountAmount,
  promoLabel,
} from "@/lib/storefront/promo";
import type { Order, OrderItem, OrderStatusEvent, Product } from "@/storefront/types";
import {
  authoritativeItemPrice,
  effectiveShippingFee,
  orderHasFreeShippingProduct,
} from "@/storefront/checkout";
import type { GroupBuyPriceScope } from "@/lib/storefront/two-ways";
import { isGroupBuyPreorder, twoWaysOrderViolation } from "@/lib/storefront/two-ways-cart";
import { after } from "next/server";
import { capturePostHogEvent } from "@/lib/analytics/capture";
import { sendAdminOrderNotification } from "@/lib/analytics/admin-notify";
import {
  buildEmailBrand,
  buildOrderPlacedPayload,
  buildStatusChangedPayload,
} from "@/lib/analytics/events";
import { storefrontOrigin } from "@/lib/tenant/resolve";

export type UploadProofResult = { url: string } | { error: string };
export type PlaceOrderResult = { ok: true; order: Order } | { error: string };
export type ListOrdersResult = { ok: true; orders: Order[] } | { error: string };
export type UpdateOrderResult = { ok: true; order: Order } | { error: string };
export type DeleteOrdersResult = { ok: true } | { error: string };
export type BulkUpdateStatusResult = { ok: true; changed: number } | { error: string };

const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Input hardening ─────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (v == null) return "";
  return String(v).slice(0, max);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Whether real ImageKit credentials are present (not blank / not placeholders). */
function imageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

/** Coerce an untrusted client object into a clean storefront Order item. */
function normalizeItems(input: unknown): OrderItem[] {
  const arr = Array.isArray(input) ? input : [];
  return arr.slice(0, 200).map((it) => {
    const x = (it ?? {}) as Record<string, unknown>;
    return {
      name: str(x.name, 300),
      qty: Math.max(1, Math.round(num(x.qty)) || 1),
      price: Math.max(0, num(x.price)),
      ...(x.productId ? { productId: str(x.productId, 64) } : {}),
      ...(x.variation ? { variation: str(x.variation, 80) } : {}),
    };
  });
}

// Inventory sync on status change (deduct on confirm / restock on cancel, never
// twice) is decided by inventoryMove/planStatusChange in lib/storefront/order-status.

/** The first line in the cart that asks for more than the product has in
 *  stock, as a customer-facing error — or null when the whole cart fits.
 *  Lines match by productId (stamped at checkout) or exact name; lines that
 *  match no product aren't stock-checked. Products inside the live round's
 *  scope (`gbScope`, from stampGroupBuy) are PRE-ORDERS — the supplier order
 *  is placed after the round closes — so they're exempt, mirroring the cart
 *  (store.tsx → isGroupBuyPreorder). */
function stockViolation(
  products: Array<{
    id: string;
    name: string;
    stock?: number | null;
    variations?: { name: string; price: number; stock?: number }[];
    productType?: "gb" | "onhand";
  }>,
  items: OrderItem[],
  gbScope: GroupBuyPriceScope | null = null,
): string | null {
  for (const it of items) {
    const prod = products.find((x) =>
      it.productId ? x.id === it.productId : x.name === it.name,
    );
    if (!prod) continue;
    if (isGroupBuyPreorder(prod, gbScope)) continue;
    // Per-variant: a tracked variation checks its OWN pool; anything else the
    // base column (effectiveStock resolves the fallback).
    const stock = effectiveStock(prod, it.variation);
    if (it.qty > stock) {
      return stock === 0
        ? `"${prod.name}" is out of stock.`
        : `Only ${stock} of "${prod.name}" left in stock — you have ${it.qty} in your cart.`;
    }
  }
  return null;
}

/**
 * Reject lines for products the owner took off sale (`purchasable: false`, set
 * in Group Buys → Pricing). The storefront disables the button
 * (product-cta.buildProductCta) and the cart refuses the add (store.tsx), but
 * both are UX: this is the boundary a stale tab, a re-add from a long-lived
 * cart, or a hand-rolled request has to clear.
 *
 * No group-buy pre-order exemption here, unlike stockViolation: "paused" is the
 * owner's explicit decision about the product itself, not a stock state a round
 * is expected to outlive. Lines matching no product are skipped — the same rule
 * stockViolation uses, so every guard judges the same set of lines.
 */
function purchasableViolation(
  products: Array<{ id: string; name: string; purchasable?: boolean }>,
  items: OrderItem[],
): string | null {
  for (const it of items) {
    const prod = products.find((x) =>
      it.productId ? x.id === it.productId : x.name === it.name,
    );
    if (prod?.purchasable === false) {
      return `"${prod.name}" isn't available right now — please remove it from your cart.`;
    }
  }
  return null;
}

/** The catalog ids the order's lines resolve to — productId first, exact-name
 *  fallback, unmatched lines skipped: the same matching rule stockViolation
 *  uses, so the two-ways mixing re-check judges exactly the lines the other
 *  guards saw. */
function matchedProductIds(
  products: Array<{ id: string; name: string }>,
  items: OrderItem[],
): string[] {
  return items.flatMap((it) => {
    const prod = products.find((x) =>
      it.productId ? x.id === it.productId : x.name === it.name,
    );
    return prod ? [prod.id] : [];
  });
}

/**
 * Re-run the tenant's Smart Checkout rules (lib/storefront/checkout-rules)
 * against the stored catalog and config, so the server enforces exactly what
 * the cart UI showed — a tampered or stale client can't skip them. Returns the
 * first blocking violation as a customer-facing error, or null when the order
 * passes. `clientFee` is the RAW adminFee the checkout echoed (the fee it
 * displayed): when admin-fee validation is on and that snapshot no longer
 * matches the configured fee, the order is rejected so the customer never pays
 * a total they didn't see. Legacy clients that send no snapshot skip the check
 * (the server-stamped fee remains authoritative either way).
 */
function checkoutRulesViolation(
  config: Record<string, unknown>,
  catalog: Product[],
  items: OrderItem[],
  clientFee: unknown,
  adminFeeEntitled: boolean,
): string | null {
  const rules = normalizeCheckoutRules(config.checkoutRules);

  if (rules.adminFeeValidation && rules.ruleBasedCheckout && clientFee && typeof clientFee === "object") {
    const shown = Math.max(0, num((clientFee as Record<string, unknown>).amount));
    // No fee is charged when the tenant isn't entitled, so it must validate to 0.
    const charged = adminFeeEntitled
      ? (activeAdminFee(config.adminFee, itemsSubtotal(items))?.amount ?? 0)
      : 0;
    if (shown !== charged) {
      return "The store's fees changed while you were checking out — please review your updated total and try again.";
    }
  }

  // Rebuild cart lines from the order's items. Lines match by productId
  // (stamped at checkout) or exact name; unmatched lines aren't rule-checked,
  // same as stockViolation.
  const lines = items.flatMap((it) => {
    const product = catalog.find((p) =>
      it.productId ? p.id === it.productId : p.name === it.name,
    );
    return product ? [{ product, qty: it.qty }] : [];
  });
  const blocked = checkoutRuleViolations(lines, catalog, config.checkoutRules).find(
    (v) => v.blocking,
  );
  return blocked?.message ?? null;
}

/** The order's items subtotal — the base a percentage admin fee is charged on
 *  (same prices the order stores and every total surface sums). */
function itemsSubtotal(items: OrderItem[]): number {
  return items.reduce((s, it) => s + it.price * it.qty, 0);
}

/**
 * Re-price every line from the live catalog so the order is STORED — and every
 * percentage fee/discount is charged — at the CURRENT price, never a stale or
 * tampered client value. Mirrors the same server-authoritative re-derive the
 * shipping fee, admin fee and discount already do. A line that matches no
 * catalog product (or whose variation was removed) keeps its sent price — the
 * same skip rule as the stock and Smart Checkout checks. Mutates in place; the
 * order object is local to this request. Must run BEFORE the fee/discount stamps
 * so they compute against the authoritative subtotal.
 */
function repriceItems(
  items: OrderItem[],
  catalog: Product[],
  groupBuyScope: GroupBuyPriceScope | null = null,
  wholesaleScope: WholesaleScope | null = null,
): void {
  for (const it of items) {
    const live = authoritativeItemPrice(it, catalog, groupBuyScope, wholesaleScope);
    if (live != null) it.price = live;
  }
}

/**
 * Re-derive the SERVER-AUTHORITATIVE shipping fee + courier from the tenant's
 * configured shipping locations, keyed by the `locationId` the checkout sent.
 * Mirrors the admin-fee stamp: the client's displayed fee is never trusted, so a
 * tampered or stale selection can't undercharge shipping. Mutates the order in
 * place. No-ops when the store has no shipping locations configured, or the
 * order carries no locationId (legacy/unconfigured checkout → keep what was
 * sent). An unknown or inactive locationId zeroes the fee and clears the courier
 * — a pick that no longer exists can't smuggle a charge through.
 */
function stampShipping(config: Record<string, unknown>, p: Order, catalog: Product[]): void {
  const freeShipping = orderHasFreeShippingProduct(p.items, catalog);
  const locationId = p.shipping.locationId;
  const couriers = Array.isArray(config.couriers)
    ? (config.couriers as Array<Record<string, unknown>>)
    : [];
  const locations = Array.isArray(config.shippingLocations)
    ? (config.shippingLocations as Array<Record<string, unknown>>)
    : [];
  // No location sent: either a legacy/unconfigured checkout (keep what the
  // client sent), or a COD/no-location courier (Lalamove, Maxim…) the customer
  // picked. Those carry no shipping fee, so when the sent courier matches an
  // active no-location courier, zero the fee and re-stamp its name — a tampered
  // client can't smuggle a shipping charge onto a COD pick.
  if (!locationId) {
    const cod = couriers.find(
      (c) =>
        (c ?? {}).active !== false &&
        (c ?? {}).noLocation === true &&
        str((c ?? {}).name, 120) === p.courier,
    );
    if (cod) {
      p.shipping.fee = 0;
      p.courier = str(cod.name, 120);
    }
    return;
  }
  if (locations.length === 0) return;
  const loc = locations.find(
    (l) => String((l ?? {}).id ?? "") === locationId && (l ?? {}).active !== false,
  );
  if (!loc) {
    p.shipping.fee = 0;
    p.courier = "";
    return;
  }
  p.shipping.fee = effectiveShippingFee(loc.price, freeShipping);
  // Re-stamp the courier NAME from config so it matches the linked courier;
  // fall back to the client-sent name only when the courier was since removed.
  const courier = couriers.find((c) => String((c ?? {}).id ?? "") === String(loc.courierId ?? ""));
  if (courier) p.courier = str(courier.name, 120);
}

/**
 * Re-run the tenant's Group Buy rules (lib/storefront/group-buy-rules) against
 * the order's items, so the server enforces exactly what the cart drawer
 * validated — a tampered or stale client can't skip them. Only fires when the
 * engine is on AND its checkout-validation toggle is on; the caller gates on
 * the FEATURES.GB_RULES entitlement. Returns the first violation as a
 * customer-facing error, or null when the order complies.
 */
function groupBuyViolation(
  config: Record<string, unknown>,
  items: OrderItem[],
  catalog: Product[],
): string | null {
  const rules = normalizeGroupBuyRules(config.groupBuyRules);
  if (!rules.enabled || !rules.validation.checkout) return null;
  const lines = items.map((it) => ({ name: it.name, qty: it.qty }));
  const legacy = groupBuyViolations(rules, lines)[0];
  if (legacy) return legacy;
  // Order Ratio Control — classify each line by the admin's per-product tag
  // (carried on the live catalog row), falling back to the name heuristic. Only
  // a BLOCKING (strict / auto_add residual) violation rejects the order; warn
  // mode never hard-blocks server-side, matching the cart.
  const ratioLines: RatioLine[] = items.map((it) => {
    const p = catalog.find((c) => (it.productId ? c.id === it.productId : c.name === it.name));
    return {
      name: it.name,
      qty: it.qty,
      category: p?.category,
      sequence: p?.sequence,
      productClass: p?.productClass,
    };
  });
  const rv = ratioViolation(rules, ratioLines);
  return rv?.blocking ? rv.message : null;
}

/** Apply an order's line items to a product list (− on deduct, + on restock),
 *  clamping at zero. Delegates to the shared per-variation engine so the demo
 *  path moves a tracked variation's own pool (and the base column otherwise)
 *  exactly like the DB path. Lines match by productId else exact name. */
function adjustProductStock(
  products: Product[],
  items: OrderItem[],
  move: Exclude<InventoryMove, null>,
): Product[] {
  return applyStockMoveToProducts(products, items, move);
}

/**
 * Adapt the tenant transaction client to the narrow surface the batched stock
 * engine needs (lib/storefront/stock-move-db). Keeping that engine free of
 * Prisma types is what lets a test substitute a round-trip-counting fake.
 *
 * updateMany rather than update: the tenant extension scopes updateMany by
 * tenantId, while a bare-id update is not tenant-scoped (see lib/db/tenant-client).
 */
function stockMoveDb(db: TenantTx): StockMoveDb {
  return {
    findProducts: ({ ids, names }) =>
      db.product.findMany({
        where: {
          OR: [
            ...(ids.length ? [{ id: { in: ids } }] : []),
            ...(names.length ? [{ name: { in: names } }] : []),
          ],
        },
        select: { id: true, name: true, stock: true, metadata: true },
      }),
    updateProduct: async (id, data) => {
      await db.product.updateMany({
        where: { id },
        data: {
          ...(data.stock !== undefined ? { stock: data.stock } : {}),
          ...(data.metadata !== undefined
            ? { metadata: data.metadata as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
    },
  };
}

/**
 * Apply an order's line items to the tenant's DB inventory (− on deduct, + on
 * restock), clamping at zero. The DB analogue of adjustProductStock: lines match
 * by productId when present, by exact name for legacy orders. Shared by the
 * single-order update and the bulk status action so both move stock identically.
 * Runs inside a withTenant() transaction (the passed `db` is already scoped).
 *
 * One order's worth of the batched engine: 1 read + at most 1 write per product,
 * never per line item. That budget is the whole point — see stock-move-db.
 */
async function applyOrderStockMove(
  db: TenantTx,
  items: OrderItem[],
  move: Exclude<InventoryMove, null>,
): Promise<void> {
  await applyOrderStockMovesBatched(stockMoveDb(db), [{ items, move }]);
}

/**
 * Stamp the order with the group buy it belongs to (or null) — SERVER-SIDE,
 * from the tenant's live group buys at the moment of placement, never from the
 * client. The name is snapshotted alongside the id so supplier reports survive
 * later renames. No-ops (stamps null) when the tenant lacks groupbuy.module.
 */
async function stampGroupBuy(
  p: Order,
  tenantId: string,
  demoSlug: string,
): Promise<GroupBuyPriceScope | null> {
  p.groupBuyId = null;
  p.groupBuyName = null;
  try {
    const caps = await resolveGroupBuyCaps(tenantId);
    if (!caps.enabled) return null;
    const groupBuys = await loadGroupBuys(tenantId, demoSlug);
    const orderedIds = p.items
      .map((it) => it.productId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const gb = groupBuyForOrder(groupBuys, caps, orderedIds);
    if (!gb) return null;
    p.groupBuyId = gb.id;
    p.groupBuyName = gb.name;
    // Pricing scope for THIS attributed round: only its assigned products (or the
    // whole catalog when assignment is off / the round covers all) get gbPrice.
    // Returned so repriceItems prices exactly the round's products — never an
    // off-round gb product that merely rode along in the same order.
    const coversAll = !caps.productAssignment || gb.productIds.length === 0;
    return { coversAll, productIds: coversAll ? [] : gb.productIds };
  } catch {
    /* attribution is best-effort — never block checkout on it */
    return null;
  }
}

/**
 * Block on-hand (non-group-buy) products at checkout when a run is live and the
 * owner has turned on-hand sales off (branding.config.groupBuyAllowOnHand ===
 * false). Mirrors the storefront cart gate (store.tsx → isOnHandBlocked) so a
 * stale or tampered client can't sneak a paused product through. Returns the
 * first offending product's message, or null when the order is allowed.
 */
async function groupBuyOnHandViolation(
  config: Record<string, unknown>,
  tenantId: string,
  demoSlug: string,
  items: OrderItem[],
  catalog: Product[],
): Promise<string | null> {
  return evaluateOnHandGate(config, tenantId, demoSlug, withProductTypes(items, catalog), {
    resolveCaps: resolveGroupBuyCaps,
    loadGroupBuys,
  });
}

/**
 * Attach each line's intrinsic order-path tag (Product.productType) from the
 * live catalog, for the per-way gate (storefront/on-hand-gate.decideWayBlock).
 *
 * An OrderItem doesn't carry the tag — the client never sends it, and it
 * wouldn't be trustworthy if it did — so it is resolved SERVER-SIDE here, by the
 * same match rule the re-price uses (checkout.authoritativeItemPrice): by
 * productId when present, else by name. A line matching no catalog product stays
 * untagged, the same skip rule the stock and re-price checks apply.
 *
 * Without this the gate saw every line as untagged, so between rounds a
 * group-buy pre-order read as ships-now stock and sailed past a closed
 * group-buy way.
 */
function withProductTypes(items: OrderItem[], catalog: Product[]): OnHandGateItem[] {
  return items.map((it) => {
    const live = catalog.find((p) => (it.productId ? p.id === it.productId : p.name === it.name));
    return { productId: it.productId, name: it.name, productType: live?.productType };
  });
}

/** Coerce a stored/untrusted fee blob into the order's fee, or undefined when
 *  none was charged. Used for DB rows and demo orders alike; checkout itself
 *  never trusts this — placeStorefrontOrderAction re-stamps it from config. */
function normalizeOrderFee(input: unknown): Order["adminFee"] {
  if (!input || typeof input !== "object") return undefined;
  const x = input as Record<string, unknown>;
  const amount = Math.max(0, num(x.amount));
  if (amount <= 0) return undefined;
  return { label: str(x.label, ADMIN_FEE_LABEL_MAX) || ADMIN_FEE_LABEL_DEFAULT, amount };
}

/** Coerce a stored/untrusted discount blob into the order's discount, or
 *  undefined when none applied. Used for DB rows and demo orders alike; checkout
 *  itself never trusts this — placeStorefrontOrderAction re-derives it from
 *  branding.config.promoCodes. */
function normalizeOrderDiscount(input: unknown): Order["discount"] {
  if (!input || typeof input !== "object") return undefined;
  const x = input as Record<string, unknown>;
  const amount = Math.max(0, num(x.amount));
  const code = str(x.code, 64).toUpperCase();
  if (amount <= 0 || !code) return undefined;
  return { code, label: str(x.label, 120) || promoLabel(code), amount };
}

/**
 * Re-derive the SERVER-AUTHORITATIVE discount from the tenant's configured promo
 * codes, keyed by the `code` the checkout applied. Mirrors stampShipping/the
 * admin-fee stamp: the client's displayed amount is never trusted, so a tampered
 * client can't inflate the discount. Mutates the order in place. No-ops (clears
 * the discount) when no code was applied. Returns a customer-facing error string
 * when a code WAS applied but is no longer valid (deactivated / expired / over
 * its usage limit / cart fell below the minimum) so the customer is never charged
 * a total that silently differs from the one they saw — null when it's fine.
 */
function stampDiscount(config: Record<string, unknown>, p: Order): string | null {
  const applied = p.discount?.code;
  if (!applied) {
    p.discount = undefined;
    return null;
  }
  const codes = normalizePromoCodes(config.promoCodes);
  const promo = findPromoCode(codes, applied);
  const subtotal = itemsSubtotal(p.items);
  const err = promoCodeError(promo, subtotal);
  if (err || !promo) {
    return "The discount code is no longer valid — please review your total and try again.";
  }
  p.discount = { code: promo.code, label: promoLabel(promo.code), amount: promoDiscountAmount(promo, subtotal) };
  return null;
}

/**
 * Best-effort: bump a promo code's `used` counter by one after an order that
 * applied it is genuinely stored (so usage limits actually tighten). Read-modify-
 * write on branding.config.promoCodes, mirroring savePromoCodesAction. NEVER
 * throws — a failed counter update must not fail an already-placed order, and the
 * worst case is a code that under-counts its uses.
 */
async function incrementPromoUsage(tenantId: string, slug: string, code: string | undefined): Promise<void> {
  if (!code) return;
  const bump = (config: Record<string, unknown>): { next: Record<string, unknown>; changed: boolean } => {
    const codes = normalizePromoCodes(config.promoCodes);
    let changed = false;
    const promoCodes = codes.map((c) => {
      if (c.code.toUpperCase() === code.toUpperCase()) {
        changed = true;
        return { ...c, used: c.used + 1 };
      }
      return c;
    });
    return { next: { ...config, promoCodes }, changed };
  };
  try {
    if (isDemoMode()) {
      const config = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
      const { next, changed } = bump(config);
      if (changed) saveDemoBranding(slug, { config: next });
      return;
    }
    const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
    const config = (branding?.config ?? {}) as Record<string, unknown>;
    const { next, changed } = bump(config);
    if (!changed) return;
    await prisma.branding.upsert({
      where: { tenantId },
      update: { config: next as Prisma.InputJsonValue },
      create: { tenantId, config: next as Prisma.InputJsonValue },
    });
    revalidateTenant(tenantId, slug);
  } catch {
    /* best-effort — never block a placed order on the usage counter */
  }
}

/** Coerce an untrusted status-history blob into clean, ordered journey events. */
function normalizeStatusHistory(input: unknown): OrderStatusEvent[] {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .slice(0, 50)
    .map((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const status = isOrderStatus(x.status) ? x.status : null;
      const at = str(x.at, 40);
      return status && at ? { status, at } : null;
    })
    .filter((e): e is OrderStatusEvent => e !== null);
}

/** Coerce an untrusted checkout payload into a clean storefront Order. */
function normalizeOrderInput(input: unknown): Order {
  const o = (input ?? {}) as Record<string, unknown>;
  const c = (o.customer ?? {}) as Record<string, unknown>;
  const s = (o.shipping ?? {}) as Record<string, unknown>;
  const status = isOrderStatus(o.status) ? o.status : "new";
  return {
    id: str(o.id, 64),
    orderNumber: str(o.orderNumber, 64) || undefined,
    status,
    paymentStatus: o.paymentStatus === "paid" ? "paid" : "pending",
    paymentMethod: str(o.paymentMethod, 120),
    date: str(o.date, 40) || new Date().toISOString(),
    customer: {
      name: str(c.name, 200),
      email: str(c.email, 200),
      phone: str(c.phone, 60),
      contactMethod: str(c.contactMethod, 60),
    },
    shipping: {
      address: str(s.address, 400),
      barangay: str(s.barangay, 120),
      city: str(s.city, 120),
      province: str(s.province, 120),
      postal: str(s.postal, 40),
      country: str(s.country, 120),
      region: str(s.region, 120),
      fee: Math.max(0, num(s.fee)),
      // The location the customer picked — carried so the server can re-derive
      // the authoritative fee (see stampShipping). The client `fee` above is
      // only what was displayed.
      ...(typeof s.locationId === "string" && s.locationId
        ? { locationId: str(s.locationId, 64) }
        : {}),
    },
    courier: str(o.courier, 120),
    trackingNumber: str(o.trackingNumber, 120),
    shippingNote: str(o.shippingNote, 500),
    items: normalizeItems(o.items),
    statusHistory: normalizeStatusHistory(o.statusHistory),
    adminFee: normalizeOrderFee(o.adminFee),
    discount: normalizeOrderDiscount(o.discount),
    // Carried for stored orders (admin list, demo file). Checkout never trusts
    // these — placeStorefrontOrderAction re-stamps them server-side.
    groupBuyId: typeof o.groupBuyId === "string" && o.groupBuyId ? str(o.groupBuyId, 64) : null,
    groupBuyName:
      typeof o.groupBuyName === "string" && o.groupBuyName ? str(o.groupBuyName, 200) : null,
    // Only accept a hosted URL here — the proof is uploaded separately via
    // uploadPaymentProofAction, which returns the ImageKit URL (or, when
    // ImageKit isn't configured, a data URL fallback). Cap generously so a
    // fallback data URL still survives.
    paymentProof:
      typeof o.paymentProof === "string" && o.paymentProof
        ? o.paymentProof.slice(0, 12_000_000)
        : null,
  };
}

/** Map a storefront_orders DB row to the storefront Order type the UI renders. */
type DbOrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentProofUrl: string | null;
  customer: unknown;
  shipping: unknown;
  items: unknown;
  statusHistory: unknown;
  adminFee: unknown;
  discount: unknown;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  placedAt: Date;
  groupBuyId?: string | null;
  groupBuyName?: string | null;
  imported?: boolean;
  deletedAt?: Date | string | null;
};

function dbOrderToStorefront(row: DbOrderRow): Order {
  const base = normalizeOrderInput({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    date: row.placedAt instanceof Date ? row.placedAt.toISOString() : String(row.placedAt),
    customer: row.customer,
    shipping: row.shipping,
    items: row.items,
    statusHistory: row.statusHistory,
    adminFee: row.adminFee,
    discount: row.discount,
    courier: row.courier,
    trackingNumber: row.trackingNumber,
    shippingNote: row.shippingNote,
    groupBuyId: row.groupBuyId,
    groupBuyName: row.groupBuyName,
    paymentProof: row.paymentProofUrl,
  });
  // Set from the ROW, never through normalizeOrderInput — that function also
  // parses untrusted checkout payloads, and a buyer who could declare their own
  // order "imported" would place orders that never deduct stock. `deletedAt`
  // rides the same rule for the same reason: a buyer able to set it would place
  // orders that land straight in the trash, invisible to the owner.
  const withImported = row.imported ? { ...base, imported: true } : base;
  const deletedAt =
    row.deletedAt instanceof Date ? row.deletedAt.toISOString() : row.deletedAt || null;
  return deletedAt ? { ...withImported, deletedAt } : withImported;
}

/** Shape the normalized Order into the columns/JSON the DB row expects.
 *  Note: `orderNumber` is intentionally NOT set here — it is generated
 *  server-side per tenant in createStorefrontOrder() and never trusted from the
 *  client. */
function orderToDbCreate(tenantId: string, p: Order) {
  return {
    tenantId,
    status: p.status,
    paymentStatus: p.paymentStatus,
    paymentMethod: p.paymentMethod,
    paymentProofUrl: p.paymentProof,
    customer: p.customer as unknown as Prisma.InputJsonValue,
    shipping: p.shipping as unknown as Prisma.InputJsonValue,
    items: p.items as unknown as Prisma.InputJsonValue,
    statusHistory: (p.statusHistory ?? []) as unknown as Prisma.InputJsonValue,
    // NULL (column default) when no fee was charged — omit rather than store {}.
    ...(p.adminFee ? { adminFee: p.adminFee as unknown as Prisma.InputJsonValue } : {}),
    // NULL when no code was applied — omit rather than store {}.
    ...(p.discount ? { discount: p.discount as unknown as Prisma.InputJsonValue } : {}),
    groupBuyId: p.groupBuyId ?? null,
    groupBuyName: p.groupBuyName ?? null,
    courier: p.courier,
    trackingNumber: p.trackingNumber,
    shippingNote: p.shippingNote,
    placedAt: new Date(p.date),
  };
}

// ── Proof of payment upload (ImageKit) — PUBLIC (anonymous checkout) ──────────

/**
 * Upload a customer's proof-of-payment screenshot to the tenant's own ImageKit
 * folder and return its hosted URL. The folder is forced from the server-derived
 * tenantId, so a buyer on store A can't write into store B's namespace. In demo
 * mode (and as a graceful fallback when ImageKit isn't configured) the bytes
 * round-trip as a data URL so checkout never hard-fails on a missing key.
 */
export async function uploadPaymentProofAction(formData: FormData): Promise<UploadProofResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Store not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file provided." };
  if (file.size > MAX_PROOF_BYTES) return { error: "Image too large (max 10 MB)." };

  // `file.type` is a browser hint, not a fact — several Android pickers and
  // in-app webviews report "" or application/octet-stream for a real JPEG.
  // classifyProofFile falls back to the extension so those receipts get
  // through, and refuses the rest with copy the customer can act on.
  const verdict = classifyProofFile(file.name || "", file.type || "");
  if (!verdict.ok) {
    // A refusal here is invisible to the operator otherwise: the bytes never
    // reach ImageKit, so nothing shows up in the media library or the logs and
    // "the store won't let me upload" arrives with no way to diagnose it.
    console.warn(
      `[payment-proof] refused for tenant ${tenantId}: ` +
        `name=${file.name || "(none)"} type=${file.type || "(none)"} size=${file.size}`,
    );
    return { error: verdict.reason };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Demo, or ImageKit not configured → inline the image so checkout still works.
  if (isDemoMode() || !imageKitConfigured()) {
    return { url: `data:${file.type};base64,${bytes.toString("base64")}` };
  }

  let uploaded;
  try {
    uploaded = await uploadTenantMedia({
      tenantId,
      file: bytes,
      fileName: `payment-proof-${file.name || "image"}`,
      tags: ["payment-proof"],
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }

  // Record the asset for the tenant's media library (best-effort — the image is
  // already hosted, so a failed audit row must not throw away the upload).
  try {
    await withTenant(tenantId, (db) =>
      db.mediaAsset.create({
        data: { tenantId, imagekitId: uploaded.fileId, url: uploaded.url, type: "payment-proof" },
      }),
    );
  } catch {
    /* non-fatal — media-library audit row only */
  }

  return { url: uploaded.url };
}

// ── Place order — PUBLIC (anonymous checkout) ─────────────────────────────────

/**
 * Persist an order placed at checkout. PUBLIC: the tenant is resolved from the
 * request host (never the client). The order number is generated SERVER-SIDE,
 * per tenant, and returned so the UI/chat/tracking all reference the exact value
 * that was stored. Any client-supplied orderNumber is ignored.
 */
/**
 * The display symbol the demo fixture rows should carry.
 *
 * The demo paths used to hand `dbProductToStorefront` a literal "₱", which
 * pinned a demo tenant to pesos however its branding was configured — the live
 * path beside them already reads the setting. Empty string is a valid answer:
 * dbProductToStorefront falls back on its own when the store has set nothing.
 */
function demoDisplaySymbol(slug: string): string {
  const config = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
  return String(config.currency ?? "");
}

export async function placeStorefrontOrderAction(input: unknown): Promise<PlaceOrderResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Store not found." };

  const p = normalizeOrderInput(input);
  if (!p.items.length) return { error: "Your cart is empty." };

  // The fee the checkout DISPLAYED, exactly as sent — kept raw (not the
  // normalized p.adminFee, which collapses an explicit zero to undefined) so
  // the admin-fee validation rule can tell "showed no fee" from "legacy client
  // that sent nothing".
  const clientFee = ((input ?? {}) as Record<string, unknown>).adminFee;

  // Seed the fulfillment journey with the opening event so the Track page can
  // show "Order received" with a real timestamp from the moment of checkout.
  if (!p.statusHistory || p.statusHistory.length === 0) {
    p.statusHistory = [{ status: p.status, at: p.date }];
  }

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const id = p.id || `o-${Date.now()}`;
    // Idempotent retry: the same draft id was already stored → return it, don't
    // mint a second number / duplicate the order.
    const existing = getDemoStoreOrders(slug).find((o) => o.id === id);
    if (existing) return { ok: true, order: existing };
    // Inventory guard: never store an order the stock can't cover. (After the
    // idempotent-retry check, so a committed order is still acknowledged.)
    const demoProductsRaw =
      getDemoStoreProducts(slug) ??
      getDemoProducts(slug).map((dp) =>
        dbProductToStorefront(dp as unknown as DbProductRowMap, demoDisplaySymbol(slug)),
      );
    // Reseller wholesale pricing is entitlement-gated: strip the legs before
    // ANY pricing/rules surface reads the catalog, so an unentitled tenant's
    // re-price can never charge a wholesale tier a tampered client kept
    // (test:reseller-gate) — the same strip page.tsx applies at render.
    const demoResellerCaps = await resolveResellerCaps(tenantId);
    const demoProducts = stripResellerPricing(
      demoProductsRaw,
      demoResellerCaps.enabled,
      demoResellerCaps.wholesalePricing,
    );
    // Group-buy attribution FIRST — it decides whether this order is in a live
    // round AND returns that round's pricing scope, which drives whether GB
    // products re-price at their gbPrice below.
    const demoGbScope = await stampGroupBuy(p, tenantId, slug);
    // Server-authoritative item prices: re-read each line from the live catalog
    // so a price the owner changed (or a tampered client) can't be stored. When
    // the order belongs to a live round, that round's group-buy products charge
    // their gbPrice (the single price the group-buy page advertised). Runs before
    // the fee/discount stamps below so they charge the current subtotal.
    // Wholesale MOQ is measured across the WHOLE order, per parent product —
    // four colours of 250 Vial Caps are 1,000 units of one product. Built here,
    // before the loop, because a per-line view can never see the combined
    // quantity; built the same way the cart built it, so the two agree.
    const demoWholesaleScope = orderWholesaleScope(
      p.items,
      demoProducts,
      demoResellerCaps.wholesalePricing,
    );
    repriceItems(p.items, demoProducts, demoGbScope, demoWholesaleScope);
    const demoPaused = purchasableViolation(demoProducts, p.items);
    if (demoPaused) return { error: demoPaused };
    const demoViolation = stockViolation(demoProducts, p.items, demoGbScope);
    if (demoViolation) return { error: demoViolation };
    // Two-ways split: one order never mixes group-buy (pre-order) and on-hand
    // lines — the cart blocks it, and this re-check (against the SAME scope the
    // re-price used) stops a stale/tampered client from sneaking a mix through.
    const demoMix = twoWaysOrderViolation(
      matchedProductIds(demoProducts, p.items),
      demoGbScope,
    );
    if (demoMix) return { error: demoMix };
    // The admin fee is SERVER-AUTHORITATIVE: re-derived from the tenant's
    // branding config at placement (any client-supplied value is discarded) and
    // snapshotted on the order so a later config change never rewrites it.
    const config = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    // The owner closed the shop (store admin → Store Status). Same rule the
    // storefront renders and the cart enforces, re-checked here because this is
    // the boundary: a stale tab, a replayed request or a hand-rolled POST must
    // not be able to order into a closed store. Demo and DB paths BOTH guard —
    // this branch returns before the DB one is ever reached.
    if (isStoreClosed(config.storeStatus)) {
      return { error: STORE_CLOSED_BLOCK_MESSAGE };
    }
    // Smart Checkout rules — reject the order when it violates a blocking rule.
    // Entitlement-gated: a tenant without the feature keeps any saved rules
    // dormant, matching the storefront (which strips brand.checkoutRules).
    // Admin fee is operator-revocable per tenant (admin → Features). When the
    // tenant isn't entitled the fee is neither stamped nor validated — same gate
    // the storefront uses to drop the line.
    const demoAdminFeeEntitled = await hasFeature(tenantId, FEATURES.STORE_ADMIN_FEE);
    const demoRuleError = (await hasFeature(tenantId, FEATURES.STORE_SMART_CHECKOUT))
      ? checkoutRulesViolation(config, demoProducts, p.items, clientFee, demoAdminFeeEntitled)
      : null;
    if (demoRuleError) return { error: demoRuleError };
    // Group Buy Rules (incl. Order Ratio Control) — entitlement-gated on
    // GB_RULES, re-applied server-side so a stale/tampered client can't bypass a
    // blocking (strict / auto_add) ratio floor. Warn mode never rejects here.
    const demoGbRuleError = (await hasFeature(tenantId, FEATURES.GB_RULES))
      ? groupBuyViolation(config, p.items, demoProducts)
      : null;
    if (demoGbRuleError) return { error: demoGbRuleError };
    p.adminFee = demoAdminFeeEntitled
      ? (activeAdminFee(config.adminFee, itemsSubtotal(p.items)) ?? undefined)
      : undefined;
    // Shipping fee + courier — re-derived from the tenant's shipping locations,
    // never trusted from the client (same authority as the admin fee).
    stampShipping(config, p, demoProducts);
    // Discount — re-derived from the tenant's promo codes by the applied code,
    // never trusted from the client. Rejected (not silently dropped) when the
    // code is no longer valid, so the customer never pays a higher total than
    // the one they saw.
    const demoDiscountError = stampDiscount(config, p);
    if (demoDiscountError) return { error: demoDiscountError };
    // Group-buy on-hand gate — reject paused on-hand products, matching the cart.
    const demoGbOnHand = await groupBuyOnHandViolation(config, tenantId, slug, p.items, demoProducts);
    if (demoGbOnHand) return { error: demoGbOnHand };
    // (Group-buy attribution already ran above, before re-pricing.)
    // Server-authoritative, per-tenant number (file-backed analogue of orderSeq).
    const orderNumber = nextDemoOrderNumber(slug);
    const saved: Order = { ...p, id, orderNumber };
    addDemoStoreOrder(slug, saved);
    // Genuinely-new order (the idempotent retry returned above) → count the code.
    await incrementPromoUsage(tenantId, slug, saved.discount?.code);
    return { ok: true, order: saved };
  }

  try {
    // Trial expiry (trial system): a paused store takes no orders — the same
    // server-side rule that swaps the public storefront for the pause card, so
    // a stale/forged client can't check out around it.
    if (isTrialPaused(await getTrialState(tenantId))) {
      return { error: "This store is currently on pause and isn't accepting orders right now." };
    }

    // Same server-authoritative fee stamp as the demo path — read through the
    // tag-invalidated tenant cache, so checkout charges exactly what the
    // storefront (which renders from the same cache) displayed.
    const { branding } = await getTenantContext(tenantId);
    const config = (branding?.config ?? {}) as Record<string, unknown>;

    // The owner closed the shop (store admin → Store Status). Checked here,
    // before the catalog load and any write, for the same reason the trial-pause
    // guard above it is: the client's refusal is UX, this is the rule. Read from
    // the same tag-invalidated cache the storefront rendered from, so the two
    // cannot disagree about whether the shop was open.
    if (isStoreClosed(config.storeStatus)) {
      return { error: STORE_CLOSED_BLOCK_MESSAGE };
    }

    // Load the live catalog FIRST (full rows — the stock guard, Smart Checkout
    // rules and re-pricing below all key off it). Reading through the same
    // tag-invalidated tenant cache the storefront renders from.
    const rows = await withTenant(tenantId, (db) =>
      db.product.findMany({ where: { status: { not: "archived" } } }),
    );
    const catalogRaw = rows.map((r) =>
      dbProductToStorefront(r as unknown as DbProductRowMap, String(config.currency ?? "")),
    );
    // Same reseller entitlement gate as the demo path / storefront render —
    // an unentitled tenant's placement catalog carries no wholesale legs.
    const resellerCaps = await resolveResellerCaps(tenantId);
    const catalog = stripResellerPricing(
      catalogRaw,
      resellerCaps.enabled,
      resellerCaps.wholesalePricing,
    );
    // Tenant slug (used for group-buy attribution + the on-hand gate below).
    const slug = (await getTenantSlug()) ?? tenantId;
    // Group-buy attribution FIRST — it decides whether this order is in a live
    // round AND returns that round's pricing scope, which drives whether GB
    // products re-price at their gbPrice below.
    const gbScope = await stampGroupBuy(p, tenantId, slug);
    // Server-authoritative item prices: re-read each line from the live catalog
    // so a price the owner changed (or a tampered client) can't be stored. When
    // the order belongs to a live round, that round's group-buy products charge
    // their gbPrice (the single price the group-buy page advertised). Runs before
    // the fee/discount stamps below so they charge the current subtotal.
    // Same combined-quantity scope as the demo path above (and as the cart).
    const wholesaleScope = orderWholesaleScope(p.items, catalog, resellerCaps.wholesalePricing);
    repriceItems(p.items, catalog, gbScope, wholesaleScope);

    // Admin fee is operator-revocable per tenant (admin → Features) AND
    // Business-exclusive under the trial system: when the tenant isn't entitled
    // or the trial lock is engaged it's neither stamped nor validated, matching
    // the storefront which drops the line. (For non-trial tenants the lock is
    // exactly !hasFeature, so this preserves the old behavior.)
    const adminFeeEntitled = !(await isBusinessExclusiveLocked(
      tenantId,
      FEATURES.STORE_ADMIN_FEE,
    ));
    p.adminFee = adminFeeEntitled
      ? (activeAdminFee(config.adminFee, itemsSubtotal(p.items)) ?? undefined)
      : undefined;
    // Shipping fee + courier — re-derived from the tenant's shipping locations,
    // never trusted from the client (same authority as the admin fee).
    stampShipping(config, p, catalog);
    // Discount — re-derived from the tenant's promo codes by the applied code,
    // never trusted from the client. Rejected (not silently dropped) when the
    // code is no longer valid, so the customer never pays a higher total than
    // the one they saw.
    const discountError = stampDiscount(config, p);
    if (discountError) return { error: discountError };

    // Inventory guard: reject the order outright when any line asks for more
    // than the product has in stock, so the admin never has to confirm an
    // order the inventory can't cover. Live-round group-buy lines are
    // pre-orders and exempt (gbScope).
    const paused = purchasableViolation(catalog, p.items);
    if (paused) return { error: paused };
    const violation = stockViolation(catalog, p.items, gbScope);
    if (violation) return { error: violation };

    // Two-ways split: one order never mixes group-buy (pre-order) and on-hand
    // lines — the cart blocks it, and this re-check (against the SAME scope the
    // re-price used) stops a stale/tampered client from sneaking a mix through.
    const mixViolation = twoWaysOrderViolation(matchedProductIds(catalog, p.items), gbScope);
    if (mixViolation) return { error: mixViolation };

    // Smart Checkout rules — reject the order when it violates a blocking rule.
    // Entitlement-gated, same as the demo path above.
    const ruleError = (await hasFeature(tenantId, FEATURES.STORE_SMART_CHECKOUT))
      ? checkoutRulesViolation(config, catalog, p.items, clientFee, adminFeeEntitled)
      : null;
    if (ruleError) return { error: ruleError };

    // Group Buy Rules (incl. Order Ratio Control) — entitlement-gated on
    // GB_RULES, re-applied server-side so a stale/tampered client can't bypass a
    // blocking (strict / auto_add) ratio floor. Warn mode never rejects here.
    const gbRuleError = (await hasFeature(tenantId, FEATURES.GB_RULES))
      ? groupBuyViolation(config, p.items, catalog)
      : null;
    if (gbRuleError) return { error: gbRuleError };

    // Group-buy on-hand gate — reject paused on-hand products, matching the cart.
    // (`slug` + group-buy attribution already ran above, before re-pricing.)
    const gbOnHand = await groupBuyOnHandViolation(config, tenantId, slug, p.items, catalog);
    if (gbOnHand) return { error: gbOnHand };

    const { row, created } = await createStorefrontOrder(tenantId, p);
    const placed = dbOrderToStorefront(row as DbOrderRow);
    // Only count the code on a genuinely-new row — an idempotent retry that
    // returned the already-stored order must not double-count.
    if (created) {
      await incrementPromoUsage(tenantId, slug, p.discount?.code);
      // Emit order_placed to the tenant's PostHog (entitled + connected only) so
      // their checkout workflow can email the customer. Fire-and-forget after the
      // response — never blocks or breaks checkout. Stamped with the tenant's
      // branding so one PostHog email template renders every store's identity.
      const emailBrand = buildEmailBrand(config, storefrontOrigin(slug));
      after(() =>
        capturePostHogEvent(tenantId, buildOrderPlacedPayload(placed, emailBrand), placed.date),
      );
      // Same fire-and-forget hand-off, but the store OWNER's "you received an
      // order" alert: entitlement + owner-toggle gated inside, delivered via the
      // same PostHog Messaging so the admin's email carries the store's branding.
      after(() => sendAdminOrderNotification(tenantId, placed, emailBrand, config));
    }
    return { ok: true, order: placed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't place the order." };
  }
}

/**
 * Create the order with a SERVER-generated, per-tenant order number. The number
 * is RESERVED in its own committed transaction (the atomic Tenant.orderSeq
 * increment, or a random-code probe), then the row is created in a second
 * transaction. Keeping the reservation separate is deliberate: it means a
 * committed orderSeq advance SURVIVES a failed create, so a retry always gets a
 * strictly HIGHER number and can never re-collide — whereas folding both into
 * one transaction would roll the increment back on a unique-collision and retry
 * the very same number forever (e.g. against a legacy client-minted code that
 * still occupies that slot). Like a database sequence, this can leave gaps when
 * a create fails, which is harmless; what matters is that two orders never share
 * a number and every stored row carries a consumed number. Any client-supplied
 * orderNumber is ignored — the server is the sole authority.
 *
 * Idempotency: the checkout draft id is stored as `clientId` under
 * @@unique([tenantId, clientId]). If a write COMMITTED but the response was lost
 * and the buyer retried, the same clientId returns the already-stored order
 * instead of creating a duplicate (the "await + keep cart on failure" flow would
 * otherwise turn an ambiguous timeout into a second order).
 */
async function createStorefrontOrder(tenantId: string, p: Order, attempts = 8) {
  const clientId = p.id || undefined;

  // Fast path: this exact submission is already stored (a retry) → return it.
  // @@unique([tenantId, clientId]) still counts a trashed row, so filtering one
  // out here would turn a retry into a unique-constraint error on a draft the
  // buyer already paid for. Returning the trashed row is right: the order
  // exists, and whether the owner has since binned it is not the buyer's
  // problem.
  if (clientId) {
    const existing = await withTenant(tenantId, (db) =>
      // trash-exempt: sees trashed rows on purpose — see above.
      db.storefrontOrder.findFirst({ where: { clientId } }),
    );
    if (existing) return { row: existing, created: false };
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const orderNumber = await withTenant(tenantId, (db) =>
      generateStorefrontOrderNumber(db, tenantId),
    );
    try {
      const row = await withTenant(tenantId, (db) =>
        db.storefrontOrder.create({ data: { ...orderToDbCreate(tenantId, p), orderNumber, clientId } }),
      );
      return { row, created: true };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        // The collision is on one of two unique keys:
        //  • (tenantId, clientId) — a concurrent/earlier attempt for this same
        //    draft already won the race → that row IS this order (idempotent).
        if (clientId) {
          const existing = await withTenant(tenantId, (db) =>
            // trash-exempt: the unique key counts trashed rows, so this probe
            // has to see them too — same reason as the fast path above.
            db.storefrontOrder.findFirst({ where: { clientId } }),
          );
          if (existing) return { row: existing, created: false };
        }
        //  • (tenantId, orderNumber) — a legacy code occupies this slot or a
        //    random code hit; reserve a fresh, higher number next iteration.
        if (attempt < attempts - 1) continue;
      }
      throw e;
    }
  }
  throw new Error("Couldn't allocate a unique order number — please try again.");
}

// ── Track order — PUBLIC (lookup by order number) ────────────────────────────

export type TrackedOrder = {
  orderNumber: string;
  status: Order["status"];
  date: string;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  // Order summary (no customer PII) + the fulfillment journey, so the Track page
  // can show what was ordered, the total, and the timestamped status timeline.
  items: OrderItem[];
  shippingFee: number;
  adminFee: { label: string; amount: number } | null;
  discount: { code: string; label: string; amount: number } | null;
  statusHistory: OrderStatusEvent[];
};
export type TrackOrderResult =
  | { ok: true; order: TrackedOrder }
  | { ok: true; order: null }
  | { error: string };

/**
 * Look up an order's fulfillment status by its order number (the code the buyer
 * was given at checkout). PUBLIC, tenant-scoped to the request host, and
 * deliberately returns only non-sensitive status/tracking fields — never the
 * customer PII or proof — since the order number is the only "key".
 */
export async function trackStorefrontOrderAction(orderNumber: unknown): Promise<TrackOrderResult> {
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { error: "Store not found." };
  const code = str(orderNumber, 64).trim();
  if (!code) return { ok: true, order: null };

  const pick = (o: Order): TrackedOrder => ({
    orderNumber: o.orderNumber || o.id,
    status: o.status,
    date: o.date,
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    shippingNote: o.shippingNote,
    items: o.items,
    shippingFee: o.shipping?.fee ?? 0,
    adminFee: o.adminFee ?? null,
    discount: o.discount ?? null,
    statusHistory: o.statusHistory ?? [],
  });
  const matches = (o: Order) =>
    (o.orderNumber || "").toUpperCase() === code.toUpperCase() ||
    o.id.toUpperCase() === code.toUpperCase();

  // A trashed order reads as "not found" — the same answer the buyer got when
  // deleting was a hard DELETE. Restoring it makes the code work again.
  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const found = activeOrders(getDemoStoreOrders(slug)).find(matches);
    return { ok: true, order: found ? pick(found) : null };
  }

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findFirst({ where: { ...ACTIVE_ORDERS_WHERE, orderNumber: code } }),
    );
    return { ok: true, order: row ? pick(dbOrderToStorefront(row as DbOrderRow)) : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't look up the order." };
  }
}

// ── Admin: list ───────────────────────────────────────────────────────────────

/**
 * The tenant's storefront orders, newest first, for the admin Orders screen.
 *
 * `scope` picks which half: the working list ("active", the default and what
 * every existing caller gets) or the trash. Defaulting to active is what keeps
 * the Analytics and Dashboard screens correct without touching them — a trashed
 * order must not reach a revenue figure.
 */
export async function listStorefrontOrdersAction(scope?: unknown): Promise<ListOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;
  const view: TrashScope = normalizeTrashScope(scope);

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const all = getDemoStoreOrders(slug);
    return { ok: true, orders: view === "trash" ? trashedOrders(all) : activeOrders(all) };
  }

  try {
    const rows = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findMany({
        where: ordersWhere(view),
        // The trash reads newest-DELETED first, which is the order the owner
        // undoing a mis-click is looking for.
        orderBy: view === "trash" ? { deletedAt: "desc" } : { createdAt: "desc" },
      }),
    );
    return { ok: true, orders: rows.map((r) => dbOrderToStorefront(r as DbOrderRow)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load orders." };
  }
}

// ── Admin: update (status / payment / tracking) ───────────────────────────────

type OrderPatch = {
  status?: Order["status"];
  paymentStatus?: Order["paymentStatus"];
  courier?: string;
  trackingNumber?: string;
  shippingNote?: string;
};

function cleanPatch(input: unknown): Prisma.StorefrontOrderUpdateInput {
  const o = (input ?? {}) as OrderPatch;
  const data: Prisma.StorefrontOrderUpdateInput = {};
  if (isOrderStatus(o.status)) data.status = o.status;
  if (o.paymentStatus === "paid" || o.paymentStatus === "pending") data.paymentStatus = o.paymentStatus;
  if (typeof o.courier === "string") data.courier = o.courier.slice(0, 120);
  if (typeof o.trackingNumber === "string") data.trackingNumber = o.trackingNumber.slice(0, 120);
  if (typeof o.shippingNote === "string") data.shippingNote = o.shippingNote.slice(0, 500);
  return data;
}

/** Patch one order's status/payment/tracking fields (store admin only). */
export async function updateStorefrontOrderAction(
  id: unknown,
  patch: unknown,
): Promise<UpdateOrderResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  const orderId = str(id, 64);
  if (!orderId) return { error: "Missing order id." };
  const data = cleanPatch(patch);

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const list = getDemoStoreOrders(slug);
    const i = list.findIndex((x) => x.id === orderId);
    // A trashed order is out of the fulfilment flow entirely — editing one
    // would let a deleted order be confirmed and quietly deduct stock.
    if (i < 0 || isTrashed(list[i])) return { error: "Order not found." };
    const newStatus = data.status as Order["status"] | undefined;
    // Same per-order decision the DB path and the bulk action use: append a
    // journey event only on a real change, and learn the inventory move.
    const plan = newStatus
      ? planStatusChange(
          {
            status: list[i].status,
            statusHistory: normalizeStatusHistory(list[i].statusHistory),
            imported: list[i].imported,
          },
          newStatus,
          new Date().toISOString(),
        )
      : null;
    const next: Order = {
      ...list[i],
      ...(data.status ? { status: data.status as Order["status"] } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus as Order["paymentStatus"] } : {}),
      ...(data.courier !== undefined ? { courier: data.courier as string } : {}),
      ...(data.trackingNumber !== undefined ? { trackingNumber: data.trackingNumber as string } : {}),
      ...(data.shippingNote !== undefined ? { shippingNote: data.shippingNote as string } : {}),
      statusHistory: plan ? plan.statusHistory : normalizeStatusHistory(list[i].statusHistory),
    };
    const updated = list.map((x, j) => (j === i ? next : x));
    saveDemoStoreOrders(slug, updated);
    // Confirmed → deduct the line items from the demo product set;
    // cancelled after a deduction → put them back.
    const move = plan?.move ?? null;
    if (move) {
      const products =
        getDemoStoreProducts(slug) ??
        getDemoProducts(slug).map((dp) =>
          dbProductToStorefront(dp as unknown as DbProductRowMap, demoDisplaySymbol(slug)),
        );
      saveDemoStoreProducts(slug, adjustProductStock(products, next.items, move));
      revalidateTenant(slug, slug);
    }
    return { ok: true, order: next };
  }

  try {
    const result = await withTenant(tenantId, async (db) => {
      // Read the current row first so we can append to the journey only when the
      // status actually changes (and never lose earlier events).
      // Scoped to live orders: a trashed one is out of the fulfilment flow, so
      // it must not be confirmable (which would deduct stock for a deletion the
      // owner believes they undid nothing of).
      const current = await db.storefrontOrder.findFirst({
        where: { ...ACTIVE_ORDERS_WHERE, id: orderId },
      });
      if (!current) return null;
      const next: Prisma.StorefrontOrderUpdateInput = { ...data };
      const newStatus = data.status as Order["status"] | undefined;
      // Same per-order decision the demo path and the bulk action use.
      const plan = newStatus
        ? planStatusChange(
            {
              status: current.status as Order["status"],
              statusHistory: normalizeStatusHistory(current.statusHistory),
              imported: current.imported,
            },
            newStatus,
            new Date().toISOString(),
          )
        : null;
      if (plan?.changed) {
        next.statusHistory = plan.statusHistory as unknown as Prisma.InputJsonValue;
      }
      // updateMany is tenant-scoped by the extension; the bare-id update isn't.
      await db.storefrontOrder.updateMany({
        where: { ...ACTIVE_ORDERS_WHERE, id: orderId },
        data: next,
      });

      // Confirmed → deduct each line item from the tenant's inventory;
      // cancelled after a deduction → put it back. Lines match by productId
      // (stamped at checkout) or by exact name for legacy orders; quantities
      // clamp at zero so stock never goes negative.
      const move = plan?.move ?? null;
      if (move) {
        await applyOrderStockMove(db, normalizeItems(current.items), move);
      }
      return {
        row: await db.storefrontOrder.findFirst({
          where: { ...ACTIVE_ORDERS_WHERE, id: orderId },
        }),
        moved: !!move,
        prevStatus: current.status,
        statusChanged: !!plan?.changed,
      };
    });
    if (!result?.row) return { error: "Order not found." };
    const updatedOrder = dbOrderToStorefront(result.row as DbOrderRow);
    // Fulfillment moved (e.g. shipped/delivered) → emit order_status_changed so the
    // tenant's PostHog workflow can email the customer. Fire-and-forget after the
    // response; capture no-ops unless the tenant is entitled and connected.
    // Branding is resolved BEFORE after() (getTenantContext is request-scoped)
    // and stamped onto the event so the email renders this store's identity.
    const slug = await getTenantSlug();
    if (result.statusChanged) {
      const { branding } = await getTenantContext(tenantId);
      const emailBrand = buildEmailBrand(
        (branding?.config ?? {}) as Record<string, unknown>,
        storefrontOrigin(slug),
      );
      after(() =>
        capturePostHogEvent(
          tenantId,
          buildStatusChangedPayload(updatedOrder, result.prevStatus, updatedOrder.status, emailBrand),
        ),
      );
    }
    // Stock changed → refresh the cached storefront so the catalog shows it.
    if (result.moved) revalidateTenant(tenantId, slug);
    return { ok: true, order: updatedOrder };
  } catch (e) {
    return { error: orderActionError(e, "Couldn't update the order.") };
  }
}

// ── Admin: trash / restore / purge ──────────────────────────────────────────
//
// Deleting an order is reversible. The admin's delete SOFT-deletes (stamps
// deletedAt); the Trash view lists what was removed; Restore puts it back; and
// only the owner can destroy a row for good — and only one already in the
// trash. See lib/orders/trash for the shared rules, and note what NONE of these
// three do: move stock. A hard delete never restocked either, because the goods
// left the shelf when the order was confirmed; the trip through the trash is
// bookkeeping, not fulfilment.

/** Sanitize an untrusted id list from the admin client. */
function cleanTrashIds(ids: unknown): string[] {
  return Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_TRASH_IDS)
    : [];
}

/**
 * Move one or more of the tenant's orders to the trash (store admin only).
 * They leave every list, count and report immediately — the same disappearance
 * the old hard delete produced — but the rows survive for Restore.
 */
export async function trashStorefrontOrdersAction(ids: unknown): Promise<DeleteOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  const list = cleanTrashIds(ids);
  if (!list.length) return { ok: true };
  const now = new Date();

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const target = new Set(list);
    saveDemoStoreOrders(
      slug,
      getDemoStoreOrders(slug).map((o) =>
        target.has(o.id) && !isTrashed(o) ? { ...o, deletedAt: now.toISOString() } : o,
      ),
    );
    return { ok: true };
  }

  try {
    await withTenant(tenantId, (db) =>
      db.storefrontOrder.updateMany({
        // Scoped to live orders so re-trashing an already-trashed one can't
        // reset its timestamp and push it back up the Trash list.
        where: { ...ACTIVE_ORDERS_WHERE, id: { in: list } },
        data: { deletedAt: now },
      }),
    );
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't move the orders to the trash." };
  }
}

/**
 * Put trashed orders back (store admin only). The order returns exactly as it
 * was — same status, same journey, same totals — because nothing about it was
 * ever changed except the deletedAt stamp.
 */
export async function restoreStorefrontOrdersAction(ids: unknown): Promise<DeleteOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  const list = cleanTrashIds(ids);
  if (!list.length) return { ok: true };

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const target = new Set(list);
    saveDemoStoreOrders(
      slug,
      getDemoStoreOrders(slug).map((o) => {
        if (!target.has(o.id) || !isTrashed(o)) return o;
        const { deletedAt: _removed, ...restored } = o;
        return restored;
      }),
    );
    return { ok: true };
  }

  try {
    await withTenant(tenantId, (db) =>
      db.storefrontOrder.updateMany({
        where: { ...TRASHED_ORDERS_WHERE, id: { in: list } },
        data: { deletedAt: null },
      }),
    );
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't restore the orders." };
  }
}

/**
 * Destroy trashed orders for good (store OWNER only).
 *
 * Two guards, both load-bearing. Owner-only, because a trash the same hand can
 * empty is not a safety net — staff can delete and restore, but only the owner
 * can make it final. And the delete is scoped to rows ALREADY trashed, so no id
 * list, however it was crafted or however stale the client's selection is, can
 * reach a live order through this path.
 */
export async function purgeStorefrontOrdersAction(ids: unknown): Promise<DeleteOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  if (ctx.actor.kind !== "owner") {
    return { error: "Only the store owner can delete orders permanently." };
  }
  const tenantId = ctx.tenantId;

  const list = cleanTrashIds(ids);
  if (!list.length) return { ok: true };

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const target = new Set(list);
    saveDemoStoreOrders(
      slug,
      getDemoStoreOrders(slug).filter((o) => !(target.has(o.id) && isTrashed(o))),
    );
    return { ok: true };
  }

  try {
    await withTenant(tenantId, (db) =>
      db.storefrontOrder.deleteMany({ where: { ...TRASHED_ORDERS_WHERE, id: { in: list } } }),
    );
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't delete the orders." };
  }
}

// ── Admin: bulk status change ─────────────────────────────────────────────────

/**
 * How many orders one write transaction may carry.
 *
 * Every tenant DB call runs inside a withTenant() interactive transaction over
 * a pooled connection, capped at 20s. A round trip on that path was measured at
 * ~320ms against live data, and a chunk costs roughly
 * `1 + chunkSize + 1 + productsTouched` round trips — so 20 keeps a chunk near
 * 10s, comfortably inside the cap while still cutting the number of
 * transactions by an order of magnitude versus one per order.
 */
const BULK_STATUS_CHUNK = 20;

/** Split a selection into fixed-size chunks, preserving order. */
function chunkOrders<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Turn a failure into something a store owner can act on.
 *
 * Prisma's transaction-timeout error (P2028) reads "Transaction not found.
 * Transaction ID is invalid, refers to an old closed transaction…" — internals
 * that used to land verbatim in an alert() in the store admin. The owner can
 * act on "select fewer orders"; they can do nothing with a transaction id.
 */
function orderActionError(e: unknown, fallback: string): string {
  if (isTransactionTimeout(e)) {
    return "That took too long to save. Please select fewer orders and try again.";
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Move many of the tenant's orders to one status in a single action (store admin
 * only). Reuses the SAME per-order decision as updateStorefrontOrderAction
 * (planStatusChange, via planBulkStatusChange): a journey event is appended only
 * on a real change, and inventory deducts on confirm / restocks on cancel —
 * never twice. Orders already at the target status are skipped, so the count
 * reflects genuine changes only.
 */
export async function bulkUpdateStorefrontOrderStatusAction(
  ids: unknown,
  status: unknown,
): Promise<BulkUpdateStatusResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  if (!isOrderStatus(status)) return { error: "Invalid status." };
  const list = cleanIdList(ids);
  if (!list.length) return { ok: true, changed: 0 };

  const now = new Date().toISOString();

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const target = new Set(list);
    let products =
      getDemoStoreProducts(slug) ??
      getDemoProducts(slug).map((dp) => dbProductToStorefront(dp as unknown as DbProductRowMap, demoDisplaySymbol(slug)));
    let changed = 0;
    let stockMoved = false;
    const nextOrders = getDemoStoreOrders(slug).map((o) => {
      // Trashed orders are skipped, not just filtered out of the map: they have
      // to stay in the saved list, and confirming one would deduct stock for an
      // order the owner has deleted.
      if (!target.has(o.id) || isTrashed(o)) return o;
      const plan = planStatusChange(
        {
          status: o.status,
          statusHistory: normalizeStatusHistory(o.statusHistory),
          imported: o.imported,
        },
        status,
        now,
      );
      if (!plan.changed) return o;
      changed++;
      if (plan.move) {
        products = adjustProductStock(products, o.items, plan.move);
        stockMoved = true;
      }
      return { ...o, status: plan.status, statusHistory: plan.statusHistory };
    });
    if (changed > 0) saveDemoStoreOrders(slug, nextOrders);
    if (stockMoved) {
      saveDemoStoreProducts(slug, products);
      revalidateTenant(slug, slug);
    }
    return { ok: true, changed };
  }

  try {
    // Read the whole selection once, outside the write transactions.
    const rows = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findMany({
        where: { ...ACTIVE_ORDERS_WHERE, id: { in: list } },
      }),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    const applied: BulkStatusChanged[] = [];
    let moved = false;
    // A chunk failure does NOT discard what earlier chunks already committed —
    // those orders really did change, so their emails must still go out and the
    // catalog must still be revalidated. The failure is held here and reported
    // after that work, never instead of it.
    let failure: unknown = null;

    // Persist in chunks, one transaction per chunk. Each transaction costs
    // 1 set_config + (orders in chunk) writes + 1 product read + (products
    // touched) writes, so its duration is bounded no matter how large the
    // owner's selection is. Chunking trades all-or-nothing across the whole
    // selection for a bounded transaction: what stays atomic is the pair that
    // matters — an order's status change and its stock movement never separate.
    for (const chunk of chunkOrders(rows, BULK_STATUS_CHUNK)) {
      const plan = planBulkStatusChange(
        chunk.map((r) => ({
          id: r.id,
          status: r.status as Order["status"],
          statusHistory: normalizeStatusHistory(r.statusHistory),
          imported: r.imported,
          items: normalizeItems(r.items),
        })),
        status,
        now,
      );
      if (plan.writes.length === 0) continue;

      try {
        const written = await withTenant(tenantId, async (db) => {
          for (const w of plan.writes) {
            await db.storefrontOrder.updateMany({
              where: { ...ACTIVE_ORDERS_WHERE, id: w.id },
              data: {
                status: w.status,
                statusHistory: w.statusHistory as unknown as Prisma.InputJsonValue,
              },
            });
          }
          return applyOrderStockMovesBatched(stockMoveDb(db), plan.stockMoves);
        });

        if (written > 0) moved = true;
        applied.push(...plan.changed);
      } catch (e) {
        // Stop here rather than pressing on: whatever slowed this chunk down
        // (or dropped it) will very likely take the next one too.
        failure = e;
        break;
      }
    }

    const slug = await getTenantSlug();
    if (applied.length > 0) {
      // Resolve branding once, then emit one order_status_changed per genuinely
      // changed order (fire-and-forget) so the tenant's PostHog workflow can email
      // each customer — same event the single-order update emits.
      //
      // The order handed to the payload is rebuilt from the row we already read
      // plus the status/journey we just computed — never re-read. That re-read
      // cost one round trip per order and is what pushed this transaction past
      // its budget in the first place.
      const { branding } = await getTenantContext(tenantId);
      const emailBrand = buildEmailBrand(
        (branding?.config ?? {}) as Record<string, unknown>,
        storefrontOrigin(slug),
      );
      for (const ch of applied) {
        const row = byId.get(ch.id);
        if (!row) continue;
        const order = dbOrderToStorefront({
          ...row,
          status: ch.status,
          statusHistory: ch.statusHistory,
        } as DbOrderRow);
        after(() =>
          capturePostHogEvent(
            tenantId,
            buildStatusChangedPayload(order, ch.prevStatus, order.status, emailBrand),
          ),
        );
      }
    }
    // Any stock movement → refresh the cached storefront so the catalog shows it.
    // Runs before the failure is reported: the stock of the chunks that DID
    // commit has already moved, so a stale catalog would oversell it.
    if (moved) revalidateTenant(tenantId, slug);
    // Only now, with the committed work fully accounted for, surface the failure
    // — including how much of the selection actually changed.
    if (failure) return { error: bulkStatusFailureMessage(applied.length, failure) };
    return { ok: true, changed: applied.length };
  } catch (e) {
    return { error: orderActionError(e, "Couldn't update the orders.") };
  }
}
