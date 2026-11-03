// A REUSABLE background for any storefront card, box, banner or section:
// a colour, an uploaded image, or both, plus an optional colour overlay.
//
// The one rule the whole module exists to keep: image opacity must NEVER touch
// the content. Setting `opacity` on the element would fade its text and
// buttons with it, so the renderer never does. Instead the image and the
// overlay are painted as two separate pseudo-element LAYERS behind the content
// (see `.sbg` in intl-local.css), and this module only produces the CSS custom
// properties those layers read:
//
//   --sbg-color            the element's own background colour
//   --sbg-image            url("…") or none
//   --sbg-image-opacity    0..1, the image layer only
//   --sbg-position / --sbg-size
//   --sbg-overlay          overlay colour (transparent when off)
//   --sbg-overlay-opacity  0..1, the overlay layer only
//
// Pure + JSON-safe (no React, no DB): the store-admin editor, its server
// action and the storefront share this one contract, and test:intl-local
// exercises it directly. It is written for the Intl & Local layout but carries
// nothing layout-specific, so any future template can adopt it unchanged.

import { safeImageSrc } from "./hero-media";
import { imageUrl } from "@/lib/media/image-url";

export const BACKGROUND_TYPES = ["color", "image", "image-color"] as const;
export type BackgroundType = (typeof BACKGROUND_TYPES)[number];

export const BACKGROUND_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number];

export const BACKGROUND_SIZES = ["cover", "contain", "custom"] as const;
export type BackgroundSize = (typeof BACKGROUND_SIZES)[number];

export type SectionBackground = {
  type: BackgroundType;
  /** Hex/rgb/hsl, or "" for "no colour of its own" (the page shows through). */
  color: string;
  /** http(s) URL or a small base64 image data URL; "" = no image. */
  imageUrl: string;
  /** 0..100 — the IMAGE layer's opacity, never the content's. */
  imageOpacity: number;
  position: BackgroundPosition;
  size: BackgroundSize;
  /** Used when size is "custom": the image width as a % of the element. */
  customSize: number;
  /** Overlay colour, or "" for none. */
  overlayColor: string;
  /** 0..100 — the overlay layer's opacity. */
  overlayOpacity: number;
};

/** Subtle by default: an uploaded image reads as texture, text stays crisp. */
export const DEFAULT_IMAGE_OPACITY = 18;
export const CUSTOM_SIZE_MIN = 10;
export const CUSTOM_SIZE_MAX = 300;

/** A background with no image and no overlay — just `color`. */
export function colorBackground(color: string): SectionBackground {
  return {
    type: "color",
    color,
    imageUrl: "",
    imageOpacity: DEFAULT_IMAGE_OPACITY,
    position: "center",
    size: "cover",
    customSize: 100,
    overlayColor: "",
    overlayOpacity: 0,
  };
}

// A colour we are willing to drop into an inline style. Anything else (a
// `;`-smuggled declaration, url(), expression()) collapses to "".
const COLOR_RE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\)|transparent)$/i;

/** A safe CSS colour value, or "" when the input is not one. */
export function safeCssColor(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length <= 64 && COLOR_RE.test(s) ? s : "";
}

function pct(raw: unknown, fallback: number, min = 0, max = 100): number {
  const n = Number(raw);
  if (raw === null || raw === "" || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Coerce untrusted background config into the closed shape above. `fallback`
 * supplies the element's own defaults (its pastel colour), so an element whose
 * stored background is missing or junk keeps looking like itself. Built key by
 * key — never spread from the input — so unknown keys can't ride along.
 */
export function normalizeBackground(input: unknown, fallback: SectionBackground): SectionBackground {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  return {
    type: oneOf(o.type, BACKGROUND_TYPES, fallback.type),
    // An explicitly blank colour is a real choice ("let the page show
    // through"), so only a MISSING key falls back.
    color: has("color") ? safeCssColor(o.color) : fallback.color,
    imageUrl: safeImageSrc(has("imageUrl") ? o.imageUrl : fallback.imageUrl),
    imageOpacity: pct(o.imageOpacity, fallback.imageOpacity),
    position: oneOf(o.position, BACKGROUND_POSITIONS, fallback.position),
    size: oneOf(o.size, BACKGROUND_SIZES, fallback.size),
    customSize: pct(o.customSize, fallback.customSize, CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX),
    overlayColor: has("overlayColor") ? safeCssColor(o.overlayColor) : fallback.overlayColor,
    overlayOpacity: pct(o.overlayOpacity, fallback.overlayOpacity),
  };
}

/** Does this background actually paint an image layer? */
export function hasBackgroundImage(bg: SectionBackground): boolean {
  return bg.type !== "color" && !!bg.imageUrl;
}

/** The rendered width we ask ImageKit for — big enough for a full-bleed
 *  section on a laptop, far smaller than a phone-camera original. */
const BACKGROUND_RENDER_WIDTH = 1600;

/** `url("…")` for a CSS custom property. The source is already scheme-checked
 *  by safeImageSrc; quotes, backslashes and newlines are escaped so the value
 *  can never close the string and append its own declarations. */
function cssUrl(src: string): string {
  const escaped = src.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c));
  return `url("${escaped}")`;
}

const POSITION_CSS: Record<BackgroundPosition, string> = {
  center: "center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
};

/**
 * The CSS custom properties that paint `bg`. Spread onto the element's `style`
 * alongside the `sbg` class. Opacities are emitted as 0..1 fractions.
 */
export function backgroundVars(bg: SectionBackground): Record<string, string> {
  const showImage = hasBackgroundImage(bg);
  // "image" alone means the image over NO colour of its own.
  const color = bg.type === "image" ? "transparent" : bg.color || "transparent";
  const src = showImage ? imageUrl(bg.imageUrl, { width: BACKGROUND_RENDER_WIDTH }) : "";
  return {
    "--sbg-color": color,
    "--sbg-image": showImage ? cssUrl(src) : "none",
    "--sbg-image-opacity": showImage ? String(bg.imageOpacity / 100) : "0",
    "--sbg-position": POSITION_CSS[bg.position],
    "--sbg-size": bg.size === "custom" ? `${bg.customSize}% auto` : bg.size,
    "--sbg-overlay": bg.overlayColor || "transparent",
    "--sbg-overlay-opacity": bg.overlayColor ? String(bg.overlayOpacity / 100) : "0",
  };
}
