/**
 * Bunuan — the kit-fill phase, pure rules (src/modules/bunuan/core).
 *
 *   npm run test:bunuan-core
 *
 * After Open, only variations with an unfinished kit stay buyable, capped at
 * EXACTLY the vials that kit still needs (143 @ 10 → 7). An exact multiple, a
 * variation with no orders and one with no kit size are all closed. The race
 * test replays two buyers through the same live recount the server does.
 */
import assert from "node:assert";

import {
  allKitsFilled,
  bunuanAllowance,
  bunuanEditWarnings,
  bunuanOpenItems,
  bunuanStartBlockers,
  clampToBunuan,
} from "../src/modules/bunuan/core";
import { kitKey, tallyKits, type KitOrder, type KitProduct } from "../src/lib/storefront/gb-kits";

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

const tirz: KitProduct = { id: "tirz", vialsPerKit: 10, variations: [{ name: "15mg" }, { name: "30mg", kitSize: 5 }] };
const bac: KitProduct = { id: "bac" };
const products = [tirz, bac];
const k15 = kitKey({ name: "", productId: "tirz", variation: "15mg" });
const k30 = kitKey({ name: "", productId: "tirz", variation: "30mg" });

const line = (variation: string, qty: number) => ({ name: `Tirz — ${variation}`, qty, productId: "tirz", variation });
let seq = 0;
function order(items: unknown, extra: Partial<KitOrder> = {}): KitOrder {
  seq++;
  return { id: `o${seq}`, orderNumber: `MNM-${1000 + seq}`, placedAt: `2026-10-0${(seq % 9) + 1}T00:00:00Z`, status: "new", items, ...extra };
}

// 143 vials of 15mg (7 needed) and 10 of 30mg @5 (exact, closed), 2 bac (no kit).
const round = [
  order([line("15mg", 100)]),
  order([line("15mg", 43), line("30mg", 10)]),
  order([{ name: "Bac", qty: 2, productId: "bac" }]),
];
const tally = tallyKits(round, products, "pay_later");

console.log("\nbunuanOpenItems / bunuanAllowance\n");

check("only kits with vials needed are open — 143 @ 10 opens exactly 7", () => {
  const open = bunuanOpenItems(tally);
  assert.deepEqual(open.map((e) => [e.key, e.vialsNeeded]), [[k15, 7]]);
});
check("an exact multiple is closed", () => {
  assert.equal(bunuanAllowance(tally, k30), 0);
});
check("a variation nobody ordered is closed (Bunuan never starts a new kit)", () => {
  assert.equal(bunuanAllowance(tally, kitKey({ name: "", productId: "tirz" })), 0);
});
check("a product with no kit size is closed", () => {
  assert.equal(bunuanAllowance(tally, kitKey({ name: "", productId: "bac" })), 0);
});
check("allowance reads the open count", () => {
  assert.equal(bunuanAllowance(tally, k15), 7);
});

console.log("\nclampToBunuan — the checkout cap\n");

check("within the allowance → accepted as is", () => {
  const r = clampToBunuan([line("15mg", 7)], tally);
  assert.deepEqual(r.accepted.map((l) => l.qty), [7]);
  assert.equal(r.rejected.length, 0);
});
check("the 8th vial is rejected when 7 are open", () => {
  const r = clampToBunuan([line("15mg", 8)], tally);
  assert.deepEqual(r.accepted.map((l) => l.qty), [7], "trimmed to the allowance");
  assert.equal(r.rejected.length, 1);
  assert.deepEqual([r.rejected[0].asked, r.rejected[0].allowed, r.rejected[0].reason], [8, 7, "over_limit"]);
  assert.ok(r.rejected[0].message.includes("7"), r.rejected[0].message);
});
check("two lines of the same kit share one allowance, first come first served", () => {
  const r = clampToBunuan([line("15mg", 5), line("15mg", 5)], tally);
  assert.deepEqual(r.accepted.map((l) => l.qty), [5, 2]);
  assert.deepEqual([r.rejected[0].asked, r.rejected[0].allowed], [5, 2]);
});
check("a closed kit is rejected outright with a clear reason", () => {
  const r = clampToBunuan([line("30mg", 1)], tally);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].reason, "not_open");
  assert.ok(r.rejected[0].message.includes("Tirz — 30mg"), r.rejected[0].message);
});
check("zero-qty lines are ignored, not rejected", () => {
  const r = clampToBunuan([line("15mg", 0)], tally);
  assert.deepEqual([r.accepted.length, r.rejected.length], [0, 0]);
});
check("does not mutate the cart lines", () => {
  const cart = Object.freeze([Object.freeze(line("15mg", 9))]);
  clampToBunuan(cart, tally);
  assert.equal(cart[0].qty, 9);
});

