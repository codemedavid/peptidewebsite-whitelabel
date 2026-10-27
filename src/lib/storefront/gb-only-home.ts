// A store that sells ONLY by group buy (the on-hand way hidden — mnm-pepsabuy)
// has one thing to show: the round. Before this, its home listed the round's
// products in the catalog AND the nav surfaced a separate "Group Buy" page with
// the same products again, so an approved member saw two shops for one round.
// Here the home simply IS the group-buy page, and the extra nav link goes.
//
// Deliberately narrow:
//   • a visitor a paid round locked out (groupBuyTeaser) keeps the join page —
//     there is nothing to list for them yet (see storefront/members-only.ts);
//   • only the layouts whose home carries the product grid (classic, two-ways).
//     Boutique / editorial / showcase are owner design choices with their own
//     catalog screen, so they keep it.
// Pure: no React, no DB (npm run test:gb-only-home).

import type { Brand } from "@/storefront/types";
import { isBoutiqueLayout, isEditorialLayout, isShowcaseLayout } from "./home-layout";
import { normalizeTwoWaysMode } from "./two-ways-mode";

type GbOnlyHomeInput = Pick<
  Brand,
  "homeLayout" | "twoWaysMode" | "groupBuyTeaser" | "groupBuyBanner" | "groupBuyListingCount"
>;

/** True when the storefront home should render the group buy itself. */
export function isGroupBuyOnlyHome(brand: GbOnlyHomeInput): boolean {
  const ways = normalizeTwoWaysMode(brand.twoWaysMode);
  if (ways.onHand !== "hidden" || ways.groupBuy === "hidden") return false;
  if (brand.groupBuyTeaser) return false;
  const layout = brand.homeLayout;
  if (isBoutiqueLayout(layout) || isEditorialLayout(layout) || isShowcaseLayout(layout)) return false;
  // Same "anything to show" test as the group-buy page's visibility rule.
  return !!brand.groupBuyBanner || (brand.groupBuyListingCount ?? 0) > 0;
}
