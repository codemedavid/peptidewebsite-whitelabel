/**
 * Deterministic WCAG-AA gate for the theme registry.
 *
 *   npm run test:themes
 *
 * Asserts every preset's body-text pairs clear AA (4.5:1) and reports status-fill
 * pairs (3:1 floor for the bold/large badges they back). Fails the build on any
 * critical violation so a new or edited theme can't ship inaccessible.
 */
import { contrastRatio, hslTripleToHex } from "../src/lib/theme/color";
import { THEME_PRESETS, type ThemePreset, type ThemeTokens } from "../src/lib/theme/presets";

const AA = 4.5; // body text
const UI = 3.0; // large text / UI components / status fills

type Pair = { label: string; fg: keyof ThemeTokens; bg: keyof ThemeTokens; min: number; critical: boolean };

// Body-text pairs are critical (hard fail). Status fills back bold/large badges,
// so they use the 3:1 UI floor and only warn between 3.0 and 4.5.
const PAIRS: Pair[] = [
  { label: "text / background", fg: "foreground", bg: "background", min: AA, critical: true },
  { label: "muted-text / background", fg: "muted-foreground", bg: "background", min: AA, critical: true },
  { label: "card-text / card", fg: "card-foreground", bg: "card", min: AA, critical: true },
  { label: "secondary-text / secondary", fg: "secondary-foreground", bg: "secondary", min: AA, critical: true },
  { label: "primary-text / primary", fg: "primary-foreground", bg: "primary", min: AA, critical: true },
  { label: "accent-text / accent", fg: "accent-foreground", bg: "accent", min: AA, critical: true },
  { label: "accent (link) / background", fg: "accent", bg: "background", min: AA, critical: true },
  { label: "error-text / error", fg: "destructive-foreground", bg: "destructive", min: UI, critical: true },
  { label: "success-text / success", fg: "success-foreground", bg: "success", min: UI, critical: true },
  { label: "warning-text / warning", fg: "warning-foreground", bg: "warning", min: UI, critical: true },
  { label: "info-text / info", fg: "info-foreground", bg: "info", min: UI, critical: true },
];

function lightness(triple: string): number {
  const m = triple.match(/(\d+(?:\.\d+)?)%\s*$/);
  return m ? parseFloat(m[1]) : NaN;
}

let failures = 0;
let warnings = 0;
const lines: string[] = [];

for (const t of Object.values(THEME_PRESETS) as ThemePreset[]) {
  const issues: string[] = [];

  // Mode sanity: light themes have a light background and vice-versa.
  const bgL = lightness(t.colors.background);
  if (t.mode === "light" && bgL < 50) issues.push(`mode=light but background L=${bgL}%`);
  if (t.mode === "dark" && bgL > 50) issues.push(`mode=dark but background L=${bgL}%`);

  for (const p of PAIRS) {
    const ratio = contrastRatio(t.colors[p.fg], t.colors[p.bg]);
    if (ratio < p.min) {
      issues.push(
        `${p.label}: ${ratio.toFixed(2)}:1 < ${p.min} (${hslTripleToHex(t.colors[p.fg])} on ${hslTripleToHex(t.colors[p.bg])})`,
      );
      if (p.critical) failures++;
      else warnings++;
    } else if (p.min === UI && ratio < AA) {
      // Met the UI floor but not full AA — note it as a soft warning.
      warnings++;
      issues.push(`~ ${p.label}: ${ratio.toFixed(2)}:1 (AA-large only)`);
    }
  }

  // Border should be visible against the background, but subtle.
  const borderRatio = contrastRatio(t.colors.border, t.colors.background);
  if (borderRatio < 1.12) {
    warnings++;
    issues.push(`border barely visible: ${borderRatio.toFixed(2)}:1`);
  }

  const status = issues.length === 0 ? "✓" : issues.some((i) => !i.startsWith("~")) ? "✗" : "▲";
  lines.push(`${status} ${t.id.padEnd(20)} [${t.mode}/${t.category}]`);
  for (const i of issues) lines.push(`    ${i}`);
}

console.log(`\nWCAG-AA theme gate — ${Object.keys(THEME_PRESETS).length} presets\n`);
console.log(lines.join("\n"));
console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} critical violation(s), ${warnings} warning(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
