// COPIED from src/lib/storefront/intl-local/links.ts — keep in sync; the server re-normalizes.
// (plus isPageVisible from src/storefront/visibility.ts PAGE_TOGGLE and the
// link-context builder from src/storefront/components/intl-local/il-nav.tsx)
//
// Where a Website Layout button, menu item, card or footer link GOES, and the
// "no dead buttons" check the web editor shows under every link: a link that
// would resolve to nothing on the live site is hidden there, so the editor
// says so in plain words.

import type { AdminBrand } from "../bridge";

export const IL_LINK_TYPES = ["page", "catalog", "market", "section", "url", "contact", "info", "none"] as const;
export type IlLinkType = (typeof IL_LINK_TYPES)[number];

/** HERO_LINK_PAGES (lib/storefront/hero-links) + account / group-buy pages. */
export const IL_LINK_PAGES: readonly string[] = [
  "home",
  "catalog",
  "reviews",
  "faq",
  "coa",
  "protocols",
  "calculator",
  "track",
  "merchant",
  "articles",
  "assessment",
  "account",
  "groupbuy",
  "my-groupbuy",
];

export const IL_LINK_SECTIONS = ["markets", "learn", "community", "newsletter"] as const;
export type IlLinkSection = (typeof IL_LINK_SECTIONS)[number];

export type IlLink = {
  type: IlLinkType;
  page: string;
  category: string;
  section: string;
  url: string;
  infoId: string;
  market?: string;
};

export const NO_LINK: IlLink = { type: "none", page: "", category: "", section: "", url: "", infoId: "" };

export const pageLink = (page: string): IlLink => ({ ...NO_LINK, type: "page", page });
export const catalogLink = (category = ""): IlLink => ({ ...NO_LINK, type: "catalog", category });
export const sectionLink = (section: IlLinkSection): IlLink => ({ ...NO_LINK, type: "section", section });
export const infoLink = (infoId: string): IlLink => ({ ...NO_LINK, type: "info", infoId });
export const marketLink = (market: "local" | "international"): IlLink => ({ ...NO_LINK, type: "market", market });
export const CONTACT_LINK: IlLink = { ...NO_LINK, type: "contact" };

const MAX_URL = 500;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** footer-links normalizeSocialHref: http(s) only; a bare domain gets https://. */
function normalizeSocialHref(raw: string): string {
  const value = raw.trim();
  if (!value || value === "#") return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const candidate = hasScheme ? value : /^[^\s/]+\.[^\s/]+/.test(value) ? `https://${value}` : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname ? candidate : "";
  } catch {
    return "";
  }
}

/** A URL a storefront link may open (http(s), mailto:, tel:), or "". */
export function safeLinkUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, MAX_URL) : "";
  if (!s) return "";
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(s)) return s;
  if (/^tel:\+?[\d\s().-]{3,30}$/i.test(s)) return s;
  return normalizeSocialHref(s);
}

/** Coerce an untrusted link into the closed shape (only its type's field survives). */
export function normalizeLink(input: unknown, fallback: IlLink = NO_LINK): IlLink {
  if (!input || typeof input !== "object") return { ...fallback };
  const o = input as Record<string, unknown>;
  const type = (IL_LINK_TYPES as readonly string[]).includes(o.type as string) ? (o.type as IlLinkType) : fallback.type;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: IlLink = { ...NO_LINK, type };
  if (type === "page") out.page = IL_LINK_PAGES.includes(str(o.page)) ? str(o.page) : "home";
  if (type === "catalog") out.category = str(o.category).slice(0, 64);
  if (type === "section") out.section = (IL_LINK_SECTIONS as readonly string[]).includes(str(o.section)) ? str(o.section) : "markets";
  if (type === "url") out.url = str(o.url).slice(0, MAX_URL);
  if (type === "info") out.infoId = ID_RE.test(str(o.infoId)) ? str(o.infoId) : "";
  if (type === "market") out.market = str(o.market) === "international" ? "international" : "local";
  return out;
}

/** What the resolver needs to know about the store. */
export type IlLinkContext = {
  isPageVisible: (route: string) => boolean;
  hasContact: boolean;
  infoIds: ReadonlySet<string>;
  dualMarket: boolean;
};

