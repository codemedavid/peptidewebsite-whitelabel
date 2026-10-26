import "server-only";

// Admin edits to a customer's group-buy order: add / remove / change lines.
// Prices never come from the browser (repriceEditedLines: kept lines hold their
// snapshot price, new vials are priced from the live catalog). The round row is
// locked, so an edit and a Bunuan checkout never count the same vials twice.
// Stock moves only for an order whose stock was already deducted. Every save
// is audited and stamps storeEditedAt ("Changed by the store"). Locked at
// Payment time, and once Ligwak is locked (until Recalculate).

import type { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { repriceEditedLines, type EditedLine, type EditedOrderItem } from "@/lib/orders/gb-order-edit";
import { storedItems } from "@/lib/orders/db-mapping";
import { applyOrderStockMove } from "@/lib/orders/stock-move-tx";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { editsLocked } from "@/lib/storefront/gb-stage";
import { normalizeStatusHistory } from "@/lib/orders/db-mapping";
import { stockCurrentlyDeducted } from "@/lib/storefront/order-status";
import { dbProductToStorefront, type DbProductRow } from "@/lib/storefront/product-mapping";
import { computeOrderTotals } from "@/storefront/admin/order-detail";
import type { Order, OrderItem } from "@/storefront/types";
import type { GbEditLine, GbOrderEditResult } from "@/lib/mobile/shop-contract";
import { allKitsFilled, bunuanClaimsTally, bunuanEditWarnings, effectiveStage } from "../core";
import { audit, lockRound, loadRoundState, toKitOrder, type GbActor } from "./round-state";
import { gbFail, ID_RE, NO_STAGES, stagesOn, writeStageMove, type GbCtx } from "./stage";

const MAX_LINES = 100;

export type EditCtx = GbCtx & { productAssignment: boolean };

function parseLines(raw: unknown): EditedLine[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LINES) return null;
  const out: EditedLine[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const x = it as Record<string, unknown>;
    const index = x.index === undefined || x.index === null ? undefined : x.index;
    if (index !== undefined && typeof index !== "number") return null;
    const productId = typeof x.productId === "string" ? x.productId.slice(0, 64) : undefined;
    const variation = typeof x.variation === "string" && x.variation.trim() ? x.variation.slice(0, 80) : undefined;
    out.push({ ...(index !== undefined ? { index } : {}), ...(productId ? { productId } : {}), ...(variation ? { variation } : {}), qty: x.qty });
  }
  return out;
}

/** Mark the lines the store touched: added ones carry addedBy (from the
 *  reprice); kept-but-lowered ones get changedByStore + their original qty. */
function stampEdits(current: readonly OrderItem[], edited: readonly EditedLine[], items: readonly EditedOrderItem[]): EditedOrderItem[] {
  const refs = new Map<number, number>();
  for (const l of edited) if (typeof l.index === "number") refs.set(l.index, Number(l.qty));
  const lowered: boolean[] = [];
  const originals: number[] = [];
  current.forEach((item, i) => {
    const qty = refs.get(i) ?? 0;
    if (qty <= 0) return;
    lowered.push(qty < item.qty);
    originals.push(item.originalQty ?? item.qty);
  });
  return items.map((item, k) => {
    if (item.addedBy === "store") return { ...item, changedByStore: true };
    if (k < lowered.length && lowered[k]) return { ...item, changedByStore: true, originalQty: originals[k] };
    return item;
  });
}

/** The vials the edit takes out of / puts into stock (deducted orders only). */
function stockDeltas(current: readonly OrderItem[], edited: readonly EditedLine[], items: readonly EditedOrderItem[]) {
  const refs = new Map<number, number>();
  for (const l of edited) if (typeof l.index === "number") refs.set(l.index, Number(l.qty));
  const restock = current.flatMap((item, i) => {
    const left = Math.min(item.qty, Math.max(0, refs.get(i) ?? 0));
    return left < item.qty ? [{ ...item, qty: item.qty - left }] : [];
  });
  // repriceEditedLines returns the kept lines first, then the appended ones.
  const kept = current.filter((_, i) => (refs.get(i) ?? 0) > 0).length;
  return { restock, deduct: items.slice(kept) };
}

const editLine = (item: OrderItem, index: number): GbEditLine => ({
  index,
  name: item.name,
  productId: item.productId ?? null,
  variation: item.variation ?? null,
  qty: item.qty,
  price: item.price,
  addedByStore: item.addedBy === "store",
});

/**
 * Preview (nothing saved) or save an edited line list for one order.
 * `expectedUpdatedAt` (the updatedAt the editor loaded) makes a stale editor
 * fail with "conflict" instead of overwriting someone else's change.
 */
