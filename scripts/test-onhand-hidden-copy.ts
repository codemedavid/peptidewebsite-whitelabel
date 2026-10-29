// Self-contained test gate: a store with the on-hand way HIDDEN (group-buy
// only, e.g. mnm-pepsabuy) never tells a shopper about on-hand items — not in
// the cart/checkout refusals, not in the "How group buys work" steps. A store
// that sells on hand keeps today's wording, word for word. Pure — no DB.
//
//   npm run test:onhand-hidden-copy

import {
  HIDDEN_WAY_MESSAGES,
  WAY_BLOCK_MESSAGES,
  isOnHandHidden,
  type TwoWaysMode,
} from "../src/lib/storefront/two-ways-mode";
import {
  ONE_WAY_MIX_MESSAGES,
  TWO_WAYS_MIX_MESSAGES,
  twoWaysAddViolation,
  twoWaysOrderViolation,
} from "../src/lib/storefront/two-ways-cart";
import { decideWayBlock } from "../src/lib/storefront/on-hand-gate";
import { GB_CONTENT_DEFAULTS, GB_ONLY_FIRST_STEP, gbStepsForWays } from "../src/lib/storefront/gb-content";
import type { GroupBuyStorefrontGate } from "../src/lib/storefront/group-buy";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const mentionsOnHand = (s: string | null) => s !== null && /on[- ]?hand|ships? now/i.test(s);

const GB_ONLY: TwoWaysMode = { onHand: "hidden", groupBuy: "open" };
const BOTH: TwoWaysMode = { onHand: "open", groupBuy: "open" };
const PAUSED: TwoWaysMode = { onHand: "closed", groupBuy: "open" };
const scope = { coversAll: false, productIds: ["gb1"] };

console.log("isOnHandHidden");
ok("hidden → true", isOnHandHidden(GB_ONLY));
ok("open → false", !isOnHandHidden(BOTH));
ok("closed (shown, paused) → false", !isOnHandHidden(PAUSED));
ok("junk config → false (both ways open)", !isOnHandHidden({ onHand: "nope" }));
ok("absent → false", !isOnHandHidden(undefined));

console.log("way block (cart add + server checkout)");
const gate: GroupBuyStorefrontGate = { active: true, allowOnHand: true, coversAll: false, productIds: ["gb1"] };
const staleOnHand = [{ productId: "old", name: "Old sample" }];
const hiddenBlock = decideWayBlock({ ways: GB_ONLY, gate, items: staleOnHand });
eq("hidden on-hand → neutral message", hiddenBlock, HIDDEN_WAY_MESSAGES.onHand);
ok("hidden on-hand message never says on-hand", !mentionsOnHand(hiddenBlock));
eq("closed on-hand keeps today's message", decideWayBlock({ ways: PAUSED, gate, items: staleOnHand }), WAY_BLOCK_MESSAGES.onHand);
eq("group-buy item on a GB-only store → allowed", decideWayBlock({ ways: GB_ONLY, gate, items: [{ productId: "gb1", name: "x" }] }), null);

console.log("mixing rule");
eq("add GB into stale cart, on-hand hidden → neutral", twoWaysAddViolation("gb1", ["old"], scope, true), ONE_WAY_MIX_MESSAGES.gbIntoOther);
eq("add stray into GB cart, on-hand hidden → neutral", twoWaysAddViolation("old", ["gb1"], scope, true), ONE_WAY_MIX_MESSAGES.otherIntoGb);
eq("add GB into on-hand cart, two ways → today's copy", twoWaysAddViolation("gb1", ["old"], scope), TWO_WAYS_MIX_MESSAGES.gbIntoOnHand);
eq("add on-hand into GB cart, two ways → today's copy", twoWaysAddViolation("old", ["gb1"], scope, false), TWO_WAYS_MIX_MESSAGES.onHandIntoGb);
eq("all-GB cart, on-hand hidden → allowed", twoWaysAddViolation("gb1", ["gb1"], scope, true), null);
eq("mixed order, on-hand hidden → neutral", twoWaysOrderViolation(["gb1", "old"], scope, true), ONE_WAY_MIX_MESSAGES.order);
ok("mixed order, two ways → today's copy", mentionsOnHand(twoWaysOrderViolation(["gb1", "old"], scope)));
eq("all-GB order → allowed", twoWaysOrderViolation(["gb1"], scope, true), null);
for (const [key, text] of Object.entries(ONE_WAY_MIX_MESSAGES)) {
  ok(`one-way mix message "${key}" never says on-hand`, !mentionsOnHand(text));
}
for (const [key, text] of Object.entries(HIDDEN_WAY_MESSAGES)) {
  ok(`hidden-way message "${key}" never says on-hand`, !mentionsOnHand(text));
}

console.log("how-it-works steps");
const defaults = [...GB_CONTENT_DEFAULTS.steps];
const gbOnlySteps = gbStepsForWays(defaults, true);
ok("default steps on a GB-only store never say on-hand", gbOnlySteps.every((s) => !mentionsOnHand(s)), JSON.stringify(gbOnlySteps));
eq("the on-hand step becomes the group-buy step", gbOnlySteps[0], GB_ONLY_FIRST_STEP);
eq("the other steps are untouched", gbOnlySteps.slice(1), defaults.slice(1));
eq("two-ways store keeps the default steps", gbStepsForWays(defaults, false), defaults);
const owner = ["Message us first.", "Pay to lock your slot."];
eq("owner-written steps are never rewritten", gbStepsForWays(owner, true), owner);
ok("never mutates the input", defaults[0] === GB_CONTENT_DEFAULTS.steps[0]);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
