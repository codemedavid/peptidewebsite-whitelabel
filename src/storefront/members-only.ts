// A paid group buy the visitor isn't in yet (brand.groupBuyTeaser — the server
// already stripped the round's products and prices). On a group-buy-only store
// that leaves the catalog EMPTY, so a plain "0 products · No matches" and a
// "Shop now" button into it read as a broken store. These pure rules decide
// when the storefront should speak "members only" instead, and what it says.
// Rendered by components/MembersOnlyCatalog.tsx; wired in StorefrontApp + Catalog.

import { normalizeTwoWaysMode } from "@/lib/storefront/two-ways-mode";
import type { Brand } from "./types";

type Teaser = NonNullable<Brand["groupBuyTeaser"]>;

export const GET_ACCESS_LABEL = "Get access";

/** The locked round this visitor should be pointed at, or null. */
export function membersOnlyRound(brand: Pick<Brand, "groupBuyTeaser" | "twoWaysMode">): Teaser | null {
  if (!brand.groupBuyTeaser) return null;
  return normalizeTwoWaysMode(brand.twoWaysMode).groupBuy === "hidden" ? null : brand.groupBuyTeaser;
}

/** Nothing on the shelf but a locked round: every "shop" door should lead to Get access. */
export function isMembersOnlyStore(brand: Pick<Brand, "groupBuyTeaser" | "twoWaysMode">, visibleCount: number): boolean {
  return visibleCount === 0 && membersOnlyRound(brand) !== null;
}

/** How many round listings are hidden from this visitor; null when the store shows no summary. */
export function lockedListingCount(teaser: Teaser): number | null {
  return teaser.summary && teaser.summary.productCount > 0 ? teaser.summary.productCount : null;
}

export type MembersOnlyCopy = { eyebrow: string; title: string; body: string; cta: string; note: string };

const plural = (n: number) => (n === 1 ? "1 product is" : `${n} products are`);

function timing(teaser: Teaser): string {
  if (teaser.state === "live") return "Live now";
  if (teaser.state === "upcoming" && teaser.startsAt) {
    return `Opens ${new Date(teaser.startsAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`;
  }
  return teaser.state === "upcoming" ? "Opening soon" : "Closed";
}

export function membersOnlyCopy(teaser: Teaser): MembersOnlyCopy {
  const count = lockedListingCount(teaser);
  const eyebrow = `Members only · ${timing(teaser)}`;
  if (teaser.membership) {
    return {
      eyebrow,
      title: teaser.name,
      body: teaser.membership.headline || "Your request is with the store.",
      cta: "See where you are",
      note: "The products unlock here as soon as the store approves you.",
    };
  }
  const own = teaser.copy;
  return {
    eyebrow,
    title: teaser.name,
    body:
      own?.intro.trim() ||
      (count
        ? `${plural(count)} waiting in this group buy. Members see the prices and can order.`
        : "This group buy is for members. Members see the products and prices and can order."),
    cta: getAccessLabel(teaser),
    note: own?.note.trim() || "Already approved? Verify your email on the next screen — no account needed.",
  };
}

/** The "Get access" button's words — the store's own when it typed some. */
export function getAccessLabel(teaser: Pick<Teaser, "copy">): string {
  return teaser.copy?.button.trim() || GET_ACCESS_LABEL;
}
