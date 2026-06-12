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
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { withTenant } from "@/lib/db/tenant-client";
import { generateStorefrontOrderNumber } from "@/lib/orders/order-number";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import {
  isDemoMode,
  getDemoBranding,
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
import {
  groupBuyViolations,
  normalizeGroupBuyRules,
} from "@/lib/storefront/group-buy-rules";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import type { Order, OrderItem, OrderStatusEvent, Product } from "@/storefront/types";

export type UploadProofResult = { url: string } | { error: string };
export type PlaceOrderResult = { ok: true; order: Order } | { error: string };
export type ListOrdersResult = { ok: true; orders: Order[] } | { error: string };
export type UpdateOrderResult = { ok: true; order: Order } | { error: string };
export type DeleteOrdersResult = { ok: true } | { error: string };

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

const STATUSES: Order["status"][] = [
  "new",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

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
    };
  });
}

// ── Inventory sync on status change ──────────────────────────────────────────
//
// Entering `confirmed` deducts the order's items from stock; entering
// `cancelled` puts them back — but ONLY if they are currently deducted.
// Whether they are deducted is derived by replaying the status journey, so a
// confirmed → cancelled → confirmed bounce deducts, restocks, then deducts
// again — never twice in a row. Legacy orders confirmed before this feature
// shipped have no `confirmed` event in their journey (or no journey at all),
// so replaying yields "not deducted" and cancelling them never invents stock.

type InventoryMove = "deduct" | "restock" | null;

/** Replay the journey to learn whether the order's items are deducted now. */
function stockCurrentlyDeducted(history: OrderStatusEvent[]): boolean {
  let deducted = false;
  for (const e of history) {
    if (e.status === "confirmed") deducted = true;
    else if (e.status === "cancelled") deducted = false;
  }
  return deducted;
}

/** Which stock movement (if any) this status change triggers. */
function inventoryMove(
  currentStatus: string,
  history: OrderStatusEvent[],
  newStatus: Order["status"] | undefined,
): InventoryMove {
  if (!newStatus || newStatus === currentStatus) return null;
  const deducted = stockCurrentlyDeducted(history);
  if (newStatus === "confirmed" && !deducted) return "deduct";
  if (newStatus === "cancelled" && deducted) return "restock";
  return null;
}

/** The first line in the cart that asks for more than the product has in
 *  stock, as a customer-facing error — or null when the whole cart fits.
 *  Lines match by productId (stamped at checkout) or exact name; lines that
 *  match no product aren't stock-checked. */
