/**
 * Self-contained test for "admin fee once per group buy": a member pays the
 * store's admin fee on their FIRST order in a round, never on the orders they
 * add later in the same round (mnm-pepsabuy, 2026-10-28).
 *
 *   src/lib/storefront/admin-fee-once.ts
 *     hasPaidAdminFeeInRound(prior, buyer) — did this buyer already pay it?
 *   src/lib/storefront/admin-fee.ts
 *     normalizeAdminFee / mergeAdminFeeInput — the oncePerGroupBuy switch, and
 *     that an editor which doesn't show the switch can't turn it off on save.
 *
 * Runs the REAL modules (no DB, no Next runtime):
 *
 *   npm run test:admin-fee-once
 */

import assert from "node:assert";

import { hasPaidAdminFeeInRound, type PriorRoundOrder } from "../src/lib/storefront/admin-fee-once";
import { activeAdminFee, mergeAdminFeeInput, normalizeAdminFee } from "../src/lib/storefront/admin-fee";

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

const FEE = { label: "Admin fee", amount: 250 };
function order(over: Partial<PriorRoundOrder> & { email?: string; phone?: string }): PriorRoundOrder {
  return {
    status: over.status ?? "new",
    customerAccountId: over.customerAccountId ?? null,
    customer: over.customer ?? { name: "Ana", email: over.email ?? "", phone: over.phone ?? "" },
    adminFee: "adminFee" in over ? over.adminFee : FEE,
  };
}

console.log("\nAdmin fee once per group buy\n");

console.log("who counts as the same member");

check("first order in the round: nothing before it, fee charged", () => {
  assert.equal(hasPaidAdminFeeInRound([], { email: "ana@x.com", phone: "09171234567" }), false);
});

check("same email (any case, padded) waives the add-on's fee", () => {
  const prior = [order({ email: "Ana@X.com" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { email: "  ana@x.com " }), true);
});

check("same phone written 09…, +639… or 639… waives it", () => {
  const prior = [order({ phone: "0917 123 4567" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { phone: "+63 917-123-4567" }), true);
  assert.equal(hasPaidAdminFeeInRound(prior, { phone: "639171234567" }), true);
});

check("same signed-in account waives it, whatever contact was typed", () => {
  const prior = [order({ customerAccountId: "acc1", email: "old@x.com" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { accountId: "acc1", email: "new@y.com" }), true);
});

check("a different member is charged", () => {
  const prior = [order({ email: "ana@x.com", phone: "09171234567" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { email: "ben@x.com", phone: "09179999999" }), false);
});

check("blank or junk contact never matches a blank prior contact", () => {
  const prior = [order({ email: "", phone: "" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { email: "", phone: "" }), false);
  assert.equal(hasPaidAdminFeeInRound(prior, { email: "n/a", phone: "123" }), false);
});

console.log("\nwhich earlier orders count");

check("a cancelled first order does not waive the next one", () => {
  const prior = [order({ email: "ana@x.com", status: "cancelled" })];
  assert.equal(hasPaidAdminFeeInRound(prior, { email: "ana@x.com" }), false);
});

check("an earlier order that carried no fee does not waive it", () => {
  assert.equal(hasPaidAdminFeeInRound([order({ email: "ana@x.com", adminFee: null })], { email: "ana@x.com" }), false);
  assert.equal(
    hasPaidAdminFeeInRound([order({ email: "ana@x.com", adminFee: { label: "Admin fee", amount: 0 } })], { email: "ana@x.com" }),
    false,
  );
});

check("malformed stored rows never throw", () => {
  const prior = [{ status: "new", customer: null, adminFee: "250" }, { status: "new", customer: 5, adminFee: FEE }];
  assert.equal(hasPaidAdminFeeInRound(prior as PriorRoundOrder[], { email: "ana@x.com", phone: "09171234567" }), false);
});

console.log("\nthe oncePerGroupBuy switch");

check("absent or non-true reads as off (every existing store unchanged)", () => {
  assert.equal(normalizeAdminFee({ enabled: true, amount: 250 }).oncePerGroupBuy, false);
  assert.equal(normalizeAdminFee({ oncePerGroupBuy: "yes" }).oncePerGroupBuy, false);
  assert.equal(normalizeAdminFee({ oncePerGroupBuy: true }).oncePerGroupBuy, true);
});

check("the switch never changes the fee amount itself", () => {
  assert.deepEqual(activeAdminFee({ enabled: true, amount: 250, oncePerGroupBuy: true }, 1000), FEE);
});

check("a save that omits the switch keeps the stored value (platform + app editors)", () => {
  const stored = { enabled: true, label: "Admin fee", amount: 250, oncePerGroupBuy: true };
  assert.equal(mergeAdminFeeInput(stored, { enabled: true, label: "Admin fee", amount: 300 }).oncePerGroupBuy, true);
  assert.equal(mergeAdminFeeInput(stored, { enabled: true, amount: 300 }).amount, 300);
});

check("a save that sends the switch wins (store-admin editor)", () => {
  const stored = { enabled: true, amount: 250, oncePerGroupBuy: true };
  assert.equal(mergeAdminFeeInput(stored, { enabled: true, amount: 250, oncePerGroupBuy: false }).oncePerGroupBuy, false);
  assert.equal(mergeAdminFeeInput(undefined, { enabled: true, amount: 250, oncePerGroupBuy: true }).oncePerGroupBuy, true);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
