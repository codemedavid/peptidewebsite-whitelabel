"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { resolveCssVars } from "@/lib/theme/resolve-css-vars";
import { ThemePresetPicker } from "@/components/theme/ThemePresetPicker";
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
import { Select } from "@/components/ui/select";
import { BRAND } from "@/storefront/data";
import type { Brand } from "@/storefront/types";
import { BrandTweaksForm } from "@/storefront/tweaks/BrandTweaksForm";
import { TweaksStyle } from "@/storefront/tweaks/controls";
import { CardDesignPicker, cardDesignLabel } from "@/components/admin/CardDesignPicker";
import { CARD_PRESETS } from "@/storefront/cardDesign";
import { BRAND_BORDER_WIDTH_PRESETS, borderWidthLabel } from "@/lib/storefront/brand-border";
import { TEXT_COLOR_PARTS, withTextColor } from "@/lib/storefront/text-colors";
import { saveBrandingAction } from "@/actions/onboarding";
import { uploadStorefrontImageAsAdminAction } from "@/actions/branding";
import { applyBrandingAsset, type BrandingAssetKind } from "@/lib/upload/branding-assets";
import {
  AssetUpload,
  CollapsibleSection,
  HeaderColorField,
  Segmented,
} from "@/components/admin/branding-fields";
import { BrandSplashEditor, splashSummary } from "@/components/admin/BrandSplashEditor";
import { SPLASH_DESIGNS, type BrandSplash } from "@/lib/storefront/brand-splash";
import { LivePreviewStudio } from "@/components/admin/preview/LivePreviewStudio";
import "./branding-editor.css";
import { DEFAULT_INTL_LOCAL } from "@/lib/storefront/intl-local/config";
import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import { isDualMarket, normalizeIntlMarket } from "@/lib/storefront/intl-market";
import { SiteBuilderEnvProvider, type SiteBuilderEnv } from "@/storefront/admin/site-builder/env";
import { SiteBuilderUploadProvider } from "@/storefront/admin/site-builder/mode";
import { IntlLocalStudio, studioTabFor, type StudioTab } from "@/storefront/admin/site-builder/studio";
import type { Category } from "@/storefront/types";

// Tenant storefronts live at `<slug>.<ROOT>`. ROOT carries its own dev port
// (e.g. "lvh.me:3100"), and `*.lvh.me` resolves in every browser incl. Safari —
// unlike `*.localhost`, which Safari can't reach.
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

