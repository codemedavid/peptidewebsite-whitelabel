// SHOWCASE home layout — the full-storefront, merchandised home: a promise bar
// above the header, a split hero (copy left, photography right, trust row
// under the CTA), round "shop by category" badges in a soft panel, a featured
// products shelf with real add-to-cart, two promo cards, and a closing trust
// strip. A REUSABLE TEMPLATE, not a tenant's design: it owns no business name,
// no palette, no copy, no products and no categories of its own. Every section
// is composed from data the tenant already has, and any section whose data is
// empty simply isn't rendered.
//
// What distinguishes it from the other owner-selectable layouts is that the
// home SELLS: boutique and editorial stop at discovery and leave buying to the
// catalog screen, while this one puts a shelf of buyable cards on the home and
// keeps the full grid one click away ("View all").
//
// The pieces it needs that no other surface computes:
//
//   • buildShowcaseFeatured — the home shelf. The owner's `featured` products
//     first; a store that has featured nothing gets its catalog's leading
//     products in the owner's own order instead, and the heading says so
//     honestly ("Shop the collection", not "Featured").
//   • assuranceIcon — which pictogram leads each owner-typed promise. Derived
//     from the words the owner wrote, so the template never puts a promise in
//     a tenant's mouth: it only illustrates the ones they made.
//   • hasProtocolsHub — the "Protocols hub" promo card, which opens the
//     Protocols page; shown only when the tenant has that page switched on.
//   • heroShowcaseImage — the hero's picture: the owner's uploaded hero image
//     and nothing else; no upload means a text-only hero.
//
// The trust copy (promise bar, hero trust row) deliberately
// REUSES branding.config.boutique.assurances — the same lines the boutique and
// editorial layouts show — so an owner who typed them once keeps them when
// they switch layout.
//
// Pure + JSON-safe (no React, no DB, no Next runtime), so the server page, the
// client render and the operator live preview all resolve the same answer.
// Covered by npm run test:showcase-home.

import type { Product } from "@/storefront/types";
import { safeImageSrc } from "./hero-media";

// ── Page composition ─────────────────────────────────────────────────────────

/** The two screens the showcase layout owns. */
export type ShowcaseView = "home" | "catalog";

export type ShowcaseSection =
  | "hero"
  | "circles"
  | "featured"
  | "promos"
  | "chips"
  | "catalog";

/** The home is a merchandised page: hero, category badges, a buyable shelf,
 *  the promo pair. The owner's promises live in the promise bar + hero trust
 *  panel only — a closing strip repeated them word for word. The FULL grid is not here —
 *  the shelf is capped and "View all" opens the catalog screen, so the home
 *  stays a page you can take in at a glance however large the catalog grows. */
const HOME_SECTIONS: readonly ShowcaseSection[] = [
  "hero",
  "circles",
  "featured",
  "promos",
];

/** The catalog screen is the grid. It leads with the category CHIPS because
 *  arriving from a badge means a filter is already applied: without them the
 *  shopper faces a narrowed grid with no sign of which shelf they are on. */
const CATALOG_SECTIONS: readonly ShowcaseSection[] = ["chips", "catalog"];

/** Which sections a showcase view renders, in order. Sections still self-hide
 *  when their data is empty; this only fixes the composition. */
export function showcaseSections(view: ShowcaseView): ShowcaseSection[] {
  return [...(view === "catalog" ? CATALOG_SECTIONS : HOME_SECTIONS)];
}

// ── The featured shelf ───────────────────────────────────────────────────────

/** How many cards the home shelf carries. One row at desktop width; the rest
 *  of the catalog is a click away, so the home never turns into the grid. */
export const SHOWCASE_FEATURED_MAX = 4;

export type ShowcaseShelf = {
  products: Product[];
  /** True when the shelf leads with the owner's own `featured` picks. False
   *  when it fell back to the catalog's leading products — the heading then
   *  must not claim the owner featured them. */
  curated: boolean;
};

/**
 * The home shelf.
 *
 * Featured products lead, in catalog order, using the SAME `featured` flag that
 * pins a product to the top of the catalog — the owner curates from the editor
 * they already know. With nothing featured, the shelf shows the first products
 * of the catalog as passed (the owner's own arrangement), flagged `curated:
 * false` so the heading reads as a collection rather than a recommendation.
 *
 * Featured products are topped up from the rest of the catalog when the owner
 * featured fewer than a row: a one-card shelf beside a three-card gap reads as
 * broken. The owner's picks always come first.
 *
 * A non-positive or non-finite `max` is config drift, not an instruction to
 * empty the shelf, so it falls back to SHOWCASE_FEATURED_MAX. Never mutates.
 */
export function buildShowcaseFeatured(
  products: readonly Product[] | null | undefined,
  max: number = SHOWCASE_FEATURED_MAX,
): ShowcaseShelf {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : SHOWCASE_FEATURED_MAX;
  const list = (products ?? []).filter((p): p is Product => !!p && typeof p.id === "string");

  const picks = list.filter((p) => p.featured === true);
  if (picks.length === 0) {
    return { products: list.slice(0, limit), curated: false };
  }

  const pickIds = new Set(picks.map((p) => p.id));
  const topUp = list.filter((p) => !pickIds.has(p.id));
  return { products: [...picks, ...topUp].slice(0, limit), curated: true };
}

