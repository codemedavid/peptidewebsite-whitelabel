import "server-only";

// The payment-window sweep. Correctness never depends on it — every join and
// payment settles lapsed holds in its own transaction, and readers see a
// lapsed hold as expired — but a sweep frees slots for the waitlist (and
// tells promoted members) without waiting for the next visitor. Run per round
// from the admin queue, or for every store from the cron route.

import { withTenant } from "@/lib/db/tenant-client";
import { later } from "./context";
import { notifyMember } from "./notify";
import { findFlow, staleHoldsEverywhere } from "./repo";
import { settleSlots } from "./slots";

export async function expireStale(input: { tenantId: string; groupBuyId: string; now?: Date }): Promise<{ expired: number; promoted: number }> {
  const now = input.now ?? new Date();
  const moves = await withTenant(input.tenantId, async (db) => {
    const flow = await findFlow(db, input.groupBuyId);
    return flow ? settleSlots(db, input.tenantId, input.groupBuyId, flow.id, now) : { expired: [], promoted: [] };
  });
  for (const id of moves.promoted) later(() => notifyMember(input.tenantId, id, "promoted"));
  return { expired: moves.expired.length, promoted: moves.promoted.length };
}

/** Every round with a lapsed hold, across stores (bounded per run). */
export async function expireStaleEverywhere(now: Date = new Date(), maxRounds = 50): Promise<{ rounds: number; expired: number; promoted: number }> {
  const targets = await staleHoldsEverywhere(now, maxRounds);
  let expired = 0;
  let promoted = 0;
  for (const t of targets) {
    const r = await expireStale({ tenantId: t.tenantId, groupBuyId: t.groupBuyId, now });
    expired += r.expired;
    promoted += r.promoted;
  }
  return { rounds: targets.length, expired, promoted };
}
