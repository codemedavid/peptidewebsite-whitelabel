/**
 * Self-contained tests for the Group Buy ROUND invariants — the pure helpers in
 * src/lib/storefront/group-buy.ts. No DB, no Next runtime.
 *
 * Guards the non-negotiable rule the ported spec calls out as rule #4:
 *
 *   EXACTLY ONE ACTIVE ROUND PER TENANT.
 *
 * This used to be an entitlement (groupbuy.multiple_active) that widened the
 * rule per tenant. It is now an invariant: no capability combination may ever
 * produce two live rounds. The DB partial unique index
 * (group_buys_one_active_per_tenant) backs the same rule at the storage layer.
 *
 *   npm run test:gb-rounds
 */

import assert from "node:assert";

import {
  effectiveGroupBuyStatus,
  liveGroupBuys,
  groupBuyForOrder,
  buildGroupBuyGate,
  staleActiveRoundIds,
  type GroupBuy,
  type GroupBuyStatus,
} from "../src/lib/storefront/group-buy";

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

// ──────────────────────────────── fixtures ──────────────────────────────────
const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function mkRound(over: Partial<GroupBuy> & { id: string }): GroupBuy {
  return {
    name: `Round ${over.id}`,
    description: "",
    slotGoal: 0,
    batchNumber: "",
    minVials: null,
    maxVials: null,
    closedAt: null,
    status: "active" as GroupBuyStatus,
    startsAt: null,
    endsAt: null,
    deliveryEta: "",
    productIds: [],
    createdAt: iso(-24 * HOUR),
    updatedAt: iso(-24 * HOUR),
    ...over,
  };
}

/** Every capability combination that could plausibly reach liveGroupBuys. The
 *  point of the sweep: no combination may widen the one-active rule. */
const CAP_COMBOS = [{ scheduled: false }, { scheduled: true }] as const;

console.log("\nGroup Buy round invariants — pure core\n");

// ───────────────────────── rule #4: one active round ────────────────────────
console.log("liveGroupBuys — exactly one active round per tenant");

check("two stored-active rounds collapse to one, under every capability combo", () => {
  const rounds = [
    mkRound({ id: "a", createdAt: iso(-48 * HOUR) }),
    mkRound({ id: "b", createdAt: iso(-24 * HOUR) }),
  ];
  for (const caps of CAP_COMBOS) {
    const live = liveGroupBuys(rounds, caps, NOW);
    assert.equal(
      live.length,
      1,
      `caps ${JSON.stringify(caps)} produced ${live.length} live rounds — rule #4 requires exactly one`,
    );
  }
});

check("the surviving round is the earliest-created (deterministic, not arbitrary)", () => {
  const rounds = [
    mkRound({ id: "newer", createdAt: iso(-1 * HOUR) }),
    mkRound({ id: "older", createdAt: iso(-72 * HOUR) }),
  ];
  assert.equal(liveGroupBuys(rounds, { scheduled: true }, NOW)[0].id, "older");
});

check("no legacy multipleActive flag can widen the rule", () => {
  // groupbuy.multiple_active is gone. If a stale caller still passes the old
  // flag (a cached client bundle, an old fixture) it must be inert — an unknown
  // property, never a widening switch.
  const rounds = [mkRound({ id: "a" }), mkRound({ id: "b" }), mkRound({ id: "c" })];
  const stale = { scheduled: true, multipleActive: true } as unknown as { scheduled: boolean };
  assert.equal(liveGroupBuys(rounds, stale, NOW).length, 1);
});

check("a tenant with no live round gets an empty list, not a fallback round", () => {
  const rounds = [
    mkRound({ id: "a", status: "draft" }),
    mkRound({ id: "b", status: "closed" }),
    mkRound({ id: "c", status: "archived" }),
  ];
  assert.deepEqual(liveGroupBuys(rounds, { scheduled: true }, NOW), []);
});

// ───────────────────── effective status folds in the window ─────────────────
console.log("effectiveGroupBuyStatus");

