// Hero layout variant — the reusable core for the storefront hero's look.
//
// The stored heroVariant lives on branding.config (untrusted JSON), so
// normalizeHeroVariant fails closed to "centered": an unknown/garbage value
// keeps the default centered hero for every existing tenant instead of
// silently dropping into an unstyled layout.
//
// "wordmark" is the newest variant — a large, thin, wide-tracked GOLD-GRADIENT
// rendering of the brand name on a clean background (reference: tenant
// luminara's gold logo). The wordmark IS the logo, so that variant skips the
// hero logo card / chip and paints the name itself.

import type { Brand } from "@/storefront/types";

export type HeroVariant = Brand["heroVariant"];

/**
 * Every selectable hero layout, in display order. Single source of truth: the
 * Store Admin tweaks picker (BrandTweaksForm) imports this list, and
 * normalizeHeroVariant validates against it.
 */
export const HERO_VARIANTS: readonly HeroVariant[] = [
  "centered",
  "split",
  "editorial",
  "card",
  "minimal",
  "spotlight",
  "wordmark",
];

const VARIANT_SET = new Set<string>(HERO_VARIANTS);

/** Untrusted branding.config value → a valid hero variant, else "centered". */
export function normalizeHeroVariant(value: unknown): HeroVariant {
  return typeof value === "string" && VARIANT_SET.has(value)
    ? (value as HeroVariant)
    : "centered";
}

/** True when the (normalized) variant is the gold wordmark. */
export function isWordmarkVariant(value: unknown): boolean {
  return normalizeHeroVariant(value) === "wordmark";
}

/**
 * The text painted as the gold wordmark. An explicit heroLine1 wins (lets a
 * tenant lowercase / restyle the mark independently of the display name);
 * otherwise the brand name. Always trimmed.
 */
export function wordmarkText(brand: Partial<Pick<Brand, "heroLine1" | "name">>): string {
  return (brand.heroLine1 ?? "").trim() || (brand.name ?? "").trim();
}
