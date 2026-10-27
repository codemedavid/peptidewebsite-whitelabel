import type { Brand } from "@/storefront/types";
import { brandBorderVars } from "./brand-border";
import { priceFontVar } from "./price-font";
import { fontStack } from "@/lib/theme/tokens";

/**
 * The tenant's --brand-* custom properties, the one rule both paint paths read:
 * store.tsx applyBrandStyle (client, live admin edits) and BrandStyle (server
 * render). Before the server half existed the first paint used storefront.css's
 * :root defaults — K Glow pink — until hydration ran applyBrandStyle, so every
 * refresh flashed pink on every store.
 *
 * `null` = remove the property so the CSS var() fallback applies and a previous
 * tenant's value can't linger.
 */
export type BrandStyleVars = Record<string, string | null>;

export function brandStyleVars(b: Brand): BrandStyleVars {
  const borderVars = brandBorderVars(b);
  return {
    "--brand-main": b.main,
    "--brand-accent": b.accent,
    "--brand-button": b.button,
    "--brand-button-2": b.button2,
    "--brand-button-text": b.buttonText,
    "--brand-background": b.background,
    "--brand-surface": b.surface,
    "--brand-text": b.text,
    "--brand-header": b.headerBg || null,
    "--brand-header-text": b.headerText || null,
    "--brand-border": borderVars["--brand-border"] ?? null,
    "--brand-border-width": borderVars["--brand-border-width"] ?? null,
    "--brand-heading-font": fontStack(b.headingFont, "Georgia, serif"),
    "--brand-body-font": fontStack(b.bodyFont, "system-ui, sans-serif"),
    "--brand-button-font": b.buttonFont ? fontStack(b.buttonFont, "system-ui, sans-serif") : null,
    "--brand-price-font": priceFontVar(b),
  };
}

/** Characters that could end the declaration, the rule, or the <style> tag. */
const UNSAFE_VALUE = /[;{}<>\\]/;

/**
 * The same vars as one `:root{…}` rule for the server render. Brand values
 * come from owner-edited config, so any value that could break out of its
 * declaration is dropped (that property keeps the stylesheet default).
 */
export function brandStyleCss(b: Brand): string {
  const declarations = Object.entries(brandStyleVars(b))
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
    .filter(([, value]) => !UNSAFE_VALUE.test(value))
    .map(([name, value]) => `${name}:${value.trim()}`);
  return declarations.length ? `:root{${declarations.join(";")}}` : "";
}
