// The storefront's primary navigation, assembled once.
//
// The owner's stored nav (branding.config) is only half the answer: three pages
// are surfaced AUTOMATICALLY when they're available, and any link pointing at a
// page the owner (or the operator) switched off has to disappear. That logic
// used to live inline in <Header>, which was fine while the header was the only
// nav surface. It isn't any more — the editorial layout renders a sidebar rail
// — and a second surface re-implementing this could only drift: one nav showing
// Group Buy while the other doesn't is the exact bug this prevents.
//
// Pure and side-effect free: the brand's own nav array is never mutated.

import type { Brand, NavItem } from "@/storefront/types";
import { isLinkHidden, isPageVisible } from "@/storefront/visibility";
import { isGroupBuyOnlyHome } from "./gb-only-home";

/**
 * The links a nav surface should render, in order.
 *
 * Starts from the owner's stored nav minus anything pointing at a toggled-off
 * page, then surfaces the three pages that shouldn't need a manual link:
 *
 *   • Group Buy — slotted FIRST: while a round is live it's the timely,
 *     high-intent destination. isPageVisible owns the whole question, so the
 *     link and the page can never disagree (a hidden way gets no link even
 *     mid-round; between rounds it survives only while something is tagged).
 *   • Resellers — the gated wholesale page, appended when the owner opted in.
 *   • Calculator — default-on, so tenants whose stored nav predates the feature
 *     still get it. Slotted before Reviews when present, else appended.
 *   • My Group Buy Order — operator-granted (default OFF); after Group Buy.
 *
 * Each is added only when the same href isn't already in the owner's nav, so an
 * owner who linked it themselves keeps their own label and position.
 */
/** The buyer's "My Group Buy Order" page (pages/MyGroupBuyOrderPage.tsx). */
export const MY_GROUPBUY_HREF = "#my-groupbuy";

export function buildStorefrontNav(brand: Brand): NavItem[] {
  // .filter() already gives us a fresh array, so the unshift/push/splice below
  // can never reach the caller's stored nav.
  // A group-buy-only store's home IS the group buy, so a "Group Buy" link —
  // automatic or the owner's own — would only reopen the page they're on.
  const homeIsGroupBuy = isGroupBuyOnlyHome(brand);
  const nav = (brand.nav || []).filter(
    (item) => !isLinkHidden(brand, item.href) && !(homeIsGroupBuy && item.href === "#groupbuy"),
  );

  if (!homeIsGroupBuy && isPageVisible(brand, "groupbuy") && !nav.some((i) => i.href === "#groupbuy")) {
    nav.unshift({ label: "Group Buy", href: "#groupbuy" });
  }

  // My Group Buy Order — only while the operator granted it (PAGE_TOGGLE). Sits
  // right after the Group Buy link when there is one; a group-buy-only store has
  // no such link (its home IS the round), so there it is appended and the nav is
  // still the way in.
  if (isPageVisible(brand, "my-groupbuy") && !nav.some((i) => i.href === MY_GROUPBUY_HREF)) {
    const link = { label: "My Group Buy Order", href: MY_GROUPBUY_HREF };
    const gbIdx = nav.findIndex((i) => i.href === "#groupbuy");
    if (gbIdx >= 0) nav.splice(gbIdx + 1, 0, link);
    else nav.push(link);
  }

  if (brand.showPageMerchant === true && !nav.some((i) => i.href === "#merchant")) {
    nav.push({ label: "Resellers", href: "#merchant" });
  }

  if (brand.showPageCalculator !== false && !nav.some((i) => i.href === "#calculator")) {
    const reviewsIdx = nav.findIndex((i) => i.href === "#reviews");
    const link = { label: "Calculator", href: "#calculator" };
    if (reviewsIdx >= 0) nav.splice(reviewsIdx, 0, link);
    else nav.push(link);
  }

  return nav;
}
