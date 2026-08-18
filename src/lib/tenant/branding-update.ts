// Tenant branding UPDATE — the pure core behind the MCP connector's
// update_whitelabel_branding tool.
//
// createTenantWithSetup (./setup.ts) provisions a NEW tenant. Nothing could
// restyle an EXISTING one from outside the app: an operator who wanted a live
// store's palette, theme, layout or hero changed had to open the admin UI by
// hand. This module is the write path that was missing, and it is deliberately
// stricter than everything around it.
//
// Three rules carry the design:
//
//   IT PATCHES, IT NEVER REPLACES. branding.config is one JSON column holding a
//   store's entire configured life — payment methods, FAQ, lab reports, promo
//   codes, categories, shipping locations, group-buy rules. A restyle touches a
//   dozen color keys. So the merge is key-by-key over a COPY of the current
//   config, and any key the patch doesn't name is carried through untouched.
//   A "replace the config" write here would silently delete live commerce data.
//
//   IT FAILS LOUD. The storefront's other normalizers (see ../storefront/
//   brand-border) discard junk and fall back to a theme default, because they
//   run on RENDER and a broken render must still paint. This runs on WRITE, on
//   behalf of an agent that cannot see the result, so a mistyped key or an
//   unparseable color is an ERROR and the whole patch is refused. Half-applying
//   a rejected restyle would leave a store in a state nobody asked for.
//
//   CONTRAST IS ADVISORY, NOT FATAL. Text-on-background and label-on-button are
//   the two pairs a remote restyle reliably breaks, and WCAG AA is checkable
//   arithmetic. But an operator may be applying a palette in two calls, so a
//   failing pair WARNS and still writes.
//
// Pure + JSON-safe (no Prisma, no React) so the route, a script and the test all
// share one contract. Covered by npm run test:branding-update.

import { contrastRatio, hexToHslTriple } from "@/lib/theme/color";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { MAX_BORDER_WIDTH } from "@/lib/storefront/brand-border";
import { HOME_LAYOUTS } from "@/lib/storefront/boutique-home";

/** #RGB or #RRGGBB — the same hex discipline as brand-border / cardDesign. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** WCAG AA for body text. Below this the pair is called out. */
const AA_CONTRAST = 4.5;

/** Copy caps. branding.config is a JSON column shared by every storefront read. */
const MAX_SHORT = 200;
const MAX_LONG = 600;

export type BrandingUpdateResult = {
  /** Present only when the patch actually MOVES the theme, so an unchanged
   *  theme is never rewritten to the Branding.themeId column. */
  themeId?: string;
  /** The full merged config to write. Equal to the current config when errors
   *  is non-empty — callers must check errors before writing. */
  config: Record<string, unknown>;
  /** Dotted patch paths that changed, e.g. "colors.background". */
  changed: string[];
  /** Non-empty ⇒ refuse the write. */
  errors: string[];
  /** Advisory only (contrast). Never blocks a write. */
  warnings: string[];
};

/** The patch sections this module accepts. Anything else is an error. */
export const BRANDING_PATCH_SECTIONS = [
  "themeId",
  "colors",
  "fonts",
  "layout",
  "hero",
  "identity",
  "catalog",
] as const;

/** patch key → the flat branding.config key it writes. */
type FieldMap = Record<string, string>;

const COLOR_FIELDS: FieldMap = {
  main: "main",
  accent: "accent",
  button: "button",
  button2: "button2",
  buttonText: "buttonText",
  background: "background",
  surface: "surface",
  text: "text",
  headerBg: "headerBg",
  headerText: "headerText",
  borderColor: "borderColor",
  heroHighlight: "heroHighlight",
};

const FONT_FIELDS: FieldMap = {
  heading: "headingFont",
  body: "bodyFont",
  button: "buttonFont",
  price: "priceFont",
  heroTitle: "heroTitleFont",
  heroBody: "heroBodyFont",
};

const HERO_FIELDS: FieldMap = {
  chip: "heroChipLabel",
  line1: "heroLine1",
  line2: "heroLine2",
  sub: "heroSub",
  cta1: "heroCta1",
  cta2: "heroCta2",
};

const IDENTITY_FIELDS: FieldMap = {
  name: "name",
  industry: "industry",
  ctaLabel: "ctaLabel",
  metaDescription: "metaDescription",
  footerBlurb: "footerBlurb",
};

const CATALOG_FIELDS: FieldMap = {
  eyebrow: "catalogEyebrow",
  title: "catalogTitle",
};

/** Layout keys that take a boolean. All map 1:1 onto branding.config. */
const LAYOUT_BOOLEANS = [
  "showHeader",
  "showHero",
  "showCategories",
  "showCatalog",
  "showFooter",
  "headerShowBrand",
  "headerShowLogo",
  "headerShowCart",
  "headerShowCta",
  "heroShowLogo",
  "heroShowChip",
  "heroShowSub",
  "heroShowCtas",
  "heroShowCta2",
  "catalogShowSearch",
  "catalogShowSort",
  "catalogShowCount",
  "footerShowBrand",
  "footerShowBlurb",
  "footerShowSocials",
  "footerShowColumns",
  "siteBorder",
] as const;