console.log("\nrace — two buyers for the last vials\n");

check("each buyer is checked against a LIVE recount, so exactly 7 sell", () => {
  const orders = [...round];
  const placeIfAllowed = (qty: number) => {
    const live = tallyKits(orders, products, "pay_later");
    const r = clampToBunuan([line("15mg", qty)], live);
    if (r.rejected.length > 0) return false;
    orders.push(order([line("15mg", qty)]));
    return true;
  };
  assert.equal(placeIfAllowed(7), true, "first buyer takes the 7");
  assert.equal(placeIfAllowed(7), false, "second buyer is refused");
  assert.equal(placeIfAllowed(1), false, "even a single vial is refused");
  const after = tallyKits(orders, products, "pay_later");
  assert.deepEqual([after[k15].vials, after[k15].vialsNeeded], [150, 0]);
  assert.equal(allKitsFilled(after), true);
});
check("a cancellation re-opens its vials", () => {
  const filled = [...round, order([line("15mg", 7)])];
  assert.equal(allKitsFilled(tallyKits(filled, products, "pay_later")), true);
  const cancelled = [...round, order([line("15mg", 7)], { status: "cancelled" })];
  assert.equal(bunuanAllowance(tallyKits(cancelled, products, "pay_later"), k15), 7);
});

console.log("\nallKitsFilled\n");

check("false while any kit needs vials", () => {
  assert.equal(allKitsFilled(tally), false);
});
check("true when every kit is an exact multiple or has no size", () => {
  const t = tallyKits([order([line("15mg", 20), line("30mg", 5)]), order([{ name: "Bac", qty: 3, productId: "bac" }])], products, "pay_later");
  assert.equal(allKitsFilled(t), true);
});
check("an empty round has nothing to fill", () => {
  assert.equal(allKitsFilled({}), true);
});

console.log("\nbunuanStartBlockers — pay_first orders awaiting a payment check\n");

const pending = [
  order([line("15mg", 3)], { status: "new", paymentStatus: "pending", placedAt: "2026-10-03T00:00:00Z" }),
  order([line("15mg", 3)], { status: "confirmed", placedAt: "2026-10-01T00:00:00Z" }),
  order([line("15mg", 3)], { status: "cancelled", placedAt: "2026-10-01T00:00:00Z" }),
  order([line("15mg", 3)], { status: "new", paymentStatus: "paid" }),
  order([line("15mg", 3)], { status: "new", placedAt: "2026-10-02T00:00:00Z" }),
];

check("pay_first: lists the unchecked, uncancelled orders, oldest first", () => {
  const b = bunuanStartBlockers(pending, "pay_first");
  assert.deepEqual(b.map((x) => x.id), [pending[4].id, pending[0].id]);
  assert.equal(b[0].orderNumber, pending[4].orderNumber);
});
check("pay_later: nothing blocks (every placed order already counts)", () => {
  assert.deepEqual(bunuanStartBlockers(pending, "pay_later"), []);
});

console.log("\nbunuanEditWarnings — admin edits may exceed the limit, with a warning\n");

check("adding more than is open warns, naming the kit and both numbers", () => {
  const w = bunuanEditWarnings({ [k15]: 9 }, tally);
  assert.equal(w.length, 1);
  assert.ok(w[0].includes("Tirz — 15mg") && w[0].includes("9") && w[0].includes("7"), w[0]);
});
check("adding to a closed kit warns", () => {
  assert.equal(bunuanEditWarnings({ [k30]: 1 }, tally).length, 1);
});
check("within the limit, or removing, is silent", () => {
  assert.deepEqual(bunuanEditWarnings({ [k15]: 7, [k30]: -3 }, tally), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
