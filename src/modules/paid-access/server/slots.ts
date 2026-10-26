import "server-only";

// Slots: the payment-window sweep and waitlist promotion. Both run INSIDE the
// caller's transaction, after lockFlow(), so every slot decision on a round is
// serialised on its flow row and reads a fresh counter. The counter itself is
// moved only by the DB trigger (sql/paid-access.sql) as statuses change.

import type { TenantTx } from "@/lib/db/tenant-client";
import { firstStatus } from "../core/machine";
import type { PaidAccessSettings, PaidAccessStatus } from "../core/types";
import { lockFlow, logEvents, moveMembership, readSettings, staleHolds, waitlisted, type EventInput } from "./repo";

/** Per transaction, to stay well inside the round-trip budget. */
const MAX_MOVES_PER_TX = 25;
const MINUTE = 60_000;

/** The payment deadline for a member entering `status` under `snapshot`. */
export function holdFor(snapshot: Pick<PaidAccessSettings, "payment">, status: PaidAccessStatus, now: Date): Date | null {
  const w = snapshot.payment.windowMinutes;
  return status === "payment_pending" && w ? new Date(now.getTime() + w * MINUTE) : null;
}

/** Is this payment step past its deadline (whether or not the sweep ran yet)? */
export function holdLapsed(m: { status: string; holdExpiresAt: Date | null }, now: Date): boolean {
  return m.status === "payment_pending" && !!m.holdExpiresAt && m.holdExpiresAt.getTime() < now.getTime();
}

export type SlotMoves = { expired: string[]; promoted: string[] };

/** Expire lapsed holds on the (already locked) flow. */
async function expireLapsed(db: TenantTx, groupBuyId: string, flowId: string, now: Date, events: EventInput[]): Promise<string[]> {
  const expired: string[] = [];
  for (const m of (await staleHolds(db, flowId, now)).slice(0, MAX_MOVES_PER_TX)) {
    if (await moveMembership(db, m.id, "payment_pending", { status: "expired", holdExpiresAt: null })) {
      expired.push(m.id);
      events.push({
        groupBuyId,
        membershipId: m.id,
        kind: "transition",
        fromStatus: "payment_pending",
        toStatus: "expired",
        actorKind: "system",
        actorId: "system",
        reason: "Payment window expired",
      });
    }
  }
  return expired;
}

/** Move the oldest waitlisters into free slots (on the already locked flow). */
async function promote(db: TenantTx, groupBuyId: string, flowId: string, now: Date, events: EventInput[]): Promise<string[]> {
  const { slotsTaken, maxSlots } = await lockFlow(db, flowId);
  const free = maxSlots === null ? MAX_MOVES_PER_TX : Math.min(MAX_MOVES_PER_TX, maxSlots - slotsTaken);
  if (free <= 0) return [];
  const promoted: string[] = [];
  for (const m of await waitlisted(db, flowId, free)) {
    const snapshot = readSettings(m.settingsSnapshot);
    const to = firstStatus(snapshot.steps);
    if (await moveMembership(db, m.id, "waitlisted", { status: to, holdExpiresAt: holdFor(snapshot, to, now) })) {
      promoted.push(m.id);
      events.push({
        groupBuyId,
        membershipId: m.id,
        kind: "transition",
        fromStatus: "waitlisted",
        toStatus: to,
        actorKind: "system",
        actorId: "system",
        reason: "A slot opened",
      });
    }
  }
  return promoted;
}

/**
 * Lock the flow, release lapsed holds, then fill free slots from the waitlist
 * — waitlisters always go before anyone joining now. Call at the start of any
 * transaction that claims a slot, and after any that frees one.
 */
export async function settleSlots(db: TenantTx, tenantId: string, groupBuyId: string, flowId: string, now: Date): Promise<SlotMoves> {
  await lockFlow(db, flowId);
  const events: EventInput[] = [];
  const expired = await expireLapsed(db, groupBuyId, flowId, now, events);
  const promoted = await promote(db, groupBuyId, flowId, now, events);
  await logEvents(db, tenantId, events);
  return { expired, promoted };
}