/** Layout keys constrained to a fixed set of values. */
const LAYOUT_ENUMS: Record<string, readonly string[]> = {
  heroVariant: ["centered", "split", "editorial", "card", "minimal", "spotlight", "wordmark"],
  heroAlign: ["left", "center"],
  heroTitleSize: ["sm", "md", "lg", "xl"],
  heroBodySize: ["sm", "md", "lg"],
  footerStyle: ["columns", "compact"],
  catalogSortStyle: ["classic", "simple"],
  // Owner-selectable home layout. "two-ways" additionally needs the operator
  // grant at render (resolveHomeLayout) — the allow-list only decides what may
  // be STORED. A value missing here is dropped silently on save.
  homeLayout: [...HOME_LAYOUTS],
};

/** Layout keys taking a bounded number: [min, max]. */
const LAYOUT_NUMBERS: Record<string, [number, number]> = {
  logoCurve: [0, 50],
  heroLogoSize: [24, 480],
  heroTitleWeight: [400, 800],
};

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One accumulating pass over a patch. Collects errors rather than throwing on
 * the first, so an operator gets every problem in one reply instead of
 * discovering them one call at a time.
 */
type Pass = {
  next: Record<string, unknown>;
  changed: string[];
  errors: string[];
};

function setField(pass: Pass, path: string, configKey: string, value: unknown): void {
  if (pass.next[configKey] === value) return;
  pass.next[configKey] = value;
  pass.changed.push(path);
}

/** Reject any key in `section` that isn't in `allowed` — a typo must not vanish. */
function rejectUnknownKeys(pass: Pass, section: string, obj: Record<string, unknown>, allowed: Iterable<string>): void {
  const known = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      pass.errors.push(`Unknown ${section} field "${key}". Allowed: ${[...known].sort().join(", ")}.`);
    }
  }
}

function applyColors(pass: Pass, raw: Record<string, unknown>): void {
  rejectUnknownKeys(pass, "colors", raw, [...Object.keys(COLOR_FIELDS), "borderWidth"]);

  for (const [key, configKey] of Object.entries(COLOR_FIELDS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "string" || !HEX_RE.test(value)) {
      pass.errors.push(`colors.${key} must be a hex color like #1C1917 or #111 (got ${JSON.stringify(value)}).`);
      continue;
    }
    setField(pass, `colors.${key}`, configKey, value);
  }

  if ("borderWidth" in raw) {
    const value = raw.borderWidth;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > MAX_BORDER_WIDTH) {
      pass.errors.push(
        `colors.borderWidth must be a number between 1 and ${MAX_BORDER_WIDTH} (got ${JSON.stringify(value)}).`,
      );
    } else {
      setField(pass, "colors.borderWidth", "borderWidth", Math.round(value));
    }
  }
}

/** Shared string handler for the fonts / hero / identity / catalog sections. */
function applyStrings(
  pass: Pass,
  section: string,
  raw: Record<string, unknown>,
  fields: FieldMap,
  max: number,
): void {
  rejectUnknownKeys(pass, section, raw, Object.keys(fields));

  for (const [key, configKey] of Object.entries(fields)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "string") {
      pass.errors.push(`${section}.${key} must be a string (got ${JSON.stringify(value)}).`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      pass.errors.push(`${section}.${key} is ${trimmed.length} characters; the limit is ${max}.`);
      continue;
    }
    // An empty string is a deliberate "clear this line", not a missing value —
    // omitting the key is how you leave a field alone.
    setField(pass, `${section}.${key}`, configKey, trimmed);
  }
}

function applyLayout(pass: Pass, raw: Record<string, unknown>): void {
  rejectUnknownKeys(pass, "layout", raw, [
    ...LAYOUT_BOOLEANS,
    ...Object.keys(LAYOUT_ENUMS),
    ...Object.keys(LAYOUT_NUMBERS),
  ]);

  for (const key of LAYOUT_BOOLEANS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "boolean") {
      pass.errors.push(`layout.${key} must be true or false (got ${JSON.stringify(value)}).`);
      continue;
    }
    setField(pass, `layout.${key}`, key, value);
  }

  for (const [key, allowed] of Object.entries(LAYOUT_ENUMS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "string" || !allowed.includes(value)) {
      pass.errors.push(`layout.${key} must be one of: ${allowed.join(", ")} (got ${JSON.stringify(value)}).`);
      continue;
    }
    setField(pass, `layout.${key}`, key, value);
  }

  for (const [key, [min, max]] of Object.entries(LAYOUT_NUMBERS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      pass.errors.push(`layout.${key} must be a number between ${min} and ${max} (got ${JSON.stringify(value)}).`);
      continue;
    }
    setField(pass, `layout.${key}`, key, Math.round(value));
  }
}

