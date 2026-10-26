/**
 * Ligwak — the vials left over that don't make a full kit.
 *
 * suggestLigwak walks each kit's counted orders OLDEST first (placedAt, then
 * orderNumber, then order id, then line) and fills whole kits. What doesn't fit
 * is a SUGGESTION, taken from the last-placed vials and split per vial (an
 * order of 5 straddling the last kit → 2 kept, 3 suggested). Store-added vials
 * carry their own placedAt, so they count as the newest.
 *
 * Nothing is cancelled by a suggestion. The admin decides each one —
 * "ligwak" cancels those vials, "keep" leaves them (the store absorbs the
 * partial kit) — and applyLigwakDecisions turns the decisions into per-line
 * success / cancelled quantities for the lock. A decision only applies to the
 * suggestion it was made for (same suggestQty); a changed suggestion is
 * undecided again.
 *
 * Runs on the RAW ordered quantities: an earlier lock's cancellations are
 * ignored, so an explicit Recalculate starts clean.
 */

import {
  countsTowardKits,
  indexProducts,
  kitKey,
  kitSizeForLine,
  readKitLines,
  type GbPaymentMode,
  type KitOrder,
  type KitProduct,
} from "@/lib/storefront/gb-kits";

export type LigwakEntry = {
  /** `${orderId}#${lineIndex}` — what a decision refers to. */
  id: string;
  orderId: string;
  orderNumber?: string;
  lineIndex: number;
  key: string;
  name: string;
  productId: string | null;
  variation: string | null;
  placedAt: string;
  quantity: number;
  /** Snapshot: a later product edit can't change a planned allocation. */
  kitSize: number | null;
  keepQty: number;
  suggestQty: number;
};

export type LigwakKit = {
  key: string;
  name: string;
  variation: string | null;
  kitSize: number | null;
  vials: number;
  fullKits: number;
  keepVials: number;
  ligwakVials: number;
};

/** Every counted line in walk order, plus a summary per kit. */
export type LigwakPlan = { entries: LigwakEntry[]; kits: LigwakKit[] };

export type LigwakChoice = "ligwak" | "keep";
export type LigwakDecision = { entryId: string; suggestQty: number; choice: LigwakChoice };

export type LineStatus = "pending" | "success" | "partial" | "cancelled";

export type LigwakLineResult = {
  entryId: string;
  orderId: string;
  lineIndex: number;
  key: string;
  quantity: number;
  successQty: number;
  cancelledQty: number;
  lineStatus: LineStatus;
  decision: LigwakChoice | null;
};

type Unit = Omit<LigwakEntry, "kitSize" | "keepQty" | "suggestQty">;

function orderNumberCompare(a?: string, b?: string): number {
  if (a && b) return a.localeCompare(b, undefined, { numeric: true });
  return a ? -1 : b ? 1 : 0;
}

/** Oldest first: placedAt, then orderNumber, then order id, then line. */
function compareUnits(a: Unit, b: Unit): number {
  return (
    a.placedAt.localeCompare(b.placedAt) ||
    orderNumberCompare(a.orderNumber, b.orderNumber) ||
    a.orderId.localeCompare(b.orderId) ||
    a.lineIndex - b.lineIndex
  );
}

