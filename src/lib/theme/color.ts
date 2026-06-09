/**
 * Color math for the theme system — the single home for HEX ⇄ HSL conversion and
 * WCAG contrast. Lives in its own module so both `presets.ts` (the theme registry
 * + buildTheme factory) and `tokens.ts` (the tenant role layer) can use it without
 * an import cycle. `tokens.ts` re-exports these so existing import sites keep working.
 *
 * Our CSS custom properties speak HSL channel triples ("H S% L%") so they drop
 * straight into `hsl(var(--token))`; color pickers and theme seeds speak hex.
 */

/** "#rrggbb" (or "#rgb") → an "H S% L%" channel triple. */
export function hexToHslTriple(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const light = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%`;
}

/** An "H S% L%" channel triple → "#rrggbb". Returns black on a malformed triple. */
export function hslTripleToHex(triple: string): string {
  const m = triple.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return "#000000";
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** WCAG relative luminance (0–1) of an "H S% L%" triple. */
export function luminance(triple: string): number {
  const hex = hslTripleToHex(triple).replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio (1–21) between two "H S% L%" triples. */
export function contrastRatio(tripleA: string, tripleB: string): number {
  const a = luminance(tripleA);
  const b = luminance(tripleB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Foreground candidates the factory picks between for derived "on-color" text
// (status fills, etc.). Pure white and a near-black ink cover every brand hue.
const FG_LIGHT = "0 0% 100%";
const FG_DARK = "222 47% 11%";

/**
 * The more readable of white / near-black ink on a given fill — used to derive
 * foreground text for status colors and any fill the seed doesn't pin explicitly.
 * Returns the candidate with the higher WCAG contrast against `triple`.
 */
export function bestForeground(triple: string): string {
  return contrastRatio(FG_LIGHT, triple) >= contrastRatio(FG_DARK, triple) ? FG_LIGHT : FG_DARK;
}
