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
  type GroupBuyStorefrontGate,
} from "./group-buy";
import {
  isGroupBuyBuyable,
  isOnHandBuyable,
  normalizeTwoWaysMode,
  WAY_BLOCK_MESSAGES,
  type TwoWaysMode,
} from "./two-ways-mode";

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
 * Pure per-way decision (./two-ways-mode). Unlike decideOnHandBlock above, this
 * is NOT scoped to a live round: a group-buy-only store refuses on-hand items
 * whether or not a round happens to be running, which is the whole point of the
 * setting. Returns the shopper-facing message for the first way that isn't
 * selling, or null. Never throws.
 *
 * An item counts as GROUP BUY when a live round covers it — the same rule the
 * storefront home uses to split the two shelves — and as ON-HAND otherwise. A
 * line with no productId (a custom/manual line) belongs to neither and is never
 * blocked here.
 */
export function decideWayBlock(args: {
  ways: TwoWaysMode;
  gate: GroupBuyStorefrontGate;
  items: OnHandGateItem[];
}): string | null {
  const { ways, gate, items } = args;
  if (isOnHandBuyable(ways) && isGroupBuyBuyable(ways)) return null;

  const inRound = (productId: string): boolean =>
    gate.active && (gate.coversAll || gate.productIds.includes(productId));

  for (const item of items) {
    if (!item.productId) continue;
    const way = inRound(item.productId) ? "groupBuy" : "onHand";
    if (ways[way] !== "open") return WAY_BLOCK_MESSAGES[way];
  }
  return null;
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
  const ways = normalizeTwoWaysMode(config.twoWaysMode);
  const waysOpen = isOnHandBuyable(ways) && isGroupBuyBuyable(ways);
  // Sync, common case — no I/O, no throw surface. Only a store that is actively
  // restricting how it sells (a paused round, or a shut way) pays for a read.
  if (allowOnHand && waysOpen) return null;
  try {
    const caps = await deps.resolveCaps(tenantId);
    // Without the module (or product assignment) there is no group buy to sell
    // through, so neither rule can be evaluated. Falling through to "allowed"
    // keeps a store that lost the entitlement shoppable instead of refusing
    // every order.
    if (!caps.enabled || !caps.productAssignment) return null;
    const groupBuys = await deps.loadGroupBuys(tenantId, demoSlug);
    // The owner's per-way setting first: it's the broader statement, and its
    // message explains the store's posture rather than naming one product.
    const wayBlock = decideWayBlock({
      ways,
      gate: buildGroupBuyGate(groupBuys, caps, allowOnHand),
      items,
    });
    if (wayBlock) return wayBlock;
    return decideOnHandBlock({ allowOnHand, caps, groupBuys, items });
  } catch {
    // FAIL CLOSED. On-hand sales are off, so a paused product must not slip
    // through just because the gate couldn't be evaluated. We only reach here
    // once allowOnHand is false, so this never walls an ordinary checkout.
    return ON_HAND_GATE_UNVERIFIED_MESSAGE;
  }
}
