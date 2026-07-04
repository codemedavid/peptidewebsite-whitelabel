// Pure core for the storefront announcement banner (the promo bar under the
// header). Shared by the store-admin save action (server) and the live
// storefront (client), so it must stay free of any DB / Next / browser
// dependency — it is exercised directly by test:banner.
//
// A banner has three display modes:
//   - "single"   : one static message bar
//   - "carousel" : several messages that auto-rotate
//   - "marquee"  : messages that scroll sideways continuously ("live" banner)
//
// This module is the single place that (a) sanitizes untrusted banner config
// before it is persisted, and (b) resolves a stored slide link into a concrete
// navigation target for the storefront.

import { HERO_LINK_PAGES, safeHttpUrl } from "./hero-links";

// The three supported layouts, in menu order. Kept as a readonly tuple so it is
// both iterable (the editor's mode picker) and a closed literal union.
export const BANNER_MODES = ["single", "carousel", "marquee"] as const;
export type BannerMode = (typeof BANNER_MODES)[number];

export type BannerSpeed = "slow" | "normal" | "fast";
export type BannerLinkType = "none" | "page" | "custom";

export type BannerSlide = {
  id: string;
  text: string;
  linkType: BannerLinkType;
  linkPage: string; // a route in HERO_LINK_PAGES when linkType === "page", else ""
  linkUrl: string; // an http(s) URL when linkType === "custom", else ""
};

export type StorefrontBanner = {
  enabled: boolean;
  mode: BannerMode;
  bgColor: string; // sanitized CSS color, or "" to fall back to the brand accent
  textColor: string; // sanitized CSS color, or "" for the readable default
  slides: BannerSlide[];
  autoplayMs: number; // carousel rotation interval
  speed: BannerSpeed; // marquee scroll speed
  pauseOnHover: boolean;
}

export const MAX_BANNER_SLIDES = 10;
const MAX_SLIDE_TEXT = 160;
const MAX_COLOR_LEN = 64;
const MIN_AUTOPLAY_MS = 2000;
const MAX_AUTOPLAY_MS = 20000;

const BANNER_MODE_SET: ReadonlySet<string> = new Set(BANNER_MODES);
const BANNER_SPEEDS: ReadonlySet<string> = new Set<BannerSpeed>(["slow", "normal", "fast"]);

// A conservative CSS-color allowlist: hex, rgb()/rgba(), hsl(), oklch(), simple
// named colors, and var(--token) references. The charset deliberately excludes
// ":", ";", "{", "}", quotes and angle brackets so a stored value can never
// smuggle a url() fetch or break out of an inline-style declaration.
const COLOR_CHARSET = /^[a-zA-Z0-9#(),.%\s/-]+$/;

/** Keep only values that look like a safe CSS color; anything else → "". */
export function safeCssColor(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim().slice(0, MAX_COLOR_LEN);
  if (!s) return "";
  if (s.toLowerCase().includes("url(")) return "";
  return COLOR_CHARSET.test(s) ? s : "";
}

/** The safe, empty baseline used when a tenant has never configured a banner. */
export const DEFAULT_BANNER: StorefrontBanner = {
  enabled: false,
  mode: "single",
  bgColor: "",
  textColor: "",
  slides: [],
  autoplayMs: 5000,
  speed: "normal",
  pauseOnHover: true,
};

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Coerce one untrusted slide into a closed, safe shape. Returns null for a slide
// with no text (so blank rows the owner never filled in are dropped on save).
function normalizeSlide(raw: unknown, index: number): BannerSlide | null {
  const o = asObject(raw);
  const text = String(o.text ?? "").trim().slice(0, MAX_SLIDE_TEXT);
  if (!text) return null;

  const providedId = typeof o.id === "string" ? o.id.trim() : "";
  const id = providedId || `b${index}`;

  const linkType: BannerLinkType =
    o.linkType === "custom" ? "custom" : o.linkType === "page" ? "page" : "none";

  const pageRaw = String(o.linkPage ?? "").trim();
  const linkPage = linkType === "page" ? (HERO_LINK_PAGES.has(pageRaw) ? pageRaw : "catalog") : "";
  const linkUrl = linkType === "custom" ? safeHttpUrl(String(o.linkUrl ?? "")) : "";

  return { id, text, linkType, linkPage, linkUrl };
}

/**
 * Coerce untrusted banner config into a closed, safe shape before it is written
 * to branding.config: a strict enabled flag, a known mode (default "single"),
 * sanitized colors, a de-blanked + length-capped slide list, a clamped carousel
 * interval, a known marquee speed, and a strict pause-on-hover flag. Never
 * throws for malformed input — a non-object collapses to the safe default.
 */
export function normalizeBanner(input: unknown): StorefrontBanner {
  const o = asObject(input);

  const mode = BANNER_MODE_SET.has(o.mode as string) ? (o.mode as BannerMode) : "single";

  const slides = Array.isArray(o.slides)
    ? o.slides
        .map((raw, i) => normalizeSlide(raw, i))
        .filter((s): s is BannerSlide => s !== null)
        .slice(0, MAX_BANNER_SLIDES)
    : [];

  const rawMs = o.autoplayMs;
  const autoplayMs =
    typeof rawMs === "number" && Number.isFinite(rawMs)
      ? clamp(rawMs, MIN_AUTOPLAY_MS, MAX_AUTOPLAY_MS)
      : DEFAULT_BANNER.autoplayMs;

  const speed: BannerSpeed = BANNER_SPEEDS.has(o.speed as string)
    ? (o.speed as BannerSpeed)
    : "normal";

  return {
    enabled: o.enabled === true,
    mode,
    bgColor: safeCssColor(o.bgColor as string),
    textColor: safeCssColor(o.textColor as string),
    slides,
    autoplayMs,
    speed,
    pauseOnHover: o.pauseOnHover !== false,
  };
}

// A resolved navigation target for a banner slide. The storefront maps each kind
// to a concrete action (open a tab, or change the hash route).
export type BannerSlideTarget =
  | { kind: "none" }
  | { kind: "external"; url: string }
  | { kind: "route"; route: string };

/**
 * Resolve a stored slide's link into a navigation target. A custom link with an
 * unsafe/blank URL resolves to `none` (an inert bar) rather than navigating
 * somewhere unexpected; a page link with no route falls back to the catalog.
 */
export function resolveBannerSlideTarget(slide: {
  linkType?: string;
  linkPage?: string;
  linkUrl?: string;
}): BannerSlideTarget {
  if (slide.linkType === "custom") {
    const safe = safeHttpUrl(slide.linkUrl);
    return safe ? { kind: "external", url: safe } : { kind: "none" };
  }
  if (slide.linkType === "page") {
    const route = (slide.linkPage && slide.linkPage.trim()) || "catalog";
    return { kind: "route", route };
  }
  return { kind: "none" };
}
