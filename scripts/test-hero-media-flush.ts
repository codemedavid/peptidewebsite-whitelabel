// Gate for the IMAGE HERO being FLUSH — an uploaded banner must run edge to
// edge, with no band of page background above or below it, at EVERY viewport.
//
//   npm run test:hero-flush
//
// Why this exists: `.sf-root .hero--media { padding: 0 }` sits at ~line 1060 of
// storefront.css, but the small-screen polish block further down re-declares
// `.sf-root .hero { padding-block: clamp(40px, 12vw, 72px) }`. Both selectors
// carry the SAME specificity (0,2,0), so on a phone the later one wins and the
// image hero grew a ~63px cream band above and below it — the header, the
// banner and the next section stopped meeting cleanly.
//
// A comment saying "padding is dropped entirely" is not a guarantee; the
// cascade is. So this test resolves the padding the way a browser would —
// specificity first, then source order, honouring @media width conditions —
// and asserts the answer, instead of grepping for a rule that may be overridden
// three hundred lines later.
//
// Pure: reads storefront.css as text. No DB, no React, no browser.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const CSS_PATH = join(ROOT, "src/storefront/storefront.css");

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

// ─────────────────────────── a very small CSS engine ────────────────────────
// Enough of one to answer a single question: for an element with these classes,
// at this viewport width, what padding does the stylesheet finally apply?

type Rule = {
  selector: string;
  body: string;
  /** Conditions of every enclosing @media, or null for top level. */
  media: string | null;
  /** Source order — the cascade's final tie-breaker. */
  order: number;
};

/** Strip comments so a selector never hides inside one. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;

  const walk = (text: string, media: string | null): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) break;
      const prelude = text.slice(i, open).trim();

      let depth = 1;
      let k = open + 1;
      while (k < text.length && depth > 0) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}") depth--;
        k++;
      }
      const body = text.slice(open + 1, k - 1);

      if (prelude.startsWith("@media")) {
        const cond = prelude.slice("@media".length).trim();
        walk(body, media ? `${media} and ${cond}` : cond);
      } else if (!prelude.startsWith("@")) {
        rules.push({ selector: prelude, body, media, order: order++ });
      }
      // Other at-rules (@keyframes, @supports, @font-face) cannot pad the hero,
      // so they are skipped rather than mis-parsed.

      i = k;
    }
  };

  walk(css, null);
  return rules;
}

/**
 * Does this @media condition hold at `width`? Conditions we cannot evaluate
 * (prefers-reduced-motion, hover, …) are treated as NOT applying — this test
 * only reasons about the width axis.
 */
