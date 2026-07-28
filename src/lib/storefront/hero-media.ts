// Pure core for the homepage hero's IMAGE mode — the "upload one full-width
// banner and use that instead of the written hero" option in the store-admin
// Hero Section editor. Shared by the save action (server), the live storefront
// <Hero> (client) and the operator live preview, so it must stay free of any
// DB / Next / browser dependency — it is exercised directly by test:hero-media.
//
// The written hero stays the default and the fallback: a tenant that picked
// image mode but has no (or an unsafe) image keeps rendering its written hero
// rather than a blank band. resolveHeroMedia() is the single place that decides
// the EFFECTIVE mode, so the admin preview, the storefront and the operator
// preview can never disagree about what a customer sees.

import { HERO_LINK_PAGES, safeHttpUrl, resolveHeroCtaLink, type HeroCtaTarget } from "./hero-links";

export type HeroMediaMode = "text" | "image";
export type HeroMediaRatio = "wide" | "standard" | "tall";
export type HeroMediaFocus = "center" | "top" | "bottom" | "left" | "right";
export type HeroMediaLinkType = "page" | "custom" | "none";

export interface HeroMedia {
  /** Which hero the owner chose. "image" still falls back when `url` is blank. */
  mode: HeroMediaMode;
  /** Hosted (ImageKit) banner URL, or a small data: URL in demo mode. "" = none. */
  url: string;
  alt: string;
  ratio: HeroMediaRatio;
  focus: HeroMediaFocus;
  /** "none" = the banner is decorative and not clickable. */
  linkType: HeroMediaLinkType;
  linkPage: string;
  linkUrl: string;
  /** Show the headline + primary CTA over the image. */
  overlay: boolean;
  /** Dark scrim strength behind the overlay text, 0–70 in steps of 5. */
  scrim: number;
}

// A hosted URL is short; the demo / no-ImageKit path inlines the bytes as a
// data: URL instead, which lands in the branding.config JSON blob. Cap it so a
// large local upload can't bloat every storefront render — past the cap we drop
// the image (and the hero falls back to the written variant) rather than
// persisting a multi-megabyte string.
export const HERO_MEDIA_MAX_URL_LEN = 512_000;

const RATIOS: ReadonlySet<string> = new Set<HeroMediaRatio>(["wide", "standard", "tall"]);
const FOCUSES: ReadonlySet<string> = new Set<HeroMediaFocus>([
  "center",
  "top",
  "bottom",
  "left",
  "right",
]);

const DEFAULT_RATIO: HeroMediaRatio = "standard";
const DEFAULT_FOCUS: HeroMediaFocus = "center";
const DEFAULT_PAGE = "catalog";
const DEFAULT_SCRIM = 30;
const SCRIM_MAX = 70;
const SCRIM_STEP = 5;
const MAX_ALT_LEN = 200;

// Only base64 image data URLs are inlineable. Anything else (text/html, an
// svg+xml script payload, a bare "data:" prefix) is dropped — the admin upload
// action only ever produces `data:image/<type>;base64,…`.
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

/**
 * Keep only an image source we are willing to render: an http(s) URL, or a
 * base64 image data URL under the size cap. Everything else — javascript:,
 * data:text/html, an oversized inline blob, garbage — collapses to "".
 */
export function safeImageSrc(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.toLowerCase().startsWith("data:")) {
    return s.length <= HERO_MEDIA_MAX_URL_LEN && DATA_IMAGE_RE.test(s) ? s : "";
  }
  return safeHttpUrl(s);
}

/** Clamp to 0..70 and snap to the 5% step the editor's slider offers. */
function normalizeScrim(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SCRIM;
  const clamped = Math.min(SCRIM_MAX, Math.max(0, n));
  return Math.round(clamped / SCRIM_STEP) * SCRIM_STEP;
}

/**
 * Coerce untrusted image-hero config into a closed, safe shape before it is
 * persisted into branding.config. Accepts the whole save payload (it reads the
 * nested `heroMedia` key) so the save action can hand it the same `input` it
 * gives normalizeHeroContent / normalizeHeroLinks. Unknown keys are dropped —
 * the returned object is built key-by-key, never spread from the input.
 */
export function normalizeHeroMedia(input: unknown): HeroMedia {
  const root = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const raw = (root.heroMedia && typeof root.heroMedia === "object" ? root.heroMedia : {}) as Record<
    string,
    unknown
  >;

  const ratioRaw = String(raw.ratio ?? "");
  const focusRaw = String(raw.focus ?? "");
  const pageRaw = String(raw.linkPage ?? "").trim();

  const linkTypeRaw = String(raw.linkType ?? "");
  const linkType: HeroMediaLinkType =
    linkTypeRaw === "custom" || linkTypeRaw === "none" ? linkTypeRaw : "page";

  return {
    mode: raw.mode === "image" ? "image" : "text",
    url: safeImageSrc(raw.url),
    alt: String(raw.alt ?? "").slice(0, MAX_ALT_LEN).trim(),
    ratio: (RATIOS.has(ratioRaw) ? ratioRaw : DEFAULT_RATIO) as HeroMediaRatio,
    focus: (FOCUSES.has(focusRaw) ? focusRaw : DEFAULT_FOCUS) as HeroMediaFocus,
    linkType,
    linkPage: HERO_LINK_PAGES.has(pageRaw) ? pageRaw : DEFAULT_PAGE,
    // A page/none banner never keeps a stale custom URL around.
    linkUrl: linkType === "custom" ? safeHttpUrl(String(raw.linkUrl ?? "")) : "",
    overlay: Boolean(raw.overlay),
    scrim: normalizeScrim(raw.scrim),
  };
}

/**
 * The EFFECTIVE hero media for a brand. Image mode only survives when there is
 * actually a safe image to show; otherwise the mode collapses to "text" so the
 * storefront keeps rendering the written hero instead of an empty band. Callers
 * can therefore branch on `.mode` alone.
 */
export function resolveHeroMedia(brand: unknown): HeroMedia {
  const media = normalizeHeroMedia(brand);
  if (media.mode === "image" && media.url) return media;
  return { ...media, mode: "text" };
}

/** Banner height as a CSS `aspect-ratio`, so the box reserves space (no CLS). */
export function heroMediaAspect(ratio: string): string {
  if (ratio === "wide") return "3 / 1";
  if (ratio === "tall") return "3 / 2";
  return "2 / 1";
}

/** Focus point as a CSS `object-position` — keeps the subject visible on phones. */
export function heroMediaPosition(focus: string): string {
  return FOCUSES.has(focus) ? focus : DEFAULT_FOCUS;
}

/**
 * Scrim strength as an rgba alpha. The scrim exists to keep overlay text
 * readable, so with the overlay off there is nothing to darken for — always 0.
 */
export function heroMediaScrimAlpha(media: Pick<HeroMedia, "overlay" | "scrim">): number {
  return media.overlay ? normalizeScrim(media.scrim) / 100 : 0;
}

/**
 * Resolve the whole-banner click into a navigation target, reusing the hero CTA
 * resolver so an image banner and a written CTA obey identical link rules. An
 * explicit "none" (or a custom link whose URL was stripped) yields an inert
 * banner rather than navigating somewhere unexpected.
 */
export function resolveHeroMediaLink(cfg: {
  linkType?: string;
  linkPage?: string;
  linkUrl?: string;
}): HeroCtaTarget {
  if (cfg.linkType === "none") return { kind: "none" };
  return resolveHeroCtaLink({ type: cfg.linkType, page: cfg.linkPage, url: cfg.linkUrl }, 1);
}
