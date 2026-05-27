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
export const FONT_OPTIONS = [
  "Inter",
  "Playfair Display",
  "Space Grotesk",
  "Oswald",
  "Poppins",
  "Montserrat",
  "Lora",
  "Roboto Slab",
] as const;
export type FontName = (typeof FONT_OPTIONS)[number];

/**
 * Build a Google Fonts stylesheet URL for any number of families.
 * Variadic so callers can load heading + body + a distinct hero font in one
 * request (e.g. `googleFontsUrl(heading, body, heroTitle, heroBody)`).
 */
export function googleFontsUrl(...families: (string | undefined)[]): string {
  const set = new Set<string>();
  for (const f of families) {
    if (f) set.add(f);
  }
  if (set.size === 0) set.add("Inter");
  const params = [...set]
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800`)
    .join("&");
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
