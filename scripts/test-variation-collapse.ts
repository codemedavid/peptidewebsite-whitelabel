/**
 * Self-contained test for the COLLAPSED variation picker on the storefront
 * product card + its full-detail quick-view modal.
 *
 * WHY (mstomato, 2026-08-28): the picker rendered EVERY option as a pill with no
 * cap. That tenant sells vial cases in colorways and carries 81 variations on 13
 * of its products ("Pastel Mint / Silk Barbie / Trans. Ocean / Roseberry / …"),
 * so a single card grew into a multi-screen wall of pills and the catalog grid
 * became unusable. The card now shows a short preview and hides the tail behind
 * a "+75 more" reveal.
 *
 * Two rules matter more than the truncation itself:
 *
 *   1. A short list is UNCHANGED. Every other tenant carries 2-4 variations, and
 *      a list at or under the preview count must render exactly as it does today
 *      — no reveal button, nothing collapsible. This is the non-regression gate.
 *
 *   2. The visible entries carry their ORIGINAL option index. The card calls
 *      setOptIdx(i) and reads detail.optionStock[i] with that number, so a naive
 *      `options.slice(0, 6).map((o, i) => …)` would renumber the tail and add the
 *      wrong colorway to the cart once the list is expanded. The split therefore
 *      returns {option, index} pairs, never a bare option array.
 *
 * Layers covered:
 *   1. The pure rule:  src/lib/storefront/variations.ts → splitOptionsForCard
 *   2. Structural guards on src/storefront/components/Catalog.tsx so the card
 *      AND the modal actually consume it rather than mapping the raw list.
 *
 *   npm run test:variation-collapse
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  VARIATION_PREVIEW_COUNT,
  buildProductOptions,
  splitOptionsForCard,
  type ProductOption,
} from "../src/lib/storefront/variations";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** N throwaway options, named so an index is readable in a failure message. */
const opts = (n: number): ProductOption[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Color ${i}`,
    price: 100 + i,
    variation: { name: `Color ${i}`, price: 100 + i },
  }));

const names = (split: ReturnType<typeof splitOptionsForCard>) =>
  split.visible.map((v) => v.option.name);
const indices = (split: ReturnType<typeof splitOptionsForCard>) =>
  split.visible.map((v) => v.index);

console.log("\nVariation collapse — preview a few pills, hide the tail\n");

// ─────────────────────────── the preview constant ───────────────────────────
console.log("VARIATION_PREVIEW_COUNT");

check("is a small positive number the card can actually fit", () => {
  assert.ok(Number.isInteger(VARIATION_PREVIEW_COUNT), "must be an integer");
  assert.ok(VARIATION_PREVIEW_COUNT >= 2, "must preview at least a couple options");
  assert.ok(VARIATION_PREVIEW_COUNT <= 12, "a 'preview' of >12 pills is not a preview");
});

// ───────────────────── short lists are untouched (regression) ────────────────
console.log("\nshort lists stay exactly as they are today");

check("2 options → all visible, nothing hidden, not collapsible", () => {
  const split = splitOptionsForCard(opts(2));
  assert.equal(split.visible.length, 2);
  assert.equal(split.hiddenCount, 0);
  assert.equal(split.collapsible, false, "a 2-option product must show no reveal button");
});

check("exactly VARIATION_PREVIEW_COUNT options → still not collapsible (boundary)", () => {
  const split = splitOptionsForCard(opts(VARIATION_PREVIEW_COUNT));
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.equal(split.hiddenCount, 0);
  assert.equal(split.collapsible, false);
});

check("one MORE than the preview count → collapsible, exactly one hidden (boundary)", () => {
  const split = splitOptionsForCard(opts(VARIATION_PREVIEW_COUNT + 1));
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.equal(split.hiddenCount, 1);
  assert.equal(split.collapsible, true);
});

check("an empty option list is inert (single-price product)", () => {
  const split = splitOptionsForCard([]);
  assert.deepEqual(split.visible, []);
  assert.equal(split.hiddenCount, 0);
  assert.equal(split.collapsible, false);
});

// ───────────────────────── the mstomato case: 81 colorways ───────────────────
console.log("\nmstomato — 81 colorways on one card");

check("collapsed → only the preview count is rendered, the rest counted", () => {
  const split = splitOptionsForCard(opts(81));
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.equal(split.hiddenCount, 81 - VARIATION_PREVIEW_COUNT);
  assert.equal(split.collapsible, true);
});

check("expanded → every option is rendered and nothing is left hidden", () => {
  const split = splitOptionsForCard(opts(81), { expanded: true });
  assert.equal(split.visible.length, 81);
  assert.equal(split.hiddenCount, 0);
  assert.equal(split.collapsible, true, "still collapsible — the toggle must offer 'show less'");
});

// ──────────────── the selected option can never hide behind the toggle ───────
console.log("\na picked option is never hidden");

check("a selection in the hidden tail is pulled into view", () => {
  const split = splitOptionsForCard(opts(81), { selectedIndex: 60 });
  assert.ok(
    indices(split).includes(60),
    `picked "Color 60" vanished behind the reveal — visible were ${names(split).join(", ")}`,
  );
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT + 1, "preview + the pick");
  assert.equal(split.hiddenCount, 81 - VARIATION_PREVIEW_COUNT - 1);
});

check("a selection already inside the preview is not duplicated", () => {
  const split = splitOptionsForCard(opts(81), { selectedIndex: 2 });
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.equal(
    new Set(indices(split)).size,
    VARIATION_PREVIEW_COUNT,
    "the picked option was rendered twice",
  );
  assert.equal(split.hiddenCount, 81 - VARIATION_PREVIEW_COUNT);
});

check("the card's initial 'nothing picked' state (-1) pulls nothing in", () => {
  const split = splitOptionsForCard(opts(81), { selectedIndex: -1 });
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.deepEqual(
    indices(split),
    Array.from({ length: VARIATION_PREVIEW_COUNT }, (_, i) => i),
  );
});

check("an out-of-range selection is ignored rather than crashing", () => {
  const split = splitOptionsForCard(opts(10), { selectedIndex: 999 });
  assert.equal(split.visible.length, VARIATION_PREVIEW_COUNT);
  assert.equal(split.hiddenCount, 10 - VARIATION_PREVIEW_COUNT);
});

// ─────────── original indices survive — the wrong-colorway-in-cart bug ───────
console.log("\nvisible entries keep their ORIGINAL index");

check("collapsed preview indices are 0..n, matching the option list", () => {
  const split = splitOptionsForCard(opts(81));
  assert.deepEqual(
    indices(split),
    Array.from({ length: VARIATION_PREVIEW_COUNT }, (_, i) => i),
  );
});

check("a pulled-in selection reports index 60, not its position in `visible`", () => {
  const split = splitOptionsForCard(opts(81), { selectedIndex: 60 });
  const last = split.visible[split.visible.length - 1];
  assert.equal(last.index, 60, "setOptIdx would have selected the wrong colorway");
  assert.equal(last.option.name, "Color 60");
});

check("every visible entry's index resolves back to the same option", () => {
  const all = opts(81);
  const split = splitOptionsForCard(all, { selectedIndex: 44 });
  for (const { option, index } of split.visible) {
    assert.equal(option.name, all[index].name, `index ${index} pointed at the wrong option`);
  }
});

check("indices line up with buildProductOptions on a real product (Standard offset)", () => {
  // A distinct base price means buildProductOptions prepends "Standard", so the
  // FIRST variation is option index 1. The split must not renumber that away.
  const product = {
    price: 500,
    variations: Array.from({ length: 20 }, (_, i) => ({ name: `Color ${i}`, price: 600 + i })),
  };
  const options = buildProductOptions(product);
  assert.equal(options[0].name, "Standard", "fixture no longer exercises the offset");
  const split = splitOptionsForCard(options, { selectedIndex: 15 });
  const picked = split.visible.find((v) => v.index === 15);
  assert.ok(picked, "the picked option was dropped");
  assert.equal(picked!.option.name, "Color 14", "off-by-one against buildProductOptions");
});

// ─────────────────── the card + modal actually consume the rule ──────────────
console.log("\nCatalog.tsx wiring");

const catalog = readFileSync(
  join(__dirname, "..", "src", "storefront", "components", "Catalog.tsx"),
  "utf8",
);

check("imports splitOptionsForCard from the shared variations module", () => {
  assert.match(catalog, /splitOptionsForCard/, "the helper is never imported");
});

check("BOTH the card and the modal render the collapsing picker", () => {
  // One shared <OptionPicker> rather than two copies of the split logic: the
  // card and the modal must never disagree about which option a pill selects.
  // So the guard counts RENDER sites, not calls to the helper.
  const uses = catalog.match(/<OptionPicker/g) ?? [];
  assert.ok(
    uses.length >= 2,
    `expected the card AND the modal to use the picker (found ${uses.length} render site(s))`,
  );
});

check("neither picker maps the raw, uncapped option list any more", () => {
  assert.doesNotMatch(
    catalog,
    /\boptions\.map\(\(o, i\)/,
    "the card still renders every option — an 81-colorway card stays a wall",
  );
  assert.doesNotMatch(
    catalog,
    /detail\.options\.map\(\(o, i\)/,
    "the modal still renders every option",
  );
});

check("the reveal button reports how many are hidden", () => {
  assert.match(
    catalog,
    /hiddenCount/,
    "nothing renders the hidden count — '+75 more' can't be shown",
  );
});

check("the reveal is a real toggle with expanded state", () => {
  assert.match(catalog, /aria-expanded/, "the reveal button is not announced to screen readers");
  assert.match(
    catalog,
    /setShowAllOpts|setExpandedOpts|showAllOptions/,
    "no expand/collapse state is held",
  );
});

// ─────────────────────────────── summary ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
