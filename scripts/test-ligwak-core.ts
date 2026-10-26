/**
 * Ligwak — leftover vials that don't make a full kit (src/modules/ligwak/core).
 *
 *   npm run test:ligwak-core
 *
 * Per kit (product + variation), counted orders are walked OLDEST first
 * (placedAt, then orderNumber, then id) and fill whole kits; whatever is left
 * is SUGGESTED for ligwak from the last-placed vials, splitting a line per
 * vial. The admin then decides each suggestion: Ligwak (cancel) or Keep (the
 * store absorbs the partial kit). Nothing is cancelled without a decision.
 */
import assert from "node:assert";

import {
  applyLigwakDecisions,
  ligwakSuggestions,
  lineStatusFor,
  lineStatusLabel,
  suggestLigwak,
  type LigwakDecision,
} from "../src/modules/ligwak/core";
import { kitKey, type KitOrder, type KitProduct } from "../src/lib/storefront/gb-kits";

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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const tirz: KitProduct = { id: "tirz", vialsPerKit: 10, variations: [{ name: "15mg" }, { name: "30mg", kitSize: 5 }] };
const bac: KitProduct = { id: "bac" };
const products = [tirz, bac];
const k15 = kitKey({ name: "", productId: "tirz", variation: "15mg" });
const line = (variation: string, qty: number, extra: Record<string, unknown> = {}) => ({
  name: `Tirz — ${variation}`,
  qty,
  productId: "tirz",
  variation,
  ...extra,
});
function order(id: string, placedAt: string, items: unknown, extra: Partial<KitOrder> = {}): KitOrder {
  return { id, orderNumber: `MNM-${id}`, placedAt, status: "new", items, ...extra };
}
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T00:00:00Z`;
const byOrder = (plan: ReturnType<typeof suggestLigwak>) =>
  ligwakSuggestions(plan).map((s) => [s.orderId, s.keepQty, s.suggestQty]);

console.log("\nsuggestLigwak\n");

check("15 vials @ 10 → 1 kit kept, 5 suggested", () => {
  const plan = suggestLigwak([order("a", day(1), [line("15mg", 15)])], products, "pay_later");
  assert.deepEqual(byOrder(plan), [["a", 10, 5]]);
  const kit = plan.kits.find((k) => k.key === k15)!;
  assert.deepEqual([kit.vials, kit.fullKits, kit.keepVials, kit.ligwakVials, kit.kitSize], [15, 1, 10, 5, 10]);
});
check("8 + 5 @ 10 → the older 8 stay whole, the newer line splits 2 kept / 3 suggested", () => {
  const plan = suggestLigwak(
    [order("new", day(5), [line("15mg", 5)]), order("old", day(1), [line("15mg", 8)])],
    products,
    "pay_later",
  );
  assert.deepEqual(byOrder(plan), [["new", 2, 3]]);
  const old = plan.entries.find((e) => e.orderId === "old")!;
  assert.deepEqual([old.keepQty, old.suggestQty], [8, 0]);
});
check("exact multiples → nothing suggested", () => {
  const plan = suggestLigwak(
    [order("a", day(1), [line("15mg", 12), line("30mg", 5)]), order("b", day(2), [line("15mg", 8)])],
    products,
    "pay_later",
  );
  assert.deepEqual(ligwakSuggestions(plan), []);
});
check("under one kit → every vial is suggested", () => {
  const plan = suggestLigwak(
    [order("a", day(1), [line("15mg", 4)]), order("b", day(2), [line("15mg", 3)])],
    products,
    "pay_later",
  );
  assert.deepEqual(byOrder(plan), [
    ["a", 0, 4],
    ["b", 0, 3],
  ]);
});
check("ties on placedAt break by orderNumber, numerically (MNM-999 before MNM-1010)", () => {
  const plan = suggestLigwak(
    [
      order("z", day(1), [line("15mg", 5)], { orderNumber: "MNM-1010" }),
      order("y", day(1), [line("15mg", 8)], { orderNumber: "MNM-999" }),
    ],
    products,
    "pay_later",
  );
  // 13 vials → 10 kept: 999's 8 first, then 2 of 1010's 5.
  assert.deepEqual(byOrder(plan), [["z", 2, 3]]);
});
check("orders without a number go after numbered ones, then by id", () => {
  const plan = suggestLigwak(
    [
      order("x2", day(1), [line("15mg", 1)], { orderNumber: undefined }),
      order("x1", day(1), [line("15mg", 1)], { orderNumber: undefined }),
      order("n", day(1), [line("15mg", 10)], { orderNumber: "MNM-5" }),
    ],
    products,
    "pay_later",
  );
  assert.deepEqual(byOrder(plan), [
    ["x1", 0, 1],
    ["x2", 0, 1],
  ]);
});
check("store-added vials (line placedAt) sort by when they were added", () => {
  const plan = suggestLigwak(
    [
      order("early", day(1), [line("15mg", 6), line("15mg", 3, { placedAt: day(9) })]),
      order("mid", day(4), [line("15mg", 4)]),
    ],
    products,
    "pay_later",
  );
  // 13 vials: early 6 + mid 4 = 10 kept; the 3 added on day 9 are the last placed.
  assert.deepEqual(
    ligwakSuggestions(plan).map((s) => [s.orderId, s.lineIndex, s.suggestQty]),
    [["early", 1, 3]],
  );
});
check("kits are per variation: 30mg @ 5 and 15mg @ 10 never mix", () => {
  const plan = suggestLigwak([order("a", day(1), [line("15mg", 10), line("30mg", 7)])], products, "pay_later");
  assert.deepEqual(
    ligwakSuggestions(plan).map((s) => [s.variation, s.keepQty, s.suggestQty, s.kitSize]),
    [["30mg", 5, 2, 5]],
  );
});
check("a product with no kit size is never suggested", () => {
  const plan = suggestLigwak([order("a", day(1), [{ name: "Bac", qty: 3, productId: "bac" }])], products, "pay_later");
  assert.deepEqual(ligwakSuggestions(plan), []);
  assert.equal(plan.entries[0].kitSize, null);
});
check("only orders under the counting rule take part (pay_first: checked only)", () => {
  const plan = suggestLigwak(
    [
      order("paid", day(1), [line("15mg", 10)], { status: "confirmed" }),
      order("unchecked", day(2), [line("15mg", 4)], { status: "new" }),
      order("gone", day(3), [line("15mg", 4)], { status: "cancelled" }),
    ],
    products,
    "pay_first",
  );
  assert.deepEqual(plan.entries.map((e) => e.orderId), ["paid"]);
  assert.deepEqual(ligwakSuggestions(plan), []);
});
check("re-running ignores earlier ligwak cancellations (recalculate starts clean)", () => {
  const plan = suggestLigwak([order("a", day(1), [line("15mg", 15, { cancelledQty: 5 })])], products, "pay_later");
  assert.deepEqual(byOrder(plan), [["a", 10, 5]]);
});
check("kitSize is snapshotted on every entry, with a stable entry id", () => {
  const plan = suggestLigwak([order("a", day(1), [line("15mg", 15)])], products, "pay_later");
  assert.equal(plan.entries[0].kitSize, 10);
  assert.equal(plan.entries[0].id, "a#0");
});
check("never mutates its inputs", () => {
  const orders = deepFreeze([order("a", day(2), [line("15mg", 5)]), order("b", day(1), [line("15mg", 8)])]);
  const before = JSON.stringify(orders);
  suggestLigwak(orders, deepFreeze(JSON.parse(JSON.stringify(products)) as KitProduct[]), "pay_later");
  assert.equal(JSON.stringify(orders), before);
});

console.log("\napplyLigwakDecisions\n");

const plan = suggestLigwak(
  [order("old", day(1), [line("15mg", 8)]), order("new", day(5), [line("15mg", 5), line("30mg", 7)])],
  products,
  "pay_later",
);
// new#0: keep 2 / suggest 3 (15mg)   new#1: keep 5 / suggest 2 (30mg)

const decide = (entryId: string, choice: LigwakDecision["choice"], suggestQty?: number): LigwakDecision => ({
  entryId,
  choice,
  suggestQty: suggestQty ?? plan.entries.find((e) => e.id === entryId)!.suggestQty,
});

check("undecided suggestions are listed and the lines stay pending", () => {
  const r = applyLigwakDecisions(plan, []);
  assert.equal(r.complete, false);
  assert.deepEqual(r.undecided.map((e) => e.id), ["new#0", "new#1"]);
  const pend = r.lines.find((l) => l.orderId === "new" && l.lineIndex === 0)!;
  assert.deepEqual([pend.lineStatus, pend.successQty, pend.cancelledQty], ["pending", 5, 0]);
});
check("Ligwak cancels the suggested vials → partial line", () => {
  const r = applyLigwakDecisions(plan, [decide("new#0", "ligwak"), decide("new#1", "ligwak")]);
  assert.equal(r.complete, true);
  const l = r.lines.find((x) => x.orderId === "new" && x.lineIndex === 0)!;
  assert.deepEqual([l.quantity, l.successQty, l.cancelledQty, l.lineStatus, l.decision], [5, 2, 3, "partial", "ligwak"]);
});
check("Keep moves the suggested vials back to success", () => {
  const r = applyLigwakDecisions(plan, [decide("new#0", "keep"), decide("new#1", "ligwak")]);
  const l = r.lines.find((x) => x.orderId === "new" && x.lineIndex === 0)!;
  assert.deepEqual([l.successQty, l.cancelledQty, l.lineStatus, l.decision], [5, 0, "success", "keep"]);
});
check("lines with nothing suggested are success with no decision needed", () => {
  const r = applyLigwakDecisions(plan, []);
  const l = r.lines.find((x) => x.orderId === "old")!;
  assert.deepEqual([l.successQty, l.cancelledQty, l.lineStatus, l.decision], [8, 0, "success", null]);
});
check("a whole line ligwak'd is cancelled", () => {
  const small = suggestLigwak([order("a", day(1), [line("15mg", 4)])], products, "pay_later");
  const r = applyLigwakDecisions(small, [{ entryId: "a#0", suggestQty: 4, choice: "ligwak" }]);
  assert.deepEqual([r.lines[0].successQty, r.lines[0].cancelledQty, r.lines[0].lineStatus], [0, 4, "cancelled"]);
});
check("a stale decision (suggestion changed since) does not apply", () => {
  const r = applyLigwakDecisions(plan, [decide("new#0", "ligwak", 1), decide("new#1", "ligwak")]);
  assert.equal(r.complete, false);
  assert.deepEqual(r.undecided.map((e) => e.id), ["new#0"]);
});
check("decisions for lines with no suggestion are ignored", () => {
  const r = applyLigwakDecisions(plan, [{ entryId: "old#0", suggestQty: 0, choice: "ligwak" }]);
  assert.equal(r.lines.find((x) => x.orderId === "old")!.cancelledQty, 0);
});
check("successQty + cancelledQty always equals the ordered quantity", () => {
  const r = applyLigwakDecisions(plan, [decide("new#0", "ligwak"), decide("new#1", "keep")]);
  for (const l of r.lines) assert.equal(l.successQty + l.cancelledQty, l.quantity);
});
check("never mutates the plan or the decisions", () => {
  const frozenPlan = deepFreeze(JSON.parse(JSON.stringify(plan)) as typeof plan);
  const decisions = deepFreeze([decide("new#0", "ligwak")]);
  applyLigwakDecisions(frozenPlan, decisions);
});

console.log("\nline status\n");

check("lineStatusFor: success / partial / cancelled", () => {
  assert.equal(lineStatusFor(5, 0), "success");
  assert.equal(lineStatusFor(5, 3), "partial");
  assert.equal(lineStatusFor(5, 5), "cancelled");
});
check("lineStatusLabel reads like the order list", () => {
  assert.equal(lineStatusLabel({ quantity: 5, successQty: 2, cancelledQty: 3, lineStatus: "partial" }), "2 Success · 3 Cancelled");
  assert.equal(lineStatusLabel({ quantity: 5, successQty: 5, cancelledQty: 0, lineStatus: "success" }), "Success");
  assert.equal(lineStatusLabel({ quantity: 5, successQty: 0, cancelledQty: 5, lineStatus: "cancelled" }), "Cancelled");
  assert.equal(lineStatusLabel({ quantity: 5, successQty: 5, cancelledQty: 0, lineStatus: "pending" }), "Pending");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
