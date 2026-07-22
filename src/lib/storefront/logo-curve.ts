// Logo curve core — the pure module behind the branding editor's "Logo curve"
// select and every storefront surface that renders the brand logo (site header,
// hero logo card, footer). The stored value is a corner-rounding percentage
// (0–50) on Brand.logoCurve; percent-based radii keep the look consistent
// across the differently-sized logo renders (44px header img vs. up-to-260px
// hero card).
//
// Tested by scripts/test-logo-curve.ts (npm run test:logo-curve).

/** Hard ceiling: 50% border-radius is a full circle/ellipse. */
const MAX_CURVE_PERCENT = 50;

/**
 * Friendly preset menu for the branding editor, mirroring HERO_LOGO_SIZES:
 * "Square" stores undefined so the key is pruned from branding.config and the
 * stylesheet defaults (no rounding) keep applying for existing tenants.
 */
export const LOGO_CURVE_PRESETS: Record<string, number | undefined> = {
  Square: undefined,
  Soft: 12,
  Rounded: 25,
  Circle: 50,
};

/**
 * Coerce the untrusted stored logoCurve value into a CSS border-radius.
 * Returns undefined for unset/zero/invalid input so the inline style is a
 * no-op and the pre-feature look is preserved; anything above the circle
 * threshold clamps to 50%.
 */
export function logoCurveCss(curve: unknown): string | undefined {
  if (typeof curve !== "number" || !Number.isFinite(curve) || curve <= 0) return undefined;
  return `${Math.min(curve, MAX_CURVE_PERCENT)}%`;
}

/** Stored value → preset label for the collapsed select (unknown values read as "Square"). */
export function logoCurveLabel(curve?: number): string {
  return Object.entries(LOGO_CURVE_PRESETS).find(([, v]) => v === curve)?.[0] ?? "Square";
}
