"use client";

/**
 * The operator's controls for a tenant's BRAND SPLASH — the branded loading
 * screen the storefront boots through.
 *
 * Operator-only, by design. This panel lives on the platform's per-tenant
 * Branding page and has no counterpart in the store admin: the store owner can
 * neither see nor change their loading screen. scripts/test-brand-splash-admin
 * greps the owner-facing surfaces and fails if that ever stops being true.
 *
 * Everything here except the logo upload is written into the shared Brand
 * config through `onChange`, and persists on the editor's existing "Save
 * branding" — saveBrandingAction writes that config object back WHOLESALE, so a
 * separate per-splash save action would simply be clobbered by the next save.
 * The upload is the exception: it persists server-side immediately, which is
 * why BrandingEditor mirrors the returned URL back into `cfg`.
 */

import {
  BRAND_SPLASH_DEFAULT,
  MAX_SPLASH_TAGLINE,
  SPLASH_DESIGNS,
  normalizeBrandSplash,
  splashLogoUrl,
  type BrandSplash,
  type SplashDesign,
} from "@/lib/storefront/brand-splash";
import { AssetUpload, HeaderColorField, Segmented } from "@/components/admin/branding-fields";
// The preview tiles render the REAL overlay markup, so they need the real
// stylesheet — sharing it is what stops the picker drifting from the store.
import "@/storefront/brand-splash.css";

/** Operator-facing name for each design, and what it actually does on screen. */
const DESIGN_LABELS: Record<SplashDesign, { label: string; help: string }> = {
  "logo-pulse": { label: "Pulse", help: "The brand mark breathes. The quiet default." },
  ring: { label: "Spinner", help: "A brand-colored ring turns beneath the mark." },
  bar: { label: "Bar", help: "An indeterminate progress bar beneath the mark." },
  wordmark: { label: "Wordmark", help: "An oversized mark carries the screen on its own." },
  fade: { label: "Still", help: "No motion at all — the mark simply fades away." },
};

export function splashSummary(value: unknown): string {
  const splash = normalizeBrandSplash(value);
  if (!splash.enabled) return "Off";
  return DESIGN_LABELS[splash.design].label;
}

