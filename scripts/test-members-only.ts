/**
 * Gate for the members-only storefront rules (src/storefront/members-only.ts):
 * when a paid group buy has locked a visitor out, a catalog the lock emptied
 * speaks "members only · Get access" instead of "0 products · No matches".
 *
 *   npm run test:members-only
 */
import assert from "node:assert";
import { GET_ACCESS_LABEL, getAccessLabel, isMembersOnlyStore, lockedListingCount, membersOnlyCopy, membersOnlyRound } from "../src/storefront/members-only";
import type { Brand } from "../src/storefront/types";

type Teaser = NonNullable<Brand["groupBuyTeaser"]>;

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 6).join("\n    ")}`);
  }
}

const teaser = (over: Partial<Teaser> = {}): Teaser =>
  ({
    id: "gb1",
    name: "Batch 10",
    startsAt: "2026-11-09T04:00:00.000Z",
    endsAt: "2026-11-16T04:00:00.000Z",
    state: "upcoming",
    visibility: "summary",
    summary: { description: "", deliveryEta: "", productCount: 8, maxSlots: null, slotsTaken: 0 },
    steps: ["Pay ₱100", "Admin approval", "Access"],
    joinFeeCents: 10000,
    amountLabel: "₱100",
    membership: null,
    ...over,
  }) as Teaser;

console.log("\nWhen the store is members-only");

test("a locked visitor on an empty shelf is members-only", () => {
  assert.strictEqual(isMembersOnlyStore({ groupBuyTeaser: teaser() }, 0), true);
});
test("not when other products are still on the shelf (those get the slim notice)", () => {
  assert.strictEqual(isMembersOnlyStore({ groupBuyTeaser: teaser() }, 3), false);
  assert.ok(membersOnlyRound({ groupBuyTeaser: teaser() }), "the notice still knows the round");
});
test("not for a visitor who isn't locked out (no teaser), even on an empty shelf", () => {
  assert.strictEqual(isMembersOnlyStore({}, 0), false);
  assert.strictEqual(membersOnlyRound({}), null);
});
test("not when the owner hid the group-buy way (there is no join page to send them to)", () => {
  const brand = { groupBuyTeaser: teaser(), twoWaysMode: { onHand: "open", groupBuy: "hidden" } } as Pick<Brand, "groupBuyTeaser" | "twoWaysMode">;
  assert.strictEqual(isMembersOnlyStore(brand, 0), false);
});

console.log("\nWhat it says");

test("a newcomer: the round, how many products wait, and one Get access door", () => {
  const c = membersOnlyCopy(teaser());
  assert.strictEqual(c.title, "Batch 10");
  assert.strictEqual(c.cta, GET_ACCESS_LABEL);
  assert.match(c.body, /^8 products are waiting/);
  assert.match(c.eyebrow, /^Members only · Opens Nov/);
  assert.match(c.note, /no account needed/);
});
test("one product reads singular; a live round says so", () => {
  const c = membersOnlyCopy(teaser({ state: "live", summary: { description: "", deliveryEta: "", productCount: 1, maxSlots: null, slotsTaken: 0 } }));
  assert.match(c.body, /^1 product is waiting/);
  assert.strictEqual(c.eyebrow, "Members only · Live now");
});
test("a store that shows nothing to pending visitors never states a product count", () => {
  const t = teaser({ visibility: "nothing", summary: null });
  assert.strictEqual(lockedListingCount(t), null);
  assert.doesNotMatch(membersOnlyCopy(t).body, /\d/);
});
test("someone who already asked sees their own status, not Get access again", () => {
  const c = membersOnlyCopy(teaser({ membership: { status: "payment_review", reviewReason: "", headline: "Step 1 of 2: Checking your payment" } }));
  assert.strictEqual(c.body, "Step 1 of 2: Checking your payment");
  assert.strictEqual(c.cta, "See where you are");
});

console.log("\nThe store's own words");
test("blank copy keeps every built-in line", () => {
  const c = membersOnlyCopy(teaser({ copy: { intro: "  ", button: "", note: "" } }));
  assert.match(c.body, /^8 products are waiting/);
  assert.strictEqual(c.cta, GET_ACCESS_LABEL);
  assert.match(c.note, /no account needed/);
});
test("typed copy replaces the description, button and note", () => {
  const t = teaser({ copy: { intro: "Batch 10 ships Dec 1.", button: "Join the batch", note: "Questions? Message us." } });
  const c = membersOnlyCopy(t);
  assert.strictEqual(c.body, "Batch 10 ships Dec 1.");
  assert.strictEqual(c.cta, "Join the batch");
  assert.strictEqual(c.note, "Questions? Message us.");
  assert.strictEqual(getAccessLabel(t), "Join the batch");
});
test("a member's own status still wins over the store's description", () => {
  const c = membersOnlyCopy(teaser({ copy: { intro: "Batch 10 ships Dec 1.", button: "Join", note: "" }, membership: { status: "approval_pending", reviewReason: "", headline: "Waiting" } }));
  assert.strictEqual(c.body, "Waiting");
  assert.strictEqual(c.cta, "See where you are");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