/** WCAG ratio between two hex colors, or null when either isn't a usable hex. */
function hexContrast(a: unknown, b: unknown): number | null {
  if (typeof a !== "string" || typeof b !== "string") return null;
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return null;
  return contrastRatio(hexToHslTriple(a), hexToHslTriple(b));
}

/**
 * The pairs a remote restyle reliably breaks. Read off the MERGED config so a
 * patch that changes only one half of a pair is still judged against the half
 * already stored — exactly the case a remote caller can't see.
 */
function contrastWarnings(config: Record<string, unknown>, touched: Set<string>): string[] {
  const pairs: { fg: string; bg: string; label: string }[] = [
    { fg: "text", bg: "background", label: "Body text on the page background" },
    { fg: "text", bg: "surface", label: "Body text on card surfaces" },
    { fg: "buttonText", bg: "button", label: "Button label on the button fill" },
  ];

  const warnings: string[] = [];
  for (const pair of pairs) {
    // Only judge a pair the caller actually moved; a pre-existing weak pair the
    // patch didn't touch isn't this call's news.
    if (!touched.has(pair.fg) && !touched.has(pair.bg)) continue;
    const ratio = hexContrast(config[pair.fg], config[pair.bg]);
    if (ratio === null || ratio >= AA_CONTRAST) continue;
    warnings.push(
      `Low contrast: ${pair.label} is ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${AA_CONTRAST}:1. ` +
        `Darken ${pair.fg} or lighten ${pair.bg} for readable copy.`,
    );
  }
  return warnings;
}

/**
 * Merge an operator's branding patch onto a tenant's existing Branding row.
 *
 * Returns the FULL config to write plus what changed; callers must refuse the
 * write whenever `errors` is non-empty (the returned config is then the current
 * one, unmodified). Never mutates `current`.
 */
export function buildTenantBrandingUpdate(
  current: { themeId?: string | null; config: unknown },
  patch: unknown,
): BrandingUpdateResult {
  const config = plainObject(current.config) ?? {};
  const input = plainObject(patch);

  if (!input) {
    return {
      config,
      changed: [],
      errors: [
        `The branding patch must be an object with at least one of: ${BRANDING_PATCH_SECTIONS.join(", ")}.`,
      ],
      warnings: [],
    };
  }

  const pass: Pass = { next: { ...config }, changed: [], errors: [] };

  for (const key of Object.keys(input)) {
    if (!(BRANDING_PATCH_SECTIONS as readonly string[]).includes(key)) {
      pass.errors.push(`Unknown branding section "${key}". Allowed: ${BRANDING_PATCH_SECTIONS.join(", ")}.`);
    }
  }

  let nextThemeId: string | undefined;
  if ("themeId" in input) {
    const value = input.themeId;
    if (typeof value !== "string" || !THEME_PRESETS[value]) {
      const ids = Object.keys(THEME_PRESETS);
      pass.errors.push(
        `Unknown themeId ${JSON.stringify(value)}. Pick one of the ${ids.length} presets, e.g. ${ids.slice(0, 3).join(", ")}.`,
      );
    } else if (value !== (current.themeId ?? "")) {
      nextThemeId = value;
      pass.changed.push("themeId");
    }
  }

  const sectionHandlers: { key: string; run: (raw: Record<string, unknown>) => void }[] = [
    { key: "colors", run: (raw) => applyColors(pass, raw) },
    { key: "fonts", run: (raw) => applyStrings(pass, "fonts", raw, FONT_FIELDS, MAX_SHORT) },
    { key: "layout", run: (raw) => applyLayout(pass, raw) },
    { key: "hero", run: (raw) => applyStrings(pass, "hero", raw, HERO_FIELDS, MAX_LONG) },
    { key: "identity", run: (raw) => applyStrings(pass, "identity", raw, IDENTITY_FIELDS, MAX_LONG) },
    { key: "catalog", run: (raw) => applyStrings(pass, "catalog", raw, CATALOG_FIELDS, MAX_SHORT) },
  ];

  for (const { key, run } of sectionHandlers) {
    if (!(key in input)) continue;
    const raw = plainObject(input[key]);
    if (!raw) {
      pass.errors.push(`${key} must be an object.`);
      continue;
    }
    run(raw);
  }

  if (!pass.errors.length && !pass.changed.length) {
    pass.errors.push(
      "Nothing to update — the patch matched the tenant's current branding, or every section was empty.",
    );
  }

  // All-or-nothing: a rejected patch leaves the store exactly as it was, so an
  // operator never has to guess which half of their restyle landed.
  if (pass.errors.length) {
    return { config, changed: [], errors: pass.errors, warnings: [] };
  }

  const touchedColors = new Set(
    pass.changed.filter((p) => p.startsWith("colors.")).map((p) => p.slice("colors.".length)),
  );

  return {
    ...(nextThemeId ? { themeId: nextThemeId } : {}),
    config: pass.next,
    changed: pass.changed,
    errors: [],
    warnings: contrastWarnings(pass.next, touchedColors),
  };
}
