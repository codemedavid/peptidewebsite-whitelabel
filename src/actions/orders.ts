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
import { requireStorefrontAdmin } from "@/lib/auth/storefront-admin";
import { withTenant } from "@/lib/db/tenant-client";
import { generateStorefrontOrderNumber } from "@/lib/orders/order-number";
import { uploadTenantMedia } from "@/lib/imagekit/server";
import {
  isDemoMode,
  getDemoStoreOrders,
  addDemoStoreOrder,
  saveDemoStoreOrders,
  nextDemoOrderNumber,
} from "@/lib/demo/fixtures";
import type { Order, OrderItem } from "@/storefront/types";

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
    };
  });
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
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  placedAt: Date;
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
    courier: row.courier,
    trackingNumber: row.trackingNumber,
    shippingNote: row.shippingNote,
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

  if (isDemoMode()) {
    const slug = (await getTenantSlug()) ?? tenantId;
    const id = p.id || `o-${Date.now()}`;
    // Idempotent retry: the same draft id was already stored → return it, don't
    // mint a second number / duplicate the order.
    const existing = getDemoStoreOrders(slug).find((o) => o.id === id);
    if (existing) return { ok: true, order: existing };
    // Server-authoritative, per-tenant number (file-backed analogue of orderSeq).
    const orderNumber = nextDemoOrderNumber(slug);
    const saved: Order = { ...p, id, orderNumber };
    addDemoStoreOrder(slug, saved);
    return { ok: true, order: saved };
  }

  try {
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
    const next: Order = {
      ...list[i],
      ...(data.status ? { status: data.status as Order["status"] } : {}),
      ...(data.paymentStatus ? { paymentStatus: data.paymentStatus as Order["paymentStatus"] } : {}),
      ...(data.courier !== undefined ? { courier: data.courier as string } : {}),
      ...(data.trackingNumber !== undefined ? { trackingNumber: data.trackingNumber as string } : {}),
      ...(data.shippingNote !== undefined ? { shippingNote: data.shippingNote as string } : {}),
    };
    const updated = list.map((x, j) => (j === i ? next : x));
    saveDemoStoreOrders(slug, updated);
    return { ok: true, order: next };
  }

  try {
    const row = await withTenant(tenantId, async (db) => {
      // updateMany is tenant-scoped by the extension; the bare-id update isn't.
      await db.storefrontOrder.updateMany({ where: { id: orderId }, data });
      return db.storefrontOrder.findFirst({ where: { id: orderId } });
    });
    if (!row) return { error: "Order not found." };
    return { ok: true, order: dbOrderToStorefront(row as DbOrderRow) };
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
