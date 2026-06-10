import { THEME_PRESETS, DEFAULT_THEME } from "./presets";
import { ROLE_TO_TOKENS, presetTripleForRole, hslTripleToHex, type RoleKey } from "./tokens";

type BrandingLike = {
  themeId?: string | null;
  colors?: unknown; // Json: partial role map { main, accent, button, buttonText, background, surface, text }
  fonts?: unknown; // Json: { heading?, body? }
  config?: unknown; // Json: full storefront Brand blob (may carry headingFont/bodyFont)
  radius?: string | null;
} | null;

/**
 * Effective heading/body fonts for a tenant: preset < structured fonts JSON <
 * Brand config. The storefront home renders `config.headingFont/bodyFont`
 * (page.tsx spreads config last), so every other consumer must resolve fonts
 * with the same precedence — otherwise a drifted `fonts` JSON makes sub-page
 * chrome (and the font <link> loader) disagree with the home page.
 */
function resolveFonts(
  branding: BrandingLike,
  preset: { fonts: { heading: string; body: string } },
): { heading: string; body: string } {
  const fonts = asRecord(branding?.fonts) as { heading?: string; body?: string };
  const config = asRecord(branding?.config) as { headingFont?: string; bodyFont?: string };
  return {
    heading: config.headingFont || fonts.heading || preset.fonts.heading,
    body: config.bodyFont || fonts.body || preset.fonts.body,
  };
}

/**
 * Resolve a tenant's Branding into inline CSS custom properties.
 * Precedence: preset defaults < tenant role overrides.
 * Roles (main/accent/button/buttonText/background/surface/text) are mapped onto
 * the underlying shadcn tokens, plus a dedicated --brand var for the main color.
 * Apply on a wrapping element: <div style={resolveCssVars(branding)}>.
 */
export function resolveCssVars(branding: BrandingLike): React.CSSProperties {
  const preset = THEME_PRESETS[branding?.themeId ?? ""] ?? DEFAULT_THEME;

  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(preset.colors)) {
    vars[`--${token}`] = value;
  }
  // --brand defaults to the preset's primary unless the tenant sets `main`.
  vars["--brand"] = preset.colors.primary;

  // Optional brand gradient stops (themes that ship one). Components can use
  // `linear-gradient(var(--brand-gradient-angle), hsl(var(--brand-gradient-from)),
  // hsl(var(--brand-gradient-to)))`; absent themes simply leave these unset.
  if (preset.gradient) {
    vars["--brand-gradient-from"] = preset.gradient.from;
    vars["--brand-gradient-to"] = preset.gradient.to;
  }

  const fonts = resolveFonts(branding, preset);
  vars["--radius"] = branding?.radius ?? preset.radius;
  vars["--font-heading"] = fonts.heading;
  vars["--font-body"] = fonts.body;

  // Apply role overrides onto the shadcn tokens they drive.
  const roles = asRecord(branding?.colors) as Partial<Record<RoleKey, string>>;
  for (const [role, triple] of Object.entries(roles)) {
    if (!triple) continue;
    for (const token of ROLE_TO_TOKENS[role as RoleKey] ?? []) {
      vars[`--${token}`] = triple;
    }
  }

  return vars as React.CSSProperties;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The storefront `Brand` palette fields the theme can drive. These map 1:1 to
 * the role colors (plus `button2`, the gradient end, which we flatten to the
 * button color) and the heading/body fonts.
 *
 * Note: there is intentionally no `buttonFont` here — THEME_PRESETS don't define
 * a button font, so it isn't theme-derived. It lives only on the storefront
 * Brand config (`config.buttonFont`) and falls back to the body font when unset
 * (see the --brand-button-font default in storefront.css). The storefront page
 * spreads `config` after this palette, so a configured button font is preserved.
 */
export type StorefrontPalette = {
  main: string;
  accent: string;
  button: string;
  button2: string;
  buttonText: string;
  background: string;
  surface: string;
  text: string;
  headingFont: string;
  bodyFont: string;
};

/**
 * Derive the storefront's hex palette + fonts from a tenant's theme/role colors,
 * so the hash-routed storefront home (which reads `Brand.main/accent/…` via
 * `applyBrandStyle`) stays in sync with the theme preset selected in the editor.
 * Same precedence as resolveCssVars: preset defaults < tenant role overrides.
 * The storefront's `--brand-*` vars speak hex, so role triples are converted.
 */
export function brandPaletteFromBranding(branding: BrandingLike): StorefrontPalette {
  const themeId = branding?.themeId ?? "";
  const preset = THEME_PRESETS[themeId] ?? DEFAULT_THEME;
  const overrides = asRecord(branding?.colors) as Partial<Record<RoleKey, string>>;
  const hex = (role: RoleKey) => hslTripleToHex(overrides[role] ?? presetTripleForRole(themeId, role));
  const fonts = { ...preset.fonts, ...(asRecord(branding?.fonts) as { heading?: string; body?: string }) };

  return {
    main: hex("main"),
    accent: hex("accent"),
    button: hex("button"),
    button2: hex("button"),
    buttonText: hex("buttonText"),
    background: hex("background"),
    surface: hex("surface"),
    text: hex("text"),
    headingFont: fonts.heading ?? preset.fonts.heading,
    bodyFont: fonts.body ?? preset.fonts.body,
  };
}