/** resolveIlLink(), reduced to "does it go anywhere?". */
export function linkResolves(link: IlLink, ctx: IlLinkContext): boolean {
  switch (link.type) {
    case "page":
      return link.page === "home" || ctx.isPageVisible(link.page);
    case "catalog":
      return ctx.isPageVisible("catalog");
    case "market":
      if (!ctx.isPageVisible("catalog")) return false;
      return ctx.dualMarket || link.market !== "international";
    case "section":
      return !!link.section;
    case "url":
      return !!safeLinkUrl(link.url);
    case "contact":
      return ctx.hasContact;
    case "info":
      return ctx.infoIds.has(link.infoId);
    default:
      return false;
  }
}

/** Why a link won't render — or "" when it will (fields.tsx linkProblem). */
export function linkProblem(link: IlLink, ctx: IlLinkContext): string {
  if (linkResolves(link, ctx)) return "";
  switch (link.type) {
    case "page":
    case "catalog":
      return "That page is switched off on your store, so this link is hidden.";
    case "market":
      return link.market === "international"
        ? "International selling is off (Website Layout → Markets), so this link is hidden."
        : "Your shop page is switched off, so this link is hidden.";
    case "url":
      return link.url.trim() ? "That address isn't a valid link (use https://…, mailto: or tel:)." : "Add a link. It's hidden until then.";
    case "contact":
      return "No contact channel is set up yet, so this is hidden.";
    case "info":
      return "That info page has no text yet, so this link is hidden. Write it under Footer → Info pages.";
    case "none":
      return "No link, so this is hidden.";
    default:
      return "This link is hidden.";
  }
}

/** lib/storefront/two-ways-mode normalizeTwoWaysMode: junk = open; both hidden = both open. */
function normalizeTwoWaysModeLite(value: unknown): { onHand: string; groupBuy: string } {
  const open = { onHand: "open", groupBuy: "open" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return open;
  const raw = value as Record<string, unknown>;
  const way = (v: unknown) => (v === "closed" || v === "hidden" ? v : "open");
  const mode = { onHand: way(raw.onHand), groupBuy: way(raw.groupBuy) };
  return mode.onHand === "hidden" && mode.groupBuy === "hidden" ? open : mode;
}

/** storefront/visibility.ts PAGE_TOGGLE — which storefront pages are on. */
const PAGE_TOGGLE: Record<string, (b: AdminBrand) => boolean> = {
  track: (b) => b.showPageTrack !== false,
  faq: (b) => b.showPageFAQ !== false,
  coa: (b) => b.showPageCOA !== false,
  protocols: (b) => b.showPageProtocols !== false,
  calculator: (b) => b.showPageCalculator !== false,
  reviews: (b) => b.showPageReviews !== false,
  merchant: (b) => b.showPageMerchant === true,
  groupbuy: (b) =>
    normalizeTwoWaysModeLite(b.twoWaysMode).groupBuy !== "hidden" &&
    (!!b.groupBuyBanner || Number(b.groupBuyListingCount ?? 0) > 0 || !!b.groupBuyTeaser),
  catalog: (b) => normalizeTwoWaysModeLite(b.twoWaysMode).onHand !== "hidden",
  account: (b) => b.customerAccountsEnabled === true,
  "my-groupbuy": (b) => b.myGroupBuyOrderEnabled === true,
  articles: (b) => b.showPageArticles === true,
  assessment: (b) => b.showPageAssessment === true,
};

export function isPageVisible(brand: AdminBrand, route: string): boolean {
  const check = PAGE_TOGGLE[route];
  return check ? check(brand) : true;
}

/** il-nav buildIlLinkContext: a contact channel counts when enabled with a destination. */
export function buildLinkContext(
  brand: AdminBrand,
  infoPages: readonly { id: string; body: string }[],
  dualMarket: boolean,
): IlLinkContext {
  const channels = Array.isArray(brand.contactChannels) ? (brand.contactChannels as Record<string, unknown>[]) : [];
  return {
    isPageVisible: (route) => isPageVisible(brand, route),
    hasContact: channels.some((c) => !!c && c.enabled === true && typeof c.destination === "string" && !!c.destination.trim()),
    infoIds: new Set(infoPages.filter((p) => p.body.trim()).map((p) => p.id)),
    dualMarket,
  };
}