function stockViolation(
  products: Array<{ id: string; name: string; stock?: number | null }>,
  items: OrderItem[],
): string | null {
  for (const it of items) {
    const prod = products.find((x) =>
      it.productId ? x.id === it.productId : x.name === it.name,
    );
    if (!prod) continue;
    const stock = Math.max(0, prod.stock ?? 0);
    if (it.qty > stock) {
      return stock === 0
        ? `"${prod.name}" is out of stock.`
        : `Only ${stock} of "${prod.name}" left in stock — you have ${it.qty} in your cart.`;
    }
  }
  return null;
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
): string | null {
  const rules = normalizeCheckoutRules(config.checkoutRules);

  if (rules.adminFeeValidation && rules.ruleBasedCheckout && clientFee && typeof clientFee === "object") {
    const shown = Math.max(0, num((clientFee as Record<string, unknown>).amount));
    const charged = activeAdminFee(config.adminFee, itemsSubtotal(items))?.amount ?? 0;
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
): string | null {
  const rules = normalizeGroupBuyRules(config.groupBuyRules);
  if (!rules.enabled || !rules.validation.checkout) return null;
  const lines = items.map((it) => ({ name: it.name, qty: it.qty }));
  return groupBuyViolations(rules, lines)[0] ?? null;
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
 * Stamp the order with the group buy it belongs to (or null) — SERVER-SIDE,
 * from the tenant's live group buys at the moment of placement, never from the
 * client. The name is snapshotted alongside the id so supplier reports survive
 * later renames. No-ops (stamps null) when the tenant lacks groupbuy.module.
 */
async function stampGroupBuy(p: Order, tenantId: string, demoSlug: string): Promise<void> {
  p.groupBuyId = null;
  p.groupBuyName = null;
  try {
    const caps = await resolveGroupBuyCaps(tenantId);
    if (!caps.enabled) return;
    const groupBuys = await loadGroupBuys(tenantId, demoSlug);
    const orderedIds = p.items
      .map((it) => it.productId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const gb = groupBuyForOrder(groupBuys, caps, orderedIds);
    if (gb) {
      p.groupBuyId = gb.id;
      p.groupBuyName = gb.name;
    }
  } catch {
    /* attribution is best-effort — never block checkout on it */
  }
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

/** Coerce an untrusted status-history blob into clean, ordered journey events. */
function normalizeStatusHistory(input: unknown): OrderStatusEvent[] {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .slice(0, 50)
    .map((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const status = STATUSES.includes(x.status as Order["status"])
        ? (x.status as Order["status"])
        : null;
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
  const status = STATUSES.includes(o.status as Order["status"])
    ? (o.status as Order["status"])
    : "new";
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
    },
    courier: str(o.courier, 120),
    trackingNumber: str(o.trackingNumber, 120),
    shippingNote: str(o.shippingNote, 500),
    items: normalizeItems(o.items),
    statusHistory: normalizeStatusHistory(o.statusHistory),
    adminFee: normalizeOrderFee(o.adminFee),
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
    const demoProducts =
      getDemoStoreProducts(slug) ??
      getDemoProducts(slug).map((dp) =>
        dbProductToStorefront(dp as unknown as DbProductRowMap, "₱"),
      );
    const demoViolation = stockViolation(demoProducts, p.items);
    if (demoViolation) return { error: demoViolation };
    // The admin fee is SERVER-AUTHORITATIVE: re-derived from the tenant's
    // branding config at placement (any client-supplied value is discarded) and
    // snapshotted on the order so a later config change never rewrites it.
    const config = (getDemoBranding(slug).config ?? {}) as Record<string, unknown>;
    // Smart Checkout rules — reject the order when it violates a blocking rule.
    // Entitlement-gated: a tenant without the feature keeps any saved rules
    // dormant, matching the storefront (which strips brand.checkoutRules).
    const demoRuleError = (await hasFeature(tenantId, FEATURES.STORE_SMART_CHECKOUT))
      ? checkoutRulesViolation(config, demoProducts, p.items, clientFee)
      : null;
    if (demoRuleError) return { error: demoRuleError };
    p.adminFee = activeAdminFee(config.adminFee, itemsSubtotal(p.items)) ?? undefined;
    // Group-buy attribution — same server-authoritative stamp as the fee.
    await stampGroupBuy(p, tenantId, slug);
    // Server-authoritative, per-tenant number (file-backed analogue of orderSeq).
    const orderNumber = nextDemoOrderNumber(slug);
    const saved: Order = { ...p, id, orderNumber };
    addDemoStoreOrder(slug, saved);
    return { ok: true, order: saved };
  }

  try {
    // Same server-authoritative fee stamp as the demo path — read through the
    // tag-invalidated tenant cache, so checkout charges exactly what the
    // storefront (which renders from the same cache) displayed.
    const { branding } = await getTenantContext(tenantId);
    const config = (branding?.config ?? {}) as Record<string, unknown>;
    p.adminFee = activeAdminFee(config.adminFee, itemsSubtotal(p.items)) ?? undefined;

    // Inventory guard: reject the order outright when any line asks for more
    // than the product has in stock, so the admin never has to confirm an
    // order the inventory can't cover. Full rows (not just id/name/stock)
    // because the Smart Checkout rules below need categories, reseller tiers
    // and names to classify the cart.
    const rows = await withTenant(tenantId, (db) =>
      db.product.findMany({ where: { status: { not: "archived" } } }),
    );
    const catalog = rows.map((r) =>
      dbProductToStorefront(r as unknown as DbProductRowMap, String(config.currency ?? "")),
    );
    const violation = stockViolation(catalog, p.items);
    if (violation) return { error: violation };

    // Smart Checkout rules — reject the order when it violates a blocking rule.
    // Entitlement-gated, same as the demo path above.
    const ruleError = (await hasFeature(tenantId, FEATURES.STORE_SMART_CHECKOUT))
      ? checkoutRulesViolation(config, catalog, p.items, clientFee)
      : null;
    if (ruleError) return { error: ruleError };

    // Group-buy attribution — same server-authoritative stamp as the fee.
    await stampGroupBuy(p, tenantId, (await getTenantSlug()) ?? tenantId);

    const row = await createStorefrontOrder(tenantId, p);
    return { ok: true, order: dbOrderToStorefront(row as DbOrderRow) };
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
    if (existing) return existing;
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const orderNumber = await withTenant(tenantId, (db) =>
      generateStorefrontOrderNumber(db, tenantId),
    );
    try {
      return await withTenant(tenantId, (db) =>
        db.storefrontOrder.create({ data: { ...orderToDbCreate(tenantId, p), orderNumber, clientId } }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        // The collision is on one of two unique keys:
        //  • (tenantId, clientId) — a concurrent/earlier attempt for this same
        //    draft already won the race → that row IS this order (idempotent).
        if (clientId) {
          const existing = await withTenant(tenantId, (db) =>
            db.storefrontOrder.findFirst({ where: { clientId } }),
          );
          if (existing) return existing;
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
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

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
  if (o.status && STATUSES.includes(o.status)) data.status = o.status;
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
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

  const orderId = str(id, 64);
  if (!orderId) return { error: "Missing order id." };
  const data = cleanPatch(patch);

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const list = getDemoStoreOrders(slug);
    const i = list.findIndex((x) => x.id === orderId);
    if (i < 0) return { error: "Order not found." };
    const newStatus = data.status as Order["status"] | undefined;
    const statusChanged = !!newStatus && newStatus !== list[i].status;
    const history = normalizeStatusHistory(list[i].statusHistory);
    const next: Order = {
      ...list[i],
      ...(data.status ? { status: data.status as Order["status"] } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus as Order["paymentStatus"] } : {}),
      ...(data.courier !== undefined ? { courier: data.courier as string } : {}),
      ...(data.trackingNumber !== undefined ? { trackingNumber: data.trackingNumber as string } : {}),
      ...(data.shippingNote !== undefined ? { shippingNote: data.shippingNote as string } : {}),
      statusHistory: statusChanged
        ? [...history, { status: newStatus, at: new Date().toISOString() }]
        : history,
    };
    const updated = list.map((x, j) => (j === i ? next : x));
    saveDemoStoreOrders(slug, updated);
    // Confirmed → deduct the line items from the demo product set;
    // cancelled after a deduction → put them back.
    const move = inventoryMove(list[i].status, history, newStatus);
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
      const history = normalizeStatusHistory(current.statusHistory);
      const next: Prisma.StorefrontOrderUpdateInput = { ...data };
      const newStatus = data.status as Order["status"] | undefined;
      if (newStatus && newStatus !== current.status) {
        next.statusHistory = [
          ...history,
          { status: newStatus, at: new Date().toISOString() },
        ] as unknown as Prisma.InputJsonValue;
      }
      // updateMany is tenant-scoped by the extension; the bare-id update isn't.
      await db.storefrontOrder.updateMany({ where: { id: orderId }, data: next });

      // Confirmed → deduct each line item from the tenant's inventory;
      // cancelled after a deduction → put it back. Lines match by productId
      // (stamped at checkout) or by exact name for legacy orders; quantities
      // clamp at zero so stock never goes negative.
      const move = inventoryMove(current.status, history, newStatus);
      if (move) {
        const dir = move === "deduct" ? -1 : 1;
        for (const it of normalizeItems(current.items)) {
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
      return { row: await db.storefrontOrder.findFirst({ where: { id: orderId } }), moved: !!move };
    });
    if (!result?.row) return { error: "Order not found." };
    // Stock changed → refresh the cached storefront so the catalog shows it.
    if (result.moved) revalidateTenant(tenantId, await getTenantSlug());
    return { ok: true, order: dbOrderToStorefront(result.row as DbOrderRow) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't update the order." };
  }
}

// ── Admin: delete ───────────────────────────────────────────────────────────

/** Delete one or more of the tenant's storefront orders by id (store admin only). */
export async function deleteStorefrontOrdersAction(ids: unknown): Promise<DeleteOrdersResult> {
  const tenantId = await requireStorefrontAdmin();
  if (!tenantId) return { error: "Not signed in to the store admin." };

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
