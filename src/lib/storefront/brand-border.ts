// Brand border core — the pure module behind the branding editors' "Border"
// controls (platform BrandingEditor + store-admin BrandTweaksForm) and the
// storefront's applyBrandStyle. The stored values are optional overrides on
// branding.config: `borderColor` (hex) recolors every `--brand-border`
// hairline/panel/card frame, `borderWidth` (px, 1–6) thickens the standard
// 1px borders via `--brand-border-width`. Unset = the pre-feature look (theme
// default border color, 1px), so existing tenants are unaffected.
//
// Values come from untrusted JSON and land in inline style custom properties,
// so normalization fails closed: anything that isn't a #hex color / finite
// positive number resolves to undefined and the stylesheet defaults win.
//
// Tested by scripts/test-brand-border.ts (npm run test:brand-border).

/** #RGB or #RRGGBB — mirrors cardDesign's hex discipline. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Hard ceiling: anything thicker reads as a frame, not a border. */
export const MAX_BORDER_WIDTH = 6;

export type BrandBorder = {
  borderColor?: string;
  borderWidth?: number;
};

/**
 * Friendly preset menu for the width select, mirroring LOGO_CURVE_PRESETS:
 * the first entry stores undefined so the key is pruned from branding.config
 * and the stylesheet's 1px default keeps applying for existing tenants.
 */
export const BRAND_BORDER_WIDTH_PRESETS: Record<string, number | undefined> = {
  "Hairline (default)": undefined,
  "Medium (2px)": 2,
  "Bold (3px)": 3,
  "Heavy (4px)": 4,
};

/**
 * Coerce untrusted stored border overrides into safe values. Invalid color →
 * undefined (keep theme default); width is rounded and clamped to
 * [1, MAX_BORDER_WIDTH], with zero/negative/non-number → undefined (1px default).
 */
export function normalizeBrandBorder(input: { borderColor?: unknown; borderWidth?: unknown }): BrandBorder {
  const out: BrandBorder = {};

  if (typeof input.borderColor === "string" && HEX_RE.test(input.borderColor)) {
    out.borderColor = input.borderColor;
  }

  if (typeof input.borderWidth === "number" && Number.isFinite(input.borderWidth) && input.borderWidth > 0) {
    out.borderWidth = Math.min(Math.max(Math.round(input.borderWidth), 1), MAX_BORDER_WIDTH);
  }

  return out;
}

/**
 * Resolve the CSS custom properties for a brand's border overrides. Only set
 * values are emitted, so applyBrandStyle can set what's present and remove
 * what isn't — a previous tenant's override can never linger.
 */
export function brandBorderVars(input: { borderColor?: unknown; borderWidth?: unknown }): Record<string, string> {
  const { borderColor, borderWidth } = normalizeBrandBorder(input);
  const vars: Record<string, string> = {};
  if (borderColor) vars["--brand-border"] = borderColor;
  if (borderWidth) vars["--brand-border-width"] = `${borderWidth}px`;
  return vars;
}

/** Stored width → preset label for the collapsed select (unknown values read as the default). */
export function borderWidthLabel(width?: number): string {
  return (
    Object.entries(BRAND_BORDER_WIDTH_PRESETS).find(([, v]) => v === width)?.[0] ??
    Object.keys(BRAND_BORDER_WIDTH_PRESETS)[0]
  );
}