// ── Hero photography ─────────────────────────────────────────────────────────

/**
 * The hero's picture: the owner's uploaded hero image (brand.heroMedia.url) —
 * even when the hero is in TEXT mode, because the upload is the owner telling us
 * which picture represents the store. Nothing else: the hero never borrows
 * product photos or the logo, so with no upload it is a text-only hero.
 *
 * The URL passes safeImageSrc, the same gate the image hero uses, so a
 * javascript: or oversized data: URL in untrusted config never reaches <img>.
 */
export function heroShowcaseImage(heroMediaUrl: unknown): string | null {
  return safeImageSrc(heroMediaUrl) || null;
}

/** A product photo we are willing to render: anything safeImageSrc accepts,
 *  plus a same-origin root-relative path ("/products/x.png" — how bundled
 *  sample images are referenced). Protocol-relative "//host" is NOT same-origin
 *  and goes through the strict gate like any other URL. */
function productImageSrc(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return safeImageSrc(s);
}

/** The "whole collection" card's photo: the first product photo, featured
 *  products first. Null when nothing in the catalog is photographed. */
export function collectionImage(products: readonly Product[] | null | undefined): string | null {
  const list = products ?? [];
  const ordered = [
    ...list.filter((p) => p?.featured === true),
    ...list.filter((p) => p?.featured !== true),
  ];
  for (const product of ordered) {
    const src = productImageSrc(product?.image);
    if (src) return src;
  }
  return null;
}

// ── Promise bar colours ──────────────────────────────────────────────────────

/** A plain CSS colour and nothing else: #RGB / #RRGGBB / #RRGGBBAA, or an
 *  rgb()/rgba()/hsl()/hsla() of numbers. Anything else (url(), var(), a stray
 *  ";") is refused, so owner config can only ever paint a colour. */
const PLAIN_COLOR_RE =
  /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%,\s/+-]+\))$/i;

function plainColor(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return PLAIN_COLOR_RE.test(value) ? value : null;
}

/** The promise bar's colour overrides as CSS variables, set inline on the bar.
 *  Only valid colours are emitted; unset/invalid → the stylesheet's default. */
export function promiseBarVars(brand: {
  promiseBarBg?: unknown;
  promiseBarText?: unknown;
}): Record<string, string> {
  const bg = plainColor(brand.promiseBarBg);
  const text = plainColor(brand.promiseBarText);
  return {
    ...(bg ? { "--sc-promise-bg": bg } : {}),
    ...(text ? { "--sc-promise-text": text } : {}),
  };
}

// ── Assurance pictograms ─────────────────────────────────────────────────────

/** The pictograms the template can draw. "spark" is the neutral default. */
export const ASSURANCE_ICONS = [
  "shipping",
  "authentic",
  "secure",
  "support",
  "education",
  "quality",
  "payment",
  "spark",
] as const;

export type AssuranceIcon = (typeof ASSURANCE_ICONS)[number];

/** Keyword families → pictogram. Order matters: the first family that matches
 *  wins, so the more specific families sit above the broad ones ("secure
 *  shipping" is a shipping promise before it is a security one). */
const ICON_RULES: readonly [AssuranceIcon, RegExp][] = [
  ["shipping", /\b(ship|deliver|courier|dispatch|nationwide|same[- ]day|fast)/i],
  ["payment", /\b(pay|cod\b|cash|gcash|refund|money[- ]back)/i],
  ["authentic", /\b(authentic|genuine|original|legit|verified|lab\b|lab-|tested|coa\b|certif)/i],
  ["education", /\b(guide|educat|learn|protocol|resource|tutorial|how[- ]to|calculator|dosing)/i],
  ["support", /\b(support|communit|help|care\b|chat|customer|friendly|team|24\/7)/i],
  ["quality", /\b(quality|premium|pure|purity|grade|sourc)/i],
  ["secure", /\b(secure|safe|discreet|privacy|private|protect|responsib)/i],
];

/**
 * The pictogram for one owner-typed promise, read from its own words (label
 * first, then the supporting note). Anything unrecognised — or not a string —
 * gets the neutral "spark" rather than a guess that might contradict the copy.
 */
export function assuranceIcon(label: unknown, note?: unknown): AssuranceIcon {
  const texts = [label, note].filter(
    (t): t is string => typeof t === "string" && t.trim() !== "",
  );
  for (const text of texts) {
    for (const [icon, pattern] of ICON_RULES) {
      if (pattern.test(text)) return icon;
    }
  }
  return "spark";
}

// ── The "learn" promo card ───────────────────────────────────────────────────

/** The page the Protocols hub card opens. */
export const SHOWCASE_PROTOCOLS_ROUTE = "protocols";

/**
 * Whether the home shows the Protocols hub card.
 *
 * `isVisible` is the storefront's own page-visibility rule (passed in so this
 * module stays free of the feature catalog). The card only ever links to the
 * Protocols page, so it is shown only when that page is on — a card pointing at
 * a switched-off page would bounce the shopper back to the home.
 */
export function hasProtocolsHub(isVisible: (route: string) => boolean): boolean {
  return isVisible(SHOWCASE_PROTOCOLS_ROUTE);
}
