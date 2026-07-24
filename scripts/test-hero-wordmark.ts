// Gold wordmark hero variant — RED/GREEN gate (npm run test:hero-wordmark).
//
// Tenant `luminara` asked for its hero to become the brand logo: a large,
// thin, wide-tracked, GOLD-GRADIENT wordmark on a clean background (reference:
// the "luminara" gold logo). Rather than a one-off, this adds a reusable
// `wordmark` hero variant every tenant can opt into.
//
// The reusable core lives in src/lib/storefront/hero-style.ts:
//   - HERO_VARIANTS: the single source of truth for selectable hero layouts
//     (now including "wordmark"); the Store Admin tweaks picker imports it.
//   - normalizeHeroVariant: untrusted branding.config in → a valid variant,
//     failing closed to "centered" so an unknown/garbage value can never break
//     the storefront hero.
//   - wordmarkText: the text painted as the gold wordmark — an explicit
//     heroLine1 wins, else the brand name, trimmed.
//
// Journeys covered:
//  1. Unset / garbage heroVariant → "centered" (fail-closed, pre-feature look).
//  2. Every known variant — including "wordmark" — round-trips.
//  3. HERO_VARIANTS lists all 6 legacy variants + "wordmark", no duplicates.
//  4. wordmarkText: heroLine1 wins & trims; falls back to brand name; empty→"".
//  5. types.ts hero union carries "wordmark".
//  6. Hero.tsx renders a `hero__wordmark` element via the normalized variant.
//  7. storefront.css defines the wordmark variant with a gold gradient painted
//     onto the text (background-clip: text) — the wordmark's signature look.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HERO_VARIANTS,
  normalizeHeroVariant,
  wordmarkText,
} from "../src/lib/storefront/hero-style";
import type { Brand } from "../src/storefront/types";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

const readSrc = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

console.log("normalizeHeroVariant — untrusted config in, safe variant out");
{
  check("undefined → centered", normalizeHeroVariant(undefined) === "centered");
  check("null → centered", normalizeHeroVariant(null) === "centered");
  check("garbage → centered", normalizeHeroVariant("darkmode") === "centered");
  check("number → centered", normalizeHeroVariant(3) === "centered");
  for (const v of ["centered", "split", "editorial", "card", "minimal", "spotlight", "wordmark"]) {
    check(`'${v}' round-trips`, normalizeHeroVariant(v) === v, normalizeHeroVariant(v));
  }
}

console.log("HERO_VARIANTS — single source of truth includes wordmark");
{
  const expected = ["centered", "split", "editorial", "card", "minimal", "spotlight", "wordmark"];
  for (const v of expected) {
    check(`lists '${v}'`, HERO_VARIANTS.includes(v as Brand["heroVariant"]), [...HERO_VARIANTS]);
  }
  check("no duplicates", new Set(HERO_VARIANTS).size === HERO_VARIANTS.length, [...HERO_VARIANTS]);
}

console.log("wordmarkText — heroLine1 wins, falls back to brand name");
{
  check(
    "explicit heroLine1 used & trimmed",
    wordmarkText({ heroLine1: "  luminara  ", name: "Luminara Beauty" }) === "luminara",
    wordmarkText({ heroLine1: "  luminara  ", name: "Luminara Beauty" }),
  );
  check(
    "falls back to name when heroLine1 empty",
    wordmarkText({ heroLine1: "   ", name: "luminara" }) === "luminara",
    wordmarkText({ heroLine1: "   ", name: "luminara" }),
  );
  check(
    "falls back to name when heroLine1 missing",
    wordmarkText({ name: "luminara" }) === "luminara",
    wordmarkText({ name: "luminara" }),
  );
  check("both empty → ''", wordmarkText({ heroLine1: "", name: "" }) === "");
}

console.log("Wiring — types, Hero.tsx, storefront.css carry the wordmark variant");
{
  const types = readSrc("src/storefront/types.ts");
  check('types union includes "wordmark"', /heroVariant:[^;]*"wordmark"/.test(types), types.match(/heroVariant:[^;]*;/)?.[0]);

  const hero = readSrc("src/storefront/components/Hero.tsx");
  check("Hero.tsx normalizes the variant", /normalizeHeroVariant\(/.test(hero));
  check("Hero.tsx branches on wordmark", /variant === "wordmark"/.test(hero));
  check("Hero.tsx renders hero__wordmark", /hero__wordmark/.test(hero));

  const css = readSrc("src/storefront/storefront.css");
  check('CSS defines data-variant="wordmark"', /\.hero\[data-variant="wordmark"\]/.test(css));
  const wm = css.match(/\.sf-root \.hero__wordmark\s*\{[^}]*\}/)?.[0] ?? "";
  check("hero__wordmark paints gradient onto text", /background-clip:\s*text/.test(wm), wm);
  check("hero__wordmark has a linear-gradient fill", /linear-gradient/.test(wm), wm);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll hero-wordmark checks passed");
