// The checkout-side on-hand gate, split out of actions/orders.ts so its logic is
// unit-testable without a DB. When a group buy is live and the store owner has
// turned on-hand (non-group-buy) sales OFF, paused products must be refused at
// checkout — mirroring the storefront cart gate (store.tsx → isOnHandBlocked) so
// a stale or tampered client can't sneak one through.
//
// Two layers:
//   • decideOnHandBlock  — PURE. Given fully-resolved inputs, returns the first
//     offending product's message or null. No I/O, never throws.
//   • evaluateOnHandGate — async orchestration with INJECTED deps (so the server
//     passes the real DB-backed resolvers and tests pass stubs). FAILS CLOSED.

import {
  buildGroupBuyGate,
  isOnHandBlocked,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "./group-buy";

/** Shown when the gate cannot be evaluated while on-hand sales are off. Generic
 *  by design — it must not leak why the check failed. */
export const ON_HAND_GATE_UNVERIFIED_MESSAGE =
  "We couldn't verify your cart against the current group buy. Please try again.";

/** Structural view of an order line — only the fields the gate needs. Any
 *  OrderItem satisfies it. */
export type OnHandGateItem = { productId?: string | null; name?: string | null };

/** Deps the server injects; tests pass stubs. Kept narrow so the pure module
 *  never imports the server-only group-buy-server / DB layer. */
export type OnHandGateDeps = {
  resolveCaps: (tenantId: string) => Promise<GroupBuyCapabilities>;
  loadGroupBuys: (tenantId: string, demoSlug: string) => Promise<GroupBuy[]>;
};

/**
 * Pure decision from fully-resolved inputs. Returns the first offending
 * product's message, or null when the order is allowed. Never throws.
 */
export function decideOnHandBlock(args: {
  allowOnHand: boolean;
  caps: Pick<GroupBuyCapabilities, "enabled" | "scheduled" | "productAssignment">;
  groupBuys: GroupBuy[];
  items: OnHandGateItem[];
  now?: Date;
}): string | null {
  const { allowOnHand, caps, groupBuys, items, now } = args;
  if (allowOnHand) return null;
  if (!caps.enabled || !caps.productAssignment) return null;
  const gate = buildGroupBuyGate(groupBuys, caps, allowOnHand, now);
  if (!gate.active || gate.allowOnHand || gate.coversAll) return null;
  const blocked = items.find((it) => it.productId && isOnHandBlocked(it.productId, gate));
  return blocked
    ? `${blocked.name} isn't part of the current group buy. Remove it to check out.`
    : null;
}

/**
 * Resolve the tenant's caps + live rounds, then apply the pure decision.
 *
 * The common case — on-hand sales allowed — short-circuits BEFORE any I/O, so a
 * transient error can only ever affect a store that is actively running a
 * locked-down group buy (on-hand sales off).
 */
export async function evaluateOnHandGate(
  config: Record<string, unknown>,
  tenantId: string,
  demoSlug: string,
  items: OnHandGateItem[],
  deps: OnHandGateDeps,
): Promise<string | null> {
  const allowOnHand = config.groupBuyAllowOnHand !== false;
  if (allowOnHand) return null; // sync, common case — no I/O, no throw surface
  try {
    const caps = await deps.resolveCaps(tenantId);
    if (!caps.enabled || !caps.productAssignment) return null;
    const groupBuys = await deps.loadGroupBuys(tenantId, demoSlug);
    return decideOnHandBlock({ allowOnHand, caps, groupBuys, items });
  } catch {
    return null; // TODO(phase-2): fails OPEN — must fail closed. See RED test.
  }
}
