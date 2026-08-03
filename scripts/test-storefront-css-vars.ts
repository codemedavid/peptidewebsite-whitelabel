// Gate for STOREFRONT BRAND TOKENS — every --brand-* / --hairline a storefront
// component references must actually be defined, and no component may bake a
// literal tenant palette into a color-mix().
//
//   npm run test:storefront-css-vars
//
// Why this exists: the "two ways to order" home rendered K Glow pink on every
// tenant — a cream-and-red store included. It was not a theme leak. TwoWaysHome
// referenced `var(--brand-bg, #fdf1f6)` and `var(--hairline, #f6d9e7)`, and
// NEITHER variable is defined anywhere (the real tokens are --brand-background
// and --brand-border). A CSS var with no definition silently falls back to its
// literal, so the K Glow pink was not a fallback at all — it was the only value
// those rules ever produced, for every store.
//
// A typo'd token is invisible: nothing errors, nothing warns, the page just
// quietly wears another brand's colors. The same bug was in four files.
//
// Second rule: color-mix(... , #fff) is banned. Mixing a tenant's brand color
// into hardcoded white produces a pastel TINT of that color — Dragon's dark red
// at 12% over white is pink. Mix into var(--brand-surface) so the tint follows
// the tenant's own surface.
//
// Pure: reads source as text. No DB, no React, no network.

import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const CSS = join(ROOT, "src/storefront/storefront.css");

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

/** Every .tsx/.css file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Only COMPONENTS are in scope. storefront.css is the token system itself: it
// legitimately references optional tokens (--brand-primary, --brand-danger,
// --brand-on-accent …) behind deliberate fallbacks. A component must not.
const files = sourceFiles(join(ROOT, "src/storefront")).filter((f) => f.endsWith(".tsx"));
const cssText = readFileSync(CSS, "utf8");

/**
 * Tokens the app actually defines: declarations in storefront.css plus anything
 * set at runtime via style.setProperty("--brand-…") (applyBrandStyle writes
 * per-tenant overrides such as --brand-border and --brand-price-font).
 */
const defined = new Set<string>();
for (const m of cssText.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
for (const file of sourceFiles(join(ROOT, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/setProperty\(\s*["'`](--[a-z0-9-]+)["'`]/gi)) defined.add(m[1]);
}

console.log("\n1. Every referenced brand token is defined");

check("no storefront component references an undefined --brand-* / --hairline token", () => {
  const bad: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/var\(\s*(--(?:brand|hairline)[a-z0-9-]*)/gi)) {
      const token = m[1];
      if (!defined.has(token)) bad.push(`${file.replace(ROOT + "/", "")}: ${token}`);
    }
  }
  assert.deepEqual(
    [...new Set(bad)],
    [],
    `undefined token(s) — the literal fallback becomes the only value, on every tenant:\n    ` +
      [...new Set(bad)].join("\n    "),
  );
});

check("the tokens the two-ways home needs really exist", () => {
  for (const token of [
    "--brand-main",
    "--brand-background",
    "--brand-surface",
    "--brand-text",
    "--brand-text-muted",
    "--brand-border",
    "--brand-button-text",
  ]) {
    assert.ok(defined.has(token), `${token} is not defined in storefront.css`);
  }
});

console.log("\n2. No tenant palette baked into a color-mix");

check("no color-mix blends a brand color into hardcoded white", () => {
  const bad: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/color-mix\([^;\n]*/gi)) {
      const expr = m[0];
      if (!/var\(\s*--brand/i.test(expr)) continue;
      // A literal inside var(--token, #fff) is a FALLBACK, not a mix operand —
      // strip those before looking for a hardcoded white to blend into.
      const operands = expr.replace(/var\([^()]*\)/gi, "TOKEN");
      // Mixing into a literal white tints the tenant's own hue — Dragon's dark
      // red at 12% over #fff is pink. Mix into a token instead.
      if (/(?:,|\()\s*#(?:fff|ffffff)\b/i.test(operands)) {
        bad.push(`${file.replace(ROOT + "/", "")}: ${expr.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(bad)],
    [],
    `color-mix into #fff — use var(--brand-surface) so the tint follows the tenant:\n    ` +
      [...new Set(bad)].join("\n    "),
  );
});

console.log("\n3. No foreign tenant palette in shared components");

check("the two-ways home carries no K Glow pink literal", () => {
  // The literals that shipped as "fallbacks" on the undefined tokens. A shared
  // component must not name another tenant's palette at all.
  const KGLOW_PINKS = ["#fdf1f6", "#f6d9e7", "#c81e6e", "#b08a9b"];
  const twoWays = join(ROOT, "src/storefront/components/TwoWaysHome.tsx");
  const text = readFileSync(twoWays, "utf8").toLowerCase();
  const found = KGLOW_PINKS.filter((hex) => text.includes(hex));
  assert.deepEqual(found, [], `K Glow palette hardcoded in TwoWaysHome: ${found.join(", ")}`);
});


console.log("\n4. Tokens no tenant overrides must derive, not hardcode");

check("shared surface/border tokens derive from the tenant's palette", () => {
  // applyBrandStyle (store.tsx) only setProperty's a handful of tokens —
  // --brand-main/-accent/-background/-surface/-text/-button*. Anything else
  // declared in :root with a LITERAL keeps that literal on every tenant, exactly
  // like an undefined var. --brand-surface-2 (#FFEEF3) and --brand-border
  // (#F5D9E3) were K Glow pinks, so a cream-and-red store drew pink pills and
  // pink hairlines. They must be expressed in terms of tokens that ARE per-tenant.
  for (const token of ["--brand-surface-2", "--brand-border"]) {
    const m = new RegExp(token + "\\s*:\\s*([^;]+);").exec(cssText);
    assert.ok(m, `${token} is not declared in :root`);
    assert.ok(
      /var\(\s*--brand-/.test(m![1]),
      `${token} hardcodes "${m![1].trim()}" — no tenant overrides it, so that literal ` +
        `is the value on EVERY store. Derive it with color-mix from --brand-main/--brand-surface.`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
