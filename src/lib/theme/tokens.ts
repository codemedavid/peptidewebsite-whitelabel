/**
 * Brand token roles — the friendly, tenant-editable knobs.
 * Each role maps to one or more shadcn CSS variables in resolve-css-vars.ts.
 * Stored as HSL channel triples ("H S% L%") so they slot into hsl(var(--x)).
 *
 * Note: `button` is intentionally separate from `accent` and `main` — a tenant
 * may want blue accents but a green CTA button.
 */
export const ROLE_KEYS = [
  "main",
  "accent",
  "button",
  "buttonText",
  "background",
  "surface",
  "text",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_META: Record<RoleKey, { label: string; help: string }> = {
  main: { label: "Main", help: "Brand color — logo text, headings, key surfaces" },
  accent: { label: "Accent", help: "Links, highlights, focus rings, active states" },
  button: { label: "Button", help: "Primary / CTA button background" },
  buttonText: { label: "Button text", help: "Text + icons on primary buttons" },
  background: { label: "Background", help: "Page background" },
  surface: { label: "Surface", help: "Cards and secondary surfaces" },
  text: { label: "Text", help: "Body text color" },
};

// Which shadcn CSS vars each role drives.
export const ROLE_TO_TOKENS: Record<RoleKey, string[]> = {
  background: ["background"],
  surface: ["card", "secondary", "muted"],
  text: ["foreground", "card-foreground", "secondary-foreground"],
  main: ["brand"],
  accent: ["accent", "ring"],
  button: ["primary"],
  buttonText: ["primary-foreground", "accent-foreground"],
};

// Which preset token a role inherits from when the tenant hasn't overridden it.
import { THEME_PRESETS, DEFAULT_THEME } from "./presets";

const ROLE_FROM_PRESET: Record<RoleKey, keyof typeof DEFAULT_THEME.colors> = {
  main: "primary",
  accent: "accent",
  button: "primary",
  buttonText: "primary-foreground",
  background: "background",
  surface: "card",
  text: "foreground",
};

/** The HSL triple a role shows by default for a given preset. */
export function presetTripleForRole(themeId: string, role: RoleKey): string {
  const preset = THEME_PRESETS[themeId] ?? DEFAULT_THEME;
  return preset.colors[ROLE_FROM_PRESET[role]];
}

// ── Google Fonts available to tenants ──
//
// FONT_REGISTRY is the single source of truth for which Google fonts the
// storefront can request and exactly which weights/italics each family offers.
// The Google Fonts css2 endpoint is STRICT: requesting a weight a family lacks
// (e.g. Oswald has no 800) returns HTTP 400 for the *entire* stylesheet, which
// silently breaks every font on the page. So we never request a fixed weight
// range — we look each family up here and emit only what it actually has.
type FontEntry = {
  /** Available weights we expose, within the 400–800 range the UI offers. */
  weights: number[];
  /** Whether the family ships an italic style. */
  italic: boolean;
  /** Generic CSS fallback so text still reads if the webfont fails to load. */
  fallback: "serif" | "sans-serif";
};

export const FONT_REGISTRY: Record<string, FontEntry> = {
  // Sans
  Inter: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  "DM Sans": { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  Manrope: { weights: [400, 500, 600, 700, 800], italic: false, fallback: "sans-serif" },
  Poppins: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  Montserrat: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  "Work Sans": { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  "Space Grotesk": { weights: [400, 500, 600, 700], italic: false, fallback: "sans-serif" },
  Sora: { weights: [400, 500, 600, 700, 800], italic: false, fallback: "sans-serif" },
  Outfit: { weights: [400, 500, 600, 700, 800], italic: false, fallback: "sans-serif" },
  Figtree: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  "Plus Jakarta Sans": { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  "IBM Plex Sans": { weights: [400, 500, 600, 700], italic: true, fallback: "sans-serif" },
  Archivo: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "sans-serif" },
  Oswald: { weights: [400, 500, 600, 700], italic: false, fallback: "sans-serif" },
  Syne: { weights: [400, 500, 600, 700, 800], italic: false, fallback: "sans-serif" },
  "Bebas Neue": { weights: [400], italic: false, fallback: "sans-serif" },
  // Serif / display
  "Playfair Display": { weights: [400, 500, 600, 700, 800], italic: true, fallback: "serif" },
  "DM Serif Display": { weights: [400], italic: true, fallback: "serif" },
  "Cormorant Garamond": { weights: [400, 500, 600, 700], italic: true, fallback: "serif" },
  Lora: { weights: [400, 500, 600, 700], italic: true, fallback: "serif" },
  "Libre Baskerville": { weights: [400, 700], italic: true, fallback: "serif" },
  Fraunces: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "serif" },
  Spectral: { weights: [400, 500, 600, 700, 800], italic: true, fallback: "serif" },
  Marcellus: { weights: [400], italic: false, fallback: "serif" },
  "Bodoni Moda": { weights: [400, 500, 600, 700, 800], italic: true, fallback: "serif" },
  "Roboto Slab": { weights: [400, 500, 600, 700, 800], italic: false, fallback: "serif" },
};

/** Every selectable font, in registry (curated) order. */
export const FONT_OPTIONS = Object.keys(FONT_REGISTRY) as readonly string[];
export type FontName = string;

/** CSS `font-family` value for a registered font, with its generic fallback. */
export function fontFamilyValue(name?: string): string | undefined {
  if (!name) return undefined;
  const generic = FONT_REGISTRY[name]?.fallback ?? "sans-serif";
  return `'${name}', ${generic}`;
}

/** The css2 query fragment for one family (`family=…`), requesting only the
 *  weights/styles it actually offers. Unknown families fall back to the bare
 *  form, which Google resolves to the family's default styles. */
function familySpec(name: string): string {
  const fam = `family=${name.replace(/ /g, "+")}`;
  const entry = FONT_REGISTRY[name];
  // Unknown family, or a single-weight family with no italic (e.g. Marcellus,
  // Bebas Neue): css2 rejects an explicit `:wght@400` axis here, so go bare.
  if (!entry || (entry.weights.length === 1 && !entry.italic)) return fam;
  const ws = entry.weights;
  if (entry.italic) {
    const tuples = [...ws.map((w) => `0,${w}`), ...ws.map((w) => `1,${w}`)];
    return `${fam}:ital,wght@${tuples.join(";")}`;
  }
  return `${fam}:wght@${ws.join(";")}`;
}

/**
 * Build a Google Fonts stylesheet URL for any number of families.
 * Variadic so callers can load heading + body + distinct hero fonts in one
 * request (e.g. `googleFontsUrl(heading, body, heroTitle, heroBody, ...fields)`).
 */
export function googleFontsUrl(...families: (string | undefined)[]): string {
  const set = new Set<string>();
  for (const f of families) {
    if (f) set.add(f);
  }
  if (set.size === 0) set.add("Inter");
  const params = [...set].map(familySpec).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

// ── Hero typography ──
// Friendly presets that clamp on mobile so the hero never overflows; the
// editor exposes these by key, the Hero renders the resolved values inline.

export const TITLE_SIZES = ["sm", "md", "lg", "xl"] as const;
export type TitleSize = (typeof TITLE_SIZES)[number];

export const BODY_SIZES = ["sm", "md", "lg"] as const;
export type BodySize = (typeof BODY_SIZES)[number];

/** Title size → responsive clamp(min, fluid, max). */
export const TITLE_SIZE_CLAMP: Record<TitleSize, string> = {
  sm: "clamp(1.5rem, 3vw, 2rem)",
  md: "clamp(1.75rem, 4vw, 2.5rem)",
  lg: "clamp(2rem, 4.5vw, 3rem)",
  xl: "clamp(1.75rem, 5vw, 3.5rem)",
};

/** Body size → responsive clamp. */
export const BODY_SIZE_CLAMP: Record<BodySize, string> = {
  sm: "1rem",
  md: "clamp(1rem, 2vw, 1.125rem)",
  lg: "clamp(1.0625rem, 2.5vw, 1.25rem)",
};

// The white-label storefront hero is a bolder display headline than the generic
// shadcn Hero, so it uses its own (larger) clamps. `xl`/`md` match the existing
// storefront.css defaults, so leaving the controls on default is a no-op.
/** Storefront hero title size → responsive clamp. */
export const STOREFRONT_HERO_TITLE_CLAMP: Record<TitleSize, string> = {
  sm: "clamp(28px, 5vw, 48px)",
  md: "clamp(32px, 6.5vw, 64px)",
  lg: "clamp(36px, 7vw, 80px)",
  xl: "clamp(40px, 8vw, 96px)",
};
/** Storefront hero body size → responsive clamp. */
export const STOREFRONT_HERO_BODY_CLAMP: Record<BodySize, string> = {
  sm: "clamp(14px, 1.2vw, 16px)",
  md: "clamp(15px, 1.4vw, 18px)",
  lg: "clamp(16px, 1.6vw, 20px)",
};

export const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const WEIGHT_LABELS: Record<FontWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extrabold",
};

export const HERO_ALIGNS = ["left", "center"] as const;
export type HeroAlign = (typeof HERO_ALIGNS)[number];

/**
 * Per-tenant hero typography overrides. Every field is optional — anything
 * unset inherits from the active theme (title→heading font, body→body font,
 * highlight→accent) via the CSS vars on the storefront wrapper.
 */
export type HeroTypography = {
  titleFont?: string;
  titleSize?: TitleSize;
  titleWeight?: FontWeight;
  bodyFont?: string;
  bodySize?: BodySize;
  highlightColor?: string; // hex
  align?: HeroAlign;
};

// ── Per-field hero text styling ──
// Beyond the grouped title/body typography above, each individual hero copy
// element can carry its own style overrides (font, size, weight, italic,
// transform, tracking). Everything is optional; unset attributes inherit the
// grouped hero typography, then the storefront.css defaults.

/** The hero copy elements that expose independent text-style controls. */
export const HERO_TEXT_FIELDS = [
  { key: "chip", label: "Chip label" },
  { key: "line1", label: "Line 1" },
  { key: "line2", label: "Line 2 (italic)" },
  { key: "sub", label: "Subhead" },
  { key: "cta1", label: "Primary CTA" },
  { key: "cta2", label: "Secondary CTA" },
] as const;
export type HeroTextField = (typeof HERO_TEXT_FIELDS)[number]["key"];

export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

/** Friendly letter-spacing presets → em values. */
export const LETTER_SPACINGS: Record<string, number> = {
  Tighter: -0.04,
  Tight: -0.02,
  Normal: 0,
  Wide: 0.04,
  Wider: 0.08,
};

/** Absolute font sizes (px) the per-field size picker offers. */
export const HERO_FIELD_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96] as const;

/** One hero copy element's optional style overrides. */
export type HeroFieldStyle = {
  font?: string; // family name; unset = inherit grouped/theme font
  size?: number; // absolute px; rendered as a responsive clamp
  weight?: FontWeight;
  italic?: boolean;
  transform?: TextTransform;
  letterSpacing?: number; // em
};

/** Render an absolute px size as a responsive clamp so it never overflows on
 *  mobile (min ≈ 60% of the chosen size, fluid in between). */
export function heroFieldSizeClamp(px?: number): string | undefined {
  if (!px) return undefined;
  const min = Math.round(px * 0.6);
  const vw = (px / 10).toFixed(2);
  return `clamp(${min}px, ${vw}vw, ${px}px)`;
}

/** Resolve a HeroFieldStyle to inline CSS (only the set attributes). */
export function heroFieldCss(style?: HeroFieldStyle): import("react").CSSProperties {
  if (!style) return {};
  const css: import("react").CSSProperties = {};
  if (style.font) css.fontFamily = fontFamilyValue(style.font);
  if (style.size) css.fontSize = heroFieldSizeClamp(style.size);
  if (style.weight) css.fontWeight = style.weight;
  if (style.italic !== undefined) css.fontStyle = style.italic ? "italic" : "normal";
  if (style.transform) css.textTransform = style.transform;
  if (style.letterSpacing !== undefined) css.letterSpacing = `${style.letterSpacing}em`;
  return css;
}

// ── HSL <-> HEX (color pickers speak hex; our CSS vars speak "H S% L%") ──

export function hexToHslTriple(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const light = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%`;
}

export function hslTripleToHex(triple: string): string {
  const m = triple.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return "#000000";
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative-luminance contrast ratio between two HSL triples (WCAG). */
export function contrastRatio(tripleA: string, tripleB: string): number {
  const lum = (triple: string) => {
    const hex = hslTripleToHex(triple).replace("#", "");
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const a = lum(tripleA);
  const b = lum(tripleB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
