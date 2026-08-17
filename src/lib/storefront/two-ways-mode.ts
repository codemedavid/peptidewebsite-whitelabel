// PER-WAY management for the "two ways to order" storefront.
//
// The two-ways home (./two-ways-home) assumes a store sells both ways: an
// on-hand shelf that ships now, and a group buy that ships after the round
// closes. Some tenants sell only one — Dragon Peptides runs group buys only —
// and the pre-existing owner control (branding.config.groupBuyAllowOnHand,
// ./on-hand-gate) can't express that: it pauses on-hand ONLY while a round is
// live, and never touches the group-buy side at all.
//
// So each way carries its own state, stored in branding.config.twoWaysMode:
//
//   "open"    — today's behaviour: shown and buyable.
//   "closed"  — SHOWN, marked closed, nothing addable to cart or checkoutable.
//               For a seasonal pause the shopper should still see explained.
//   "hidden"  — the section is gone. The storefront reads as a one-way store
//               and stops calling itself "two ways to order".
//
// Closed and hidden differ only in PRESENTATION — both are unbuyable, and both
// produce the same shopper-facing message, so a hidden way can never be reached
// by a stale client and quietly succeed.
//
// The stored value is untrusted JSON, so normalizeTwoWaysMode fails SAFE: any
// shape it doesn't recognise resolves to both-ways-open, which is exactly the
// storefront every existing tenant has today. It also refuses the one state
// that would break a store outright — both ways hidden leaves nothing to buy.
//
// Pure + JSON-safe (no React, no DB) so the storefront cart and the server
// checkout share one contract — the same pattern as ./two-ways-cart and
// ./on-hand-gate. Covered by npm run test:two-ways-mode.

/** What a single order path is doing right now. */
export type WayState = "open" | "closed" | "hidden";

/** The two order paths, each with its own state. */
export type TwoWaysMode = { onHand: WayState; groupBuy: WayState };

/** Which order path a rule is talking about. */
export type WayKey = keyof TwoWaysMode;

/** Both ways open — today's storefront, and the fallback for anything the
 *  normalizer doesn't recognise. */
export const TWO_WAYS_MODE_DEFAULT: TwoWaysMode = { onHand: "open", groupBuy: "open" };

/** Shopper-facing copy for an add/checkout refused because its way isn't
 *  selling. Deliberately says nothing about closed-vs-hidden: a hidden way
 *  doesn't exist as far as the storefront is concerned. */
export const WAY_BLOCK_MESSAGES: Record<WayKey, string> = {
  onHand:
    "On-hand orders are paused right now — only the group buy is open. Please remove these items to check out.",
  groupBuy:
    "The group buy isn't taking orders right now. Please remove these items to check out.",
} as const;

const WAY_STATES: readonly WayState[] = ["open", "closed", "hidden"];

/** Coerce one untrusted way value. Anything unrecognised reads as "open" — the
 *  storefront must never hide or close a way because of a typo. */
function normalizeWayState(value: unknown): WayState {
  return WAY_STATES.includes(value as WayState) ? (value as WayState) : "open";
}

/**
 * Coerce the untrusted branding.config.twoWaysMode into a usable mode. Absent,
 * junk, or partially-written config leaves the ways OPEN, so a tenant that has
 * never touched the setting keeps exactly the storefront it has today.
 *
 * Hiding both ways is the one combination that is refused: it would render a
 * store with nothing to buy and no explanation. Closing both is allowed — that
 * store is visibly paused, which is a real thing an owner may want.
 *
 * Always returns a NEW object; the input is never mutated.
 */
export function normalizeTwoWaysMode(value: unknown): TwoWaysMode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...TWO_WAYS_MODE_DEFAULT };
  }
  const raw = value as Record<string, unknown>;
  const mode: TwoWaysMode = {
    onHand: normalizeWayState(raw.onHand),
    groupBuy: normalizeWayState(raw.groupBuy),
  };
  if (mode.onHand === "hidden" && mode.groupBuy === "hidden") {
    return { ...TWO_WAYS_MODE_DEFAULT };
  }
  return mode;
}

