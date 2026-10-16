import { effectiveGroupBuyStatus } from "@/lib/storefront/group-buy";
import type { OrderRoundFacet, OrderRoundState } from "./contract";
import { ON_HAND_ROUND } from "./contract";
import type { ShopOrderRound } from "./shop-contract";

/**
 * Group-buy rounds as the order lists show them: the admin round bar (one chip
 * per round + on-hand, with counts) and the shopper's My orders sections. Pure
 * — the callers load the GroupBuy rows and the per-round counts.
 */

export type RoundRow = {
  id: string;
  name: string;
  batchNumber: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  closedAt: Date | null;
  deliveryEta: string;
  createdAt: Date;
};

export type RoundCount = { groupBuyId: string | null; count: number; snapshotName: string | null };

const STATE_RANK: Record<OrderRoundState, number> = { live: 0, upcoming: 1, closed: 2 };
const FALLBACK_NAME = "Group buy";

/** Live = taking orders now; draft/scheduled = upcoming; everything else is over. */
export function roundState(
  row: Pick<RoundRow, "status" | "startsAt" | "endsAt">,
  scheduledEnabled: boolean,
  now = new Date(),
): OrderRoundState {
  const status = effectiveGroupBuyStatus(
    {
      status: row.status as Parameters<typeof effectiveGroupBuyStatus>[0]["status"],
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
    },
    scheduledEnabled,
    now,
  );
  if (status === "active") return "live";
  if (status === "draft" || status === "scheduled") return "upcoming";
  return "closed";
}

/** Most recent first: when it closed, else when it is due to, else when it was made. */
function recency(row: RoundRow): number {
  return (row.closedAt ?? row.endsAt ?? row.createdAt).getTime();
}

/** Live first, then upcoming, then closed — newest first within each. */
export function sortRounds<T extends RoundRow>(rows: T[], scheduledEnabled: boolean, now = new Date()): T[] {
  return [...rows].sort(
    (a, b) =>
      STATE_RANK[roundState(a, scheduledEnabled, now)] - STATE_RANK[roundState(b, scheduledEnabled, now)] ||
      recency(b) - recency(a),
  );
}

export function toShopOrderRound(row: RoundRow, scheduledEnabled: boolean, now = new Date()): ShopOrderRound {
  return {
    id: row.id,
    name: row.name.trim() || FALLBACK_NAME,
    batch: (row.batchNumber ?? "").trim(),
    state: roundState(row, scheduledEnabled, now),
    deliveryEta: row.deliveryEta.trim(),
    endsAt: row.endsAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

/**
 * The admin round bar. `counts` maps groupBuyId (null = on-hand) → orders in
 * the current view. Rounds with no orders in the view are dropped; a round
 * whose row is gone keeps its chip under the name its orders were stamped with.
 * On-hand comes last.
 */
export function roundFacets(
  counts: RoundCount[],
  rows: RoundRow[],
  scheduledEnabled: boolean,
  now = new Date(),
): OrderRoundFacet[] {
  const countOf = new Map(counts.filter((c) => c.count > 0).map((c) => [c.groupBuyId, c]));
  const known = new Set(rows.map((r) => r.id));
  const facets: OrderRoundFacet[] = sortRounds(
    rows.filter((r) => countOf.has(r.id)),
    scheduledEnabled,
    now,
  ).map((r) => ({
    key: r.id,
    name: r.name.trim() || FALLBACK_NAME,
    batch: (r.batchNumber ?? "").trim(),
    state: roundState(r, scheduledEnabled, now),
    count: countOf.get(r.id)?.count ?? 0,
  }));
  for (const c of countOf.values()) {
    if (c.groupBuyId && !known.has(c.groupBuyId)) {
      facets.push({ key: c.groupBuyId, name: c.snapshotName?.trim() || FALLBACK_NAME, batch: "", state: "closed", count: c.count });
    }
  }
  const onHand = countOf.get(null)?.count ?? 0;
  if (onHand > 0) facets.push({ key: ON_HAND_ROUND, name: "On-hand", batch: "", state: "on-hand", count: onHand });
  return facets;
}

/** A `round` query value → the order filter it means; junk is ignored. */
export function roundWhere(raw: string | null): { groupBuyId: string | null } | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 64) return null;
  return v === ON_HAND_ROUND ? { groupBuyId: null } : { groupBuyId: v };
}
