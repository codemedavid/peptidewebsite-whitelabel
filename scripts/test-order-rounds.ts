/**
 * Orders filed per group buy — the pure round rules behind the app's admin
 * round bar and the shopper's My orders sections (src/lib/mobile/order-rounds).
 *
 *   npm run test:order-rounds
 */
import assert from "node:assert";

import { roundFacets, roundState, roundWhere, sortRounds, toShopOrderRound, type RoundRow } from "../src/lib/mobile/order-rounds";

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const NOW = new Date("2026-10-08T00:00:00Z");
const row = (id: string, over: Partial<RoundRow> = {}): RoundRow => ({
  id,
  name: `Round ${id}`,
  batchNumber: null,
  status: "closed",
  startsAt: null,
  endsAt: null,
  closedAt: null,
  deliveryEta: "",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

console.log("round state");
test("active is live until its window ends", () => {
  assert.equal(roundState(row("a", { status: "active" }), false, NOW), "live");
  assert.equal(roundState(row("a", { status: "active", endsAt: new Date("2026-10-01T00:00:00Z") }), false, NOW), "closed");
});
test("draft and not-yet-started scheduled rounds are upcoming", () => {
  assert.equal(roundState(row("a", { status: "draft" }), true, NOW), "upcoming");
  assert.equal(roundState(row("a", { status: "scheduled", startsAt: new Date("2026-11-01T00:00:00Z") }), true, NOW), "upcoming");
});
test("a scheduled round goes live only with the scheduled feature on", () => {
  const r = row("a", { status: "scheduled", startsAt: new Date("2026-10-01T00:00:00Z") });
  assert.equal(roundState(r, true, NOW), "live");
  assert.equal(roundState(r, false, NOW), "upcoming");
});
test("cancelled and archived count as over", () => {
  assert.equal(roundState(row("a", { status: "cancelled" }), true, NOW), "closed");
  assert.equal(roundState(row("a", { status: "archived" }), true, NOW), "closed");
});

console.log("ordering");
test("live first, then upcoming, then closed newest-first", () => {
  const rows = [
    row("old", { closedAt: new Date("2026-08-01T00:00:00Z") }),
    row("draft", { status: "draft" }),
    row("new", { closedAt: new Date("2026-09-30T00:00:00Z") }),
    row("live", { status: "active" }),
  ];
  assert.deepEqual(sortRounds(rows, false, NOW).map((r) => r.id), ["live", "draft", "new", "old"]);
});
test("sorting never mutates the input", () => {
  const rows = [row("b", { closedAt: new Date("2026-01-02") }), row("a", { status: "active" })];
  sortRounds(rows, false, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});

console.log("shop round");
test("trims, falls back, and serialises dates", () => {
  const r = toShopOrderRound(
    row("x", { name: "  ", batchNumber: " TR30 ", deliveryEta: " 3 weeks ", closedAt: new Date("2026-09-20T00:00:00Z") }),
    false,
    NOW,
  );
  assert.deepEqual(r, { id: "x", name: "Group buy", batch: "TR30", state: "closed", deliveryEta: "3 weeks", endsAt: null, closedAt: "2026-09-20T00:00:00.000Z" });
});

console.log("round bar");
test("one chip per round with orders, on-hand last, empties dropped", () => {
  const facets = roundFacets(
    [
      { groupBuyId: null, count: 4, snapshotName: null },
      { groupBuyId: "old", count: 2, snapshotName: "Round old" },
      { groupBuyId: "live", count: 5, snapshotName: "Round live" },
      { groupBuyId: "empty", count: 0, snapshotName: "x" },
    ],
    [row("old", { closedAt: new Date("2026-09-01") }), row("live", { status: "active", batchNumber: "B7" }), row("empty")],
    false,
    NOW,
  );
  assert.deepEqual(
    facets.map((f) => [f.key, f.state, f.count, f.batch]),
    [
      ["live", "live", 5, "B7"],
      ["old", "closed", 2, ""],
      ["on-hand", "on-hand", 4, ""],
    ],
  );
});
test("a round whose row is gone keeps a chip under its stamped name", () => {
  const facets = roundFacets([{ groupBuyId: "gone", count: 3, snapshotName: "Summer batch" }], [], false, NOW);
  assert.deepEqual(facets, [{ key: "gone", name: "Summer batch", batch: "", state: "closed", count: 3 }]);
});
test("no group-buy orders → only the on-hand chip (the app hides a lone chip)", () => {
  assert.deepEqual(roundFacets([{ groupBuyId: null, count: 9, snapshotName: null }], [], false, NOW).map((f) => f.key), ["on-hand"]);
});

console.log("round query");
test("on-hand → unfiled orders, an id → that round, junk ignored", () => {
  assert.deepEqual(roundWhere("on-hand"), { groupBuyId: null });
  assert.deepEqual(roundWhere(" abc123 "), { groupBuyId: "abc123" });
  assert.equal(roundWhere(null), null);
  assert.equal(roundWhere(""), null);
  assert.equal(roundWhere("x".repeat(65)), null);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall order-round tests passed");
