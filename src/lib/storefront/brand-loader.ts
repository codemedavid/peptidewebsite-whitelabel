/**
 * BRANDED PAGE LOADER — the tenant's own loading screen on ROUTE CHANGES.
 *
 * ./brand-splash covers exactly one moment: the first server render. Everything
 * after that used to fall back to unbranded chrome — a generic ring in the
 * hash-routed SPA and two grey skeleton walls in the storefront's loading.tsx
 * files. So a shopper saw the store's mark once and stock chrome for the rest
 * of the visit, which is the failure the splash was built to end.
 *
 * THE CONFIG TRAVELS AS CSS CUSTOM PROPERTIES, NOT PROPS. The surfaces that
 * need it cannot receive props: a `loading.tsx` is a Suspense fallback Next
 * renders with no arguments, and next/dynamic's `loading` gets only its own
 * status flags. Both DO sit inside the storefront layout, so vars set on that
 * root inherit down to them for free. One props-less <BrandPageLoader /> then
 * serves the server fallback and the client fallback alike — no tenant lookup,
 * no client bundle, no second copy of the config.
 *
 * That makes an inline `style` attribute the trust boundary for two untrusted
 * strings (the tenant's logo URL and its name), which is what `cssUrl` and
 * `cssString` below are for.
 *
 * Pure + JSON-safe (no React, no DB, no Next runtime) so the layout, the loader
 * and the tests all render from one contract.
 * Covered by npm run test:brand-page-loader.
 */

import {
  DESIGNS_WITH_INDICATOR,
  splashLogoUrl,
  splashVarsCss,
  type BrandSplash,
  type SplashDesign,
} from "./brand-splash";

/**
 * The initials <Monogram> draws, as a standalone rule so the loader's CSS-only
 * monogram and the React component can never disagree about a store's mark.
 */
export function monogramInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

/**
 * A CSS `url("…")` value, or undefined.
 *
 * This is interpolated into an inline style attribute, so a URL carrying a
 * quote or a paren could close the function and append declarations of its own
 * onto the storefront root. Rather than escape, REJECT: the characters below
 * have no business in a hosted asset URL (they would be percent-encoded), and a
 * dropped mark degrades to the monogram instead of to an injection.
 */
function cssUrl(value: string): string | undefined {
  if (!value) return undefined;
  // An allowlist, not an escape: quote, paren, backslash, semicolon and any
  // whitespace are absent, and so is everything non-ASCII. The comma stays —
  // ImageKit transform URLs (tr=w-400,h-400) are ordinary here.
  return /^[\w.~:/?#[\]@!$&*+,=%-]+$/.test(value) ? `url("${value}")` : undefined;
}

/**
 * A CSS string literal for `content:`. The store name is tenant-controlled, so
 * the quote and the backslash are escaped rather than dropped — unlike a URL,
 * there is no safe fallback for a name.
 */
function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Which indicator the transition loader animates.
 *
 * On boot a motionless mark is fine — the page is arriving behind it, and the
 * CSS backstop lifts the overlay on a timer either way. Mid-visit it is not: a
 * still overlay during a route change reads as a page that finished and came up
 * empty. So the indicator-less designs (logo-pulse, wordmark, fade) borrow the
 * default spinner here while keeping the tenant's mark and colors.
 *
 * Returns undefined when the operator turned the splash off, which is what
 * leaves those surfaces on their existing plain spinner.
 */
export function brandLoaderDesign(splash: BrandSplash): SplashDesign | undefined {
  if (!splash.enabled) return undefined;
  return DESIGNS_WITH_INDICATOR.includes(splash.design)
    ? splash.design
    : DESIGNS_WITH_INDICATOR[0];
}

/**
 * The CSS custom properties the storefront root carries for the page loader:
 * the operator's color overrides (only the ones actually set — see
 * splashVarsCss) plus the mark.
 *
 * EXACTLY ONE of --splash-logo / --splash-initials is ever emitted. The
 * stylesheet draws the monogram through `content: var(--splash-initials)`,
 * which has no way to branch; if both were set the loader would stack the
 * store's logo and its initials on top of each other.
 *
 * Empty when the splash is disabled. Never mutates its input.
 */
export function brandLoaderVars(
  splash: BrandSplash,
  storeName: string,
  brandingLogoUrl: string | null | undefined,
): Record<string, string> {
  if (!splash.enabled) return {};

  const vars: Record<string, string> = { ...splashVarsCss(splash) };
  const logo = cssUrl(splashLogoUrl(splash, brandingLogoUrl));

  if (logo) {
    vars["--splash-logo"] = logo;
  } else {
    vars["--splash-initials"] = cssString(monogramInitials(storeName));
  }
  return vars;
}