type EditorTab = "brand" | "hero" | "storefront" | "intl";

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
  const [tab, setTab] = useState<EditorTab>("brand");
  // The Intl & Local studio's own sub-tab, lifted here so the live preview's
  // "Click to edit" can open the right panel.
  const [studioTab, setStudioTab] = useState<StudioTab>("general");
  // A short status line for actions that don't navigate (studio uploads etc.).
  const [notice, setNotice] = useState("");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl);
  // Unlike the logo/favicon (own columns), this one lives inside branding.config
  // — see onDefaultProductImageChange for why it is mirrored into `cfg` too.
  const [defaultProductImage, setDefaultProductImage] = useState<string | null>(
    initialConfig.defaultProductImage ?? null,
  );
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
  const [saveError, setSaveError] = useState("");

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

  // Unsaved-changes tracking: a fingerprint of everything Save branding writes,
  // compared against the last saved one. Drives the save bar, ⌘S and the
  // leave-page guard.
  const fingerprint = JSON.stringify({ themeId, hexes, headingFont, bodyFont, cfg });
  const [savedPrint, setSavedPrint] = useState(fingerprint);
  const dirty = fingerprint !== savedPrint;

  // The Intl & Local tab exists only for a store ON that layout.
  const isIntlLocal = cfg.homeLayout === "intl-local";
  const intlValue = useMemo(() => normalizeIntlLocalConfig(cfg.intlLocal ?? DEFAULT_INTL_LOCAL), [cfg.intlLocal]);
  const previewExtras = useMemo(() => ({ name, logoUrl }), [name, logoUrl]);
  const studioBrand: Brand = useMemo(
    () => ({ ...storefrontBrand, dualMarket: isDualMarket({ homeLayout: cfg.homeLayout, intlMarket: cfg.intlMarket }) }),
    [storefrontBrand, cfg.homeLayout, cfg.intlMarket],
  );

  const setTweak = (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => {
    const edits: Partial<Brand> =
      typeof keyOrEdits === "object" && keyOrEdits !== null
        ? keyOrEdits
        : ({ [keyOrEdits]: val } as Partial<Brand>);
    setCfg((c) => ({ ...c, ...edits }));
    // Mirror heading/body changes made in the embedded Storefront form (incl.
    // the Global Font Style preset picker) back onto the top-level font state,
    // which drives the structured `fonts` JSON + the shared-chrome --font-*
    // vars — so the two never drift out of sync on save.
    if (typeof edits.headingFont === "string") setHeadingFont(edits.headingFont);
    if (typeof edits.bodyFont === "string") setBodyFont(edits.bodyFont);
    setSaved(false);
  };

  /**
   * The upload already persisted the URL into branding.config server-side, so
   * this doesn't mark the form dirty. It DOES have to mirror the value into
   * `cfg`: Save branding writes that object back wholesale, so a `cfg` still
   * holding the config as it was loaded would silently undo the upload.
   */
  const mirrorAssetIntoCfg = (kind: BrandingAssetKind, url: string | null) =>
    setCfg((c) => applyBrandingAsset(c as Record<string, unknown>, kind, url) as Partial<Brand>);

  const onDefaultProductImageChange = (url: string | null) => {
    setDefaultProductImage(url);
    mirrorAssetIntoCfg("defaultProductImage", url);
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

  const customTextColors = Object.keys(cfg.textColors ?? {}).length;
  const textColorSummary = customTextColors > 0 ? `${customTextColors} customized` : "Theme defaults";

  const btnContrast = contrastRatio(triples.buttonText, triples.button);
  const textContrast = contrastRatio(triples.text, triples.background);

  // Auto-sync (theme → storefront): mirror the Brand-tab palette + fonts onto
  // the storefront Brand config so the live storefront home matches the chosen
  // theme. `button2` (gradient end) flattens to the button color. The Storefront
  // tab stays editable — operators can still override these afterward.
  // `buttonFont` is intentionally NOT touched here: themes don't define one, and
  // this runs on every color tweak too, so resetting it would wipe a Global Font
  // Style choice. It persists across theme/color edits (unset → follows body).
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
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await saveBrandingAction(slug, {
        themeId,
        colors: triples,
        fonts: { heading: headingFont, body: bodyFont },
        hero: heroTypography,
        config: storefrontBrand as unknown as Record<string, unknown>,
      });
      if ("ok" in res) {
        setSaved(true);
        setSavedPrint(fingerprint);
      } else {
        setSaveError(res.error === "FORBIDDEN" ? "Your session expired — sign in again to save." : res.error);
      }
    } catch {
      setSaveError("Couldn't save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // ⌘S / Ctrl+S saves; leaving with unsaved edits asks first.
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);
  // A store that leaves the Intl & Local layout loses that tab.
  useEffect(() => {
    if (tab === "intl" && !isIntlLocal) setTab("storefront");
  }, [tab, isIntlLocal]);

  // The platform's plumbing for the shared Intl & Local studio (see
  // site-builder/env): edits land in `cfg` and ride Save branding.
  const siteEnv = useMemo<SiteBuilderEnv>(
    () => ({
      toast: setNotice,
      categories: ((cfg.categories as Category[] | undefined) ?? []).filter((c) => c.id !== "all"),
      intl: {
        enabled: normalizeIntlMarket(cfg.intlMarket).enabled,
        savesImmediately: false,
        setEnabled: async (enabled) => {
          setCfg((c) => ({ ...c, intlMarket: { ...normalizeIntlMarket(c.intlMarket), enabled } }));
          setSaved(false);
          return { ok: true };
        },
      },
      subscribers: null,
    }),
    [cfg.categories, cfg.intlMarket],
  );
  const studioUpload = useCallback(
    (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "branding");
      return uploadStorefrontImageAsAdminAction(slug, fd);
    },
    [slug],
  );

  // "Click to edit" in the live preview → open the controls for that part.
  const onSelectRegion = useCallback(
    (region: string) => {
      if (isIntlLocal && region !== "catalog") {
        setTab("intl");
        setStudioTab(studioTabFor(region));
      } else {
        setTab(region === "hero" ? "hero" : "storefront");
      }
      controlsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [isIntlLocal],
  );
  const controlsRef = useRef<HTMLDivElement>(null);
  const tabs: { id: EditorTab; label: string }[] = [
    { id: "brand", label: "Brand" },
    { id: "hero", label: "Hero" },
    { id: "storefront", label: "Storefront" },
    ...(isIntlLocal ? [{ id: "intl" as const, label: "Intl & Local" }] : []),
  ];

  return (
    <div>
      {/* load the chosen fonts for the live preview — incl. distinct hero fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={googleFontsUrl(headingFont, bodyFont, storefrontBrand.buttonFont, heroTitleFont, heroBodyFont)} />

      <div className="be-bar" data-dirty={dirty ? "1" : "0"}>
        <div className="be-bar__title">
          <h2 className="font-heading text-xl font-bold">Branding</h2>
          {dirty ? (
            <span className="be-pill be-pill--warn">Unsaved changes</span>
          ) : saved ? (
            <span className="be-pill be-pill--ok">All changes saved</span>
          ) : null}
          {saveError && (
            <span className="be-pill be-pill--err" role="alert">
              {saveError}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="be-kbd" aria-hidden>
            ⌘S
          </span>
          <a
            href={`http://${slug}.${ROOT}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-sm text-accent underline underline-offset-2"
          >
            View storefront
            <ExternalLink className="h-3.5 w-3.5" aria-label="opens in a new tab" />
          </a>
          {/* .sa's button reset beats single-class Tailwind utilities, so the
              primary action uses the admin's own .btn styles. */}
          <button type="button" className="btn btn-accent" onClick={onSave} disabled={saving || (!dirty && saved)}>
            {saving ? "Saving…" : !dirty && saved ? (<><Check aria-hidden /> Saved</>) : "Save branding"}
          </button>
        </div>
      </div>
      {saved && !dirty && (
        <span role="status" className="sr-only">
          Branding saved.
        </span>
      )}
      {notice && (
        <div className="be-toast" role="status">
          {notice}
        </div>
      )}

      {/* ── Tabs ── */}
      {/* A segmented control, not a second underline tab bar — the tenant
          workspace tabs already sit directly above this. */}
      <div role="tablist" aria-label="Branding sections" className="seg mt-5 brand-seg">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={"seg-item" + (tab === t.id ? " active" : "") + (t.id === "intl" ? " seg-item--new" : "")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="be-grid mt-6">
        {/* ── Controls ── */}
        <div ref={controlsRef} className="space-y-6 be-controls">
          {tab !== "intl" && (
          <>
          {/* Theme preset + Card Studio are the shared base for every tab —
              keep them reachable from Hero and Storefront too. Both collapse
              (closed by default) so the controls column stays compact; the
              header summary always shows the current selection. */}
          <CollapsibleSection
            title="Theme preset"
            summary={THEME_PRESETS[themeId]?.name ?? themeId}
            badge={`${Object.keys(THEME_PRESETS).length} themes`}
          >
            <p className="text-xs text-muted-foreground">
              Pick a preset to re-skin the whole storefront — colors, fonts &amp; radius. You can
              fine-tune any color below afterward.
            </p>
            <div className="mt-3">
              <ThemePresetPicker value={themeId} onChange={pickPreset} columns={2} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Card Studio"
            summary={cardDesignLabel(storefrontBrand.cardDesign)}
            badge={`${CARD_PRESETS.length} styles`}
          >
            <p className="text-xs text-muted-foreground">
              Product card style for the tenant&apos;s catalog. Each preview renders the real
              storefront card with this brand&apos;s colors &amp; fonts.
            </p>
            <div className="mt-3">
              <CardDesignPicker
                brand={storefrontBrand}
                value={storefrontBrand.cardDesign}
                onChange={(d) => setTweak("cardDesign", d)}
              />
            </div>
          </CollapsibleSection>

          {/* Loading screen — the branded splash every storefront boots through.
              Operator-only: there is no store-admin counterpart, so this panel
              is the ONLY place it can be changed. Like every other tweak here it
              rides the shared Save branding; only its logo upload persists on
              its own, which is why the URL is mirrored back into cfg. */}
          <CollapsibleSection
            title="Loading screen"
            summary={splashSummary(storefrontBrand.brandSplash)}
            badge={`${SPLASH_DESIGNS.length} designs`}
          >
            <BrandSplashEditor
              slug={slug}
              storeName={storefrontBrand.name}
              value={storefrontBrand.brandSplash}
              brandingLogoUrl={logoUrl}
              surfaceColor={storefrontBrand.surface}
              mainColor={storefrontBrand.main}
              textColor={storefrontBrand.text}
              onChange={(next: BrandSplash) => setTweak("brandSplash", next)}
              onLogoUploaded={(url) => {
                // The upload already wrote branding.config server-side; mirror
                // it so the next Save branding can't write a stale cfg over it.
                mirrorAssetIntoCfg("splashLogo", url);
              }}
            />
          </CollapsibleSection>
          </>
          )}

          {tab === "intl" ? (
            // The SAME studio the store owner uses (#admin → Website Layout),
            // here writing into the branding draft so it rides Save branding.
            <SiteBuilderEnvProvider env={siteEnv}>
              <SiteBuilderUploadProvider upload={studioUpload}>
                <div className="sf-root sb sb-embed">
                  <IntlLocalStudio
                    brand={studioBrand}
                    value={intlValue}
                    onChange={(fn) => {
                      setCfg((c) => ({ ...c, intlLocal: fn(normalizeIntlLocalConfig(c.intlLocal ?? DEFAULT_INTL_LOCAL)) }));
                      setSaved(false);
                    }}
                    tab={studioTab}
                    onTab={setStudioTab}
                  />
                </div>
              </SiteBuilderUploadProvider>
            </SiteBuilderEnvProvider>
          ) : tab === "brand" ? (
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

                {/* Header colors — storefront-only overrides for the sticky site
                    header. Stored on the Brand config (not the role palette), so
                    leaving them unset keeps the current behavior (header derives
                    its background from Surface and its text from Main/Text). */}
                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Header</h3>
                  <div className="mt-2 space-y-2">
                    <HeaderColorField
                      label="Header background"
                      help="Background of the sticky site header. Defaults to Surface."
                      value={cfg.headerBg}
                      fallback={storefrontBrand.surface}
                      onChange={(v) => setTweak("headerBg", v)}
                      onReset={() => setTweak("headerBg", undefined)}
                      resetLabel="Reset to Surface"
                    />
                    <HeaderColorField
                      label="Header text"
                      help="Logo text, nav links, cart & menu icons. Defaults to Main."
                      value={cfg.headerText}
                      fallback={storefrontBrand.main}
                      onChange={(v) => setTweak("headerText", v)}
                      onReset={() => setTweak("headerText", undefined)}
                      resetLabel="Reset to brand colors"
                    />
                  </div>
                </div>

                {/* Borders — storefront-wide overrides. Color recolors every
                    --brand-border hairline/panel/card frame; width thickens the
                    standard 1px borders. Stored on the Brand config; unset keeps
                    the theme default at 1px (existing tenants unaffected). */}
                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Borders</h3>
                  <div className="mt-2 space-y-2">
                    <HeaderColorField
                      label="Border color"
                      help="Hairlines, panels & card frames across the storefront. Defaults to the theme border."
                      value={cfg.borderColor}
                      fallback="#E5E7EB"
                      onChange={(v) => setTweak("borderColor", v)}
                      onReset={() => setTweak("borderColor", undefined)}
                      resetLabel="Reset to theme border"
                    />
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Border width</span>
                      <Select
                        value={borderWidthLabel(cfg.borderWidth)}
                        onChange={(e) => setTweak("borderWidth", BRAND_BORDER_WIDTH_PRESETS[e.target.value])}
                        className="mt-1"
                      >
                        {Object.keys(BRAND_BORDER_WIDTH_PRESETS).map((label) => (
                          <option key={label} value={label}>{label}</option>
                        ))}
                      </Select>
                    </label>
                  </div>
                </div>
              </div>

              {/* Text colors — per-part font colour overrides (Brand.textColors,
                  rendered by TextColorsStyle). Unset parts inherit the palette
                  above, so existing tenants are unaffected. Hero lines and the
                  header have their own colour controls (Hero tab / Header). */}
              <CollapsibleSection
                title="Text colors"
                summary={textColorSummary}
                badge={`${TEXT_COLOR_PARTS.length} parts`}
              >
                <p className="text-xs text-muted-foreground">
                  Change the font color of one part of the website without touching the rest. Hero
                  text is set in the Hero tab; header text under Header above.
                </p>
                <div className="mt-3 space-y-3">
                  {TEXT_COLOR_PARTS.map((part) => (
                    <HeaderColorField
                      key={part.id}
                      label={part.label}
                      help={part.help}
                      value={cfg.textColors?.[part.id]}
                      fallback={storefrontBrand.text}
                      onChange={(v) => setTweak("textColors", withTextColor(cfg.textColors, part.id, v))}
                      onReset={() => setTweak("textColors", withTextColor(cfg.textColors, part.id, undefined))}
                      resetLabel="Reset to theme color"
                    />
                  ))}
                </div>
              </CollapsibleSection>

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
                <AssetUpload
                  slug={slug}
                  kind="defaultProductImage"
                  label="Default product image"
                  help="Shown on products that have no photo of their own — instead of the grey placeholder. Products with their own image keep it. JPG/PNG/WebP, max 10 MB."
                  value={defaultProductImage}
                  onChange={onDefaultProductImageChange}
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
                    uploadImage={(fd) => uploadStorefrontImageAsAdminAction(slug, fd)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Live preview ── */}
        {/* The tenant's REAL storefront in a device frame, fed the unsaved
            draft (components/admin/preview). Sticky so it stays in view while
            the much taller controls column scrolls. */}
        <div className="be-preview">
          <LivePreviewStudio
            slug={slug}
            draft={cfg}
            extras={previewExtras}
            previewBrand={studioBrand}
            storefrontUrl={`http://${slug}.${ROOT}`}
            onSelectRegion={onSelectRegion}
          />
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
  headerBg,
  headerText,
}: {
  name: string;
  logoUrl: string | null;
  hero?: Partial<Brand>;
  headerBg?: string;
  headerText?: string;
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
  } else if (heroVariant === "wordmark") {
    // Wordmark: the brand name as one large gold-gradient mark on a clean
    // background — mirrors the storefront .hero__wordmark look.
    heroNode = (
      <div className="px-6 py-12 text-center" style={{ background: "hsl(var(--background))" }}>
        <div className="flex flex-col items-center gap-4">
          <span
            className="font-normal"
            style={{
              fontFamily: titleFontFamily,
              fontSize: "clamp(2.25rem, 9vw, 3.5rem)",
              letterSpacing: "0.04em",
              lineHeight: 0.95,
              background: highlight
                ? undefined
                : "linear-gradient(100deg,#8a6a24 0%,#e6c874 26%,#b8892e 50%,#f0d98f 72%,#a67c28 100%)",
              WebkitBackgroundClip: highlight ? undefined : "text",
              backgroundClip: highlight ? undefined : "text",
              color: highlight ?? "transparent",
            }}
          >
            {(hero?.heroLine1 || "").trim() || name}
          </span>
          {renderSub()}
          {renderCtas("center")}
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
      {/* Header — reflects the optional header color overrides; unset falls back
          to the brand surface/brand colors via the shadcn tokens. */}
      <div
        className="flex items-center justify-between border-b border-border px-5 py-3"
        style={headerBg ? { background: headerBg } : undefined}
      >
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
          <span
            className="font-semibold text-brand"
            style={{ fontFamily: "var(--font-heading)", color: headerText }}
          >
            {name}
          </span>
        </span>
        <span className="flex items-center gap-4 text-sm">
          <span style={headerText ? { color: headerText } : undefined} className={headerText ? "" : "text-accent"}>Catalog</span>
          <span style={headerText ? { color: headerText } : undefined} className={headerText ? "" : "text-muted-foreground"}>Research</span>
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
                  ₱49.99
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

/**
 * A collapsible controls section (closed by default) — keeps the big pickers
 * (themes, card designs) out of the way until the operator opens them. The
 * header always shows the current selection so closed ≠ hidden information.
 */
function ContrastHint({ label, ratio }: { label: string; ratio: number }) {
  const ok = ratio >= 4.5;
  return (
    <p className={ok ? "text-muted-foreground" : "text-destructive"}>
      {ok ? "✓" : "⚠"} {label}: {ratio.toFixed(1)}:1 {ok ? "(AA)" : "(below 4.5:1 — hard to read)"}
    </p>
  );
}
