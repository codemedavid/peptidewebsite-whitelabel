import "server-only";

// The Bunuan checkout cap. During Bunuan time a round sells only the vials its
// unfinished kits still need — never more. Two layers:
//
//   bunuanPrecheck   — no lock, for the quote and a fast clear error before
//                      any write (validateLiveOrder);
//   enforceBunuanCap — INSIDE the order's own insert transaction: the round row
//                      is locked (SELECT … FOR UPDATE), the claims recounted
//                      live, over-limit lines refused (the whole order rolls
//                      back). finishBunuanOrder then closes the round the
//                      moment the last kit fills.
//
// Two buyers racing for the last vials queue on the round row; the second
// recounts after the first committed and is told what's left.

import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { ACTIVE_ORDERS_WHERE } from "@/lib/orders/trash";
import { readKitLines, type KitOrder } from "@/lib/storefront/gb-kits";
import type { Order, OrderItem } from "@/storefront/types";
import { allKitsFilled, bunuanClaimsTally, clampToBunuan, type BunuanRejection } from "../core";
import { lockRound, loadKitProducts, loadRoundState, toKitOrder } from "./round-state";
import { writeStageMove } from "./stage";

/** Thrown inside the order transaction to roll it back; its message is the
 *  customer's (placeStorefrontOrderAction returns e.message). */
export class BunuanCapError extends Error {}

export type BunuanScope = { coversAll: boolean; productIds: readonly string[] } | null;

export const BUNUAN_JUST_CLOSED = "This group buy just closed, so this order can't be placed in it. Thank you for joining!";

/** The order's lines that belong to the round (and so to its kits). */
function roundLines(items: readonly OrderItem[], scope: NonNullable<BunuanScope>): OrderItem[] {
  return items.filter((i) => !!i.productId && (scope.coversAll || scope.productIds.includes(i.productId)));
}

function capMessage(rejected: readonly BunuanRejection[]): string | null {
  if (!rejected.length) return null;
  return [...rejected.map((r) => r.message), "Please update your cart and try again."].join(" ");
}

async function claimsFor(db: TenantTx, roundId: string, extraProductIds: string[]): Promise<{ orders: KitOrder[]; products: Awaited<ReturnType<typeof loadKitProducts>> }> {
  const rows = await db.storefrontOrder.findMany({
    where: { ...ACTIVE_ORDERS_WHERE, groupBuyId: roundId },
    select: { id: true, orderNumber: true, status: true, paymentStatus: true, items: true, createdAt: true },
  });
  const orders = rows.map(toKitOrder);
  return { orders, products: await loadKitProducts(db, orders, extraProductIds) };
}

/** Quote / placement pre-check (no lock). null = fine. */
export async function bunuanPrecheck(tenantId: string, p: Order, scope: BunuanScope): Promise<string | null> {
  if (!p.groupBuyId || !scope) return null;
  const roundId = p.groupBuyId;
  return withTenant(tenantId, async (db) => {
    const round = await db.groupBuy.findFirst({ where: { id: roundId }, select: { stage: true } });
    if (round?.stage !== "bunuan") return null;
    const lines = roundLines(p.items, scope);
    const { orders, products } = await claimsFor(db, roundId, lines.flatMap((l) => (l.productId ? [l.productId] : [])));
    return capMessage(clampToBunuan(lines, bunuanClaimsTally(orders, products)).rejected);
  });
}

export type BunuanHold = { roundId: string; orders: KitOrder[]; products: Awaited<ReturnType<typeof loadKitProducts>> };

/**
 * Inside the order's insert transaction, BEFORE the insert. Not Bunuan → null
 * (one cheap read). Bunuan → lock, recount, throw BunuanCapError when any line
 * is over what's left; else the hold finishBunuanOrder needs after the insert.
 */
export async function enforceBunuanCap(db: TenantTx, tenantId: string, p: Order, scope: BunuanScope): Promise<BunuanHold | null> {
  if (!p.groupBuyId || !scope) return null;
  const roundId = p.groupBuyId;
  const peek = await db.groupBuy.findFirst({ where: { id: roundId }, select: { stage: true } });
  // The order was attributed while the round took orders; if a stage move (or
  // the last kit filling) closed it since, it can't land in the closed round.
  // Stores without stages never leave "open", so this never fires for them.
  if (peek?.stage === "closed" || peek?.stage === "payment") throw new BunuanCapError(BUNUAN_JUST_CLOSED);
  if (peek?.stage !== "bunuan") return null;
  const locked = await lockRound(db, tenantId, roundId);
  // The round left Bunuan while this buyer was checking out (the last kit filled).
  if (locked?.stage !== "bunuan") throw new BunuanCapError(BUNUAN_JUST_CLOSED);
  const lines = roundLines(p.items, scope);
  const { orders, products } = await claimsFor(db, roundId, lines.flatMap((l) => (l.productId ? [l.productId] : [])));
  const message = capMessage(clampToBunuan(lines, bunuanClaimsTally(orders, products)).rejected);
  if (message) throw new BunuanCapError(message);
  return { roundId, orders, products };
}

/** After the insert, same transaction: every kit full → the round closes by itself. */
export async function finishBunuanOrder(
  db: TenantTx,
  tenantId: string,
  hold: BunuanHold,
  placed: { id: string; orderNumber: string; status: string; paymentStatus: string; items: unknown; createdAt: Date },
): Promise<boolean> {
  const orders = [...hold.orders, toKitOrder(placed)];
  const ids = new Set(hold.products.map((p) => p.id));
  const missing = readKitLines(placed.items).some((l) => l.productId && !ids.has(l.productId));
  const products = missing ? await loadKitProducts(db, orders) : hold.products;
  if (!allKitsFilled(bunuanClaimsTally(orders, products))) return false;
  const state = await loadRoundState(db, hold.roundId);
  if (!state) return false;
  await writeStageMove(db, tenantId, state, "closed", "system", {
    reason: "Every kit filled",
    data: { auto: true, lastOrderId: placed.id },
  });
  return true;
}
