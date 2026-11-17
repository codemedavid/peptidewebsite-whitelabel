// Unit tests for features/tracker/lib/sites.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { siteA11yLabel, siteStates, suggestSite } from "../src/features/tracker/lib/sites";
import { dose, makeTest, oct } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker sites");

test("recent under 72 h, healing 3–6 days, rested 7+ or never", () => {
  const doses = [dose(oct(11), { site: "belly_ll" }), dose(oct(7), { site: "belly_lr" }), dose(oct(1), { site: "thigh_l" })];
  const s = siteStates(doses, oct(12, 9));
  assert.equal(s.belly_ll.state, "recent");
  assert.equal(s.belly_lr.state, "healing");
  assert.equal(s.thigh_l.state, "rested");
  assert.equal(s.arm_r.state, "rested");
});

test("suggests a never-used zone next in rotation, then the longest-rested", () => {
  assert.equal(suggestSite([], oct(12)), "belly_ll");
  assert.equal(suggestSite([dose(oct(11), { site: "belly_ll" })], oct(12)), "belly_lr");
  const all = ["belly_ll", "belly_lr", "belly_ul", "belly_ur", "thigh_l", "thigh_r", "glute_l", "glute_r", "arm_l", "arm_r"] as const;
  const doses = all.map((site, i) => dose(new Date(2026, 8, 1 + i), { site }));
  assert.equal(suggestSite(doses, oct(12)), "belly_ll");
});

test("screen-reader labels say state and last use", () => {
  const s = siteStates([dose(oct(1), { site: "belly_ll" })], oct(12));
  assert.equal(siteA11yLabel(s.belly_ll), "Left lower belly, rested, last used Oct 1");
});

done();
