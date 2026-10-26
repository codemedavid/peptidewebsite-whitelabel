import type { AdminBrand } from "@/features/admin/bridge";

/**
 * Card Studio's design model, preset catalog and the pure rules the website
 * admin applies client-side — COPIED from the website (the app cannot import
 * `src/storefront/cardDesign.ts`: it pulls React DOM types and sits outside the
 * `@contract` aliases). Sources:
 *   - types, DEFAULT_CARD_DESIGN, CARD_PRESETS, BORDER_COLOR_PRESETS,
 *     isDarkColor → src/storefront/cardDesign.ts
 *   - normalizeCardDesign / normalizeCardTemplates → src/actions/storefront-admin.ts
 *   - applied-identity rules (template:<id>, "Customized") → src/storefront/admin/AdminCardStudio.tsx
 * The server re-normalizes every save, so drift here can only mis-show a card,
 * never store something the website wouldn't.
 */

/** "text" drops the image entirely (mirrors the website's text-only card). */
export type CardLayout = "vertical" | "horizontal" | "overlay" | "text";
export type CardSurface = "flat" | "glass" | "neumorphic" | "gradient";
export type CardShadow = "none" | "sm" | "md" | "lg" | "glow";
export type CardHover = "none" | "lift" | "grow" | "glow" | "frame" | "tilt";
export type CardButtonStyle = "gradient" | "solid" | "outline" | "soft" | "contrast";
export type CardButtonShape = "pill" | "rounded" | "square";
export type CardBadgeStyle = "solid" | "soft" | "outline" | "mono" | "hidden";
export type CardImageRatio = "square" | "landscape" | "portrait" | "wide";
export type CardSpacing = "compact" | "cozy" | "roomy";
export type CardTitleSize = "sm" | "md" | "lg";
export type CardTitleFont = "display" | "body";
export type CardBorderStyle = "solid" | "dashed" | "dotted";
export type CardTitleWeight = 400 | 500 | 600 | 700 | 800;

export type CardDesign = {
  preset: string;
  layout: CardLayout;
  surface: CardSurface;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
  borderStyle: CardBorderStyle;
  radius: number;
  background: string;
  background2: string;
  textColor: string;
  shadow: CardShadow;
  hover: CardHover;
  titleFont: CardTitleFont;
  titleWeight: CardTitleWeight;
  titleSize: CardTitleSize;
  titleCase: "none" | "uppercase";
  showDesc: boolean;
  buttonStyle: CardButtonStyle;
  buttonColor: string;
  buttonShape: CardButtonShape;
  badgeStyle: CardBadgeStyle;
  imageRatio: CardImageRatio;
  mediaInset: boolean;
  spacing: CardSpacing;
};

export type CardTemplate = { id: string; name: string; design: CardDesign };
export type CardPreset = { id: string; name: string; tagline: string; design: CardDesign };

export const BORDER_COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "Light Gray", value: "#E5E7EB" },
  { name: "Slate", value: "#CBD5E1" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Emerald", value: "#10B981" },
  { name: "Rose", value: "#F43F5E" },
  { name: "Dark Gray", value: "#374151" },
];

/** The website's button swatches: the border list minus the grays. */
export const BUTTON_COLOR_PRESETS = BORDER_COLOR_PRESETS.filter((p) => !p.name.includes("Gray") && p.name !== "Slate");

export const DEFAULT_CARD_DESIGN: CardDesign = {
  preset: "signature",
  layout: "vertical",
  surface: "flat",
  borderEnabled: true,
  borderColor: "",
  borderWidth: 1,
  borderStyle: "solid",
  radius: 24,
  background: "",
  background2: "",
  textColor: "",
  shadow: "sm",
  hover: "lift",
  titleFont: "display",
  titleWeight: 500,
  titleSize: "md",
  titleCase: "none",
  showDesc: true,
  buttonStyle: "gradient",
  buttonColor: "",
  buttonShape: "pill",
  badgeStyle: "solid",
  imageRatio: "square",
  mediaInset: false,
  spacing: "cozy",
};

function preset(id: string, name: string, tagline: string, d: Partial<CardDesign>): CardPreset {
  return { id, name, tagline, design: { ...DEFAULT_CARD_DESIGN, ...d, preset: id } };
}

