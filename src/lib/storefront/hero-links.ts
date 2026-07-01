// Pure core for the homepage hero's CTA links. Shared by the store-admin save
// action (server) and the live storefront (client), so it must stay free of any
// DB / Next / browser dependency — it is exercised directly by test:hero-links.
//
// A hero CTA links either to a page on the storefront (a route key resolved by
// the hash router) or to a custom http(s) URL. This module is the single place
// that (a) sanitizes untrusted link config before it is persisted, and (b)
// resolves stored config into a concrete navigation target for the buttons.

// Storefront route keys a hero CTA may point at — "home"/"catalog" plus each
// toggle-able sub-page. Kept in sync with the ROUTES list the hash router in
// StorefrontApp resolves. The editor only offers the subset visible for the
// tenant, but any known key is accepted here.
export const HERO_LINK_PAGES: ReadonlySet<string> = new Set([
  "home",
  "catalog",
  "reviews",
  "faq",
  "coa",
  "protocols",
  "calculator",
  "track",
  "merchant",
]);

// Default destination per button when none is configured. Primary keeps the
// legacy "scroll to catalog" behaviour; secondary points at reviews.
const DEFAULT_PAGE: Record<1 | 2, string> = { 1: "catalog", 2: "reviews" };

const MAX_URL_LEN = 500;

/** Keep only http(s) URLs; anything else (javascript:, data:, garbage) → "". */
export function safeHttpUrl(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim().slice(0, MAX_URL_LEN);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

/**
 * Coerce untrusted CTA link config into a safe, closed shape: a known link type
 * ("page" default), a known page route (falling back to a sensible per-button
 * default), and an http(s)-only custom URL that is dropped unless the type is
 * "custom". The custom URL is always sanitized so a stored `javascript:` scheme
 * can never reach the storefront's CTA handler.
 */
export function normalizeHeroLinks(input: unknown): Record<string, string> {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const n of [1, 2] as const) {
    const type = o[`heroCta${n}LinkType`] === "custom" ? "custom" : "page";
    const pageRaw = String(o[`heroCta${n}LinkPage`] ?? "").trim();
    const page = HERO_LINK_PAGES.has(pageRaw) ? pageRaw : DEFAULT_PAGE[n];
    out[`heroCta${n}LinkType`] = type;
    out[`heroCta${n}LinkPage`] = page;
    out[`heroCta${n}LinkUrl`] =
      type === "custom" ? safeHttpUrl(String(o[`heroCta${n}LinkUrl`] ?? "")) : "";
  }
  return out;
}

// A resolved navigation target for a hero CTA. The storefront maps each kind to
// a concrete action (open a tab, scroll to the catalog, change the hash route).
export type HeroCtaTarget =
  | { kind: "external"; url: string }
  | { kind: "catalog" }
  | { kind: "home" }
  | { kind: "route"; route: string }
  | { kind: "none" };

/**
 * Resolve stored CTA link config into a navigation target. `n` selects the
 * per-button default (primary → catalog, secondary → reviews) so a tenant that
 * never configured the hero keeps a sensible primary "shop" action. A custom
 * link with an unsafe/blank URL resolves to `none` (an inert button) rather
 * than navigating somewhere unexpected.
 */
export function resolveHeroCtaLink(
  cfg: { type?: string; page?: string; url?: string },
  n: 1 | 2,
): HeroCtaTarget {
  if (cfg.type === "custom") {
    const safe = safeHttpUrl(cfg.url);
    return safe ? { kind: "external", url: safe } : { kind: "none" };
  }
  const route = (cfg.page && cfg.page.trim()) || DEFAULT_PAGE[n];
  if (route === "catalog") return { kind: "catalog" };
  if (route === "home") return { kind: "home" };
  return { kind: "route", route };
}
