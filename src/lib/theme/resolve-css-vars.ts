import { THEME_PRESETS, DEFAULT_THEME } from "./presets";
import { ROLE_TO_TOKENS, presetTripleForRole, hslTripleToHex, type RoleKey } from "./tokens";

type BrandingLike = {
  themeId?: string | null;
  colors?: unknown; // Json: partial role map { main, accent, button, buttonText, background, surface, text }
  fonts?: unknown; // Json: { heading?, body? }
  radius?: string | null;
} | null;

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

  const fonts = { ...preset.fonts, ...(asRecord(branding?.fonts) as { heading?: string; body?: string }) };
  vars["--radius"] = branding?.radius ?? preset.radius;
  vars["--font-heading"] = fonts.heading ?? preset.fonts.heading;
  vars["--font-body"] = fonts.body ?? preset.fonts.body;

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
