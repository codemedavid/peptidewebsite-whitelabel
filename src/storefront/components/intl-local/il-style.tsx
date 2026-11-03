// The Intl & Local theme → CSS. Two pieces:
//
//   • <IntlLocalStyle> paints the layout's --il-* tokens (palette, radius,
//     type scale, spacing, fonts) under `scope`, and loads the two chosen
//     Google fonts. Every value is sanitized by normalizeIntlLocalConfig
//     (colours are hex/rgb/hsl only, fonts come from the registry), so the
//     generated <style> can't be broken out of.
//   • bgProps() turns one SectionBackground into the `sbg` class + its
//     --sbg-* vars — the separate image/overlay layers that keep text opaque.

import type { CSSProperties } from "react";
import type { IlTheme } from "@/lib/storefront/intl-local/config";
import { backgroundVars, hasBackgroundImage, type SectionBackground } from "@/lib/storefront/section-background";
import { fontFamilyValue, googleFontsUrl } from "@/lib/theme/tokens";

const SCALE: Record<IlTheme["scale"], string> = { sm: "0.94", md: "1", lg: "1.07" };
const SPACING: Record<IlTheme["spacing"], string> = { compact: "28px", cozy: "44px", roomy: "68px" };

/** The --il-* declarations for a theme (exported for the test). */
export function themeDeclarations(t: IlTheme): string {
  const palette = t.useBrandColors
    ? {
        "--il-page": "var(--brand-background)",
        "--il-surface": "var(--brand-surface)",
        "--il-ink": "var(--brand-text)",
        "--il-muted": "var(--brand-text-muted)",
        "--il-accent": "var(--brand-main)",
        "--il-accent-text": "var(--brand-button-text)",
      }
    : {
        "--il-page": t.pageBg,
        "--il-surface": t.surface,
        "--il-ink": t.ink,
        "--il-muted": t.muted,
        "--il-accent": t.accent,
        "--il-accent-text": t.accentText,
      };
  const head = fontFamilyValue(t.headingFont) ?? "var(--brand-heading-font)";
  const body = fontFamilyValue(t.bodyFont) ?? "var(--brand-body-font)";
  const vars: Record<string, string> = {
    ...palette,
    "--il-radius": `${t.radius}px`,
    "--il-scale": SCALE[t.scale],
    "--il-gap": SPACING[t.spacing],
    "--il-head-weight": String(t.headingWeight),
    "--il-font-head": head,
    "--il-font-body": body,
  };
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export function IntlLocalStyle({ theme, scope }: { theme: IlTheme; scope: string }) {
  const fonts = [theme.headingFont, theme.bodyFont].filter(Boolean);
  return (
    <>
      {fonts.length > 0 && <link rel="stylesheet" href={googleFontsUrl(...fonts)} precedence="default" />}
      <style>{`${scope}{${themeDeclarations(theme)}}`}</style>
    </>
  );
}

/** className + style for an element painted by a SectionBackground. */
export function bgProps(
  bg: SectionBackground,
  className: string,
  textColor = "",
): { className: string; style: CSSProperties } {
  const style: Record<string, string> = { ...backgroundVars(bg) };
  if (textColor) style["--il-local-ink"] = textColor;
  const cls = `${className} sbg${hasBackgroundImage(bg) ? " sbg--image" : ""}${textColor ? " il-has-ink" : ""}`;
  return { className: cls, style: style as CSSProperties };
}
