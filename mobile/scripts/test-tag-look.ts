// Member tag colours (mobile/src/features/community/lib/tagLook.ts).
// Run from the repo root:  npx tsx mobile/scripts/test-tag-look.ts
import assert from "node:assert/strict";
import type { CommunityTagDesign } from "../../src/lib/mobile/contract";
import { COMMUNITY_TAG_ICONS, DEFAULT_COMMUNITY_TAGS } from "../../src/lib/mobile/contract";
import { DEFAULT_TAGS, TAG_ICONS, TAG_SWATCHES, changedTags, contrast, hexFromInput, isSwatch, rolesOf, tagLook, tagProblem } from "../src/features/community/lib/tagLook";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const VIOLET = "#7C3AED";
const base: CommunityTagDesign = { label: "Admin", icon: "star", color: null, style: "soft", shape: "pill" };
const solidOn = (bg: string) => (bg === "transparent" ? "#FFFFFF" : bg);

test("the app's defaults match the server's", () => {
  assert.deepEqual(DEFAULT_TAGS, DEFAULT_COMMUNITY_TAGS);
});
test("the icon list matches the server's allowlist", () => {
  assert.deepEqual([...TAG_ICONS], [...COMMUNITY_TAG_ICONS]);
});
test("every swatch, in every style, keeps tag text at 4.5:1 on a light row", () => {
  for (const s of TAG_SWATCHES) {
    for (const style of ["soft", "solid", "outline"] as const) {
      const look = tagLook({ ...base, color: s.value, style }, VIOLET);
      const ratio = contrast(look.fg, solidOn(look.bg));
      assert.ok(ratio >= 4.5, `${s.name} ${style}: ${ratio.toFixed(2)}`);
    }
  }
});
test("every swatch, in every style, stays readable on the coloured profile band", () => {
  for (const s of TAG_SWATCHES) {
    for (const style of ["soft", "solid", "outline"] as const) {
      const look = tagLook({ ...base, color: s.value, style }, VIOLET, "brand");
      const behind = look.bg.startsWith("rgba") ? VIOLET : look.bg;
      const ratio = contrast(look.fg, behind);
      assert.ok(ratio >= 4.5, `${s.name} ${style} on band: ${ratio.toFixed(2)}`);
    }
  }
});
test("a pale custom colour is darkened for text instead of vanishing", () => {
  const look = tagLook({ ...base, color: "#FDE68A", style: "soft" }, VIOLET);
  assert.ok(contrast(look.fg, look.bg) >= 4.5);
  const solid = tagLook({ ...base, color: "#FDE68A", style: "solid" }, VIOLET);
  assert.equal(solid.fg, "#0F1115", "dark text on a pale fill");
});
test("a solid tag in the band's own colour flips to a white chip", () => {
  const look = tagLook({ ...base, color: null, style: "solid" }, VIOLET, "brand");
  assert.equal(look.bg, "#FFFFFF");
});
test("a solid tag in another colour keeps its fill on the band, even at a similar brightness", () => {
  const look = tagLook({ ...base, color: "#047857", style: "solid" }, VIOLET, "brand");
  assert.equal(look.bg, "#047857");
  assert.ok(look.borderWidth > 0, "edged so it lifts off the band");
});
test("shape sets the bubble radius", () => {
  assert.equal(tagLook({ ...base, shape: "pill" }, VIOLET).radius, 999);
  assert.ok(tagLook({ ...base, shape: "rounded" }, VIOLET).radius > tagLook({ ...base, shape: "square" }, VIOLET).radius);
});
test("rolesOf lists admin before reseller, only what the person holds", () => {
  assert.deepEqual(rolesOf({ isAdmin: true, isVerifiedReseller: true }), ["admin", "reseller"]);
  assert.deepEqual(rolesOf({ isVerifiedReseller: true }), ["reseller"]);
  assert.deepEqual(rolesOf({}), []);
});

test("hex typing is forgiving but only a full colour counts", () => {
  assert.equal(hexFromInput(" 7c3aed "), "#7C3AED");
  assert.equal(hexFromInput("#7C3AED"), "#7C3AED");
  assert.equal(hexFromInput("#7C3AE"), null);
  assert.equal(hexFromInput("purple"), null);
});
test("a blank or too-long name is the only thing that blocks a save", () => {
  assert.equal(tagProblem(base), null);
  assert.ok(/name/.test(tagProblem({ ...base, label: "   " }) ?? ""));
  assert.ok(/20/.test(tagProblem({ ...base, label: "x".repeat(21) }) ?? ""));
});
test("only edited tags are sent, with trimmed names", () => {
  assert.deepEqual(changedTags(DEFAULT_TAGS, DEFAULT_TAGS), {});
  assert.deepEqual(changedTags({ ...DEFAULT_TAGS, admin: { ...DEFAULT_TAGS.admin, label: "Admin " } }, DEFAULT_TAGS), {}, "a trailing space is not a change");
  const draft = { ...DEFAULT_TAGS, reseller: { ...DEFAULT_TAGS.reseller, label: " VR ", style: "solid" as const } };
  assert.deepEqual(changedTags(draft, DEFAULT_TAGS), { reseller: { ...draft.reseller, label: "VR" } });
});
test("custom colours are told apart from swatches", () => {
  assert.equal(isSwatch(null), true);
  assert.equal(isSwatch("#7C3AED"), true);
  assert.equal(isSwatch("#123456"), false);
});

console.log(`\ntag look: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
