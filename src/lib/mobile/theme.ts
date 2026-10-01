import { createHash } from "node:crypto";
import type { MobileBrandTheme, MobileBrandFonts, MobilePalette } from "./contract";

/**
 * Website branding → the signed-in app's theme, so a store's admin app looks
 * like its storefront: same page background, card surface, text, header and
 * fonts (merged exactly like storefront-home.tsx: theme preset < config).
 *
 * The website's palette was designed for a storefront, not for an admin tool
 * that must stay legible in the sun, so this is a TRANSLATION, not a copy:
 *   - background / surface / header are used as-is; every text colour laid on
 *     them (body, muted, links, header text) is nudged until it reaches AA;
 *   - the button colour becomes `primary` (CTAs, active tab, selected controls);
 *   - `onPrimary` is the website's button text colour when it is readable,
 *     otherwise the best of white / near-black (always ≥ 4.5:1);
 *   - `primaryText` / `primaryTextDark` are the primary nudged just far enough
 *     to read as link text on the app's light / dark surfaces;
 *   - status colours are NOT here on purpose — "paid", "cancelled" and "low
 *     stock" must mean the same colour in every tenant, so the app owns them.
 *
 * Anything missing or malformed falls back to a neutral Pepweb default.
 * Pure (npm run test:mobile-core).
 */

const WHITE = "#ffffff";
const INK = "#111111";
const BLACK = "#000000";
/** The app's dark-mode surface (mobile/src/theme/tokens.ts keeps the same value). */
const DARK_SURFACE = "#15171c";
const AA = 4.5;
/** Non-text graphics (chart lines, bars) need 3:1 (WCAG 1.4.11). */
const AA_GRAPHIC = 3;
/** Below this background luminance the website is a dark site → dark app. */
const DARK_LUMINANCE = 0.18;

export const DEFAULT_MOBILE_THEME = {
  primary: "#1f5f4a",
  accent: "#c8a24a",
  background: "#ffffff",
  surface: "#ffffff",
  text: "#1d1b16",
  textDark: "#f2efe8",
} as const;

export type ThemeInput = {
  name: string | null | undefined;
  logoUrl?: string | null;
  palette: {
    main?: string;
    accent?: string;
    button?: string;
    buttonText?: string;
    headerBg?: string;
    headerText?: string;
    background?: string;
    surface?: string;
    text?: string;
    borderColor?: string;
    headingFont?: string;
    bodyFont?: string;
  };
  fontFiles?: MobileBrandFonts["files"];
};

// ── colour maths ─────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

function parseHex(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two hex colours (1–21). Invalid input → 1. */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
}

/** Move `color` toward `toward` in 5% steps until it reaches `min` on every surface. */
function readableOn(color: string, surface: string | string[], toward: string, min = AA): string {
  const surfaces = Array.isArray(surface) ? surface : [surface];
  const c = parseHex(color)!;
  const t = parseHex(toward)!;
  for (let step = 0; step <= 20; step++) {
    const candidate = toHex(mix(c, t, step / 20));
    if (surfaces.every((s) => contrastRatio(candidate, s) >= min)) return candidate;
  }
  return toward;
}

/** White or near-black — whichever reads better on `background`. */
function extremeFor(background: string): string {
  return contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK;
}

/** `a` blended `t` of the way to `b` (both valid hex). */
function blend(a: string, b: string, t: number): string {
  return toHex(mix(parseHex(a)!, parseHex(b)!, t));
}

function isDark(color: string): boolean {
  return luminance(parseHex(color)!) < DARK_LUMINANCE;
}

function pickOnColor(preferred: string | null, background: string): string {
  if (preferred && contrastRatio(preferred, background) >= AA) return preferred;
  if (contrastRatio(WHITE, background) >= AA) return WHITE;
  return contrastRatio(INK, background) >= AA ? INK : BLACK;
}

// ── field sanitisers ─────────────────────────────────────────────────────────

function hexOr(value: unknown, fallback: string): string {
  const rgb = parseHex(value);
  return rgb ? toHex(rgb) : fallback;
}

function fontName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^[A-Za-z0-9 \-]{1,60}$/.test(v) ? v : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 2048 ? v : null;
}

