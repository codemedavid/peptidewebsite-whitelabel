// Per-part text colours. `Brand.textColors` (branding.config) maps a website
// part → hex, set from the super admin Brand tab (and the store-admin COA
// field). Each part lists the storefront selectors it recolours across every
// home layout, and the overrides ship as one scoped <style> (TextColorsStyle).
//
// Unset parts emit nothing, so existing tenants keep their theme colours. The
// hero has its own per-line colours (Hero tab) and the header its own Header
// text colour, so neither is repeated here.
//
// The config is untrusted JSON that lands inside a <style> tag: only known part
// ids with a plain hex value survive normalizeTextColors.

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Tripled class = specificity (0,4,0)+, which outranks both the base
// `.sf-root .x` rules and the layout-scoped `.sf-root[data-sf-home=…] .x` ones,
// so an explicit owner choice can't be silently undone by source order.
const SCOPE = ".sf-root.sf-root.sf-root";

export type TextColorPart = {
  id: string;
  label: string;
  help: string;
  selectors: readonly string[];
};

export const TEXT_COLOR_PARTS: readonly TextColorPart[] = [
  {
    id: "sectionTitle",
    label: "Section & page titles",
    help: "Catalog heading, shelf titles, FAQ / Reviews / Track page titles.",
    selectors: [
      ".catalog__title", ".page__title", ".bq-head__title", ".sc-shelf__title",
      ".sc-circles__title", ".sc-promo__title", ".sf-twh__sec-title", ".sf-twh__way-name",
    ],
  },
  {
    id: "eyebrow",
    label: "Small labels",
    help: "The little uppercase labels above titles, plus page subtitles.",
    selectors: [".eyebrow", ".page__sub", ".catalog__count"],
  },
  {
    id: "productName",
    label: "Product names",
    help: "Names on product cards, the product pop-up and group-buy cards.",
    selectors: [
      ".product-card__name", ".product-card__name-btn", ".sf-detail__name", ".bq-tile__name",
      ".ed-edit__name", ".sf-twh__row-name", ".sf-twh__gb-name", ".gbpage__card-name",
    ],
  },
  {
    id: "price",
    label: "Prices",
    help: "Product, pop-up, group-buy and cart prices.",
    selectors: [
      ".product-card__price", ".product-card__price-poa", ".sf-detail__price", ".sf-twh__row-price",
      ".ed-edit__price", ".gbpage__card-price", ".sf-cart__line-price",
    ],
  },
  {
    id: "productDesc",
    label: "Product descriptions",
    help: "Short description text on product cards.",
    selectors: [".product-card__desc"],
  },
  {
    id: "category",
    label: "Category chips",
    help: "The category filter chips above the catalog.",
    selectors: [".categories .chip"],
  },
  {
    id: "coa",
    label: "Lab Reports (COA) page",
    help: "Title, Lab Verified chip, purity tags and View Report links.",
    selectors: [
      ".coa__title", ".coa__shield-chip", ".coa-card__purity", ".coa-card__cta",
      ".coa__info a", ".coa__info-icon",
    ],
  },
  {
    id: "faq",
    label: "FAQ questions & answers",
    help: "Question rows and their answers on the FAQ page.",
    selectors: [".faq__q", ".faq__a"],
  },
  {
    id: "reviews",
    label: "Reviews",
    help: "Review titles and text on the Reviews page.",
    selectors: [".review-card__title", ".review-card__sub"],
  },
  {
    id: "cart",
    label: "Cart & checkout",
    help: "Cart title, item names and totals.",
    selectors: [".sf-cart__title", ".sf-cart__line-name", ".sf-cart__total"],
  },
  {
    id: "footer",
    label: "Footer",
    help: "Footer brand name, blurb, column labels, links and legal line.",
    selectors: [
      ".site-footer__brandname", ".site-footer__compact-name", ".site-footer__compact-tagline",
      ".site-footer__blurb", ".site-footer__col", ".site-footer__col a", ".site-footer__col .eyebrow",
      ".site-footer__legal", ".site-footer__made",
    ],
  },
];

const PART_IDS = new Set(TEXT_COLOR_PARTS.map((p) => p.id));

export type TextColors = Record<string, string>;

/** Untrusted config in → only known parts with a plain hex value. */
export function normalizeTextColors(input: unknown): TextColors {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([id, hex]) => PART_IDS.has(id) && typeof hex === "string" && HEX_RE.test(hex),
    ),
  ) as TextColors;
}

/** Scoped CSS for the set parts; "" when nothing is set. */
export function textColorsCss(input: unknown): string {
  const colors = normalizeTextColors(input);
  return TEXT_COLOR_PARTS.filter((p) => colors[p.id])
    .map((p) => `${p.selectors.map((s) => `${SCOPE} ${s}`).join(",")}{color:${colors[p.id]}}`)
    .join("\n");
}

/**
 * Immutable set/clear of one part. Clearing drops the key (rather than storing
 * "") and returns undefined once nothing is left, so a fully-reset tenant's
 * config goes back to having no `textColors` at all.
 */
export function withTextColor(
  colors: TextColors | undefined,
  id: string,
  hex: string | undefined,
): TextColors | undefined {
  const { [id]: _dropped, ...rest } = colors ?? {};
  const next = hex ? { ...rest, [id]: hex } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}
