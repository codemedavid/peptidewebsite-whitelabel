// Assignment drift: does a round's product assignment still match what people
// are actually buying? Pure — no I/O — so the dashboard, the one-click fix and
// the tests all share one definition.
//
// WHY THIS EXISTS (k-glow, 2026-07-30)
// The "july 28" round assigned 5 products. Customers ordered 3 entirely
// different ones. With zero overlap, groupBuyForOrder() stamped groupBuyId =
// NULL on every order, and those buyers also missed group-buy pricing at
// checkout — silently, because the admin looked correct: the round listed five
// perfectly valid products.
//
// The mechanical cause was duplicate catalog rows. The round held an OLD
// "Tirzepatide" id (stock 0) while customers bought a NEWER row with the SAME
// NAME and a different id. No amount of staring at the assignment list reveals
// that — the two are indistinguishable by eye.
//
// So drift is detected from BEHAVIOUR (what is being ordered), never from the
// assignment alone. That is the only signal that survives duplicate names.

import { orderCountsAsDemand } from "./group-buy";
import type { LinkableOrder } from "./group-buy-orders";

/** The round fields the drift check needs — a slice of GroupBuy. */
export type DriftRound = {
  id: string;
  name: string;
  productIds: string[];
};

export type DriftProduct = {
  productId: string;
  /** Taken from the order line, so a renamed or duplicated product still reads
   *  as the customer saw it. */
  name: string;
  vials: number;
  orders: number;
};

export type AssignmentDrift = {
  /** True when productIds is empty: the round covers everything, so it cannot
   *  drift. Reported so the UI can say "whole catalog" rather than "no problems". */
  coversWholeCatalog: boolean;
  /** Products customers ordered that this round does NOT cover. The actionable
   *  list — these are the orders losing attribution and group-buy pricing. */
  orderedUnassigned: DriftProduct[];
  /** Assigned products with no demand yet. Informational, NOT a problem: a round
   *  may legitimately list something nobody has bought. */
  assignedUnsold: DriftProduct[];
  /** Assigned ids with no product row left — deleted products still referenced. */
  danglingAssignments: string[];
  /** Whether the owner needs to act. Deliberately excludes assignedUnsold. */
  hasDrift: boolean;
};

/**
 * Compare a round's assignment against the orders it actually received.
 *
 * @param round      the round being checked
 * @param orders     orders already resolved for this round (resolveRoundOrders)
 * @param catalogIds product ids that still exist. An EMPTY set is treated as
 *                   "unknown", never as "everything is deleted" — a failed or
 *                   skipped product lookup must not mass-flag every assignment.
 */
export function detectAssignmentDrift(
  round: DriftRound,
  orders: LinkableOrder[],
  catalogIds: ReadonlySet<string>,
): AssignmentDrift {
  const assigned = new Set(round.productIds);

  // An unassigned round covers the whole catalog — every ordered product is
  // already included, so flagging any of them would be a permanent false alarm.
  if (assigned.size === 0) {
    return {
      coversWholeCatalog: true,
      orderedUnassigned: [],
      assignedUnsold: [],
      danglingAssignments: [],
      hasDrift: false,
    };
  }

  // Demand only. A cancelled order is not evidence that a product belongs in the
  // round, and its vials must never inflate the counts — the same rule the rest
  // of the module applies to every total.
  const demand = new Map<string, DriftProduct>();
  for (const o of orders) {
    if (!orderCountsAsDemand(o.status)) continue;
    const seenInThisOrder = new Set<string>();
    for (const it of o.items ?? []) {
      // Legacy lines predate productIds. They cannot be assigned to anything, so
      // reporting them would give the owner a row they can't act on.
      if (!it.productId) continue;
      const row = demand.get(it.productId) ?? {
        productId: it.productId,
        name: it.name,
        vials: 0,
        orders: 0,
      };
      row.vials += it.qty;
      if (!seenInThisOrder.has(it.productId)) {
        seenInThisOrder.add(it.productId); // one order, not one per line
        row.orders += 1;
      }
      demand.set(it.productId, row);
    }
  }

  const orderedUnassigned = [...demand.values()]
    .filter((p) => !assigned.has(p.productId))
    .sort((a, b) => b.vials - a.vials || a.name.localeCompare(b.name));

  const danglingAssignments =
    catalogIds.size === 0 ? [] : round.productIds.filter((id) => !catalogIds.has(id));
  const dangling = new Set(danglingAssignments);

  // A dead id is already reported as dangling; listing it again as "unsold"
  // would present one problem as two.
  const assignedUnsold = round.productIds
    .filter((id) => !dangling.has(id) && !demand.has(id))
    .map((id) => ({ productId: id, name: id, vials: 0, orders: 0 }));

  return {
    coversWholeCatalog: false,
    orderedUnassigned,
    assignedUnsold,
    danglingAssignments,
    // assignedUnsold is deliberately NOT drift — a round listing something
    // nobody bought yet is normal, and warning about it would train the owner
    // to ignore the banner that matters.
    hasDrift: orderedUnassigned.length > 0 || danglingAssignments.length > 0,
  };
}

/**
 * The productIds to save when the owner clicks "add the ordered products":
 * everything currently assigned, minus dead ids, plus what customers actually
 * bought. Existing assignments are kept — the owner chose them, and a round may
 * cover stock that simply hasn't sold yet.
 *
 * Never returns an empty array for a round that had an assignment: empty means
 * "whole catalog", so collapsing to it would widen a targeted round to the
 * entire shop and change storefront pricing for every product.
 */
export function productsToAssign(round: DriftRound, drift: AssignmentDrift): string[] {
  if (drift.coversWholeCatalog) return [];
  const dead = new Set(drift.danglingAssignments);
  const next = new Set(round.productIds.filter((id) => !dead.has(id)));
  for (const p of drift.orderedUnassigned) next.add(p.productId);
  // Every id was dead and nothing has been ordered: keep the round as-is rather
  // than silently converting it into a whole-catalog round.
  if (next.size === 0) return [...round.productIds];
  return [...next];
}
