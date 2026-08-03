/**
 * Tests for the checkout on-hand gate — src/lib/storefront/on-hand-gate.ts.
 *
 * The load-bearing guarantee (Phase 2): when the store owner has turned on-hand
 * sales OFF during a live group buy, the SERVER must reject paused products even
 * if the gate can't be evaluated. The old inline version failed OPEN — a
 * transient error let a paused product through. This suite pins it fail-CLOSED,
 * and injects throwing stubs so the error path is exercised without a DB.
 *
 *   npm run test:onhand-gate
 */

import assert from "node:assert";

import {
  decideOnHandBlock,
  decideWayBlock,
  evaluateOnHandGate,
  ON_HAND_GATE_UNVERIFIED_MESSAGE,
  type OnHandGateDeps,
} from "../src/lib/storefront/on-hand-gate";
import {
  GROUP_BUY_CAPS_OFF,
  buildGroupBuyGate,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "../src/lib/storefront/group-buy";
import { WAY_BLOCK_MESSAGES } from "../src/lib/storefront/two-ways-mode";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

// ──────────────────────────────── fixtures ──────────────────────────────────
// Anchored to the REAL clock, not a frozen date. Every fixture window below is
// a relative offset from this, and the resolver tests that don't pass an
// explicit `now` fall through to the real clock — a hardcoded date silently
// expires and turns "the round is live" into "the round closed" once the
// calendar passes it.
const NOW = new Date();
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

// A live round that covers ONLY p1 (so p2 is on-hand → blocked when sales off).
const ROUND_COVERS_P1: GroupBuy = {
  id: "gb1",
  name: "Round 1",
  description: "",
  slotGoal: 0,
  batchNumber: "",
  minVials: null,
  maxVials: null,
  closedAt: null,
  status: "active",
  startsAt: null,
  endsAt: iso(+24 * HOUR),
  deliveryEta: "",
  productIds: ["p1"],
  createdAt: iso(-24 * HOUR),
  updatedAt: iso(-24 * HOUR),
};

// Caps with the module + product assignment on (the gate-enforcing regime).
const CAPS_ON: GroupBuyCapabilities = {
  ...GROUP_BUY_CAPS_OFF,
  enabled: true,
  productAssignment: true,
};

const OFF = { groupBuyAllowOnHand: false }; // owner paused on-hand sales
const ITEMS_WITH_ONHAND = [
  { productId: "p1", name: "In-buy product" },
  { productId: "p2", name: "On-hand product" },
];

const throwingDeps: OnHandGateDeps = {
  resolveCaps: async () => {
    throw new Error("boom: entitlement read failed");
  },
  loadGroupBuys: async () => {
    throw new Error("boom: rounds read failed");
  },
};
const okDeps = (caps: GroupBuyCapabilities, rounds: GroupBuy[]): OnHandGateDeps => ({
  resolveCaps: async () => caps,
  loadGroupBuys: async () => rounds,
});

async function main() {
  console.log("\nCheckout on-hand gate\n");

  // ── pure decision ─────────────────────────────────────────────────────────
  console.log("decideOnHandBlock (pure)");

  await check("allows everything when on-hand sales are allowed", () => {
    const msg = decideOnHandBlock({
      allowOnHand: true,
      caps: CAPS_ON,
      groupBuys: [ROUND_COVERS_P1],
      items: ITEMS_WITH_ONHAND,
      now: NOW,
    });
    assert.equal(msg, null);
  });

  await check("blocks a paused on-hand product by name when sales are off", () => {
    const msg = decideOnHandBlock({
      allowOnHand: false,
      caps: CAPS_ON,
      groupBuys: [ROUND_COVERS_P1],
      items: ITEMS_WITH_ONHAND,
      now: NOW,
    });
    assert.match(msg ?? "", /On-hand product/);
  });

  await check("allows an in-buy product even when sales are off", () => {
    const msg = decideOnHandBlock({
      allowOnHand: false,
      caps: CAPS_ON,
      groupBuys: [ROUND_COVERS_P1],
      items: [{ productId: "p1", name: "In-buy product" }],
      now: NOW,
    });
    assert.equal(msg, null);
  });

  await check("allows when the group buy module is off (gate N/A)", () => {
    const msg = decideOnHandBlock({
      allowOnHand: false,
      caps: GROUP_BUY_CAPS_OFF,
      groupBuys: [ROUND_COVERS_P1],
      items: ITEMS_WITH_ONHAND,
      now: NOW,
    });
    assert.equal(msg, null);
  });

  // ── async orchestration ───────────────────────────────────────────────────
  console.log("evaluateOnHandGate (orchestration)");

  await check("common case (on-hand allowed) short-circuits WITHOUT touching deps", async () => {
    let touched = false;
    const spyDeps: OnHandGateDeps = {
      resolveCaps: async () => {
        touched = true;
        return CAPS_ON;
      },
      loadGroupBuys: async () => {
        touched = true;
        return [];
      },
    };
    const msg = await evaluateOnHandGate({ groupBuyAllowOnHand: true }, "t1", "slug", ITEMS_WITH_ONHAND, spyDeps);
    assert.equal(msg, null);
    assert.equal(touched, false, "must not hit the DB when on-hand sales are allowed");
  });

  await check("blocks the paused product through the real resolvers", async () => {
    const msg = await evaluateOnHandGate(OFF, "t1", "slug", ITEMS_WITH_ONHAND, okDeps(CAPS_ON, [ROUND_COVERS_P1]));
    assert.match(msg ?? "", /On-hand product/);
  });

  // THE load-bearing one — currently RED (fails open, returns null).
  await check("FAILS CLOSED when caps resolution throws while on-hand sales are off", async () => {
    const msg = await evaluateOnHandGate(OFF, "t1", "slug", ITEMS_WITH_ONHAND, throwingDeps);
    assert.equal(
      msg,
      ON_HAND_GATE_UNVERIFIED_MESSAGE,
      `expected fail-closed rejection, got ${JSON.stringify(msg)} (fails OPEN — paused product would slip through)`,
    );
  });

  await check("FAILS CLOSED when the rounds read throws while on-hand sales are off", async () => {
    const deps: OnHandGateDeps = {
      resolveCaps: async () => CAPS_ON,
      loadGroupBuys: async () => {
        throw new Error("boom");
      },
    };
    const msg = await evaluateOnHandGate(OFF, "t1", "slug", ITEMS_WITH_ONHAND, deps);
    assert.equal(msg, ON_HAND_GATE_UNVERIFIED_MESSAGE);
  });

  await check("a gate error NEVER walls checkout when on-hand sales are allowed", async () => {
    const msg = await evaluateOnHandGate({ groupBuyAllowOnHand: true }, "t1", "slug", ITEMS_WITH_ONHAND, throwingDeps);
    assert.equal(msg, null, "on-hand allowed must short-circuit before the throwing deps");
  });

  // ── per-way mode (./two-ways-mode) ────────────────────────────────────────
  // Unlike groupBuyAllowOnHand, the owner's per-way setting is NOT scoped to a
  // live round: a group-buy-only store (Dragon Peptides) refuses on-hand items
  // whether or not a round happens to be running.
  console.log("decideWayBlock (pure, per-way mode)");

  const GATE_ROUND_P1 = buildGroupBuyGate([ROUND_COVERS_P1], CAPS_ON, true, NOW);
  const GATE_NO_ROUND = buildGroupBuyGate([], CAPS_ON, true, NOW);

  await check("both ways open blocks nothing", () => {
    const msg = decideWayBlock({
      ways: { onHand: "open", groupBuy: "open" },
      gate: GATE_ROUND_P1,
      items: ITEMS_WITH_ONHAND,
    });
    assert.equal(msg, null);
  });

  await check("a HIDDEN on-hand way blocks an on-hand item with NO round running", () => {
    const msg = decideWayBlock({
      ways: { onHand: "hidden", groupBuy: "open" },
      gate: GATE_NO_ROUND,
      items: [{ productId: "p2", name: "On-hand product" }],
    });
    assert.equal(msg, WAY_BLOCK_MESSAGES.onHand);
  });

  await check("a CLOSED on-hand way blocks just the same (closed and hidden both refuse)", () => {
    const msg = decideWayBlock({
      ways: { onHand: "closed", groupBuy: "open" },
      gate: GATE_NO_ROUND,
      items: [{ productId: "p2", name: "On-hand product" }],
    });
    assert.equal(msg, WAY_BLOCK_MESSAGES.onHand);
  });

  await check("a hidden on-hand way still lets the ROUND's products through", () => {
    const msg = decideWayBlock({
      ways: { onHand: "hidden", groupBuy: "open" },
      gate: GATE_ROUND_P1,
      items: [{ productId: "p1", name: "In-buy product" }],
    });
    assert.equal(msg, null);
  });

  await check("a HIDDEN group-buy way blocks the round's products", () => {
    const msg = decideWayBlock({
      ways: { onHand: "open", groupBuy: "hidden" },
      gate: GATE_ROUND_P1,
      items: [{ productId: "p1", name: "In-buy product" }],
    });
    assert.equal(msg, WAY_BLOCK_MESSAGES.groupBuy);
  });

  await check("a closed group-buy way leaves on-hand items alone", () => {
    const msg = decideWayBlock({
      ways: { onHand: "open", groupBuy: "closed" },
      gate: GATE_ROUND_P1,
      items: [{ productId: "p2", name: "On-hand product" }],
    });
    assert.equal(msg, null);
  });

  await check("under a catalog-wide round every item is group-buy, so on-hand rules are moot", () => {
    const coversAll: GroupBuy = { ...ROUND_COVERS_P1, productIds: [] };
    const gate = buildGroupBuyGate([coversAll], CAPS_ON, true, NOW);
    const msg = decideWayBlock({
      ways: { onHand: "hidden", groupBuy: "open" },
      gate,
      items: ITEMS_WITH_ONHAND,
    });
    assert.equal(msg, null);
  });

  await check("an item with no productId is never blocked", () => {
    const msg = decideWayBlock({
      ways: { onHand: "hidden", groupBuy: "open" },
      gate: GATE_NO_ROUND,
      items: [{ productId: null, name: "Custom line" }],
    });
    assert.equal(msg, null);
  });

  console.log("evaluateOnHandGate (per-way mode)");

  await check("both ways open + on-hand allowed still short-circuits WITHOUT touching deps", async () => {
    let touched = false;
    const spyDeps: OnHandGateDeps = {
      resolveCaps: async () => {
        touched = true;
        return CAPS_ON;
      },
      loadGroupBuys: async () => {
        touched = true;
        return [];
      },
    };
    const msg = await evaluateOnHandGate({}, "t1", "slug", ITEMS_WITH_ONHAND, spyDeps);
    assert.equal(msg, null);
    assert.equal(touched, false, "an untouched config must not cost a DB read");
  });

  await check("a group-buy-only store refuses an on-hand item at checkout", async () => {
    const config = { twoWaysMode: { onHand: "hidden", groupBuy: "open" } };
    const msg = await evaluateOnHandGate(
      config,
      "t1",
      "slug",
      ITEMS_WITH_ONHAND,
      okDeps(CAPS_ON, [ROUND_COVERS_P1]),
    );
    assert.equal(msg, WAY_BLOCK_MESSAGES.onHand);
  });

  await check("a group-buy-only store refuses on-hand items with no round running at all", async () => {
    const config = { twoWaysMode: { onHand: "hidden", groupBuy: "open" } };
    const msg = await evaluateOnHandGate(
      config,
      "t1",
      "slug",
      [{ productId: "p2", name: "On-hand product" }],
      okDeps(CAPS_ON, []),
    );
    assert.equal(msg, WAY_BLOCK_MESSAGES.onHand);
  });

  await check("FAILS CLOSED when the gate can't be evaluated and a way is shut", async () => {
    const config = { twoWaysMode: { onHand: "hidden", groupBuy: "open" } };
    const msg = await evaluateOnHandGate(config, "t1", "slug", ITEMS_WITH_ONHAND, throwingDeps);
    assert.equal(msg, ON_HAND_GATE_UNVERIFIED_MESSAGE);
  });

  // Losing the Group Buy module must not wall a store shut: without it there is
  // no group buy to sell through, so the per-way setting is meaningless and the
  // store falls back to an ordinary one rather than refusing every order.
  await check("the per-way mode is ignored when the Group Buy module is off", async () => {
    const config = { twoWaysMode: { onHand: "hidden", groupBuy: "open" } };
    const msg = await evaluateOnHandGate(
      config,
      "t1",
      "slug",
      ITEMS_WITH_ONHAND,
      okDeps(GROUP_BUY_CAPS_OFF, [ROUND_COVERS_P1]),
    );
    assert.equal(msg, null);
  });

  await check("junk in config.twoWaysMode leaves checkout open", async () => {
    const msg = await evaluateOnHandGate(
      { twoWaysMode: "group-buy-only" },
      "t1",
      "slug",
      ITEMS_WITH_ONHAND,
      throwingDeps,
    );
    assert.equal(msg, null, "unreadable config must not wall an ordinary store");
  });

  // The pre-existing live-round rule keeps its own, more specific message.
  await check("the legacy live-round block still names the offending product", async () => {
    const msg = await evaluateOnHandGate(OFF, "t1", "slug", ITEMS_WITH_ONHAND, okDeps(CAPS_ON, [ROUND_COVERS_P1]));
    assert.match(msg ?? "", /On-hand product/);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
