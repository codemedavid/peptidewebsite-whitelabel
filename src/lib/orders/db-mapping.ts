// The storefront_orders row - storefront Order mapping layer.
//
// Lifted out of actions/orders.ts so it can have more than one caller. That
// module is "use server", which means every export must be an async server
// action - so nothing inside it can be shared with a route handler. The Telegram
// webhook needs exactly this mapping (to re-render an order, and to emit the same
// status-changed event the admin emits), and lib/orders/apply-status.ts needs it
// to serve both doors from one engine.
//
// Everything here is PURE and total: untrusted JSON in, a clean Order out. These
// functions parse two different kinds of input - a stored DB row AND an
// anonymous checkout payload - which is why the authority fields (`imported`,
// `orderType`, `deletedAt`) are deliberately NOT handled by normalizeOrderInput
// and are stamped from the row instead. See dbOrderToStorefront.

import { isOrderStatus } from "@/lib/storefront/order-status";
import { normalizeOrderPaymentFee } from "@/lib/storefront/payment-fee";
import { normalizeCustomerNote } from "@/lib/orders/customer-note";
import { promoLabel } from "@/lib/storefront/promo";
import { ADMIN_FEE_LABEL_DEFAULT, ADMIN_FEE_LABEL_MAX } from "@/lib/storefront/admin-fee";
import type { Order, OrderGbTotals, OrderItem, OrderRefundStatus, OrderStatusEvent } from "@/storefront/types";

// -- Input hardening ---------------------------------------------------------

