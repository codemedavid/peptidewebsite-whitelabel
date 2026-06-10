// Product Card Design Studio — the design model, preset catalog and the
// style/attribute bridge that turns a CardDesign into CSS custom properties +
// data attributes consumed by storefront.css (`.product-card[data-cd]`).
//
// A tenant's chosen design lives in `brand.cardDesign` (branding.config JSON),
// saved templates in `brand.cardTemplates`. No design set → the card renders
// exactly as before (no [data-cd] attribute, zero visual change).

import type { CSSProperties } from "react";

export type CardLayout = "vertical" | "horizontal" | "overlay";
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

export type CardDesign = {
  /** Preset id this design started from (for gallery highlighting). */
  preset: string;
  layout: CardLayout;
  surface: CardSurface;

  // Border
  borderEnabled: boolean;
  /** Hex; "" inherits the theme border color. */
  borderColor: string;
  borderWidth: number;
  borderStyle: CardBorderStyle;
  /** Corner radius in px (0–32). */
  radius: number;

  // Colors — "" inherits the active theme.
  background: string;
  /** Second gradient stop (surface: "gradient"). "" derives from background. */
  background2: string;
  /** Card text color override; "" keeps theme heading/body colors. */
  textColor: string;

  shadow: CardShadow;
  hover: CardHover;

  // Typography
  titleFont: CardTitleFont;
  titleWeight: 400 | 500 | 600 | 700 | 800;
  titleSize: CardTitleSize;
  titleCase: "none" | "uppercase";
  showDesc: boolean;

  // Button
  buttonStyle: CardButtonStyle;
  /** Hex; "" inherits the theme button color. */
  buttonColor: string;
  buttonShape: CardButtonShape;

  badgeStyle: CardBadgeStyle;

  // Image
  imageRatio: CardImageRatio;
  /** Inset the image inside the card with its own rounded corners (bento). */
  mediaInset: boolean;

  spacing: CardSpacing;
};

export type CardTemplate = { id: string; name: string; design: CardDesign };

export type CardPreset = {
  id: string;
  name: string;
  tagline: string;
  design: CardDesign;
};

/** Recommended border colors surfaced as one-tap presets in the studio. */
export const BORDER_COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "Light Gray", value: "#E5E7EB" },
  { name: "Slate", value: "#CBD5E1" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Emerald", value: "#10B981" },
  { name: "Rose", value: "#F43F5E" },
  { name: "Dark Gray", value: "#374151" },
];

/** The card as it ships today — the fallback and the "Signature" preset. */
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
  preset("apple", "Apple-Inspired", "Understated precision", {
    background: "#F5F5F7", textColor: "#1D1D1F",
    borderEnabled: false, radius: 18, shadow: "sm", hover: "grow",
    titleFont: "body", titleWeight: 600,
    buttonStyle: "solid", buttonColor: "#0071E3", badgeStyle: "hidden",
    spacing: "roomy",
  }),
];

