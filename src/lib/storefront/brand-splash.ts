/**
 * BRAND SPLASH — the per-tenant branded loading screen.
 *
 * Every white-label storefront used to boot through the same grey skeleton, so
 * the first thing a shopper saw carried no sign of whose shop they had opened.
 * The splash replaces that moment with the tenant's own mark and colors.
 *
 * Deliberately DEFAULT ON, with no entitlement and no owner toggle:
 *
 *   - Default on, because a loading screen is not a feature a store opts into —
 *     it is the store's own front door. `normalizeBrandSplash` therefore fails
 *     ON: absent, partial or junk config all resolve to an enabled splash, and
 *     only a literal `false` turns it off. Config that has round-tripped
 *     through JSON or a form post tends to arrive as strings, and `"false"` is
 *     truthy in JS, so a looser check would blank storefronts by accident.
 *     Same discipline as ./store-status, for the same reason.
 *
 *   - Operator-only. This is configured on the platform's per-tenant Branding
 *     page and is invisible to the store owner — there is no store-admin panel,
 *     no staff permission and no nav entry for it. It lives in the shared
 *     branding.config blob alongside owner-editable keys, which is safe because
 *     every store-admin save action does a narrow read-modify-write of its own
 *     keys (see actions/storefront-admin.ts) rather than replacing the blob.
 *
 * The three colors are OPTIONAL. Unset means "inherit the theme", so a tenant
 * nobody has styled still gets a splash that matches their storefront, and
 * `splashVarsCss` emits only the overrides the operator actually set — the same
 * unset-is-a-no-op contract as ./logo-curve.
 *
 * Pure + JSON-safe (no React, no DB, no Next runtime) so the server layout, the
 * client overlay and the operator's live preview all render from one contract.
 * Covered by npm run test:brand-splash.
 */

/** The loading animations an operator can pick between. */
export const SPLASH_DESIGNS = ["logo-pulse", "ring", "bar", "wordmark", "fade"] as const;

export type SplashDesign = (typeof SPLASH_DESIGNS)[number];

/**
 * The designs that render a moving loading indicator (a spinner or a bar) as
 * well as the mark. A loading screen has to LOOK like one: on a slow connection
 * the mark alone reads as a page that has finished and is simply empty, which
 * is the opposite of what the splash is for. The default must be one of these —
 * asserted by npm run test:brand-splash.
 */
export const DESIGNS_WITH_INDICATOR: readonly SplashDesign[] = ["ring", "bar"];

/** The splash config, persisted at branding.config.brandSplash. */
export type BrandSplash = {
  /** false = no splash. Absent or junk normalizes to true — never blank by typo. */
  enabled: boolean;
  /** Which loading animation renders. Unknown values fall back to the default. */
  design: SplashDesign;
  /** Uploaded splash-only mark. Empty → the header logo → the monogram. */
  logoUrl: string;
  /** Backdrop. Unset → the theme's surface color. */
  bgColor?: string;
  /** Spinner / bar / pulse color. Unset → the brand's main color. */
  accentColor?: string;
  /** Tagline color. Unset → the brand's text color. */
  textColor?: string;
  /** Optional line under the mark ("Research-grade peptides"). */
  tagline: string;
  /** Whether the tagline renders at all, so the copy survives being hidden. */
  showTagline: boolean;
  /** Floor before the splash may lift — stops a sub-100ms flash of nothing. */
  minDurationMs: number;
  /** Ceiling after which it lifts regardless. Also enforced in pure CSS. */
  maxDurationMs: number;
};

// ── caps ────────────────────────────────────────────────────────────────────
export const MAX_SPLASH_TAGLINE = 120;

/**
 * Duration bounds. The maximum is capped hard: the splash covers the whole
 * viewport, so an operator who typed an extra zero would otherwise hide a live
 * storefront behind a loading screen for a minute. The client dismisses on
 * hydration well before this; the ceiling is the backstop, mirrored in CSS so
 * it holds even when JS never runs.
 */
export const SPLASH_MIN_DURATION_CEILING = 3000;
export const SPLASH_MAX_DURATION_FLOOR = 300;
export const SPLASH_MAX_DURATION_CEILING = 5000;

/**
 * A tenant nobody has configured: on, theme-colored, and visibly loading. The
 * spinner is the default rather than the quieter logo-pulse because the mark
 * breathing on its own does not read as progress — see DESIGNS_WITH_INDICATOR.
 */