export function str(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (v == null) return "";
  return String(v).slice(0, max);
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an untrusted client object into a clean storefront Order item. */
export function normalizeItems(input: unknown): OrderItem[] {
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

type LineStamps = Pick<OrderItem, "cancelledQty" | "placedAt" | "addedBy" | "changedByStore" | "originalQty">;

/** The server's stamps on one STORED line (Ligwak cancellations, store edits).
 *  Read only from a DB row — normalizeItems, which also parses anonymous
 *  checkout payloads, never accepts them, or a buyer could pre-cancel vials. */
function readLineStamps(raw: unknown, qty: number): LineStamps {
  if (!raw || typeof raw !== "object") return {};
  const x = raw as Record<string, unknown>;
  const cancelled = Math.floor(num(x.cancelledQty));
  const original = Math.floor(num(x.originalQty));
  const placedAt = typeof x.placedAt === "string" && x.placedAt ? str(x.placedAt, 40) : "";
  return {
    ...(cancelled > 0 ? { cancelledQty: Math.min(cancelled, qty) } : {}),
    ...(placedAt ? { placedAt } : {}),
    ...(x.addedBy === "store" ? { addedBy: "store" as const } : {}),
    ...(x.changedByStore === true ? { changedByStore: true as const } : {}),
    ...(original > 0 ? { originalQty: original } : {}),
  };
}

/** Stored items with their server stamps kept (index-aligned with normalizeItems). */
export function storedItems(input: unknown): OrderItem[] {
  const raw = Array.isArray(input) ? input : [];
  return normalizeItems(raw).map((item, i) => ({ ...item, ...readLineStamps(raw[i], item.qty) }));
}

/** The vials an order's stock move covers: what survived Ligwak. A fully
 *  ligwak'd line moves nothing — its vials went back when the lock ran. */
export function stockItems(input: unknown): OrderItem[] {
  return storedItems(input)
    .map(({ cancelledQty, ...item }) => ({ ...item, qty: item.qty - (cancelledQty ?? 0) }))
    .filter((item) => item.qty > 0);
}

const REFUND_STATUSES: readonly OrderRefundStatus[] = ["for_review", "refund_pending", "refunded"];

const centsToMajor = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v / 100 : undefined;

function readGbTotals(input: unknown): OrderGbTotals | undefined {
  if (!input || typeof input !== "object") return undefined;
  const x = input as Record<string, unknown>;
  const n = (k: string) => Math.max(0, num(x[k]));
  return {
    subtotal: n("subtotal"),
    successSubtotal: n("successSubtotal"),
    discount: n("discount"),
    shipping: n("shipping"),
    adminFee: n("adminFee"),
    paymentFee: n("paymentFee"),
    originalTotal: n("originalTotal"),
    newTotal: n("newTotal"),
    amountDue: n("amountDue"),
    refundDue: n("refundDue"),
  };
}

/** The Ligwak re-total fields, from the ROW only (never from checkout input). */
function rowAllocation(row: DbOrderRow): Partial<Order> {
  const adjustedTotal = centsToMajor(row.adjustedTotalCents);
  const gbTotals = adjustedTotal === undefined ? undefined : readGbTotals(row.gbTotals);
  const amountDue = centsToMajor(row.amountDueCents);
  const refundDue = centsToMajor(row.refundDueCents);
  const refundStatus = REFUND_STATUSES.find((s) => s === row.refundStatus);
  const editedAt = row.storeEditedAt instanceof Date ? row.storeEditedAt.toISOString() : row.storeEditedAt || "";
  return {
    ...(adjustedTotal !== undefined ? { adjustedTotal } : {}),
    ...(gbTotals ? { gbTotals } : {}),
    ...(amountDue !== undefined ? { amountDue } : {}),
    ...(refundDue !== undefined ? { refundDue } : {}),
    ...(refundStatus ? { refundStatus } : {}),
    ...(row.refundReference ? { refundReference: str(row.refundReference, 200) } : {}),
    ...(editedAt ? { storeEditedAt: editedAt } : {}),
  };
}

/** Coerce a stored/untrusted fee blob into the order's fee, or undefined when
 *  none was charged. Used for DB rows and demo orders alike; checkout itself
 *  never trusts this — placeStorefrontOrderAction re-stamps it from config. */
export function normalizeOrderFee(input: unknown): Order["adminFee"] {
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
export function normalizeOrderDiscount(input: unknown): Order["discount"] {
  if (!input || typeof input !== "object") return undefined;
  const x = input as Record<string, unknown>;
  const amount = Math.max(0, num(x.amount));
  const code = str(x.code, 64).toUpperCase();
  if (amount <= 0 || !code) return undefined;
  return { code, label: str(x.label, 120) || promoLabel(code), amount };
}

/** Coerce an untrusted status-history blob into clean, ordered journey events. */
export function normalizeStatusHistory(input: unknown): OrderStatusEvent[] {
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
export function normalizeOrderInput(input: unknown): Order {
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
    // The buyer's own note. Bounded by the SHARED helper rather than str() so
    // there is one definition of what a stored note may be — this value comes
    // straight off an anonymous checkout payload.
    customerNote: normalizeCustomerNote(o.customerNote),
    items: normalizeItems(o.items),
    statusHistory: normalizeStatusHistory(o.statusHistory),
    adminFee: normalizeOrderFee(o.adminFee),
    paymentFee: normalizeOrderPaymentFee(o.paymentFee),
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
export type DbOrderRow = {
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
  paymentFee: unknown;
  discount: unknown;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  customerNote: string;
  placedAt: Date;
  groupBuyId?: string | null;
  groupBuyName?: string | null;
  orderType?: string | null;
  imported?: boolean;
  deletedAt?: Date | string | null;
  // Ligwak re-total (all optional: older selects and demo rows don't carry them)
  adjustedTotalCents?: number | null;
  amountDueCents?: number | null;
  refundDueCents?: number | null;
  refundStatus?: string | null;
  refundReference?: string | null;
  gbTotals?: unknown;
  storeEditedAt?: Date | string | null;
};

export function dbOrderToStorefront(row: DbOrderRow): Order {
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
    paymentFee: row.paymentFee,
    discount: row.discount,
    courier: row.courier,
    trackingNumber: row.trackingNumber,
    shippingNote: row.shippingNote,
    customerNote: row.customerNote,
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
  // Set from the ROW for the same reason `imported` is (see above): orderType is
  // server-stamped authority about how the order was priced, so it must never be
  // rehydrated through normalizeOrderInput, which also parses untrusted payloads.
  const withType: Order =
    row.orderType === "reseller" ? { ...withImported, orderType: "reseller" } : withImported;
  const deletedAt =
    row.deletedAt instanceof Date ? row.deletedAt.toISOString() : row.deletedAt || null;
  const withDeleted = deletedAt ? { ...withType, deletedAt } : withType;
  // Server stamps on stored lines and the Ligwak re-total ride the same rule:
  // from the ROW only. storedItems is index-aligned with normalizeItems.
  return { ...withDeleted, items: storedItems(row.items), ...rowAllocation(row) };
}
