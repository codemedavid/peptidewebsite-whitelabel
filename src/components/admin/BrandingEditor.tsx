"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { resolveCssVars } from "@/lib/theme/resolve-css-vars";
import {
  ROLE_KEYS,
  ROLE_META,
  FONT_OPTIONS,
  TITLE_SIZES,
  BODY_SIZES,
  FONT_WEIGHTS,
  WEIGHT_LABELS,
  HERO_ALIGNS,
  googleFontsUrl,
  hexToHslTriple,
  hslTripleToHex,
  presetTripleForRole,
  contrastRatio,
  type RoleKey,
  type HeroTypography,
  type TitleSize,
  type BodySize,
  type FontWeight,
  type HeroAlign,
} from "@/lib/theme/tokens";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { BRAND } from "@/storefront/data";
import type { Brand } from "@/storefront/types";
import { BrandTweaksForm } from "@/storefront/tweaks/BrandTweaksForm";
import { TweaksStyle } from "@/storefront/tweaks/controls";
import { StorefrontLivePreview } from "@/components/admin/StorefrontLivePreview";
import { saveBrandingAction } from "@/actions/onboarding";
import {
  uploadBrandingAssetAction,
  removeBrandingAssetAction,
  type BrandingAssetKind,
} from "@/actions/branding";

// Tenant storefronts live at `<slug>.<ROOT>`. ROOT carries its own dev port
// (e.g. "lvh.me:3100"), and `*.lvh.me` resolves in every browser incl. Safari —
// unlike `*.localhost`, which Safari can't reach.
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

type Props = {
  slug: string;
  name: string;
  initialThemeId: string;
  initialColors: Record<string, string>; // role → HSL triple (partial)
  initialFonts: { heading?: string; body?: string };
  initialLogoUrl: string | null;
  initialFaviconUrl: string | null;
  initialConfig: Partial<Brand>; // full storefront Brand config (branding.config)
};

function hexesForPreset(themeId: string): Record<RoleKey, string> {
  return Object.fromEntries(
    ROLE_KEYS.map((r) => [r, hslTripleToHex(presetTripleForRole(themeId, r))]),
  ) as Record<RoleKey, string>;
}