export const BRAND_SPLASH_DEFAULT: BrandSplash = {
  enabled: true,
  design: "ring",
  logoUrl: "",
  tagline: "",
  showTagline: false,
  minDurationMs: 250,
  maxDurationMs: 900,
};

// ── field coercion ──────────────────────────────────────────────────────────

/**
 * A plain CSS hex color, or undefined.
 *
 * These render into an inline `style` attribute, which makes this the trust
 * boundary for them: a value like `#fff;background-image:url(...)` would other-
 * wise smuggle a whole extra declaration into the element. Only `#rgb` and
 * `#rrggbb` are accepted — named colors and functional notations are dropped
 * rather than rejected, so a bad paste falls back to the theme instead of
 * failing the operator's save.
 */
function cleanHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : undefined;
}

/**
 * A hosted image URL, or "". Only http(s) — the same rule the default product
 * image uses, and what keeps javascript:/data: out of the splash <img src>.
 */
function cleanHostedUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

/** Trim and clamp one untrusted copy field; a non-string reads as empty. */
function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** A finite millisecond count inside [0, ceiling], or the stated fallback. */
function clampDuration(value: unknown, fallback: number, ceiling: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), 0), ceiling);
}

function isSplashDesign(value: unknown): value is SplashDesign {
  return (SPLASH_DESIGNS as readonly unknown[]).includes(value);
}

// ── the normalizer ──────────────────────────────────────────────────────────

/**
 * Coerce the untrusted branding.config.brandSplash into a usable config.
 *
 * Fails ON (see the header note): anything unrecognised yields the default
 * splash, so a tenant that has never been touched still gets a branded loading
 * screen. Always returns a NEW object; the input is never mutated — the layout
 * renders from the same cached config object this is handed.
 */
export function normalizeBrandSplash(value: unknown): BrandSplash {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...BRAND_SPLASH_DEFAULT };
  }
  const raw = value as Record<string, unknown>;

  const maxDurationMs = Math.max(
    SPLASH_MAX_DURATION_FLOOR,
    clampDuration(raw.maxDurationMs, BRAND_SPLASH_DEFAULT.maxDurationMs, SPLASH_MAX_DURATION_CEILING),
  );
  // A minimum above the maximum would hold the splash past its own ceiling, so
  // the floor yields to the ceiling rather than the other way round.
  const minDurationMs = Math.min(
    clampDuration(raw.minDurationMs, BRAND_SPLASH_DEFAULT.minDurationMs, SPLASH_MIN_DURATION_CEILING),
    maxDurationMs,
  );

  return {
    // Only an explicit boolean false disables the splash — see the header note.
    enabled: raw.enabled !== false,
    design: isSplashDesign(raw.design) ? raw.design : BRAND_SPLASH_DEFAULT.design,
    logoUrl: cleanHostedUrl(raw.logoUrl),
    bgColor: cleanHex(raw.bgColor),
    accentColor: cleanHex(raw.accentColor),
    textColor: cleanHex(raw.textColor),
    tagline: clampText(raw.tagline, MAX_SPLASH_TAGLINE),
    showTagline: raw.showTagline === true,
    minDurationMs,
    maxDurationMs,
  };
}

/**
 * The predicate the storefront layout reads. Takes raw config so a caller can
 * pass branding.config.brandSplash straight through without normalizing first.
 */
export function isBrandSplashEnabled(value: unknown): boolean {
  return normalizeBrandSplash(value).enabled;
}

/**
 * The mark the splash renders: the operator's splash-only upload wins, then the
 * tenant's header logo, then "" — at which point the overlay draws a monogram
 * rather than a broken image. A splash logo that failed normalization (not
 * http(s)) is already "" here, so it falls through to the header logo instead
 * of blanking the screen.
 */
export function splashLogoUrl(
  splash: BrandSplash,
  brandingLogoUrl: string | null | undefined,
): string {
  return splash.logoUrl || cleanHostedUrl(brandingLogoUrl);
}

/**
 * The CSS custom properties for the operator's color overrides — and ONLY those.
 * An unset color emits no var at all, so the stylesheet's `var(--splash-bg,
 * <theme fallback>)` keeps resolving to the tenant's theme. Emitting an empty
 * string instead would shadow the fallback and paint the splash transparent.
 */
export function splashVarsCss(splash: BrandSplash): Record<string, string> {
  const vars: Record<string, string> = {};
  if (splash.bgColor) vars["--splash-bg"] = splash.bgColor;
  if (splash.accentColor) vars["--splash-accent"] = splash.accentColor;
  if (splash.textColor) vars["--splash-text"] = splash.textColor;
  return vars;
}