check("an active round past its endsAt is effectively closed", () => {
  const gb = mkRound({ id: "a", status: "active", endsAt: iso(-1 * HOUR) });
  assert.equal(effectiveGroupBuyStatus(gb, true, NOW), "closed");
});

check("a scheduled round past its startsAt is effectively active (needs the flag)", () => {
  const gb = mkRound({ id: "a", status: "scheduled", startsAt: iso(-1 * HOUR) });
  assert.equal(effectiveGroupBuyStatus(gb, true, NOW), "active");
  assert.equal(effectiveGroupBuyStatus(gb, false, NOW), "scheduled");
});

check("a lapsed round is excluded from live, so it cannot occupy the single slot", () => {
  // The lapsed round is the earliest-created. If effective status were ignored
  // it would win the slice(0,1) and mask the genuinely-open round.
  const rounds = [
    mkRound({ id: "lapsed", createdAt: iso(-72 * HOUR), endsAt: iso(-1 * HOUR) }),
    mkRound({ id: "open", createdAt: iso(-24 * HOUR), endsAt: iso(+24 * HOUR) }),
  ];
  const live = liveGroupBuys(rounds, { scheduled: true }, NOW);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, "open");
});

// ──────────────── attribution + gate ride on the same single round ──────────
console.log("groupBuyForOrder / buildGroupBuyGate");

check("an order is never attributed to a closed round", () => {
  const rounds = [mkRound({ id: "lapsed", endsAt: iso(-1 * HOUR), productIds: ["p1"] })];
  const gb = groupBuyForOrder(rounds, { scheduled: true, productAssignment: true }, ["p1"], NOW);
  assert.equal(gb, null);
});

check("an order is attributed to the single live round covering its lines", () => {
  const rounds = [mkRound({ id: "open", endsAt: iso(+24 * HOUR), productIds: ["p1"] })];
  const gb = groupBuyForOrder(rounds, { scheduled: true, productAssignment: true }, ["p1"], NOW);
  assert.equal(gb?.id, "open");
});

check("the gate is built from at most one live round", () => {
  const rounds = [
    mkRound({ id: "a", createdAt: iso(-48 * HOUR), productIds: ["p1"] }),
    mkRound({ id: "b", createdAt: iso(-24 * HOUR), productIds: ["p2"] }),
  ];
  const gate = buildGroupBuyGate(rounds, { scheduled: true, productAssignment: true }, false, NOW);
  // Only round "a" is live, so only its products are covered. If both rounds
  // counted, p2 would leak in and the on-hand gate would under-block.
  assert.deepEqual(gate.productIds, ["p1"]);
});

// ───────────── reconciliation for the DB partial unique index ───────────────
// The index group_buys_one_active_per_tenant guards the STORED status='active'.
// effectiveGroupBuyStatus derives "closed" on read, so a lapsed round lingers
// stored-active forever. staleActiveRoundIds finds exactly those rows, so the
// save path can persist their close before activating a new round — otherwise
// the index would false-reject a legitimate activation.
console.log("staleActiveRoundIds — reconcile lapsed stored-active rows");

check("finds a stored-active round whose window has lapsed", () => {
  const rounds = [
    mkRound({ id: "lapsed", status: "active", endsAt: iso(-1 * HOUR) }),
    mkRound({ id: "live", status: "active", endsAt: iso(+24 * HOUR) }),
  ];
  assert.deepEqual(staleActiveRoundIds(rounds, { scheduled: true }, NOW), ["lapsed"]);
});

check("ignores a genuinely-live stored-active round", () => {
  const rounds = [mkRound({ id: "live", status: "active", endsAt: iso(+24 * HOUR) })];
  assert.deepEqual(staleActiveRoundIds(rounds, { scheduled: true }, NOW), []);
});

check("ignores rounds not stored active (scheduled/closed/draft)", () => {
  const rounds = [
    mkRound({ id: "s", status: "scheduled", startsAt: iso(-2 * HOUR), endsAt: iso(-1 * HOUR) }),
    mkRound({ id: "c", status: "closed" }),
    mkRound({ id: "d", status: "draft" }),
  ];
  assert.deepEqual(staleActiveRoundIds(rounds, { scheduled: true }, NOW), []);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