export function getCardPreset(id: string): CardPreset | undefined {
  return CARD_PRESETS.find((p) => p.id === id);
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Approximate luminance (0–255) of a #RRGGBB color; non-hex → 255 (light). */
function luma(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex.trim());
  if (!m) return 255;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relative luminance check — drives qty-stepper/divider inversion on dark cards. */
export function isDarkColor(hex: string): boolean {
  return luma(hex) < 140;
}

const TITLE_PX: Record<CardTitleSize, number> = { sm: 17, md: 20, lg: 23 };
const PAD_PX: Record<CardSpacing, number> = { compact: 14, cozy: 20, roomy: 26 };
const RATIO_CSS: Record<CardImageRatio, string> = {
  square: "1 / 1",
  landscape: "4 / 3",
  portrait: "3 / 4",
  wide: "16 / 9",
};
const BTN_RADIUS: Record<CardButtonShape, string> = {
  pill: "999px",
  rounded: "12px",
  square: "6px",
};

/**
 * Bridge a CardDesign to the article element: inline `--cd-*` custom
 * properties (colors, radius, border, sizes) + `data-cd-*` attributes that
 * select the behavioral variants in storefront.css.
 */
export function cardDesignAttrs(d: CardDesign): {
  style: CSSProperties;
  data: Record<string, string>;
} {
  const vars: Record<string, string> = {};

  // Every value interpolated into the style attribute is re-validated HERE,
  // not only in the save action's normalizer — branding.config can also be
  // written via the platform admin's whole-blob save, so the render path
  // never trusts the blob (a free-string borderStyle/titleCase would otherwise
  // ride into the style attribute).
  const bg = HEX_RE.test(d.background) ? d.background : "";
  const bg2 = HEX_RE.test(d.background2) ? d.background2 : "";
  const text = HEX_RE.test(d.textColor) ? d.textColor : "";
  const borderColor = HEX_RE.test(d.borderColor) ? d.borderColor : "";
  const btn = HEX_RE.test(d.buttonColor) ? d.buttonColor : "";
  const borderStyle: CardBorderStyle =
    d.borderStyle === "dashed" || d.borderStyle === "dotted" ? d.borderStyle : "solid";
  const radius = Number.isFinite(d.radius) ? Math.max(0, Math.min(40, d.radius)) : 24;
  const borderWidth = Number.isFinite(d.borderWidth) ? Math.max(1, Math.min(8, d.borderWidth)) : 1;

  vars["--cd-radius"] = `${radius}px`;
  vars["--cd-border"] = d.borderEnabled
    ? `${borderWidth}px ${borderStyle} ${borderColor || "var(--brand-border)"}`
    : "none";
  if (borderColor) vars["--cd-border-color"] = borderColor;
  vars["--cd-bg"] = bg || "var(--brand-surface)";
  if (d.surface === "gradient") {
    vars["--cd-bg2"] = bg2 || `color-mix(in srgb, ${bg || "var(--brand-surface)"} 55%, var(--brand-surface-2))`;
  }

  // Card text. An explicit textColor wins; otherwise a dark custom background
  // (or the overlay scrim) auto-switches to light text so a dark background
  // without a hand-picked text color can never render dark-on-dark.
  const bgDark = !!bg && isDarkColor(bg);
  if (text) {
    vars["--cd-heading"] = text;
    vars["--cd-body"] = `color-mix(in srgb, ${text} 76%, transparent)`;
  } else if (d.layout === "overlay" || bgDark) {
    vars["--cd-heading"] = "#FFFFFF";
    vars["--cd-body"] = "rgba(255, 255, 255, 0.82)";
  }
  const dark = d.layout === "overlay" || bgDark || (!!text && isDarkColor(bg || "#ffffff"));

  vars["--cd-btn"] = btn || "var(--brand-button)";
  // Custom button color: derive the gradient's second stop and a readable
  // label color; inherited color keeps the theme's configured pair.
  vars["--cd-btn2"] = btn
    ? `color-mix(in srgb, ${btn} 55%, #ffffff)`
    : "var(--brand-button-2)";
  vars["--cd-btn-text"] = btn
    ? luma(btn) < 168 ? "#FFFFFF" : "#111827"
    : "var(--brand-button-text)";
  vars["--cd-btn-radius"] = BTN_RADIUS[d.buttonShape] ?? "999px";
  vars["--cd-title-font"] =
    d.titleFont === "display" ? "var(--brand-heading-font)" : "var(--brand-body-font)";
  vars["--cd-title-weight"] = String(Number.isFinite(d.titleWeight) ? d.titleWeight : 500);
  vars["--cd-title-px"] = `${TITLE_PX[d.titleSize] ?? 20}px`;
  vars["--cd-title-case"] = d.titleCase === "uppercase" ? "uppercase" : "none";
  vars["--cd-pad"] = `${PAD_PX[d.spacing] ?? 20}px`;
  vars["--cd-ratio"] = RATIO_CSS[d.imageRatio] ?? "1 / 1";

  const shadowMap: Record<CardShadow, string> = {
    none: "none",
    sm: "var(--shadow-sm)",
    md: "var(--shadow-md)",
    lg: "var(--shadow-lg)",
    glow: `0 10px 40px -8px color-mix(in srgb, ${btn || "var(--brand-accent)"} 45%, transparent)`,
  };
  vars["--cd-shadow"] = shadowMap[d.shadow] ?? shadowMap.sm;

  const data: Record<string, string> = {
    "data-cd": "1",
    "data-cd-layout": d.layout,
    "data-cd-surface": d.surface,
    "data-cd-hover": d.hover,
    "data-cd-btn": d.buttonStyle,
    "data-cd-badge": d.badgeStyle,
  };
  if (dark) data["data-cd-dark"] = "1";
  if (d.mediaInset) data["data-cd-inset"] = "1";
  if (!d.showDesc) data["data-cd-desc"] = "0";

  return { style: vars as CSSProperties, data };
}