export const CARD_PRESETS: CardPreset[] = [
  preset("signature", "Signature", "Your theme's classic card", {}),
  preset("minimal", "Minimal", "Quiet, content-first", {
    borderEnabled: false, radius: 12, shadow: "none", hover: "none",
    titleFont: "body", titleWeight: 600, showDesc: false,
    buttonStyle: "outline", buttonShape: "rounded", badgeStyle: "mono",
  }),
  preset("modern-saas", "Modern SaaS", "Crisp, product-led polish", {
    borderColor: "#E2E8F0", radius: 16, background: "#FFFFFF", shadow: "md",
    titleFont: "body", titleWeight: 700,
    buttonStyle: "solid", buttonColor: "#6366F1", buttonShape: "rounded",
    badgeStyle: "soft", imageRatio: "landscape",
  }),
  preset("glassmorphism", "Glassmorphism", "Frosted, translucent glass", {
    surface: "glass", borderColor: "#FFFFFF", radius: 20, background: "#FFFFFF",
    shadow: "lg", hover: "glow", titleFont: "body", titleWeight: 600,
    buttonStyle: "soft",
  }),
  preset("neumorphism", "Neumorphism", "Soft, extruded surfaces", {
    surface: "neumorphic", borderEnabled: false, radius: 24,
    background: "#EEF1F6", textColor: "#39404D", shadow: "none", hover: "grow",
    titleFont: "body", titleWeight: 600, buttonStyle: "soft",
    badgeStyle: "mono", mediaInset: true,
  }),
  preset("luxury", "Luxury / Premium", "Black & gold boutique", {
    background: "#15110C", textColor: "#F3EAD9",
    borderColor: "#C9A961", radius: 6, shadow: "lg", hover: "frame",
    titleWeight: 600, titleCase: "uppercase",
    buttonStyle: "outline", buttonColor: "#C9A961", buttonShape: "square",
    badgeStyle: "outline", imageRatio: "portrait", spacing: "roomy",
  }),
  preset("ecommerce", "E-commerce", "Conversion-focused retail", {
    borderColor: "#E5E7EB", radius: 10, shadow: "sm",
    titleFont: "body", titleWeight: 600, titleSize: "sm", showDesc: false,
    buttonStyle: "solid", buttonColor: "#EA580C", buttonShape: "rounded",
    spacing: "compact",
  }),
  preset("dark-mode", "Dark Mode", "Sleek midnight UI", {
    background: "#0F172A", textColor: "#E2E8F0",
    borderColor: "#283548", radius: 16, shadow: "lg", hover: "glow",
    titleFont: "body", titleWeight: 700,
    buttonStyle: "solid", buttonColor: "#818CF8", buttonShape: "rounded",
    badgeStyle: "soft",
  }),
  preset("marketplace", "Marketplace", "Dense multi-vendor listing", {
    borderColor: "#E2E8F0", radius: 12, shadow: "none", hover: "frame",
    titleFont: "body", titleWeight: 600, titleSize: "sm",
    buttonStyle: "soft", badgeStyle: "soft", imageRatio: "landscape",
    spacing: "compact",
  }),
  preset("bold-marketing", "Bold Marketing", "Loud gradient promo", {
    surface: "gradient", background: "#7C3AED", background2: "#DB2777",
    textColor: "#FFFFFF", borderEnabled: false, radius: 20,
    shadow: "glow", hover: "grow",
    titleFont: "body", titleWeight: 800, titleSize: "lg", titleCase: "uppercase",
    buttonStyle: "contrast", badgeStyle: "mono", imageRatio: "landscape",
  }),
  preset("clean-startup", "Clean Startup", "Airy and friendly", {
    borderEnabled: false, radius: 14, shadow: "sm",
    titleFont: "body", titleWeight: 700,
    buttonStyle: "solid", badgeStyle: "soft",
    imageRatio: "landscape", spacing: "roomy",
  }),
  preset("gradient", "Gradient", "Soft pastel wash", {
    surface: "gradient", background: "#EEF2FF", background2: "#FCE7F3",
    borderEnabled: false, radius: 20, shadow: "md",
    titleWeight: 600, buttonStyle: "gradient",
  }),
  preset("outline", "Outline", "Sharp editorial border", {
    borderColor: "#111827", borderWidth: 2, radius: 4, shadow: "none",
    hover: "frame", titleFont: "body", titleWeight: 700,
    buttonStyle: "outline", buttonColor: "#111827", buttonShape: "square",
    badgeStyle: "outline",
  }),
  preset("soft-shadow", "Soft Shadow", "Floating, borderless", {
    borderEnabled: false, radius: 18, shadow: "lg",
    titleFont: "body", titleWeight: 600,
    buttonStyle: "soft", buttonShape: "rounded", badgeStyle: "soft",
  }),
  preset("compact", "Compact", "Space-efficient grid", {
    borderColor: "#E5E7EB", radius: 12, shadow: "sm",
    titleFont: "body", titleWeight: 600, titleSize: "sm", showDesc: false,
    buttonStyle: "solid", buttonShape: "rounded", badgeStyle: "hidden",
    imageRatio: "landscape", spacing: "compact",
  }),
  preset("feature-rich", "Feature-Rich", "Everything up front", {
    borderColor: "#E2E8F0", radius: 16, shadow: "md",
    titleFont: "body", titleWeight: 700,
    imageRatio: "landscape", spacing: "roomy",
  }),
  preset("mobile-first", "Mobile-First", "Thumb-friendly touch UI", {
    borderEnabled: false, radius: 20, shadow: "sm", hover: "none",
    titleFont: "body", titleWeight: 700, showDesc: false,
    buttonStyle: "solid", badgeStyle: "soft", imageRatio: "wide",
  }),
  preset("side-image", "Side Image", "Horizontal split layout", {
    layout: "horizontal", borderColor: "#E5E7EB", radius: 16, shadow: "sm",
    titleFont: "body", titleWeight: 600,
    buttonStyle: "solid", buttonShape: "rounded", badgeStyle: "soft",
  }),
  preset("bg-image", "Background Image", "Full-bleed photo overlay", {
    layout: "overlay", background: "#1A1A1A", textColor: "#FFFFFF",
    borderEnabled: false, radius: 20, shadow: "lg", hover: "grow",
    titleSize: "lg", titleWeight: 600, showDesc: false,
    buttonStyle: "contrast", badgeStyle: "mono", imageRatio: "portrait",
  }),
  preset("bento", "Bento Style", "Soft rounded tile", {
    background: "#F4F4F5", borderEnabled: false, radius: 28, shadow: "none",
    hover: "grow", titleFont: "body", titleWeight: 700,
    buttonStyle: "soft", badgeStyle: "mono",
    imageRatio: "landscape", mediaInset: true, spacing: "roomy",
  }),
  preset("text-only", "Text Only", "No photo — name and price lead", {
    layout: "text", borderColor: "#E5E7EB", radius: 14, shadow: "none",
    hover: "frame", titleWeight: 700, titleSize: "lg",
    buttonStyle: "solid", buttonShape: "rounded", badgeStyle: "soft",
  }),
  preset("apple", "Apple-Inspired", "Understated precision", {
    background: "#F5F5F7", textColor: "#1D1D1F",
    borderEnabled: false, radius: 18, shadow: "sm", hover: "grow",
    titleFont: "body", titleWeight: 600,
    buttonStyle: "solid", buttonColor: "#0071E3", badgeStyle: "hidden",
    spacing: "roomy",
  }),
];