function cleanFontFiles(files: ThemeInput["fontFiles"]): MobileBrandFonts["files"] {
  const out: MobileBrandFonts["files"] = {};
  for (const key of ["heading", "headingBold", "body", "bodyBold"] as const) {
    const url = httpsUrl(files?.[key]);
    if (url) out[key] = url;
  }
  return out;
}

// ── builder ──────────────────────────────────────────────────────────────────

type Header = { background: string; text: string; explicit: boolean };

/** The site header: its own override, else the storefront default (surface + brand text). */
function buildHeader(p: ThemeInput["palette"], surface: string, brandText: string): Header {
  const explicit = !!parseHex(p.headerBg);
  const background = explicit ? hexOr(p.headerBg, surface) : surface;
  const preferred = parseHex(p.headerText) ? hexOr(p.headerText, brandText) : brandText;
  return { background, text: readableOn(preferred, background, extremeFor(background)), explicit };
}

function buildPalette(
  p: ThemeInput["palette"],
  primary: string,
  accent: string,
  header: Header,
  main: string,
): MobilePalette {
  const bg = hexOr(p.background, DEFAULT_MOBILE_THEME.background);
  const surface = hexOr(p.surface, bg);
  const scheme = isDark(bg) ? "dark" : "light";
  const toward = scheme === "dark" ? WHITE : BLACK;
  const surfaces = [bg, surface];
  const textDefault = scheme === "dark" ? DEFAULT_MOBILE_THEME.textDark : DEFAULT_MOBILE_THEME.text;
  const text = readableOn(hexOr(p.text, textDefault), surfaces, toward);

  // The dark block behind the sales hero: the site's own header when the owner
  // set one (e.g. a black bar), otherwise the brand's main colour.
  const band = header.explicit ? header.background : main;
  const bandText = header.explicit ? header.text : extremeFor(band);

  return {
    scheme,
    bg,
    surface,
    surfaceAlt: blend(bg, text, 0.045),
    border: parseHex(p.borderColor) ? hexOr(p.borderColor, surface) : blend(surface, text, 0.14),
    text,
    textMuted: readableOn(blend(text, bg, 0.3), surfaces, toward),
    textFaint: readableOn(blend(text, bg, 0.45), surfaces, toward),
    band,
    bandText,
    bandMuted: readableOn(blend(bandText, band, 0.25), band, bandText),
    bandLine: blend(bandText, band, 0.8),
    chart: readableOn(primary, surfaces, toward, AA_GRAPHIC),
    chartOnBand: readableOn(accent, band, bandText, AA_GRAPHIC),
    chartTrack: blend(surface, text, 0.1),
  };
}

export function buildMobileTheme(input: ThemeInput): MobileBrandTheme {
  const p = input.palette ?? {};
  const primary = hexOr(p.button ?? p.main, DEFAULT_MOBILE_THEME.primary);
  const main = hexOr(p.main, primary);
  const accent = hexOr(p.accent, DEFAULT_MOBILE_THEME.accent);
  const buttonText = parseHex(p.buttonText) ? hexOr(p.buttonText, WHITE) : null;
  const bg = hexOr(p.background, DEFAULT_MOBILE_THEME.background);
  const surface = hexOr(p.surface, bg);
  const header = buildHeader(p, surface, main);
  const palette = buildPalette(p, primary, accent, header, main);
  const linkToward = palette.scheme === "dark" ? WHITE : BLACK;

  const base: Omit<MobileBrandTheme, "version"> = {
    name: (input.name ?? "").trim().slice(0, 80) || "Your store",
    logoUrl: httpsUrl(input.logoUrl),
    primary,
    onPrimary: pickOnColor(buttonText, primary),
    primaryText: readableOn(primary, [palette.bg, palette.surface], linkToward),
    primaryTextDark: readableOn(primary, DARK_SURFACE, WHITE),
    accent,
    headerBackground: header.background,
    headerText: header.text,
    fonts: {
      heading: fontName(p.headingFont),
      body: fontName(p.bodyFont),
      files: cleanFontFiles(input.fontFiles),
    },
    palette,
  };

  const version = createHash("sha256").update(JSON.stringify(base)).digest("hex").slice(0, 16);
  return { version, ...base };
}
