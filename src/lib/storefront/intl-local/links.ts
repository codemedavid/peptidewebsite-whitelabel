// Where an Intl & Local button, menu item, card or footer link GOES.
//
// Every clickable thing in the layout stores one IlLink. This module is the
// single place that (a) sanitizes an untrusted link before it is persisted and
// (b) resolves a stored link against the live tenant into a concrete target —
// or into NULL, which the renderer treats as "don't draw this link at all".
// That null is the "no dead buttons" guarantee: a link to a page the store has
// switched off, an empty custom URL, a contact link with no channel set up, or
// an info page with no text never reaches the shopper as a button that does
// nothing.
//
// Pure (no React, no DB) — shared by the admin editor, the save action and the
// storefront, and covered by test:intl-local.

import { HERO_LINK_PAGES } from "../hero-links";
import { normalizeSocialHref } from "../footer-links";

export const IL_LINK_TYPES = ["page", "catalog", "market", "section", "url", "contact", "info", "none"] as const;
export type IlLinkType = (typeof IL_LINK_TYPES)[number];

/** Storefront routes a link may open: the hero's set plus the account and
 *  group-buy pages, which this layout's Account menu points at. */
export const IL_LINK_PAGES: readonly string[] = [...HERO_LINK_PAGES, "account", "groupbuy", "my-groupbuy"];

/** Home sections a link can scroll to (the hero is the top of the page). */
export const IL_LINK_SECTIONS = ["markets", "learn", "community", "newsletter"] as const;
export type IlLinkSection = (typeof IL_LINK_SECTIONS)[number];

export type IlLink = {
  type: IlLinkType;
  /** type "page": a route key from IL_LINK_PAGES. */
  page: string;
  /** type "catalog": a category id to pre-filter by, or "" for everything. */
  category: string;
  /** type "section": which home section to scroll to. */
  section: string;
  /** type "url": http(s), mailto: or tel:. */
  url: string;
  /** type "info": the id of one of the layout's info pages. */
  infoId: string;
  /** type "market": which market's shop page ("local" / "international"). */
  market?: string;
};

export const NO_LINK: IlLink = { type: "none", page: "", category: "", section: "", url: "", infoId: "" };

/** The route each market's own shop page lives at. */
export const MARKET_ROUTES = { local: "shop-local", international: "shop-international" } as const;

export function pageLink(page: string): IlLink {
  return { ...NO_LINK, type: "page", page };
}
export function catalogLink(category = ""): IlLink {
  return { ...NO_LINK, type: "catalog", category };
}
export function sectionLink(section: IlLinkSection): IlLink {
  return { ...NO_LINK, type: "section", section };
}
export function urlLink(url: string): IlLink {
  return { ...NO_LINK, type: "url", url };
}
export function infoLink(infoId: string): IlLink {
  return { ...NO_LINK, type: "info", infoId };
}
export const CONTACT_LINK: IlLink = { ...NO_LINK, type: "contact" };
export function marketLink(market: "local" | "international"): IlLink {
  return { ...NO_LINK, type: "market", market };
}

const MAX_URL = 500;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * A URL the browser may open from a storefront link, or "". Web links accept
 * what an owner actually pastes (a bare "mystore.com/x" is upgraded to https);
 * mailto: and tel: are allowed for contact links; every other scheme —
 * javascript:, data:, vbscript: — is refused.
 */
export function safeLinkUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, MAX_URL) : "";
  if (!s) return "";
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(s)) return s;
  if (/^tel:\+?[\d\s().-]{3,30}$/i.test(s)) return s;
  return normalizeSocialHref(s);
}

/** Coerce an untrusted link into the closed shape. Only the field its type
 *  uses survives, so a stale URL can't ride along on a page link. */
export function normalizeLink(input: unknown, fallback: IlLink = NO_LINK): IlLink {
  if (!input || typeof input !== "object") return { ...fallback };
  const o = input as Record<string, unknown>;
  const type = (IL_LINK_TYPES as readonly string[]).includes(o.type as string)
    ? (o.type as IlLinkType)
    : fallback.type;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: IlLink = { ...NO_LINK, type };
  if (type === "page") out.page = IL_LINK_PAGES.includes(str(o.page)) ? str(o.page) : "home";
  if (type === "catalog") out.category = str(o.category).slice(0, 64);
  if (type === "section") {
    out.section = (IL_LINK_SECTIONS as readonly string[]).includes(str(o.section)) ? str(o.section) : "markets";
  }
  // The raw URL is KEPT while typing (so the editor doesn't eat a half-typed
  // address) but only ever resolved through safeLinkUrl.
  if (type === "url") out.url = str(o.url).slice(0, MAX_URL);
  if (type === "info") out.infoId = ID_RE.test(str(o.infoId)) ? str(o.infoId) : "";
  if (type === "market") out.market = str(o.market) === "international" ? "international" : "local";
  return out;
}

/** A link resolved against the live tenant. */
export type IlTarget =
  | { kind: "home" }
  | { kind: "route"; route: string }
  | { kind: "catalog"; category: string }
  | { kind: "section"; section: string }
  | { kind: "external"; url: string }
  | { kind: "info"; id: string };

/** What the resolver needs to know about the tenant. */
export type IlLinkContext = {
  isPageVisible: (route: string) => boolean;
  /** The store's first working contact channel as a URL, or "". */
  contactUrl: string;
  /** Info pages that have text (an empty one is not linkable). */
  infoIds: ReadonlySet<string>;
  /** The tenant's category ids — a filter on a deleted category opens "all". */
  categoryIds: ReadonlySet<string>;
  /** The store sells in two markets (brand.dualMarket). */
  dualMarket?: boolean;
};

/** Resolve a link, or null when it has nowhere real to go (→ not rendered). */
export function resolveIlLink(link: IlLink, ctx: IlLinkContext): IlTarget | null {
  switch (link.type) {
    case "page":
      if (link.page === "home") return { kind: "home" };
      if (link.page === "catalog") return ctx.isPageVisible("catalog") ? { kind: "catalog", category: "" } : null;
      return ctx.isPageVisible(link.page) ? { kind: "route", route: link.page } : null;
    case "catalog":
      if (!ctx.isPageVisible("catalog")) return null;
      return { kind: "catalog", category: ctx.categoryIds.has(link.category) ? link.category : "" };
    case "market":
      // Two markets: each has its own shop page. One market (dual-currency
      // off): "local" is simply the shop, and there is no International shop.
      if (!ctx.isPageVisible("catalog")) return null;
      if (ctx.dualMarket) {
        return { kind: "route", route: link.market === "international" ? MARKET_ROUTES.international : MARKET_ROUTES.local };
      }
      return link.market === "international" ? null : { kind: "catalog", category: "" };
    case "section":
      return link.section ? { kind: "section", section: link.section } : null;
    case "url": {
      const url = safeLinkUrl(link.url);
      return url ? { kind: "external", url } : null;
    }
    case "contact":
      return ctx.contactUrl ? { kind: "external", url: ctx.contactUrl } : null;
    case "info":
      return ctx.infoIds.has(link.infoId) ? { kind: "info", id: link.infoId } : null;
    default:
      return null;
  }
}

/** The href an anchor should carry for a target (real links for middle-click
 *  and screen readers; the click handler still routes in-app). */
export function targetHref(t: IlTarget): string {
  switch (t.kind) {
    case "home":
      return "#";
    case "route":
      return `#${t.route}`;
    case "catalog":
      return "#catalog";
    case "section":
      return `#il-${t.section}`;
    case "external":
      return t.url;
    case "info":
      return `#il-info-${t.id}`;
  }
}
