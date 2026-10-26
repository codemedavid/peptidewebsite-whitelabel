import "server-only";

// One round as the Bunuan / Ligwak server reads it, inside the caller's
// tenant transaction: the round row, its live orders, the kit sizes of the
// products they name, and the round's payment mode. 3–4 queries, never a loop.
// Shared by both modules (Ligwak imports it) so their counts can't drift.

import { Prisma } from "@prisma/client";
import type { TenantTx } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { normalizeVialsPerKit } from "@/lib/storefront/gb-moq-kits";
import { gbPaymentModeFor, normalizeGbPaymentMode, type GbPaymentMode } from "@/lib/storefront/gb-payment-mode";
import { readKitLines, type KitOrder, type KitProduct } from "@/lib/storefront/gb-kits";
import { bunuanStartBlockers } from "../core";
import type { GbBlocker } from "@/lib/mobile/shop-contract";

export const ROUND_SELECT = {
  id: true,
  name: true,
  status: true,
  stage: true,
  stageChangedAt: true,
  startsAt: true,
  endsAt: true,
  closedAt: true,
  paymentMode: true,
  paymentDueAt: true,
  ligwakLockedAt: true,
  productIds: true,
  updatedAt: true,
} as const;
export type RoundRow = Prisma.GroupBuyGetPayload<{ select: typeof ROUND_SELECT }>;

/** Everything about an order the kit rules, the re-total and the review read. */
export const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  items: true,
  createdAt: true,
  customer: true,
  shipping: true,
  discount: true,
  adminFee: true,
  paymentFee: true,
  statusHistory: true,
  imported: true,
  adjustedTotalCents: true,
  originalTotalCents: true,
  refundStatus: true,
  refundReference: true,
  refundDueCents: true,
  updatedAt: true,
} as const;
export type RoundOrderRow = Prisma.StorefrontOrderGetPayload<{ select: typeof ORDER_SELECT }>;

export type RoundState = {
  round: RoundRow;
  mode: GbPaymentMode;
  orders: RoundOrderRow[];
  kitOrders: KitOrder[];
  products: KitProduct[];
  config: Record<string, unknown>;
};

/** A store-admin actor as stored in the audit trail: "owner" | "staff:<id>" | "system". */
export type GbActor = string;

export const toKitOrder = (o: Pick<RoundOrderRow, "id" | "orderNumber" | "status" | "paymentStatus" | "createdAt"> & { items: unknown }): KitOrder => ({
  id: o.id,
  orderNumber: o.orderNumber,
  placedAt: o.createdAt.toISOString(),
  status: o.status,
  paymentStatus: o.paymentStatus,
  items: o.items,
});

/** A product row → the fields the kit rules read (vialsPerKit + per-option kitSize). */
export function kitProductFromRow(row: { id: string; metadata: unknown }): KitProduct {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const variations = Array.isArray(meta.variations)
    ? meta.variations.flatMap((v) => {
        const x = (v ?? {}) as Record<string, unknown>;
        const name = typeof x.name === "string" ? x.name.trim() : "";
        return name ? [{ name, kitSize: normalizeVialsPerKit(x.kitSize) }] : [];
      })
    : [];
  return { id: row.id, vialsPerKit: normalizeVialsPerKit(meta.vialsPerKit), variations };
}

/** The round's counting rule: its snapshot, else the store's current setting. */
export function roundPaymentMode(round: Pick<RoundRow, "paymentMode">, config: unknown): GbPaymentMode {
  return normalizeGbPaymentMode(round.paymentMode) ?? gbPaymentModeFor(config);
}

/** The products an order set names (for kit sizes) — one query. */
export async function loadKitProducts(db: TenantTx, orders: readonly { items: unknown }[], extraIds: readonly string[] = []): Promise<KitProduct[]> {
  const ids = new Set(extraIds);
  for (const o of orders) for (const l of readKitLines(o.items)) if (l.productId) ids.add(l.productId);
  if (ids.size === 0) return [];
  const rows = await db.product.findMany({ where: { id: { in: [...ids] } }, select: { id: true, metadata: true } });
  return rows.map(kitProductFromRow);
}

export async function loadStoreConfig(db: TenantTx): Promise<Record<string, unknown>> {
  const b = await db.branding.findFirst({ select: { config: true } });
  return (b?.config && typeof b.config === "object" ? b.config : {}) as Record<string, unknown>;
}

/** Lock the round row for the rest of the transaction (serializes Bunuan
 *  checkouts and stage moves on one round). Returns null when it isn't ours. */
export async function lockRound(db: TenantTx, tenantId: string, roundId: string): Promise<{ stage: string } | null> {
  const rows = await db.$queryRaw<{ stage: string }[]>`
    SELECT "stage" FROM group_buys WHERE id = ${roundId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  return rows[0] ?? null;
}

/** The round, its live orders, kit sizes and payment mode. */
export async function loadRoundState(db: TenantTx, roundId: string): Promise<RoundState | null> {
  const round = await db.groupBuy.findFirst({ where: { id: roundId }, select: ROUND_SELECT });
  if (!round) return null;
  const orders = await db.storefrontOrder.findMany({
    where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: roundId },
    select: ORDER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  const config = await loadStoreConfig(db);
  const products = await loadKitProducts(db, orders);
  return { round, mode: roundPaymentMode(round, config), orders, kitOrders: orders.map(toKitOrder), products, config };
}

const customerName = (raw: unknown): string => {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return typeof c.name === "string" ? c.name.slice(0, 200) : "";
};
export { customerName };

/** pay_first orders still awaiting a payment check, oldest first, for the UI. */
export function roundBlockers(state: Pick<RoundState, "orders" | "kitOrders" | "mode">): GbBlocker[] {
  const byId = new Map(state.orders.map((o) => [o.id, o]));
  return bunuanStartBlockers(state.kitOrders, state.mode).map((b) => ({
    orderId: b.id,
    orderNumber: b.orderNumber ?? "",
    customerName: customerName(byId.get(b.id)?.customer),
    placedAt: b.placedAt,
  }));
}

export type AuditInput = {
  groupBuyId?: string | null;
  orderId?: string | null;
  kind: "stage" | "order_edit" | "ligwak_decide" | "ligwak_lock" | "ligwak_recalculate" | "refund";
  actor: GbActor;
  reason?: string;
  data?: Record<string, unknown>;
};

/** Append one audit event (gb_audit_events is append-only in the database). */
export async function audit(db: TenantTx, tenantId: string, e: AuditInput): Promise<void> {
  await db.gbAuditEvent.create({
    data: {
      tenantId,
      groupBuyId: e.groupBuyId ?? null,
      orderId: e.orderId ?? null,
      kind: e.kind,
      actor: e.actor,
      reason: (e.reason ?? "").slice(0, 500),
      data: (e.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}
