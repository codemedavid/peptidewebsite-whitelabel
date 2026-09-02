// Batched inventory movement for order status changes — the DB half.
//
// The pure half lives in ./inventory (applyStockMovesToProducts). This module
// is the thin persistence wrapper around it, and its whole reason for existing
// is the ROUND-TRIP BUDGET.
//
// Every tenant DB call in this app runs inside a withTenant() interactive
// transaction over Supabase's PgBouncer pooler, where a round trip costs on the
// order of 100-300ms and the transaction has a hard 20s budget. The previous
// per-order/per-line-item loop cost 2 round trips PER LINE ITEM, so a bulk
// status change over ~17 orders overran the budget and Prisma aborted the whole
// transaction with P2028 ("Transaction not found…"). See
// scripts/test-bulk-status-batching.ts, which fails if this regresses.
//
// The shape here is fixed: ONE read for every product involved, then at most
// ONE write per product whose stock actually changed — independent of how many
// orders or line items produced those changes.

import type { OrderItem } from "@/storefront/types";
import { applyStockMovesToProducts, type StockMoveEntry } from "./inventory";
import type { Variation } from "./variations";

export type { StockMoveEntry };

/** The product columns the stock rules read. Deliberately narrow so the caller
 *  can `select` exactly these and nothing else. */
export type StockProductRow = {
  id: string;
  name: string;
  stock: number | null;
  metadata: unknown;
};

/** The patch written back — only the field that actually moved. A tracked
 *  variation moves inside `metadata`; everything else moves the base column. */
export type StockProductPatch = {
  stock?: number;
  metadata?: Record<string, unknown>;
};

/**
 * The narrow DB surface this needs, as an interface rather than a Prisma client.
 * Two reasons: the transaction client's types don't have to leak into the lib,
 * and a test can substitute a fake that COUNTS round trips — which is the actual
 * regression guard for the P2028 timeout.
 */
export type StockMoveDb = {
  findProducts(where: { ids: string[]; names: string[] }): Promise<StockProductRow[]>;
  updateProduct(id: string, data: StockProductPatch): Promise<void>;
};

/** Pull the variations array out of an untrusted metadata blob. */
function readVariations(metadata: unknown): Variation[] | undefined {
  const meta = (metadata ?? {}) as { variations?: unknown };
  return Array.isArray(meta.variations) ? (meta.variations as Variation[]) : undefined;
}

/** The made-to-order flag out of the same blob. It has to reach the pure engine
 *  or applyStockMovesToProducts would deduct from a product that holds no
 *  inventory — writing a row on every confirm to clamp the same 0 back to 0. */
function readMadeToOrder(metadata: unknown): boolean {
  return ((metadata ?? {}) as { madeToOrder?: unknown }).madeToOrder === true;
}

/** Every product key the moves refer to: ids when the line carries one (the
 *  modern path), exact names for legacy orders placed before productId existed. */
function referencedKeys(moves: readonly StockMoveEntry[]): { ids: string[]; names: string[] } {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const { items } of moves) {
    for (const it of items as readonly OrderItem[]) {
      if (it.productId) ids.add(it.productId);
      else if (it.name) names.add(it.name);
    }
  }
  return { ids: [...ids], names: [...names] };
}

/**
 * Apply many orders' stock movements in one batch.
 *
 * Costs 1 read + (number of products whose stock genuinely changed) writes.
 * Returns how many products were written, so the caller knows whether to
 * revalidate the cached storefront.
 *
 * Netting note: deltas from every order are summed BEFORE the zero clamp, so a
 * deduct and a matching restock in the same batch cancel out exactly instead of
 * clamping to zero in between and inventing units on the way back up.
 */
export async function applyOrderStockMovesBatched(
  db: StockMoveDb,
  moves: readonly StockMoveEntry[],
): Promise<number> {
  if (moves.length === 0) return 0;

  const keys = referencedKeys(moves);
  // Nothing identifiable to move — don't spend a round trip finding that out.
  if (keys.ids.length === 0 && keys.names.length === 0) return 0;

  const rows = await db.findProducts(keys);
  if (rows.length === 0) return 0;

  const before = rows.map((r) => ({
    id: r.id,
    name: r.name,
    stock: r.stock,
    variations: readVariations(r.metadata),
    madeToOrder: readMadeToOrder(r.metadata),
  }));
  const after = applyStockMovesToProducts(before, moves);

  let written = 0;
  for (let i = 0; i < before.length; i++) {
    const prev = before[i];
    const next = after[i];
    const patch: StockProductPatch = {};

    if ((next.stock ?? 0) !== (prev.stock ?? 0)) patch.stock = next.stock ?? 0;
    if (next.variations !== prev.variations) {
      const meta = (rows[i].metadata ?? {}) as Record<string, unknown>;
      patch.metadata = { ...meta, variations: next.variations };
    }

    if (patch.stock === undefined && patch.metadata === undefined) continue;
    await db.updateProduct(prev.id, patch);
    written++;
  }
  return written;
}