export function BrandSplashEditor({
  slug,
  storeName,
  value,
  brandingLogoUrl,
  surfaceColor,
  mainColor,
  textColor,
  onChange,
  onLogoUploaded,
}: {
  slug: string;
  storeName: string;
  /** The raw config value; normalized here so a legacy blob still renders. */
  value: unknown;
  brandingLogoUrl: string | null;
  /** Theme fallbacks, shown in the color inputs while a color is unset. */
  surfaceColor: string;
  mainColor: string;
  textColor: string;
  onChange: (next: BrandSplash) => void;
  onLogoUploaded: (url: string | null) => void;
}) {
  const splash = normalizeBrandSplash(value);
  const set = <K extends keyof BrandSplash>(key: K, val: BrandSplash[K]) =>
    onChange({ ...splash, [key]: val });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Shown while this tenant&apos;s storefront loads. On for every store by default — the
        shopper sees this brand, not a blank page. The store owner cannot see or change it.
      </p>

      {/* ── On/off ── */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={splash.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm font-medium">
          Show the loading screen{" "}
          <span className="text-xs font-normal text-muted-foreground">(on by default)</span>
        </span>
      </label>

      {splash.enabled && (
        <>
          {/* ── Design ── */}
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Design
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SPLASH_DESIGNS.map((design) => (
                <button
                  key={design}
                  type="button"
                  onClick={() => set("design", design)}
                  aria-pressed={splash.design === design}
                  className={`rounded-[var(--radius)] border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    splash.design === design
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {/* The real overlay, scaled into a tile, with this tenant's
                      own colors and mark — the operator picks from what the
                      shopper will actually see, not from a name. */}
                  <SplashPreview
                    splash={{ ...splash, design }}
                    storeName={storeName}
                    brandingLogoUrl={brandingLogoUrl}
                    surfaceColor={surfaceColor}
                    mainColor={mainColor}
                    textColor={textColor}
                  />
                  <span className="mt-1.5 block text-xs font-medium">
                    {DESIGN_LABELS[design].label}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {DESIGN_LABELS[design].help}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Logo ── */}
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mark
            </h3>
            <div className="mt-2">
              <AssetUpload
                slug={slug}
                kind="splashLogo"
                label="Loading screen logo"
                help={
                  splash.logoUrl
                    ? "Shown while the store loads."
                    : "Optional. Leave empty to use the store's header logo — upload one only when the loading screen wants a different mark."
                }
                value={splash.logoUrl || null}
                onChange={onLogoUploaded}
              />
              {!splash.logoUrl && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {brandingLogoUrl
                    ? "Currently using the header logo."
                    : "This tenant has no logo at all — the loading screen will draw their initials."}
                </p>
              )}
            </div>
          </div>

          {/* ── Colors ── */}
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Colors
            </h3>
            <div className="mt-2 space-y-2">
              <HeaderColorField
                label="Background"
                help="Fills the whole screen while the store loads. Defaults to Surface."
                value={splash.bgColor}
                fallback={surfaceColor}
                onChange={(v) => set("bgColor", v)}
                onReset={() => set("bgColor", undefined)}
                resetLabel="Reset to Surface"
              />
              <HeaderColorField
                label="Accent"
                help="The spinner, bar, or pulse. Defaults to Main."
                value={splash.accentColor}
                fallback={mainColor}
                onChange={(v) => set("accentColor", v)}
                onReset={() => set("accentColor", undefined)}
                resetLabel="Reset to Main"
              />
              <HeaderColorField
                label="Text"
                help="The tagline under the mark. Defaults to Text."
                value={splash.textColor}
                fallback={textColor}
                onChange={(v) => set("textColor", v)}
                onReset={() => set("textColor", undefined)}
                resetLabel="Reset to Text"
              />
            </div>
          </div>

          {/* ── Tagline ── */}
          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={splash.showTagline}
                onChange={(e) => set("showTagline", e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">Show a tagline</span>
            </label>
            {splash.showTagline && (
              <input
                type="text"
                value={splash.tagline}
                maxLength={MAX_SPLASH_TAGLINE}
                onChange={(e) => set("tagline", e.target.value)}
                placeholder="Research-grade peptides"
                className="mt-2 w-full rounded-[var(--radius)] border border-border bg-background px-2 py-1.5 text-sm"
              />
            )}
          </div>

          {/* ── Timing ── */}
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              How long it stays
            </h3>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              The screen lifts as soon as the store is ready. These are the floor and the
              ceiling around that — the ceiling also runs in CSS, so the store still appears
              if the page&apos;s scripts fail.
            </p>
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">Minimum</span>
              <Segmented
                options={[0, 250, 500, 800] as const}
                value={nearest(splash.minDurationMs, [0, 250, 500, 800])}
                onChange={(v) => set("minDurationMs", v)}
                render={(v) => (v === 0 ? "None" : `${v}ms`)}
              />
            </div>
            <div className="mt-2">
              <span className="text-xs text-muted-foreground">Maximum</span>
              <Segmented
                options={[600, 900, 1500, 2500] as const}
                value={nearest(splash.maxDurationMs, [600, 900, 1500, 2500])}
                onChange={(v) => set("maxDurationMs", v)}
                render={(v) => `${v}ms`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Snap a stored millisecond value onto the offered presets for display. */
function nearest<T extends number>(value: number, options: readonly T[]): T {
  return options.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best,
  );
}

/**
 * A scaled-down render of the real splash for the design picker. It reuses the
 * same class names as the live overlay so the preview inherits every rule from
 * brand-splash.css — a preview with its own styling would drift from what the
 * shopper sees, which is the one thing a picker must not do.
 */
function SplashPreview({
  splash,
  storeName,
  brandingLogoUrl,
  surfaceColor,
  mainColor,
  textColor,
}: {
  splash: BrandSplash;
  storeName: string;
  brandingLogoUrl: string | null;
  surfaceColor: string;
  mainColor: string;
  textColor: string;
}) {
  const logo = splashLogoUrl(splash, brandingLogoUrl);
  return (
    <span
      className={`sf-splash-preview sf-splash--${splash.design}`}
      style={
        {
          // The preview always paints a color, falling back to the tenant's
          // theme, because there is no storefront theme in scope out here.
          "--splash-bg": splash.bgColor || surfaceColor,
          "--splash-accent": splash.accentColor || mainColor,
          "--splash-text": splash.textColor || textColor,
        } as React.CSSProperties
      }
    >
      <span className="sf-splash__inner">
        <span className="sf-splash__mark">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="sf-splash__logo" />
          ) : (
            <span className="sf-splash__initials">{initials(storeName)}</span>
          )}
        </span>
        <span className="sf-splash__ring" aria-hidden />
        <span className="sf-splash__bar" aria-hidden>
          <span className="sf-splash__bar-fill" />
        </span>
        {splash.showTagline && splash.tagline ? (
          <span className="sf-splash__tagline">{splash.tagline}</span>
        ) : null}
      </span>
    </span>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export { BRAND_SPLASH_DEFAULT };
