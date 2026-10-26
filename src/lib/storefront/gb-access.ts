/**
 * Group-buy access on the storefront — who may see a GATED round, and what a
 * locked viewer's storefront contains. Pure (no DB, no React). Whether a round
 * is gated, and whether a viewer is in, is decided by Paid Access
 * (src/modules/paid-access — the round's entry flow); this file only applies that
 * answer to the catalog (server side: gb-access.server.ts). GB pages never
 * read Paid Access's tables.
 *
 *   a round is LOCKED for a viewer when Paid Access says it is gated and the viewer
 *   is neither a store admin nor an active member (canAccess).
 *
 * A locked viewer's catalog is built so View Source shows nothing of the round:
 * every gb listing is removed, every gbPrice (product and variation) is
 * stripped, and while the round is LIVE its assigned products — or, for a round
 * with no assignment, the whole catalog — are removed too. In their place the
 * brand carries a GroupBuyTeaser: name, dates, the way in, and (when the
 * round's visibility is "summary") a short summary.
 *
 * Gate: npm run test:gb-access (pure) + test:gb-access-flow (wired, PGlite).
 */

import type { Product } from "@/storefront/types";
import type { ShopGroupBuyTeaser, ShopGroupBuyTeaserCopy } from "@/lib/mobile/shop-contract";
import { effectiveGroupBuyStatus, liveGroupBuys, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { isGroupBuyProduct } from "./two-ways";

/** Who is looking. Admins (owner/staff) always see the round — they price it. */
export type GroupBuyViewer =
  | { kind: "admin" }
  | { kind: "customer"; customerId: string }
  | { kind: "anonymous" };

export const ANONYMOUS_VIEWER: GroupBuyViewer = { kind: "anonymous" };

type Caps = Pick<GroupBuyCapabilities, "scheduled" | "productAssignment">;

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

/** Paid Access's answer applied: is this viewer locked out of the round? Admins
 *  (owner/staff) always see it — they price it. */
export function isGroupBuyLocked(input: { gated: boolean; viewer: GroupBuyViewer; canAccess: boolean }): boolean {
  if (!input.gated) return false;
  if (input.viewer.kind === "admin") return false;
  return !input.canAccess;
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

export type GroupBuyTeaser = ShopGroupBuyTeaser;

export type TeaserInput = {
  visibility: "nothing" | "summary";
  /** The way in, e.g. ["Pay ₱500", "Admin approval", "Access"]. */
  steps: string[];
  joinFeeCents: number;
  amountLabel: string;
  /** How many of the round's listings the viewer can't see (summary only). */
  productCount: number;
  maxSlots: number | null;
  slotsTaken: number;
  /** The viewer's own membership; null = none (or anonymous). */
  membership: { status: string; reviewReason: string; headline: string } | null;
  /** The store's join-page words (absent = built-in). */
  copy?: ShopGroupBuyTeaserCopy;
};

/** What a locked viewer is told about the round — never products or prices. */
export function buildGroupBuyTeaser(round: GroupBuy, caps: Pick<Caps, "scheduled">, input: TeaserInput, now: Date = new Date()): GroupBuyTeaser {
  const status = effectiveGroupBuyStatus(round, caps.scheduled, now);
  return {
    id: round.id,
    name: round.name,
    startsAt: round.startsAt,
    endsAt: round.endsAt,
    state: status === "active" ? "live" : status === "scheduled" ? "upcoming" : "closed",
    visibility: input.visibility,
    summary:
      input.visibility === "summary"
        ? { description: round.description, deliveryEta: round.deliveryEta, productCount: input.productCount, maxSlots: input.maxSlots, slotsTaken: input.slotsTaken }
        : null,
    steps: input.steps,
    joinFeeCents: input.joinFeeCents,
    amountLabel: input.amountLabel,
    membership: input.membership,
    ...(input.copy ? { copy: { intro: input.copy.intro, button: input.copy.button, note: input.copy.note } } : {}),
  };
}