export function BrandingEditor({
  slug,
  name,
  initialThemeId,
  initialColors,
  initialFonts,
  initialLogoUrl,
  initialFaviconUrl,
  initialConfig,
}: Props) {
  const [tab, setTab] = useState<"brand" | "hero" | "storefront">("brand");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl);
  const [themeId, setThemeId] = useState(initialThemeId || "clinical-white");
  const [hexes, setHexes] = useState<Record<RoleKey, string>>(() =>
    Object.fromEntries(
      ROLE_KEYS.map((r) => [
        r,
        hslTripleToHex(initialColors[r] ?? presetTripleForRole(initialThemeId || "clinical-white", r)),
      ]),
    ) as Record<RoleKey, string>,
  );
  const [headingFont, setHeadingFont] = useState(initialFonts.heading ?? THEME_PRESETS[initialThemeId]?.fonts.heading ?? "Inter");
  const [bodyFont, setBodyFont] = useState(initialFonts.body ?? THEME_PRESETS[initialThemeId]?.fonts.body ?? "Inter");

  // Full storefront Brand config (sections, pages, hero/catalog copy, footer,
  // admin, plus the storefront's own --brand-* hex palette). Edited via the
  // shared BrandTweaksForm in the "Storefront" tab; persisted by Save branding.
  const [cfg, setCfg] = useState<Partial<Brand>>(initialConfig);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // The form needs a complete Brand; layer overrides on the design defaults and
  // seed identity from the tenant when the operator hasn't set it.
  const storefrontBrand: Brand = useMemo(
    () => ({
      ...BRAND,
      ...cfg,
      name: cfg.name || name || BRAND.name,
      logoUrl: cfg.logoUrl || logoUrl || BRAND.logoUrl,
    }),
    [cfg, name, logoUrl],
  );

  const setTweak = (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => {
    const edits: Partial<Brand> =
      typeof keyOrEdits === "object" && keyOrEdits !== null
        ? keyOrEdits
        : ({ [keyOrEdits]: val } as Partial<Brand>);
    setCfg((c) => ({ ...c, ...edits }));
    setSaved(false);
  };

  // Map the storefront's hex palette onto the shadcn tokens the live preview
  // mock reads, so the Storefront tab's preview re-themes as colors change.
  // Non-hex values (rgb()/named) are skipped — the token then inherits.
  const storefrontPreviewVars = useMemo(() => {
    const toTriple = (hex?: string) =>
      hex && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hexToHslTriple(hex) : undefined;
    const set = (vars: Record<string, string>, names: string[], hex?: string) => {
      const tri = toTriple(hex);
      if (tri) for (const n of names) vars[n] = tri;
    };
    const vars: Record<string, string> = {};
    set(vars, ["brand"], storefrontBrand.main);
    set(vars, ["accent", "ring"], storefrontBrand.accent);
    set(vars, ["primary"], storefrontBrand.button);
    set(vars, ["primary-foreground"], storefrontBrand.buttonText);
    set(vars, ["background"], storefrontBrand.background);
    set(vars, ["card", "muted", "secondary"], storefrontBrand.surface);
    set(vars, ["foreground", "card-foreground"], storefrontBrand.text);
    set(vars, ["muted-foreground"], storefrontBrand.text);
    return Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [`--${k}`, v]),
    ) as React.CSSProperties;
  }, [storefrontBrand]);

  // Open the live storefront (optionally at a hash route) in a new tab.
  const openStorefront = (hash = "") =>
    window.open(`http://${slug}.${ROOT}/${hash ? `#${hash}` : ""}`, "_blank", "noreferrer");

  // role triples derived from the current hex pickers
  const triples = useMemo(
    () => Object.fromEntries(ROLE_KEYS.map((r) => [r, hexToHslTriple(hexes[r])])) as Record<RoleKey, string>,
    [hexes],
  );

  const previewVars = useMemo(
    () => resolveCssVars({ themeId, colors: triples, fonts: { heading: headingFont, body: bodyFont } }),
    [themeId, triples, headingFont, bodyFont],
  );

  // Hero typography now lives directly on the storefront Brand config (the same
  // blob the Storefront tab edits), so the Hero-tab controls read/write `cfg`
  // via setTweak — no separate state to keep in sync. Defaults mirror the
  // storefront.css baseline, so leaving a control on its default is a no-op.
  const heroTitleFont = storefrontBrand.heroTitleFont ?? "";
  const heroTitleSize: TitleSize = storefrontBrand.heroTitleSize ?? "xl";
  const heroTitleWeight: FontWeight = storefrontBrand.heroTitleWeight ?? 500;
  const heroBodyFont = storefrontBrand.heroBodyFont ?? "";
  const heroBodySize: BodySize = storefrontBrand.heroBodySize ?? "md";
  const heroAlign: HeroAlign = storefrontBrand.heroAlign ?? "center";
  const heroHighlight = storefrontBrand.heroHighlight;

  // Mirrored into the demo save payload (the DB path reads it from config).
  const heroTypography: HeroTypography = {
    titleFont: heroTitleFont || undefined,
    titleSize: heroTitleSize,
    titleWeight: heroTitleWeight,
    bodyFont: heroBodyFont || undefined,
    bodySize: heroBodySize,
    highlightColor: heroHighlight,
    align: heroAlign,
  };

  const btnContrast = contrastRatio(triples.buttonText, triples.button);
  const textContrast = contrastRatio(triples.text, triples.background);

  // Auto-sync (theme → storefront): mirror the Brand-tab palette + fonts onto
  // the storefront Brand config so the live storefront home matches the chosen
  // theme. `button2` (gradient end) flattens to the button color. The Storefront
  // tab stays editable — operators can still override these afterward.
  function syncStorefrontPalette(
    nextHexes: Record<RoleKey, string>,
    heading: string,
    body: string,
  ) {
    setCfg((c) => ({
      ...c,
      main: nextHexes.main,
      accent: nextHexes.accent,
      button: nextHexes.button,
      button2: nextHexes.button,
      buttonText: nextHexes.buttonText,
      background: nextHexes.background,
      surface: nextHexes.surface,
      text: nextHexes.text,
      headingFont: heading,
      bodyFont: body,
    }));
  }

  function pickPreset(id: string) {
    const nextHexes = hexesForPreset(id);
    const heading = THEME_PRESETS[id]?.fonts.heading ?? "Inter";
    const body = THEME_PRESETS[id]?.fonts.body ?? "Inter";
    setThemeId(id);
    setHexes(nextHexes);
    setHeadingFont(heading);
    setBodyFont(body);
    syncStorefrontPalette(nextHexes, heading, body);
    setSaved(false);
  }

  function setRole(role: RoleKey, hex: string) {
    const next = { ...hexes, [role]: hex };
    setHexes(next);
    syncStorefrontPalette(next, headingFont, bodyFont);
    setSaved(false);
  }

  async function onSave() {
    setSaving(true);
    const res = await saveBrandingAction(slug, {
      themeId,
      colors: triples,
      fonts: { heading: headingFont, body: bodyFont },
      hero: heroTypography,
      config: storefrontBrand as unknown as Record<string, unknown>,
    });
    setSaving(false);
    if ("ok" in res) setSaved(true);
  }

  return (
    <div>
      {/* load the chosen fonts for the live preview — incl. distinct hero fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={googleFontsUrl(headingFont, bodyFont, heroTitleFont, heroBodyFont)} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Tenants
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-bold">Branding · {name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`http://${slug}.${ROOT}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-sm text-accent underline underline-offset-2"
          >
            View storefront
            <ExternalLink className="h-3.5 w-3.5" aria-label="opens in a new tab" />
          </a>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : saved ? (<><Check className="h-4 w-4" aria-hidden /> Saved</>) : "Save branding"}
          </Button>
        </div>
      </div>
      {saved && (
        <span role="status" className="sr-only">
          Branding saved.
        </span>
      )}

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Branding sections" className="mt-5 flex gap-1 border-b border-border">
        {(["brand", "hero", "storefront"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-sm border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "brand" ? "Brand" : t === "hero" ? "Hero" : "Storefront"}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* ── Controls ── */}
        <div className="space-y-6">
          {/* Theme preset is the shared base for every tab — keep it reachable
              from Hero and Storefront too, so the operator can snap back to a
              preset without first switching to the Brand tab. */}
          <div>
            <h2 className="text-sm font-semibold">Theme preset</h2>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {Object.values(THEME_PRESETS).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickPreset(t.id)}
                  aria-pressed={themeId === t.id}
                  className={`rounded-[var(--radius)] border p-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${themeId === t.id ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted"}`}
                >
                  <div className="mb-1 flex gap-1" aria-hidden>
                    <span className="h-4 w-4 rounded-full" style={{ background: `hsl(${t.colors.primary})` }} />
                    <span className="h-4 w-4 rounded-full border border-border" style={{ background: `hsl(${t.colors.background})` }} />
                  </div>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {tab === "brand" ? (
            <>
              <div>
                <h2 className="text-sm font-semibold">Colors</h2>
                <div className="mt-2 space-y-2">
                  {ROLE_KEYS.map((role) => (
                    <label key={role} className="flex items-center gap-3">
                      <input
                        type="color"
                        value={hexes[role]}
                        onChange={(e) => setRole(role, e.target.value)}
                        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{ROLE_META[role].label}</span>
                        <span className="block text-xs text-muted-foreground">{ROLE_META[role].help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Fonts</h2>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Heading</span>
                  <Select value={headingFont} onChange={(e) => { const v = e.target.value; setHeadingFont(v); syncStorefrontPalette(hexes, v, bodyFont); setSaved(false); }} className="mt-1">
                    {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Body</span>
                  <Select value={bodyFont} onChange={(e) => { const v = e.target.value; setBodyFont(v); syncStorefrontPalette(hexes, headingFont, v); setSaved(false); }} className="mt-1">
                    {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </label>
              </div>

              {/* contrast hints */}
              <div className="space-y-1 text-xs">
                <ContrastHint label="Button text on button" ratio={btnContrast} />
                <ContrastHint label="Body text on background" ratio={textContrast} />
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Brand assets</h2>
                <AssetUpload
                  slug={slug}
                  kind="logo"
                  label="Logo"
                  help="Shown in the storefront header. Replaces the monogram. PNG/SVG/WebP, max 2 MB."
                  value={logoUrl}
                  onChange={setLogoUrl}
                />
                <AssetUpload
                  slug={slug}
                  kind="favicon"
                  label="Favicon"
                  help="Browser-tab icon. Overrides the generated tile. ICO/PNG/SVG, max 2 MB."
                  value={faviconUrl}
                  onChange={setFaviconUrl}
                />
              </div>
            </>
          ) : tab === "hero" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Hero typography for this tenant’s storefront. Leave a font on
                “Inherit” to follow the brand fonts. The preview shows the live
                storefront hero (its layout variant is set on the Storefront tab).
              </p>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Title</h2>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Font</span>
                  <Select
                    value={heroTitleFont}
                    onChange={(e) => setTweak("heroTitleFont", e.target.value)}
                    className="mt-1"
                  >
                    <option value="">Inherit (brand heading)</option>
                    {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </label>
                <div>
                  <span className="text-xs text-muted-foreground">Size</span>
                  <Segmented
                    options={TITLE_SIZES}
                    value={heroTitleSize}
                    onChange={(v) => setTweak("heroTitleSize", v)}
                    render={(s) => s.toUpperCase()}
                  />
                </div>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Weight</span>
                  <Select
                    value={heroTitleWeight}
                    onChange={(e) => setTweak("heroTitleWeight", Number(e.target.value) as FontWeight)}
                    className="mt-1"
                  >
                    {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{WEIGHT_LABELS[w]} ({w})</option>)}
                  </Select>
                </label>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Body</h2>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Font</span>
                  <Select
                    value={heroBodyFont}
                    onChange={(e) => setTweak("heroBodyFont", e.target.value)}
                    className="mt-1"
                  >
                    <option value="">Inherit (brand body)</option>
                    {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </label>
                <div>
                  <span className="text-xs text-muted-foreground">Size</span>
                  <Segmented
                    options={BODY_SIZES}
                    value={heroBodySize}
                    onChange={(v) => setTweak("heroBodySize", v)}
                    render={(s) => s.toUpperCase()}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-semibold">Layout</h2>
                <div>
                  <span className="text-xs text-muted-foreground">Alignment</span>
                  <Segmented
                    options={HERO_ALIGNS}
                    value={heroAlign}
                    onChange={(v) => setTweak("heroAlign", v)}
                    render={(s) => s[0].toUpperCase() + s.slice(1)}
                  />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Highlight color (accent line)</span>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="color"
                      value={heroHighlight ?? storefrontBrand.accent}
                      onChange={(e) => setTweak("heroHighlight", e.target.value)}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                    />
                    {heroHighlight ? (
                      <button
                        type="button"
                        onClick={() => setTweak("heroHighlight", undefined)}
                        className="text-xs text-primary underline"
                      >
                        Reset to brand accent
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Inheriting brand accent</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                The full storefront editor. Controls every section, page, hero
                layout &amp; copy, catalog, footer and the admin password. Changes
                here drive the live tenant storefront once you press{" "}
                <span className="font-medium text-foreground">Save branding</span>.
              </p>
              {/* TweaksStyle scopes its own .twk-* classes; render the shared
                  form docked (static, full-width) instead of the floating panel. */}
              <TweaksStyle />
              <div
                className="twk-panel"
                style={{
                  position: "static",
                  width: "100%",
                  maxWidth: "100%",
                  maxHeight: "none",
                  right: "auto",
                  bottom: "auto",
                }}
              >
                <div className="twk-body" style={{ maxHeight: "none", overflow: "visible" }}>
                  <BrandTweaksForm
                    brand={storefrontBrand}
                    setTweak={setTweak}
                    goPage={(p) => openStorefront(p)}
                    goHome={() => openStorefront()}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Live preview ── */}
        {/* Sticky + self-start so the preview stays in view while the (often
            much taller) controls column scrolls; caps at viewport height and
            scrolls internally if the preview itself overflows. */}
        <div className="self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          <h2 className="mb-2 text-sm font-semibold">Live preview</h2>
          {tab === "brand" ? (
            <div
              style={previewVars}
              className="overflow-hidden rounded-[var(--radius)] border border-border bg-background text-foreground"
            >
              <StorefrontPreview name={name} logoUrl={logoUrl} />
            </div>
          ) : tab === "hero" ? (
            <div className="space-y-2">
              <div
                style={storefrontPreviewVars}
                className="overflow-hidden rounded-[var(--radius)] border border-border bg-background text-foreground"
              >
                <StorefrontPreview name={storefrontBrand.name} logoUrl={storefrontBrand.logoUrl || null} hero={storefrontBrand} />
              </div>
              <p className="text-xs text-muted-foreground">
                Approximate preview of the live storefront hero. Open{" "}
                <button type="button" onClick={() => openStorefront()} className="text-accent underline">
                  the live storefront
                </button>{" "}
                for the exact result.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <StorefrontLivePreview brand={storefrontBrand} />
              <p className="text-xs text-muted-foreground">
                Live preview of the current edits — Sections and Pages toggles
                apply here instantly. Open{" "}
                <button type="button" onClick={() => openStorefront()} className="text-accent underline">
                  the live storefront
                </button>{" "}
                to see the saved result in a full window.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mini storefront mock for the Brand tab's live preview, modeled on the
 * whitelabel Orozep-style base: sticky header, centered hero with a logo card
 * + accent chip + italic-gradient headline, a category chip row, and a product
 * grid with featured badges, purity pills, and pill "Add to Cart" buttons.
 * Every color/font reads from the resolved brand CSS vars on the wrapper, so it
 * re-themes live as the editor changes.
 */
const PRIMARY_GRADIENT =
  "linear-gradient(135deg, hsl(var(--primary)), color-mix(in srgb, hsl(var(--primary)) 65%, white))";

const PREVIEW_PRODUCTS = [
  { name: "BPC-157", desc: "Body-protection compound for recovery research.", purity: "≥99%", featured: true },
  { name: "TB-500", desc: "Thymosin beta-4 fragment, lyophilized.", purity: "≥98%", featured: false },
  { name: "GHK-Cu", desc: "Copper tripeptide for regenerative studies.", purity: "≥99%", featured: false },
];

function StorefrontPreview({
  name,
  logoUrl,
  hero,
}: {
  name: string;
  logoUrl: string | null;
  hero?: Partial<Brand>;
}) {
  const initial = name.trim()[0]?.toUpperCase() ?? "B";
  // Reflect the editable hero fields so "Generate hero" / "Cycle layout
  // variant" produce a visible change; fall back to the static mock copy when
  // no hero overrides are supplied (e.g. the Brand tab's logo/color preview).
  const heroVariant = hero?.heroVariant || "centered";
  const chip = (hero?.heroChipLabel || "").trim() || "Research-grade";
  const line1 = (hero?.heroLine1 || "").trim() || `${name} —`;
  const line2 = hero ? (hero.heroLine2 || "").trim() : "precision peptides";
  const sub =
    (hero?.heroSub || "").trim() ||
    "High-purity peptides with third-party COAs for every batch.";
  const cta1 = (hero?.heroCta1 || "").trim() || "Shop catalog";
  const cta2 = (hero?.heroCta2 || "").trim() || "Learn more";

  // ── Hero typography overrides (admin "Hero" tab), scaled down to fit the
  // preview card. Font family, weight, highlight and alignment reflect 1:1;
  // sizes use preview-friendly rem steps so SM…XL stay visibly distinct here.
  const PREVIEW_TITLE_SIZE: Record<NonNullable<Brand["heroTitleSize"]>, string> = {
    sm: "1.5rem", md: "1.75rem", lg: "2rem", xl: "2.25rem",
  };
  const PREVIEW_BODY_SIZE: Record<NonNullable<Brand["heroBodySize"]>, string> = {
    sm: "0.8rem", md: "0.875rem", lg: "0.95rem",
  };
  const titleFontFamily = hero?.heroTitleFont ? `'${hero.heroTitleFont}', var(--font-heading)` : "var(--font-heading)";
  const titleStyle: React.CSSProperties = {
    fontFamily: titleFontFamily,
    fontWeight: hero?.heroTitleWeight,
    fontSize: hero?.heroTitleSize ? PREVIEW_TITLE_SIZE[hero.heroTitleSize] : undefined,
  };
  const subStyle: React.CSSProperties = {
    fontFamily: hero?.heroBodyFont ? `'${hero.heroBodyFont}', var(--font-body)` : undefined,
    fontSize: hero?.heroBodySize ? PREVIEW_BODY_SIZE[hero.heroBodySize] : undefined,
  };
  const highlight = hero?.heroHighlight;

  // ── Shared hero sub-elements, parameterized so each variant can place them.
  const renderLogo = (size: number, radius: number) => (
    <div
      className="flex shrink-0 items-center justify-center bg-card"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        boxShadow: "0 18px 40px -18px color-mix(in srgb, hsl(var(--accent)) 70%, transparent)",
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} className="object-contain" style={{ maxWidth: "70%", maxHeight: "70%" }} />
      ) : (
        <span
          className="font-semibold text-brand"
          style={{ fontFamily: "var(--font-heading)", fontSize: Math.round(size * 0.34) }}
        >
          {initial}
        </span>
      )}
    </div>
  );

  const renderChip = (light = false) => (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
      style={
        light
          ? {
              borderColor: "color-mix(in srgb, white 20%, transparent)",
              background: "color-mix(in srgb, white 12%, transparent)",
              color: "#fff",
            }
          : { borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--brand))" }
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: light ? "#fff" : highlight || "hsl(var(--accent))" }}
        aria-hidden
      />
      {chip}
    </span>
  );

  const accentGradient = (light: boolean) =>
    light
      ? "linear-gradient(120deg, #fff, color-mix(in srgb, hsl(var(--accent)) 55%, white))"
      : "linear-gradient(120deg, hsl(var(--accent)), color-mix(in srgb, hsl(var(--accent)) 55%, white))";

  const renderHeadline = (sizeClass = "text-3xl", light = false) => (
    <h3
      className={`${sizeClass} font-semibold leading-[1.05] tracking-tight`}
      style={{ ...titleStyle, maxWidth: "22ch", color: light ? "#fff" : "hsl(var(--brand))" }}
    >
      {line1}
      {line2 && (
        <>
          <br />
          <span
            className="italic"
            style={
              highlight
                ? { color: highlight }
                : {
                    backgroundImage: accentGradient(light),
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }
            }
          >
            {line2}
          </span>
        </>
      )}
    </h3>
  );

  const renderSub = (light = false) => (
    <p
      className="text-sm"
      style={{ ...subStyle, maxWidth: "40ch", color: light ? "color-mix(in srgb, white 80%, transparent)" : "hsl(var(--muted-foreground))" }}
    >
      {sub}
    </p>
  );

  const renderCtas = (justify: "start" | "center" | "end" = "center", light = false) => (
    <div
      className={`flex flex-wrap items-center gap-2 ${
        justify === "center" ? "justify-center" : justify === "end" ? "justify-end" : "justify-start"
      }`}
    >
      <button
        className="rounded-full px-5 py-2 text-sm font-semibold"
        style={{ background: PRIMARY_GRADIENT, color: "hsl(var(--primary-foreground))" }}
      >
        {cta1}
      </button>
      <button
        className="rounded-full border px-5 py-2 text-sm font-semibold"
        style={
          light
            ? { borderColor: "color-mix(in srgb, white 25%, transparent)", background: "transparent", color: "#fff" }
            : { borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--brand))" }
        }
      >
        {cta2}
      </button>
    </div>
  );

  // ── Per-variant hero layout, mirroring the live storefront's <Hero>.
  let heroNode: React.ReactNode;
  if (heroVariant === "split") {
    // Two columns: text left, logo orb right.
    heroNode = (
      <div className="px-6 py-9 text-left">
        <div className="grid grid-cols-[1.1fr_1fr] items-center gap-6">
          <div className="flex flex-col items-start gap-3">
            {renderChip()}
            {renderHeadline("text-2xl")}
            {renderSub()}
            {renderCtas("start")}
          </div>
          <div className="relative flex items-center justify-center" style={{ aspectRatio: "1 / 1" }}>
            <div
              className="pointer-events-none absolute inset-[8%] rounded-full"
              aria-hidden
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, color-mix(in srgb, hsl(var(--accent)) 40%, transparent), transparent 60%)",
                filter: "blur(20px)",
              }}
            />
            {renderLogo(104, 28)}
          </div>
        </div>
      </div>
    );
  } else if (heroVariant === "editorial") {
    // Magazine cover: masthead rule, monumental stacked headline, bottom row.
    const issue = (hero?.heroChipLabel || "").trim() || "Issue 01";
    heroNode = (
      <div
        className="px-6 py-9 text-left"
        style={{
          background:
            "radial-gradient(70% 80% at 110% 10%, color-mix(in srgb, hsl(var(--accent)) 18%, transparent), transparent 60%), linear-gradient(180deg, hsl(var(--background)), color-mix(in srgb, hsl(var(--primary)) 6%, hsl(var(--background))))",
        }}
      >
        <div className="flex items-center justify-between border-y border-border py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand">
          <span>{(name || "Brand").toUpperCase()}</span>
          <span>{issue}</span>
        </div>
        <h3
          className="my-4 font-normal leading-[0.92] tracking-[-0.04em] text-brand"
          style={{ fontFamily: titleFontFamily, fontWeight: hero?.heroTitleWeight, fontSize: hero?.heroTitleSize ? PREVIEW_TITLE_SIZE[hero.heroTitleSize] : "clamp(40px, 9vw, 72px)" }}
        >
          <span className="block">{line1}</span>
          {line2 && (
            <span
              className="block italic"
              style={
                highlight
                  ? { color: highlight }
                  : {
                      backgroundImage: accentGradient(false),
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }
              }
            >
              {line2}
            </span>
          )}
        </h3>
        <div className="grid grid-cols-[1fr_auto] items-end gap-6">
          {renderSub()}
          {renderCtas("end")}
        </div>
      </div>
    );
  } else if (heroVariant === "card") {
    // Content floats in a rounded surface card with an accent blob.
    heroNode = (
      <div
        className="px-6 py-8"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, hsl(var(--accent)) 14%, hsl(var(--background))), hsl(var(--background)))",
        }}
      >
        <div
          className="relative overflow-hidden rounded-[28px] border border-border bg-card px-6 py-9"
          style={{ boxShadow: "0 30px 60px -30px rgba(0,0,0,0.35)" }}
        >
          <div
            className="pointer-events-none absolute -right-[10%] -top-[40%] aspect-square w-3/5 rounded-full"
            aria-hidden
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, hsl(var(--accent)) 18%, transparent), transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-center gap-3 text-center">
            {renderLogo(64, 16)}
            {renderChip()}
            {renderHeadline("text-2xl")}
            {renderSub()}
            {renderCtas("center")}
          </div>
        </div>
      </div>
    );
  } else if (heroVariant === "minimal") {
    // Barely-there banner: small logo, tighter type, hairline rule.
    heroNode = (
      <div className="border-b border-border px-6 py-8" style={{ background: "hsl(var(--background))" }}>
        <div className="flex flex-col items-center gap-3 text-center">
          {renderLogo(48, 12)}
          {renderChip()}
          {renderHeadline("text-2xl")}
          {renderSub()}
          {renderCtas("center")}
        </div>
      </div>
    );
  } else if (heroVariant === "spotlight") {
    // Dark dramatic: deep gradient, white text, glassy chip.
    heroNode = (
      <div
        className="relative overflow-hidden px-6 py-10 text-center"
        style={{
          background:
            "linear-gradient(160deg, color-mix(in srgb, hsl(var(--primary)) 92%, black) 0%, color-mix(in srgb, hsl(var(--primary)) 70%, black) 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(60% 60% at 50% 30%, color-mix(in srgb, hsl(var(--accent)) 40%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-3">
          {renderLogo(64, 16)}
          {renderChip(true)}
          {renderHeadline("text-3xl", true)}
          {renderSub(true)}
          {renderCtas("center", true)}
        </div>
      </div>
    );
  } else {
    // "centered" (default): radial glow + centered column.
    heroNode = (
      <div className="relative px-6 py-10 text-center">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(60% 55% at 50% 35%, color-mix(in srgb, hsl(var(--accent)) 18%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-4">
          {renderLogo(64, 16)}
          {renderChip()}
          {renderHeadline("text-3xl")}
          {renderSub()}
          {renderCtas("center")}
        </div>
      </div>
    );
  }
  return (
    <div style={{ fontFamily: "var(--font-body)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={name} className="h-7 w-auto" />
          ) : (
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
              style={{ background: "linear-gradient(135deg, hsl(var(--brand)), hsl(var(--accent)))", color: "hsl(var(--primary-foreground))" }}
            >
              {initial}
            </span>
          )}
          <span className="font-semibold text-brand" style={{ fontFamily: "var(--font-heading)" }}>
            {name}
          </span>
        </span>
        <span className="flex items-center gap-4 text-sm">
          <span className="text-accent">Catalog</span>
          <span className="text-muted-foreground">Research</span>
          <button
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold"
            style={{ background: PRIMARY_GRADIENT, color: "hsl(var(--primary-foreground))" }}
          >
            Shop now
          </button>
        </span>
      </div>

      {/* Hero — layout mirrors the live storefront's selected variant. */}
      <div className="relative">
        {hero && (
          <span className="absolute right-3 top-3 z-20 rounded-full border border-border bg-card px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {heroVariant} layout
          </span>
        )}
        {heroNode}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto border-y border-border bg-card px-6 py-3">
        {["All", "Healing", "Recovery", "Longevity"].map((c, i) => (
          <span
            key={c}
            className="whitespace-nowrap rounded-full px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
            style={
              i === 0
                ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
                : { border: "1px solid hsl(var(--border))", color: "hsl(var(--brand))" }
            }
          >
            {c}
          </span>
        ))}
      </div>

      {/* Catalog */}
      <div className="px-6 py-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Catalog</p>
        <h4 className="mt-1 text-2xl font-semibold tracking-tight text-brand" style={{ fontFamily: "var(--font-heading)" }}>
          Our collection
        </h4>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {PREVIEW_PRODUCTS.map((p) => (
            <div
              key={p.name}
              className="relative flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card text-card-foreground"
            >
              {p.featured && (
                <span
                  className="absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                  style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                >
                  Featured
                </span>
              )}
              <div
                className="flex aspect-square items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(var(--background)))" }}
              >
                <svg
                  viewBox="0 0 64 64"
                  fill="none"
                  stroke="hsl(var(--accent))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-8 w-8 opacity-40"
                  aria-hidden
                >
                  <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" />
                  <path d="M6 16l26 12 26-12" />
                  <path d="M32 28v32" />
                </svg>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="text-sm font-semibold text-brand" style={{ fontFamily: "var(--font-heading)" }}>
                  {p.name}
                </div>
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.desc}</p>
                <span
                  className="mt-0.5 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                  style={{ background: "color-mix(in srgb, hsl(var(--accent)) 12%, transparent)", color: "hsl(var(--accent))" }}
                >
                  {p.purity} Purity
                </span>
              </div>
              <hr className="border-border" />
              <div className="flex flex-col gap-2 p-3">
                <div className="text-base font-semibold text-brand" style={{ fontFamily: "var(--font-heading)" }}>
                  $49.99
                </div>
                <button
                  className="w-full rounded-full px-3 py-1.5 text-[11px] font-semibold"
                  style={{ background: PRIMARY_GRADIENT, color: "hsl(var(--primary-foreground))" }}
                >
                  Add to Cart
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <div className="mt-1 flex gap-1">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={`flex-1 rounded-[var(--radius)] border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            value === opt ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
          }`}
        >
          {render(opt)}
        </button>
      ))}
    </div>
  );
}

function AssetUpload({
  slug,
  kind,
  label,
  help,
  value,
  onChange,
}: {
  slug: string;
  kind: BrandingAssetKind;
  label: string;
  help: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadBrandingAssetAction(slug, kind, fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if ("error" in res) setError(res.error);
    else onChange(res.url);
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    const res = await removeBrandingAssetAction(slug, kind);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onChange(null);
  }

  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="max-h-12 max-w-12 object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">none</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{label}</span>
            {value && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className="text-xs text-muted-foreground underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
        </div>
      </div>
      <div className="mt-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/x-icon,.ico"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground disabled:opacity-50"
        />
        {busy && <p className="mt-1 text-xs text-muted-foreground">Uploading…</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function ContrastHint({ label, ratio }: { label: string; ratio: number }) {
  const ok = ratio >= 4.5;
  return (
    <p className={ok ? "text-muted-foreground" : "text-destructive"}>
      {ok ? "✓" : "⚠"} {label}: {ratio.toFixed(1)}:1 {ok ? "(AA)" : "(below 4.5:1 — hard to read)"}
    </p>
  );
}
