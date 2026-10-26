/**
 * Paid group-buy access — who may see a paid round, and what a LOCKED viewer's
 * storefront contains. Pure (no DB, no React): the storefront loader, the
 * public price refresh, the app catalog, the chat card and checkout all ask
 * these same questions (server side: gb-access.server.ts).
 *
 * The rule (lib/storefront/gb-membership.ts owns the lifecycle):
 *   a round is LOCKED for a viewer when the store holds groupbuy.paid_access,
 *   the round has paid join on with a positive fee, and the viewer is neither a
 *   store admin nor the holder of an APPROVED membership for that round.
 *
 * A locked viewer's catalog is built so View Source shows nothing of the round:
 * every gb listing is removed, every gbPrice (product and variation) is
 * stripped, and while the round is LIVE its assigned products — or, for a round
 * with no assignment, the whole catalog — are removed too. In their place the
 * brand carries a GroupBuyTeaser: name, dates, fee, and the viewer's own request.
 *
 * Gate: npm run test:gb-access (pure) + test:gb-access-flow (wired, PGlite).
 */

import type { Product } from "@/storefront/types";
import { effectiveGroupBuyStatus, liveGroupBuys, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { hasGroupBuyAccess } from "./gb-membership";
import { isGroupBuyProduct } from "./two-ways";

/** Who is looking. Admins (owner/staff) always see the round — they price it. */
export type GroupBuyViewer =
  | { kind: "admin" }
  | { kind: "customer"; customerId: string }
  | { kind: "anonymous" };

export const ANONYMOUS_VIEWER: GroupBuyViewer = { kind: "anonymous" };

type Caps = Pick<GroupBuyCapabilities, "enabled" | "scheduled" | "productAssignment" | "paidAccess">;

const closedAtOf = (gb: GroupBuy) => gb.closedAt ?? gb.endsAt ?? gb.updatedAt;

/**
 * The round whose access rules apply to the storefront right now: the live
 * round; else the soonest upcoming one; else the most recently closed one —
 * its view-only group-buy page still lists the round's prices.
 */
export function governingGroupBuy(list: readonly GroupBuy[], caps: Pick<Caps, "scheduled">, now: Date = new Date()): GroupBuy | null {
  const live = liveGroupBuys([...list], caps, now)[0];
  if (live) return live;
  const t = now.getTime();
  const upcoming = list
    .filter((gb) => effectiveGroupBuyStatus(gb, caps.scheduled, now) === "scheduled" && gb.startsAt && new Date(gb.startsAt).getTime() > t)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
  if (upcoming[0]) return upcoming[0];
  const closed = list
    .filter((gb) => effectiveGroupBuyStatus(gb, caps.scheduled, now) === "closed")
    .sort((a, b) => closedAtOf(b).localeCompare(closedAtOf(a)));
  return closed[0] ?? null;
}

/** Does this round sit behind paid join at all? Revoking the feature reopens it. */
export function requiresPaidJoin(
  gb: Pick<GroupBuy, "paidJoin" | "joinFeeCents"> | null | undefined,
  caps: Pick<Caps, "enabled" | "paidAccess">,
): boolean {
  return !!gb && caps.enabled && caps.paidAccess && gb.paidJoin === true && (gb.joinFeeCents ?? 0) > 0;
}

export function isGroupBuyLocked(input: {
  round: Pick<GroupBuy, "paidJoin" | "joinFeeCents"> | null | undefined;
  caps: Pick<Caps, "enabled" | "paidAccess">;
  viewer: GroupBuyViewer;
  /** The viewer's latest membership status for THIS round (null = none). */
  membershipStatus: string | null | undefined;
}): boolean {
  if (!requiresPaidJoin(input.round, input.caps)) return false;
  if (input.viewer.kind === "admin") return false;
  if (input.viewer.kind !== "customer") return true;
  return !hasGroupBuyAccess(input.membershipStatus);
}

function withoutGbPrices(p: Product): Product {
  const hasVariationGb = p.variations?.some((v) => "gbPrice" in v) ?? false;
  if (!("gbPrice" in p) && !hasVariationGb) return p;
  const { gbPrice: _drop, ...rest } = p;
  void _drop;
  if (!hasVariationGb) return rest;
  return {
    ...rest,
    variations: p.variations!.map((v) => {
      if (!("gbPrice" in v)) return v;
      const { gbPrice: _v, ...keep } = v;
      void _v;
      return keep;
    }),
  };
}

/** The catalog a locked viewer may receive. Immutable — inputs are untouched. */
export function lockGroupBuyCatalog(
  products: readonly Product[],
  round: Pick<GroupBuy, "status" | "startsAt" | "endsAt" | "productIds">,
  caps: Pick<Caps, "scheduled" | "productAssignment">,
  now: Date = new Date(),
): Product[] {
  const live = effectiveGroupBuyStatus(round, caps.scheduled, now) === "active";
  const coversAll = !caps.productAssignment || round.productIds.length === 0;
  if (live && coversAll) return [];
  const scope = new Set(live ? round.productIds : []);
  return products.filter((p) => !isGroupBuyProduct(p) && !scope.has(p.id)).map(withoutGbPrices);
}

export type GroupBuyTeaser = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  state: "upcoming" | "live" | "closed";
  /** Centavos — the server's price, the only one the join flow charges. */
  joinFeeCents: number;
  /** The viewer's own latest request on this round; null = none (or anonymous). */
  membership: { status: string; reviewReason: string } | null;
};

/** What a locked viewer is told about the round — no products, prices or copy. */
export function buildGroupBuyTeaser(
  round: GroupBuy,
  caps: Pick<Caps, "scheduled">,
  membership: { status: string; reviewReason: string } | null,
  now: Date = new Date(),
): GroupBuyTeaser {
  const status = effectiveGroupBuyStatus(round, caps.scheduled, now);
  return {
    id: round.id,
    name: round.name,
    startsAt: round.startsAt,
    endsAt: round.endsAt,
    state: status === "active" ? "live" : status === "scheduled" ? "upcoming" : "closed",
    joinFeeCents: round.joinFeeCents ?? 0,
    membership: membership ? { status: membership.status, reviewReason: membership.reviewReason } : null,
  };
}
