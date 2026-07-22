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
import { uploadTenantMedia } from "@/lib/imagekit/server";
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
import { dbProductToStorefront, type DbProductRow as DbProductRowMap } from "@/lib/storefront/product-mapping";
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
import { evaluateOnHandGate } from "@/lib/storefront/on-hand-gate";
import { stripResellerPricing } from "@/lib/storefront/reseller-gate";
import {
  groupBuyViolations,
  normalizeGroupBuyRules,
  ratioViolation,
  type RatioLine,
} from "@/lib/storefront/group-buy-rules";
import { hasFeature } from "@/lib/features/entitlements";
import { isBusinessExclusiveLocked, getTrialState } from "@/lib/trial/trial-info";
import { isTrialPaused } from "@/lib/trial/trial-state";
import { FEATURES } from "@/lib/features/catalog";
import {
  isOrderStatus,
  cleanIdList,
  planStatusChange,
  type InventoryMove,
} from "@/lib/storefront/order-status";
import {
  findPromoCode,
  normalizePromoCodes,
  promoCodeError,
  promoDiscountAmount,
  promoLabel,
} from "@/lib/storefront/promo";
import type { Order, OrderItem, OrderStatusEvent, Product } from "@/storefront/types";
import { authoritativeItemPrice } from "@/storefront/checkout";
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
  products: Array<{ id: string; name: string; stock?: number | null; productType?: "gb" | "onhand" }>,
  items: OrderItem[],
  gbScope: GroupBuyPriceScope | null = null,
): string | null {
  for (const it of items) {
    const prod = products.find((x) =>
      it.productId ? x.id === it.productId : x.name === it.name,
    );
    if (!prod) continue;
    if (isGroupBuyPreorder(prod, gbScope)) continue;
    const stock = Math.max(0, prod.stock ?? 0);
    if (it.qty > stock) {
      return stock === 0
        ? `"${prod.name}" is out of stock.`
        : `Only ${stock} of "${prod.name}" left in stock — you have ${it.qty} in your cart.`;
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
): void {
  for (const it of items) {
    const live = authoritativeItemPrice(it, catalog, groupBuyScope);
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
function stampShipping(config: Record<string, unknown>, p: Order): void {
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
  p.shipping.fee = Math.max(0, num(loc.price));
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
 *  clamping at zero. Lines match by productId when present, by exact name for
 *  legacy orders. */
function adjustProductStock(
  products: Product[],
  items: OrderItem[],
  move: Exclude<InventoryMove, null>,
): Product[] {
  const dir = move === "deduct" ? -1 : 1;
  return products.map((p) => {
    const qty = items
      .filter((it) => (it.productId ? it.productId === p.id : it.name === p.name))
      .reduce((s, it) => s + (it.qty || 0), 0);
    return qty > 0 ? { ...p, stock: Math.max(0, (p.stock || 0) + dir * qty) } : p;
  });
}

/**
 * Apply an order's line items to the tenant's DB inventory (− on deduct, + on
 * restock), clamping at zero. The DB analogue of adjustProductStock: lines match
 * by productId when present, by exact name for legacy orders. Shared by the
 * single-order update and the bulk status action so both move stock identically.
 * Runs inside a withTenant() transaction (the passed `db` is already scoped).
 */
async function applyOrderStockMove(
  db: TenantTx,
  items: OrderItem[],
  move: Exclude<InventoryMove, null>,
): Promise<void> {
  const dir = move === "deduct" ? -1 : 1;
  for (const it of items) {
    const prod = await db.product.findFirst({
      where: it.productId ? { id: it.productId } : { name: it.name },
      select: { id: true, stock: true },
    });
    if (prod) {
      await db.product.updateMany({
        where: { id: prod.id },
        data: { stock: Math.max(0, (prod.stock ?? 0) + dir * it.qty) },
      });
    }
  }
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
): Promise<string | null> {
  return evaluateOnHandGate(config, tenantId, demoSlug, items, {
    resolveCaps: resolveGroupBuyCaps,
    loadGroupBuys,
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
  return base;
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
  if (!file.type.startsWith("image/")) {
    return { error: `Unsupported type: ${file.type || "unknown"}.` };
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
        dbProductToStorefront(dp as unknown as DbProductRowMap, "₱"),
      );
    // Reseller wholesale pricing is entitlement-gated: strip the legs before
    // ANY pricing/rules surface reads the catalog, so an unentitled tenant's
    // re-price can never charge a wholesale tier a tampered client kept
    // (test:reseller-gate) — the same strip page.tsx applies at render.
    const demoProducts = stripResellerPricing(
      demoProductsRaw,
      await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL),
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
    repriceItems(p.items, demoProducts, demoGbScope);
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
    stampShipping(config, p);
    // Discount — re-derived from the tenant's promo codes by the applied code,
    // never trusted from the client. Rejected (not silently dropped) when the
    // code is no longer valid, so the customer never pays a higher total than
    // the one they saw.
    const demoDiscountError = stampDiscount(config, p);
    if (demoDiscountError) return { error: demoDiscountError };
    // Group-buy on-hand gate — reject paused on-hand products, matching the cart.
    const demoGbOnHand = await groupBuyOnHandViolation(config, tenantId, slug, p.items);
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
    const catalog = stripResellerPricing(
      catalogRaw,
      await hasFeature(tenantId, FEATURES.STORE_RESELLER_PORTAL),
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
    repriceItems(p.items, catalog, gbScope);

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
    stampShipping(config, p);
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
    const gbOnHand = await groupBuyOnHandViolation(config, tenantId, slug, p.items);
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
  if (clientId) {
    const existing = await withTenant(tenantId, (db) =>
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

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const found = getDemoStoreOrders(slug).find(matches);
    return { ok: true, order: found ? pick(found) : null };
  }

  try {
    const row = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findFirst({ where: { orderNumber: code } }),
    );
    return { ok: true, order: row ? pick(dbOrderToStorefront(row as DbOrderRow)) : null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't look up the order." };
  }
}

// ── Admin: list ───────────────────────────────────────────────────────────────

/** The tenant's storefront orders, newest first, for the admin Orders screen. */
export async function listStorefrontOrdersAction(): Promise<ListOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    return { ok: true, orders: getDemoStoreOrders(slug) };
  }

  try {
    const rows = await withTenant(tenantId, (db) =>
      db.storefrontOrder.findMany({ orderBy: { createdAt: "desc" } }),
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
    if (i < 0) return { error: "Order not found." };
    const newStatus = data.status as Order["status"] | undefined;
    // Same per-order decision the DB path and the bulk action use: append a
    // journey event only on a real change, and learn the inventory move.
    const plan = newStatus
      ? planStatusChange(
          { status: list[i].status, statusHistory: normalizeStatusHistory(list[i].statusHistory) },
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
          dbProductToStorefront(dp as unknown as DbProductRowMap, "₱"),
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
      const current = await db.storefrontOrder.findFirst({ where: { id: orderId } });
      if (!current) return null;
      const next: Prisma.StorefrontOrderUpdateInput = { ...data };
      const newStatus = data.status as Order["status"] | undefined;
      // Same per-order decision the demo path and the bulk action use.
      const plan = newStatus
        ? planStatusChange(
            {
              status: current.status as Order["status"],
              statusHistory: normalizeStatusHistory(current.statusHistory),
            },
            newStatus,
            new Date().toISOString(),
          )
        : null;
      if (plan?.changed) {
        next.statusHistory = plan.statusHistory as unknown as Prisma.InputJsonValue;
      }
      // updateMany is tenant-scoped by the extension; the bare-id update isn't.
      await db.storefrontOrder.updateMany({ where: { id: orderId }, data: next });

      // Confirmed → deduct each line item from the tenant's inventory;
      // cancelled after a deduction → put it back. Lines match by productId
      // (stamped at checkout) or by exact name for legacy orders; quantities
      // clamp at zero so stock never goes negative.
      const move = plan?.move ?? null;
      if (move) {
        await applyOrderStockMove(db, normalizeItems(current.items), move);
      }
      return {
        row: await db.storefrontOrder.findFirst({ where: { id: orderId } }),
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
    return { error: e instanceof Error ? e.message : "Couldn't update the order." };
  }
}

// ── Admin: delete ───────────────────────────────────────────────────────────

/** Delete one or more of the tenant's storefront orders by id (store admin only). */
export async function deleteStorefrontOrdersAction(ids: unknown): Promise<DeleteOrdersResult> {
  const ctx = await requireStaffPermission("orders");
  if (!ctx) return { error: "Not signed in to the store admin." };
  const tenantId = ctx.tenantId;

  const list = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 1000)
    : [];
  if (!list.length) return { ok: true };

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const remove = new Set(list);
    saveDemoStoreOrders(slug, getDemoStoreOrders(slug).filter((o) => !remove.has(o.id)));
    return { ok: true };
  }

  try {
    await withTenant(tenantId, (db) =>
      db.storefrontOrder.deleteMany({ where: { id: { in: list } } }),
    );
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't delete the orders." };
  }
}

// ── Admin: bulk status change ─────────────────────────────────────────────────

/**
 * Move many of the tenant's orders to one status in a single action (store admin
 * only). Reuses the SAME per-order decision as updateStorefrontOrderAction
 * (planStatusChange): a journey event is appended only on a real change, and
 * inventory deducts on confirm / restocks on cancel — never twice. Orders already
 * at the target status are skipped, so the count reflects genuine changes only.
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
      getDemoProducts(slug).map((dp) => dbProductToStorefront(dp as unknown as DbProductRowMap, "₱"));
    let changed = 0;
    let stockMoved = false;
    const nextOrders = getDemoStoreOrders(slug).map((o) => {
      if (!target.has(o.id)) return o;
      const plan = planStatusChange(
        { status: o.status, statusHistory: normalizeStatusHistory(o.statusHistory) },
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
    const result = await withTenant(tenantId, async (db) => {
      const rows = await db.storefrontOrder.findMany({ where: { id: { in: list } } });
      const changedOrders: { order: Order; prevStatus: string }[] = [];
      let moved = false;
      for (const current of rows) {
        const plan = planStatusChange(
          {
            status: current.status as Order["status"],
            statusHistory: normalizeStatusHistory(current.statusHistory),
          },
          status,
          now,
        );
        if (!plan.changed) continue;
        await db.storefrontOrder.updateMany({
          where: { id: current.id },
          data: {
            status: plan.status,
            statusHistory: plan.statusHistory as unknown as Prisma.InputJsonValue,
          },
        });
        if (plan.move) {
          await applyOrderStockMove(db, normalizeItems(current.items), plan.move);
          moved = true;
        }
        const updatedRow = await db.storefrontOrder.findFirst({ where: { id: current.id } });
        if (updatedRow) {
          changedOrders.push({
            order: dbOrderToStorefront(updatedRow as DbOrderRow),
            prevStatus: current.status,
          });
        }
      }
      return { changedOrders, moved };
    });

    const slug = await getTenantSlug();
    if (result.changedOrders.length > 0) {
      // Resolve branding once, then emit one order_status_changed per genuinely
      // changed order (fire-and-forget) so the tenant's PostHog workflow can email
      // each customer — same event the single-order update emits.
      const { branding } = await getTenantContext(tenantId);
      const emailBrand = buildEmailBrand(
        (branding?.config ?? {}) as Record<string, unknown>,
        storefrontOrigin(slug),
      );
      for (const { order, prevStatus } of result.changedOrders) {
        after(() =>
          capturePostHogEvent(
            tenantId,
            buildStatusChangedPayload(order, prevStatus, order.status, emailBrand),
          ),
        );
      }
    }
    // Any stock movement → refresh the cached storefront so the catalog shows it.
    if (result.moved) revalidateTenant(tenantId, slug);
    return { ok: true, changed: result.changedOrders.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the orders." };
  }
}