/** True when the design renders no product image at all. */
export function isTextOnlyCard(d: Pick<CardDesign, "layout">): boolean {
  return d.layout === "text";
}

export function getCardPreset(id: string): CardPreset | undefined {
  return CARD_PRESETS.find((p) => p.id === id);
}

// ── limits (the website's sliders / server clamps) ──────────────────────────

export const BORDER_WIDTH_MIN = 1;
export const BORDER_WIDTH_MAX = 6;
export const RADIUS_MIN = 0;
export const RADIUS_MAX = 32;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATES_MAX = 30;
export const COMPARE_MAX = 4;
const TEMPLATE_PREFIX = "template:";

// ── colour helpers ──────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const isHex = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v.trim());

/** #RGB / #RRGGBB / #RRGGBBAA → [r, g, b] (alpha dropped); null when not hex. */
export function hexRgb(hex: string): [number, number, number] | null {
  const s = hex.trim();
  if (!HEX_RE.test(s)) return null;
  const body = s.length === 4 ? s.slice(1).split("").map((c) => c + c).join("") : s.slice(1, 7);
  const n = parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Approximate luminance (0–255); non-hex → 255 (light), as on the website. */
export function luma(hex: string): number {
  const rgb = hexRgb(hex);
  if (!rgb) return 255;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

const DARK_LUMA = 140;
const LIGHT_LABEL_LUMA = 168;
export const isDarkColor = (hex: string) => luma(hex) < DARK_LUMA;
/** The label colour the website picks for a custom button colour. */
export const labelOn = (hex: string) => (luma(hex) < LIGHT_LABEL_LUMA ? "#FFFFFF" : "#111827");

/** `a` mixed with `b` at `pct`% of `a` (CSS color-mix in srgb). Non-hex `a` → `b`. */
export function mix(a: string, b: string, pct: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b) ?? [255, 255, 255];
  if (!x) return b;
  const p = pct / 100;
  const ch = (i: number) => Math.round(x[i] * p + y[i] * (1 - p)).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/** `hex` at `alpha` (0–1) as rgba(); non-hex falls back to `hex` unchanged. */
export function alpha(hex: string, a: number): string {
  const rgb = hexRgb(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : hex;
}

// ── normalizers (mirror the server's) ───────────────────────────────────────

function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return allowed.includes(v as T) ? (v as T) : dflt;
}
function num(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : dflt;
}
const color = (v: unknown) => (isHex(v) ? v.trim() : "");

export function normalizeCardDesign(input: unknown): CardDesign {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_CARD_DESIGN;
  return {
    preset: String(o.preset ?? "custom").slice(0, 64),
    layout: oneOf(o.layout, ["vertical", "horizontal", "overlay", "text"] as const, d.layout),
    surface: oneOf(o.surface, ["flat", "glass", "neumorphic", "gradient"] as const, d.surface),
    borderEnabled: o.borderEnabled !== false,
    borderColor: color(o.borderColor),
    borderWidth: num(o.borderWidth, 1, 8, d.borderWidth),
    borderStyle: oneOf(o.borderStyle, ["solid", "dashed", "dotted"] as const, d.borderStyle),
    radius: num(o.radius, 0, 40, d.radius),
    background: color(o.background),
    background2: color(o.background2),
    textColor: color(o.textColor),
    shadow: oneOf(o.shadow, ["none", "sm", "md", "lg", "glow"] as const, d.shadow),
    hover: oneOf(o.hover, ["none", "lift", "grow", "glow", "frame", "tilt"] as const, d.hover),
    titleFont: oneOf(o.titleFont, ["display", "body"] as const, d.titleFont),
    titleWeight: (Math.round(num(o.titleWeight, 400, 800, d.titleWeight) / 100) * 100) as CardTitleWeight,
    titleSize: oneOf(o.titleSize, ["sm", "md", "lg"] as const, d.titleSize),
    titleCase: oneOf(o.titleCase, ["none", "uppercase"] as const, d.titleCase),
    showDesc: o.showDesc !== false,
    buttonStyle: oneOf(o.buttonStyle, ["gradient", "solid", "outline", "soft", "contrast"] as const, d.buttonStyle),
    buttonColor: color(o.buttonColor),
    buttonShape: oneOf(o.buttonShape, ["pill", "rounded", "square"] as const, d.buttonShape),
    badgeStyle: oneOf(o.badgeStyle, ["solid", "soft", "outline", "mono", "hidden"] as const, d.badgeStyle),
    imageRatio: oneOf(o.imageRatio, ["square", "landscape", "portrait", "wide"] as const, d.imageRatio),
    mediaInset: o.mediaInset === true,
    spacing: oneOf(o.spacing, ["compact", "cozy", "roomy"] as const, d.spacing),
  };
}

/** The applied design, or null when the store uses the classic card. */
export function brandCardDesign(brand: AdminBrand): CardDesign | null {
  const raw = brand.cardDesign;
  return raw && typeof raw === "object" ? normalizeCardDesign(raw) : null;
}

export function normalizeCardTemplates(input: unknown): CardTemplate[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, TEMPLATES_MAX).map((t, i) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    return {
      id: String(o.id ?? `ct${i + 1}`).slice(0, 64),
      name: String(o.name ?? "").slice(0, TEMPLATE_NAME_MAX).trim() || `Template ${i + 1}`,
      design: normalizeCardDesign(o.design),
    };
  });
}