function mediaApplies(media: string | null, width: number): boolean {
  if (!media) return true;
  const features = [...media.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)/g)];
  if (features.length === 0) return false;
  for (const [, feature, raw] of features) {
    const px = Number.parseFloat(raw);
    if (feature === "max-width") {
      if (!(width <= px)) return false;
    } else if (feature === "min-width") {
      if (!(width >= px)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** (ids, classes+attrs+pseudo-classes, elements) — :not() contributes its inner. */
function specificity(selector: string): [number, number, number] {
  const flat = selector.replace(/:not\(|:is\(|:where\(|\)/g, " ");
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (flat.match(/\.[\w-]+/g) ?? []).length +
    (flat.match(/\[[^\]]+\]/g) ?? []).length +
    (flat.match(/:[a-z-]+(?![\w(])/g) ?? []).length;
  const elements = (flat.match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
  return [ids, classes, elements];
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

type Element = { classes: readonly string[]; attrs?: Readonly<Record<string, string>> };

/**
 * Does the SUBJECT compound (the rightmost part) of this selector match the
 * element? Ancestor parts are assumed satisfied — every storefront rule is
 * scoped under `.sf-root`, and the hero always lives there. That assumption is
 * safe in the conservative direction: it can only make MORE rules count.
 */
function subjectMatches(selector: string, el: Element): boolean {
  const subject = selector.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
  if (!subject) return false;

  // A pseudo-element rule (::before/::after) paints a box of its own; it never
  // pads the element itself.
  if (subject.includes("::")) return false;

  const own = new Set(el.classes);

  for (const [, inner] of subject.matchAll(/:not\(([^)]*)\)/g)) {
    for (const [, cls] of inner.matchAll(/\.([\w-]+)/g)) {
      if (own.has(cls)) return false;
    }
  }
  const positive = subject.replace(/:not\([^)]*\)/g, "");

  for (const [, cls] of positive.matchAll(/\.([\w-]+)/g)) {
    if (!own.has(cls)) return false;
  }
  for (const [, name, value] of positive.matchAll(/\[\s*([\w-]+)\s*=\s*"?([^"\]]+)"?\s*\]/g)) {
    if ((el.attrs ?? {})[name] !== value) return false;
  }
  // A bare pseudo-class state (:hover, :focus-visible) is not the resting state.
  if (/:(?!not\()[a-z-]/.test(positive)) return false;

  return /\.[\w-]+/.test(positive);
}

type Declaration = { prop: string; value: string; important: boolean };

function parseDeclarations(body: string): Declaration[] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .flatMap((d) => {
      const colon = d.indexOf(":");
      if (colon === -1) return [];
      const prop = d.slice(0, colon).trim().toLowerCase();
      let value = d.slice(colon + 1).trim();
      const important = /!important$/i.test(value);
      if (important) value = value.replace(/!important$/i, "").trim();
      return [{ prop, value, important }];
    });
}

/** Split a shorthand value into top-level parts (parenthesised groups intact). */
function shorthandParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** A declaration → its effect on block-start / block-end padding, if any. */
function blockPadding(decl: Declaration): { top?: string; bottom?: string } | null {
  const { prop, value } = decl;
  if (prop === "padding") {
    const p = shorthandParts(value);
    return { top: p[0], bottom: p[2] ?? p[0] };
  }
  if (prop === "padding-block") {
    const p = shorthandParts(value);
    return { top: p[0], bottom: p[1] ?? p[0] };
  }
  if (prop === "padding-top" || prop === "padding-block-start") return { top: value };
  if (prop === "padding-bottom" || prop === "padding-block-end") return { bottom: value };
  return null;
}

/** The winning padding-top / padding-bottom for an element at a viewport width. */
function resolveBlockPadding(
  rules: readonly Rule[],
  el: Element,
  width: number,
): { top: string; bottom: string } {
  const applicable = rules
    .filter((r) => mediaApplies(r.media, width))
    .flatMap((r) =>
      r.selector
        .split(",")
        .map((s) => s.trim())
        .filter((s) => subjectMatches(s, el))
        .map((s) => ({ rule: r, spec: specificity(s) })),
    )
    .sort((a, b) => compareSpecificity(a.spec, b.spec) || a.rule.order - b.rule.order);

  let top = "0";
  let bottom = "0";
  let topImportant = false;
  let bottomImportant = false;

  for (const { rule } of applicable) {
    for (const decl of parseDeclarations(rule.body)) {
      const effect = blockPadding(decl);
      if (!effect) continue;
      if (effect.top !== undefined && (decl.important || !topImportant)) {
        top = effect.top;
        topImportant = topImportant || decl.important;
      }
      if (effect.bottom !== undefined && (decl.important || !bottomImportant)) {
        bottom = effect.bottom;
        bottomImportant = bottomImportant || decl.important;
      }
    }
  }

  return { top, bottom };
}

function isZero(value: string): boolean {
  return /^0([a-z%]*)$/i.test(value.trim());
}

// ─────────────────────────── the guarantees ─────────────────────────────────

const rules = parseRules(stripComments(readFileSync(CSS_PATH, "utf8")));

// The two heroes exactly as <Hero> renders them (src/storefront/components/Hero.tsx).
const IMAGE_HERO: Element = { classes: ["hero", "hero--media"], attrs: { "data-variant": "media" } };
const WRITTEN_HERO: Element = { classes: ["hero"], attrs: { "data-variant": "centered" } };

// 320 = the narrowest supported phone, 375/414/560 = common phones, 600 = the
// breakpoint edge itself, 768+ = tablet and desktop. The bug only ever showed
// below 600px, which is precisely why nobody caught it on a laptop.
const WIDTHS = [320, 375, 414, 560, 600, 768, 1024, 1440];

console.log("engine self-check (the resolver must be trustworthy before its verdicts are)");

check("a later same-specificity rule wins over an earlier one", () => {
  const toy = parseRules(".a .b { padding: 10px } .a .c { padding: 4px }");
  assert.equal(resolveBlockPadding(toy, { classes: ["b", "c"] }, 1000).top, "4px");
});

check("higher specificity beats source order", () => {
  const toy = parseRules(".a .b.c { padding: 10px } .a .c { padding: 4px }");
  assert.equal(resolveBlockPadding(toy, { classes: ["b", "c"] }, 1000).top, "10px");
});

check(":not() excludes the element it names", () => {
  const toy = parseRules(".a .b:not(.c) { padding: 10px }");
  assert.equal(resolveBlockPadding(toy, { classes: ["b", "c"] }, 1000).top, "0");
  assert.equal(resolveBlockPadding(toy, { classes: ["b"] }, 1000).top, "10px");
});

check("a max-width rule applies only below its breakpoint", () => {
  const toy = parseRules("@media (max-width: 600px) { .a .b { padding: 9px } }");
  assert.equal(resolveBlockPadding(toy, { classes: ["b"] }, 375).top, "9px");
  assert.equal(resolveBlockPadding(toy, { classes: ["b"] }, 1024).top, "0");
});

check("padding-block sets both sides; a second value sets the end alone", () => {
  const toy = parseRules(".a .b { padding-block: 5px 7px }");
  const r = resolveBlockPadding(toy, { classes: ["b"] }, 1000);
  assert.equal(r.top, "5px");
  assert.equal(r.bottom, "7px");
});

console.log("image hero is flush at every viewport");

for (const width of WIDTHS) {
  check(`no band above or below the banner at ${width}px`, () => {
    const { top, bottom } = resolveBlockPadding(rules, IMAGE_HERO, width);
    assert.ok(
      isZero(top),
      `padding-top resolves to "${top}" at ${width}px — the banner must sit flush under the header`,
    );
    assert.ok(
      isZero(bottom),
      `padding-bottom resolves to "${bottom}" at ${width}px — the section below must meet the banner`,
    );
  });
}

console.log("the WRITTEN hero keeps its breathing room (the fix must not overreach)");

for (const width of WIDTHS) {
  check(`text hero still padded at ${width}px`, () => {
    const { top, bottom } = resolveBlockPadding(rules, WRITTEN_HERO, width);
    assert.ok(!isZero(top), `written hero lost its top padding at ${width}px`);
    assert.ok(!isZero(bottom), `written hero lost its bottom padding at ${width}px`);
  });
}

console.log("the banner box itself adds no inset");

check("hero__media has no padding of its own", () => {
  const { top, bottom } = resolveBlockPadding(rules, { classes: ["hero__media"] }, 375);
  assert.ok(isZero(top) && isZero(bottom), `hero__media padded ${top}/${bottom}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