function countedUnits(orders: readonly KitOrder[], mode: GbPaymentMode): Unit[] {
  const units: Unit[] = [];
  for (const order of orders) {
    if (!countsTowardKits(order, mode)) continue;
    for (const line of readKitLines(order.items)) {
      units.push({
        id: `${order.id}#${line.index}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        lineIndex: line.index,
        key: kitKey(line),
        name: line.name,
        productId: line.productId ?? null,
        variation: line.variation ?? null,
        placedAt: line.placedAt ?? order.placedAt,
        quantity: line.qty,
      });
    }
  }
  return units.sort(compareUnits);
}

function summarize(entries: readonly LigwakEntry[]): LigwakKit[] {
  const kits = new Map<string, LigwakKit>();
  for (const e of entries) {
    const kit = kits.get(e.key) ?? {
      key: e.key,
      name: e.name,
      variation: e.variation,
      kitSize: e.kitSize,
      vials: 0,
      fullKits: 0,
      keepVials: 0,
      ligwakVials: 0,
    };
    kits.set(e.key, {
      ...kit,
      vials: kit.vials + e.quantity,
      keepVials: kit.keepVials + e.keepQty,
      ligwakVials: kit.ligwakVials + e.suggestQty,
    });
  }
  return [...kits.values()].map((k) => ({ ...k, fullKits: k.kitSize ? Math.floor(k.vials / k.kitSize) : 0 }));
}

/** Plan which vials make whole kits and which are suggested for ligwak. */
export function suggestLigwak(
  orders: readonly KitOrder[],
  products: readonly KitProduct[],
  mode: GbPaymentMode,
): LigwakPlan {
  const index = indexProducts(products);
  const units = countedUnits(orders, mode);
  const totals = new Map<string, number>();
  for (const u of units) totals.set(u.key, (totals.get(u.key) ?? 0) + u.quantity);

  const budget = new Map<string, number>();
  const entries = units.map((u): LigwakEntry => {
    const kitSize = kitSizeForLine({ productId: u.productId ?? undefined, variation: u.variation ?? undefined }, index);
    if (!budget.has(u.key)) {
      const total = totals.get(u.key) ?? 0;
      budget.set(u.key, kitSize ? Math.floor(total / kitSize) * kitSize : Number.POSITIVE_INFINITY);
    }
    const left = budget.get(u.key) ?? 0;
    const keepQty = Math.min(u.quantity, left);
    budget.set(u.key, left - keepQty);
    return { ...u, kitSize, keepQty, suggestQty: u.quantity - keepQty };
  });
  return { entries, kits: summarize(entries) };
}

/** Just the lines with vials suggested for ligwak. */
export function ligwakSuggestions(plan: Pick<LigwakPlan, "entries">): LigwakEntry[] {
  return plan.entries.filter((e) => e.suggestQty > 0);
}

export function lineStatusFor(quantity: number, cancelledQty: number): Exclude<LineStatus, "pending"> {
  if (cancelledQty <= 0) return "success";
  return cancelledQty >= quantity ? "cancelled" : "partial";
}

/** "2 Success · 3 Cancelled", as the order list reads. */
export function lineStatusLabel(r: Pick<LigwakLineResult, "quantity" | "successQty" | "cancelledQty" | "lineStatus">): string {
  switch (r.lineStatus) {
    case "pending":
      return "Pending";
    case "success":
      return "Success";
    case "cancelled":
      return "Cancelled";
    case "partial":
      return `${r.successQty} Success · ${r.cancelledQty} Cancelled`;
  }
}

function resultFor(entry: LigwakEntry, decision: LigwakDecision | undefined): LigwakLineResult {
  const base = { entryId: entry.id, orderId: entry.orderId, lineIndex: entry.lineIndex, key: entry.key, quantity: entry.quantity };
  if (entry.suggestQty === 0) {
    return { ...base, successQty: entry.quantity, cancelledQty: 0, lineStatus: "success", decision: null };
  }
  if (!decision) {
    return { ...base, successQty: entry.quantity, cancelledQty: 0, lineStatus: "pending", decision: null };
  }
  const cancelledQty = decision.choice === "ligwak" ? entry.suggestQty : 0;
  return {
    ...base,
    successQty: entry.quantity - cancelledQty,
    cancelledQty,
    lineStatus: lineStatusFor(entry.quantity, cancelledQty),
    decision: decision.choice,
  };
}

/**
 * Apply the admin's decisions. `complete` is false while any suggestion is
 * undecided (or its decision went stale); those lines read "pending" and the
 * lock must refuse. Inputs are never mutated.
 */
export function applyLigwakDecisions(
  plan: Pick<LigwakPlan, "entries">,
  decisions: readonly LigwakDecision[],
): { lines: LigwakLineResult[]; undecided: LigwakEntry[]; complete: boolean } {
  const byId = new Map(decisions.map((d) => [d.entryId, d]));
  const undecided: LigwakEntry[] = [];
  const lines = plan.entries.map((entry) => {
    const d = byId.get(entry.id);
    const valid = d && d.suggestQty === entry.suggestQty && (d.choice === "ligwak" || d.choice === "keep");
    if (entry.suggestQty > 0 && !valid) undecided.push(entry);
    return resultFor(entry, valid ? d : undefined);
  });
  return { lines, undecided, complete: undecided.length === 0 };
}

/** Per order, per line index → vials cancelled: the shape recalculateOrder reads. */
export function cancellationsByOrder(
  lines: readonly LigwakLineResult[],
): Record<string, Record<number, { cancelledQty: number }>> {
  const out: Record<string, Record<number, { cancelledQty: number }>> = {};
  for (const l of lines) {
    if (l.cancelledQty <= 0) continue;
    out[l.orderId] = { ...out[l.orderId], [l.lineIndex]: { cancelledQty: l.cancelledQty } };
  }
  return out;
}