// ── applied identity (AdminCardStudio) ──────────────────────────────────────

export const presetKey = (id: string) => `p:${id}`;
export const templateKey = (id: string) => `t:${id}`;

/** Applying a template stamps the design with the template's identity. */
export const stampTemplate = (t: CardTemplate): CardDesign => ({ ...t.design, preset: `${TEMPLATE_PREFIX}${t.id}` });

export type Applied = {
  /** Gallery key of the applied tile (`p:<id>` / `t:<id>`), null = classic card. */
  key: string | null;
  /** What the design started from, for the "Customized" check. */
  name: string;
  customized: boolean;
};

export function appliedIdentity(design: CardDesign | null, templates: readonly CardTemplate[]): Applied {
  if (!design) return { key: null, name: "Classic", customized: false };
  const template = design.preset.startsWith(TEMPLATE_PREFIX)
    ? templates.find((t) => t.id === design.preset.slice(TEMPLATE_PREFIX.length))
    : undefined;
  const presetDef = template ? undefined : getCardPreset(design.preset);
  const baseline = presetDef?.design ?? (template ? { ...template.design, preset: design.preset } : undefined);
  return {
    key: template ? templateKey(template.id) : presetKey(design.preset),
    name: presetDef?.name ?? template?.name ?? "Custom",
    customized: !!baseline && JSON.stringify(design) !== JSON.stringify(baseline),
  };
}

export const newTemplateId = () => `ct${Date.now()}`;
