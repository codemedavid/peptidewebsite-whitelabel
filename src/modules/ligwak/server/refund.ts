import "server-only";

// pay_first refunds after a Ligwak lock: for_review → refund_pending →
// refunded (with the store's reference). Forward only — the database refuses
// a step back (gb-allocation.sql). The amount is never typed: it is the
// order's refundDue from the lock, which recalculateOrder already capped at
// what the customer paid (and which never includes the QR PH fee).

import { withTenant } from "@/lib/db/tenant-client";
import { revalidateOrders } from "@/lib/orders/order-cache";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import type { GbRefund, GbRefundResult, GbRefundsResult, GbRefundStep, ShopRefundStatus } from "@/lib/mobile/shop-contract";
import { audit, customerName, gbFail } from "@/modules/bunuan/server";
import type { LigwakCtx } from "./allocation";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES: readonly ShopRefundStatus[] = ["for_review", "refund_pending", "refunded"];
const NO_LIGWAK = gbFail("unavailable", "Ligwak isn't enabled for this store.");

const REFUND_SELECT = {
  id: true,
  orderNumber: true,
  customer: true,
  groupBuyId: true,
  originalTotalCents: true,
  refundDueCents: true,
  refundStatus: true,
  refundReference: true,
  updatedAt: true,
} as const;

type RefundRow = {
  id: string;
  orderNumber: string;
  customer: unknown;
  groupBuyId: string | null;
  originalTotalCents: number | null;
  refundDueCents: number | null;
  refundStatus: string | null;
  refundReference: string | null;
};
type AuditRow = { orderId: string | null; groupBuyId: string | null; kind: string; actor: string; data: unknown; createdAt: Date };

function trailFor(order: RefundRow, events: readonly AuditRow[]): GbRefundStep[] {
  const lock = events.filter((e) => e.kind === "ligwak_lock" && e.groupBuyId === order.groupBuyId).at(-1);
  const steps: GbRefundStep[] = lock ? [{ status: "for_review", at: lock.createdAt.toISOString(), by: lock.actor, reference: "" }] : [];
  for (const e of events) {
    if (e.kind !== "refund" || e.orderId !== order.id) continue;
    const d = (e.data ?? {}) as Record<string, unknown>;
    const to = STATUSES.find((s) => s === d.to);
    if (to) steps.push({ status: to, at: e.createdAt.toISOString(), by: e.actor, reference: typeof d.reference === "string" ? d.reference : "" });
  }
  return steps;
}

function refundOf(order: RefundRow, events: readonly AuditRow[]): GbRefund {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: customerName(order.customer),
    amountPaid: (order.originalTotalCents ?? 0) / 100,
    refundDue: (order.refundDueCents ?? 0) / 100,
    status: STATUSES.find((s) => s === order.refundStatus) ?? "for_review",
    reference: order.refundReference ?? "",
    trail: trailFor(order, events),
  };
}

export async function listRefunds(ctx: LigwakCtx, roundId: unknown): Promise<GbRefundsResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  if (typeof roundId !== "string" || !ID_RE.test(roundId)) return gbFail("not_found", "Group buy not found.");
  return withTenant(ctx.tenantId, async (db) => {
    const orders = await db.storefrontOrder.findMany({
      where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: roundId, refundStatus: { not: null } },
      select: REFUND_SELECT,
      orderBy: { createdAt: "asc" },
    });
    const events = await db.gbAuditEvent.findMany({
      where: { groupBuyId: roundId, kind: { in: ["refund", "ligwak_lock"] } },
      select: { orderId: true, groupBuyId: true, kind: true, actor: true, data: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return { ok: true as const, refunds: orders.map((o) => refundOf(o, events)) };
  });
}

/** Move one order's refund forward. "refunded" needs the store's reference. */
export async function setRefundStatus(
  ctx: LigwakCtx,
  input: { orderId: unknown; status: unknown; reference?: unknown },
): Promise<GbRefundResult> {
  if (!ctx.caps.ligwak) return NO_LIGWAK;
  const { orderId } = input;
  if (typeof orderId !== "string" || !ID_RE.test(orderId)) return gbFail("not_found", "Order not found.");
  const to = STATUSES.find((s) => s === input.status);
  if (!to) return gbFail("invalid_input", "Choose a refund status: for_review, refund_pending or refunded.");
  const reference = typeof input.reference === "string" ? input.reference.trim().slice(0, 200) : "";
  if (to === "refunded" && !reference) return gbFail("invalid_input", "Add the refund reference (e.g. the GCash reference number).");

  const result = await withTenant(ctx.tenantId, async (db) => {
    const order = await db.storefrontOrder.findFirst({ where: { ...ACTIVE_ORDERS_WHERE, id: orderId }, select: REFUND_SELECT });
    if (!order) return gbFail("not_found", "Order not found.");
    const from = STATUSES.find((s) => s === order.refundStatus);
    if (!from || !order.refundDueCents) return gbFail("conflict", "This order has no refund due.");
    if (STATUSES.indexOf(to) < STATUSES.indexOf(from)) return gbFail("conflict", "A refund only moves forward.");
    if (from === "refunded") return gbFail("conflict", "This refund is already done.");
    if (from === to && (to !== "refund_pending" || reference === (order.refundReference ?? ""))) {
      return gbFail("conflict", "The refund is already at that step.");
    }
    const written = await db.storefrontOrder.updateMany({
      where: { ...ACTIVE_ORDERS_WHERE, id: orderId, refundStatus: from },
      data: { refundStatus: to, ...(reference ? { refundReference: reference } : {}) },
    });
    if (written.count === 0) return gbFail("conflict", "This refund changed since you opened it. Reload and try again.");
    await audit(db, ctx.tenantId, {
      groupBuyId: order.groupBuyId,
      orderId,
      kind: "refund",
      actor: ctx.actor,
      data: { from, to, reference, amount: order.refundDueCents / 100 },
    });
    const events = await db.gbAuditEvent.findMany({
      where: { groupBuyId: order.groupBuyId, kind: { in: ["refund", "ligwak_lock"] } },
      select: { orderId: true, groupBuyId: true, kind: true, actor: true, data: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      ok: true as const,
      refund: refundOf({ ...order, refundStatus: to, refundReference: reference || order.refundReference }, events),
    };
  });
  if (result.ok) revalidateOrders(ctx.tenantId);
  return result;
}
