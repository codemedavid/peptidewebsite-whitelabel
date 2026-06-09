// ── Global Font Style presets ──
//
// Curated typography pairings the website builder can apply in one click, so a
// tenant gets professional type without picking heading/body/button fonts one
// at a time. Each preset names three families — heading, body, and button —
// that the storefront drives via the --brand-*-font CSS vars (see store.tsx
// applyBrandStyle and storefront.css). Selecting a preset just writes those
// three Brand fields; the tenant can still override any single font afterwards.
//
// IMPORTANT: every family referenced here MUST exist in FONT_REGISTRY (the
// single source of truth in ./tokens), so the picker can preview it and the
// storefront can load it without a 400 on a missing weight. A small dev-time
// guard below asserts this so a typo can't ship a font the page can't render.

import { FONT_REGISTRY } from "./tokens";

export type FontPreset = {
  /** Stable id, also the value stored when matching the current trio. */
  id: string;
  /** Display name shown in the picker (rendered in the heading font). */
  name: string;
  /** One-line character description shown under the name. */
  description: string;
  /** Headings, titles, eyebrows — the storefront's display face. */
  heading: string;
  /** Paragraph + UI copy — the storefront's reading face. */
  body: string;
  /** CTA / button label face. Often matches the heading for a confident CTA. */
  button: string;
};

/**
 * The presets, in display order. They lead with the most common SaaS/startup
 * looks and end with the more expressive editorial/creative pairings.
 */
export const FONT_PRESETS: FontPreset[] = [
  {
    id: "modern-saas",
    name: "Modern SaaS",
    description: "Clean, geometric, product-first",
    heading: "Plus Jakarta Sans",
    body: "Inter",
    button: "Plus Jakarta Sans",
  },
  {
    id: "startup",
    name: "Startup",
    description: "Bold, friendly, high-energy",
    heading: "Sora",
    body: "Inter",
    button: "Sora",
  },
  {
    id: "corporate",
    name: "Corporate",
    description: "Trusted, structured, professional",
    heading: "Archivo",
    body: "IBM Plex Sans",
    button: "Archivo",
  },
  {
    id: "tech",
    name: "Tech",
    description: "Precise, engineered, modern",
    heading: "Space Grotesk",
    body: "IBM Plex Sans",
    button: "Space Grotesk",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Quiet, single-typeface restraint",
    heading: "Manrope",
    body: "Manrope",
    button: "Manrope",
  },
  {
    id: "luxury",
    name: "Luxury",
    description: "Elegant serif, refined spacing",
    heading: "Cormorant Garamond",
    body: "Outfit",
    button: "Outfit",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Magazine-style serif pairing",
    heading: "Fraunces",
    body: "Spectral",
    button: "Fraunces",
  },
  {
    id: "creative",
    name: "Creative",
    description: "Expressive, distinctive, playful",
    heading: "Syne",
    body: "DM Sans",
    button: "Syne",
  },
];

export const FONT_PRESETS_BY_ID: Record<string, FontPreset> = Object.fromEntries(
  FONT_PRESETS.map((p) => [p.id, p]),
);

/**
 * The id of the preset whose heading/body/button match the given fonts, or null
 * when the trio is a custom combination. `button` falls back to `body` because
 * an unset button font follows the body font (the storefront.css default), and
 * presets always spell their button font out explicitly.
 */
export function matchFontPreset(
  heading?: string,
  body?: string,
  button?: string,
): string | null {
  const btn = button ?? body;
  const hit = FONT_PRESETS.find(
    (p) => p.heading === heading && p.body === body && p.button === btn,
  );
  return hit ? hit.id : null;
}

// Dev-time guard: catch a font typo here (where the test:themes gate or a code
// review will surface it) rather than as a silently-broken font on a live
// storefront. Stripped from production builds.
if (process.env.NODE_ENV !== "production") {
  for (const p of FONT_PRESETS) {
    for (const family of [p.heading, p.body, p.button]) {
      if (!FONT_REGISTRY[family]) {
        // eslint-disable-next-line no-console
        console.warn(
          `[fontPresets] preset "${p.id}" references "${family}", which is not in FONT_REGISTRY`,
        );
      }
    }
  }
}
