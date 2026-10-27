/**
 * Gate for the Paid Access join-fee payment accounts (PaymentMethod.paidAccess).
 * A store can reserve methods for the group-buy join fee: those show on the
 * join payment step only, never at checkout (website, app, QR PH fee lookup).
 * A store that tags none keeps showing its checkout methods on the join step.
 *
 *   npm run test:paid-access-methods
 */
import assert from "node:assert";
import { activePaymentMethods } from "../src/storefront/checkout";
import { paidAccessMethodsOf, readPaymentMethods } from "../src/lib/mobile/shop-checkout";
import type { PaymentMethod } from "../src/storefront/types";

const method = (id: string, extra: Partial<PaymentMethod> = {}): PaymentMethod => ({
  id, name: `Method ${id}`, account: "ACCT", number: "0917", qrImage: "", order: Number(id), active: true, ...extra,
});

const split = [method("1"), method("2", { paidAccess: true }), method("3"), method("4", { paidAccess: true, active: false })];
const untagged = [method("1"), method("2"), method("3", { active: false })];
const ids = (list: { id: string }[]) => list.map((m) => m.id);

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check("website checkout never offers a join-fee account", () => {
  assert.deepStrictEqual(ids(activePaymentMethods(split)), ["1", "3"]);
});

check("app checkout never offers a join-fee account", () => {
  assert.deepStrictEqual(ids(readPaymentMethods({ paymentMethods: split }, false)), ["1", "3"]);
});

check("join step shows only the active join-fee accounts when any are tagged", () => {
  assert.deepStrictEqual(ids(paidAccessMethodsOf({ paymentMethods: split })), ["2"]);
});

check("join step falls back to checkout methods when none are tagged", () => {
  assert.deepStrictEqual(ids(paidAccessMethodsOf({ paymentMethods: untagged })), ["1", "2"]);
});

check("an inactive join-fee tag does not hide the checkout fallback", () => {
  const onlyOff = [method("1"), method("2", { paidAccess: true, active: false })];
  assert.deepStrictEqual(ids(paidAccessMethodsOf({ paymentMethods: onlyOff })), ["1"]);
});

check("no saved methods → nothing on either surface", () => {
  assert.deepStrictEqual(paidAccessMethodsOf({}), []);
  assert.deepStrictEqual(readPaymentMethods({}, false), []);
});

console.log(`\n${passed} passed`);