/** The live-round facts the resolution folds in. */
export type WaysContext = {
  /** branding.config.groupBuyAllowOnHand — the pre-existing owner toggle. */
  allowOnHand: boolean;
  /** Is a group-buy round live right now? */
  roundLive: boolean;
};

/**
 * The EFFECTIVE state of each way: the owner's setting, plus the pre-existing
 * live-round rule (on-hand paused while a round runs). That rule can only ever
 * tighten — it closes an open on-hand way, and never re-opens one the owner
 * closed or hid.
 *
 * One resolver so the storefront, the cart, and the server checkout can't
 * disagree about what is buyable. The input mode is never mutated.
 */
export function resolveWays(mode: TwoWaysMode, ctx: WaysContext): TwoWaysMode {
  const base = normalizeTwoWaysMode(mode);
  const pausedByRound = ctx.roundLive && !ctx.allowOnHand && base.onHand === "open";
  return pausedByRound ? { ...base, onHand: "closed" } : base;
}

/** Can shoppers add on-hand products to the cart and check them out? */
export function isOnHandBuyable(ways: TwoWaysMode): boolean {
  return ways.onHand === "open";
}

/** Can shoppers join the group buy? */
export function isGroupBuyBuyable(ways: TwoWaysMode): boolean {
  return ways.groupBuy === "open";
}

/** Why an add/checkout on this way is refused, or null when it's selling.
 *  Both callers (cart + server) use this so the shopper sees one message. */
export function wayBlockMessage(way: WayKey, ways: TwoWaysMode): string | null {
  return ways[way] === "open" ? null : WAY_BLOCK_MESSAGES[way];
}

// ── The two owner-facing controls ────────────────────────────────────────────
// The store admin presents each way as TWO switches, because that is how an
// owner thinks about it:
//
//   Visibility    Visible / Hidden
//   Accept orders Enabled / Disabled
//
// Both are PROJECTIONS of the single WayState above, never a second stored
// field. A standalone "accept orders" boolean would make "hidden but accepting
// orders" representable — a state with no meaning — and would give the
// storefront two things to consult that could disagree. One state, two views of
// it, so they cannot drift.
//
//   open   = Visible + Enabled
//   closed = Visible + Disabled
//   hidden = Hidden  (the Accept Orders switch is moot, and is disabled in the UI)

/** Does this way appear on the storefront at all? */
export function wayIsVisible(state: WayState): boolean {
  return state !== "hidden";
}

/** Can shoppers actually order through this way? */
export function wayAcceptsOrders(state: WayState): boolean {
  return state === "open";
}

/**
 * Apply the Visibility switch. Hiding is one click from anywhere; un-hiding
 * lands on "open", the plain reading of "make it visible" (the owner can then
 * turn ordering off, which is a second, deliberate click).
 *
 * Flipping it ON for a way that is ALREADY visible is a no-op, so an owner who
 * has set up "visible but not accepting orders" can't have the shop silently
 * re-opened by the other control.
 */
export function setWayVisible(state: WayState, visible: boolean): WayState {
  if (!visible) return "hidden";
  return state === "hidden" ? "open" : state;
}

/**
 * Apply the Accept Orders switch. Moves between open and closed and NEVER
 * touches visibility — a hidden way stays hidden, so this control can't
 * accidentally put a removed order path back on the storefront. Making it
 * visible again is the other switch's job.
 */
export function setWayAcceptOrders(state: WayState, accept: boolean): WayState {
  if (state === "hidden") return "hidden";
  return accept ? "open" : "closed";
}

/** How many order paths the page actually shows. A CLOSED way still counts —
 *  it renders, marked closed. Only "hidden" drops out. */
export function visibleWayCount(ways: TwoWaysMode): number {
  return (ways.onHand === "hidden" ? 0 : 1) + (ways.groupBuy === "hidden" ? 0 : 1);
}

/** The heading above the ways split. A one-way store must never claim two. */
export function waysHeading(ways: TwoWaysMode): string {
  return visibleWayCount(ways) > 1 ? "Two ways to order" : "How to order";
}
