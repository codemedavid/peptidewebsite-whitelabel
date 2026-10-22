import { textColorsCss } from "@/lib/storefront/text-colors";

/**
 * Per-part text colour overrides (Brand.textColors) as one scoped <style>.
 * Renders nothing when no part is set. Values are hex-validated by
 * textColorsCss, so the config can't inject arbitrary CSS.
 */
export function TextColorsStyle({ textColors }: { textColors?: unknown }) {
  const css = textColorsCss(textColors);
  return css ? <style>{css}</style> : null;
}