export async function editOrderLines(
  ctx: EditCtx,
  input: { orderId: unknown; lines: unknown; preview?: unknown; expectedUpdatedAt?: unknown },
): Promise<GbOrderEditResult & { roundClosed?: boolean; roundId?: string }> {
  if (!stagesOn(ctx.caps)) return NO_STAGES;
  const { orderId } = input;
  if (typeof orderId !== "string" || !ID_RE.test(orderId)) return gbFail("not_found", "Order not found.");
  const lines = parseLines(input.lines);
  if (!lines) return gbFail("invalid_input", `Send the order's lines (up to ${MAX_LINES}).`);
  const preview = input.preview === true;
  const expected = typeof input.expectedUpdatedAt === "string" ? input.expectedUpdatedAt : null;

  return withTenant(ctx.tenantId, async (db) => {
    const order = await db.storefrontOrder.findFirst({ where: { ...ACTIVE_ORDERS_WHERE, id: orderId } });
    if (!order) return gbFail("not_found", "Order not found.");
    if (!order.groupBuyId) return gbFail("unavailable", "Only group-buy orders can be edited here.");
    if (expected && order.updatedAt.toISOString() !== expected) {
      return gbFail("conflict", "This order changed since you opened it. Reload and try again.");
    }
    const roundId = order.groupBuyId;
    if (!preview && !(await lockRound(db, ctx.tenantId, roundId))) return gbFail("not_found", "Group buy not found.");
    const state = await loadRoundState(db, roundId);
    if (!state) return gbFail("not_found", "Group buy not found.");
    const stage = effectiveStage(state.round);
    if (editsLocked(stage, !!state.round.ligwakLockedAt)) {
      return gbFail(
        "conflict",
        stage === "payment"
          ? "Payment time has started — order lines can't change now."
          : "Ligwak is locked — press Recalculate before changing order lines.",
      );
    }

    const current = storedItems(order.items);
    const ids = new Set<string>();
    for (const l of [...current, ...lines]) if (l.productId) ids.add(l.productId);
    const rows = ids.size ? await db.product.findMany({ where: { id: { in: [...ids] } } }) : [];
    const currency = typeof state.config.currency === "string" ? state.config.currency : "";
    const catalog = rows.map((r) => dbProductToStorefront(r as unknown as DbProductRow, currency));
    const roundIds = Array.isArray(state.round.productIds) ? (state.round.productIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const coversAll = !ctx.productAssignment || roundIds.length === 0;
    const now = new Date();
    const priced = repriceEditedLines(current, lines, catalog, {
      scope: { coversAll, productIds: coversAll ? [] : roundIds },
      now: now.toISOString(),
    });
    if (!priced.ok) return gbFail("invalid_input", priced.error);

    const items = stampEdits(current, lines, priced.items);
    const others = state.kitOrders.filter((o) => o.id !== order.id);
    const claimsBefore = bunuanClaimsTally(state.kitOrders, state.products);
    const warnings = stage === "bunuan" ? bunuanEditWarnings(priced.kitDeltas, claimsBefore) : [];
    const totals = computeOrderTotals({ ...(order as unknown as Order), items, shipping: order.shipping as Order["shipping"], adminFee: (order.adminFee ?? undefined) as Order["adminFee"], paymentFee: (order.paymentFee ?? undefined) as Order["paymentFee"], discount: (order.discount ?? undefined) as Order["discount"], adjustedTotal: undefined, gbTotals: undefined });
    const base = {
      ok: true as const,
      orderId: order.id,
      lines: items.map(editLine),
      changes: priced.changes,
      warnings,
      subtotal: totals.subtotal,
      total: totals.total,
    };
    if (preview || priced.changes.length === 0) {
      return { ...base, saved: false, updatedAt: order.updatedAt.toISOString() };
    }

    const written = await db.storefrontOrder.updateMany({
      where: { ...ACTIVE_ORDERS_WHERE, id: order.id, updatedAt: order.updatedAt },
      data: { items: items as unknown as Prisma.InputJsonValue, storeEditedAt: now },
    });
    if (written.count === 0) return gbFail("conflict", "This order changed since you opened it. Reload and try again.");
    if (!order.imported && stockCurrentlyDeducted(normalizeStatusHistory(order.statusHistory))) {
      const { restock, deduct } = stockDeltas(current, lines, items);
      if (restock.length) await applyOrderStockMove(db, restock, "restock");
      if (deduct.length) await applyOrderStockMove(db, deduct, "deduct");
    }
    await audit(db, ctx.tenantId, {
      groupBuyId: roundId,
      orderId: order.id,
      kind: "order_edit",
      actor: ctx.actor,
      data: { changes: priced.changes, warnings, stage, total: totals.total },
    });
    // An edit that fills the last kit ends Bunuan, exactly like a checkout would.
    let roundClosed = false;
    if (stage === "bunuan") {
      const after = [...others, toKitOrder({ ...order, items })];
      if (allKitsFilled(bunuanClaimsTally(after, state.products))) {
        await writeStageMove(db, ctx.tenantId, state, "closed", "system" as GbActor, {
          reason: "Every kit filled",
          data: { auto: true, lastOrderId: order.id, byEdit: true },
        });
        roundClosed = true;
      }
    }
    const fresh = await db.storefrontOrder.findFirst({ where: { id: order.id }, select: { updatedAt: true } });
    return { ...base, saved: true, updatedAt: (fresh?.updatedAt ?? now).toISOString(), roundClosed, roundId };
  });
}
