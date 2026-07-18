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
  evaluateOnHandGate,
  ON_HAND_GATE_UNVERIFIED_MESSAGE,
  type OnHandGateDeps,
} from "../src/lib/storefront/on-hand-gate";
import {
  GROUP_BUY_CAPS_OFF,
  type GroupBuy,
  type GroupBuyCapabilities,
} from "../src/lib/storefront/group-buy";

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
const NOW = new Date("2026-07-17T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

// A live round that covers ONLY p1 (so p2 is on-hand → blocked when sales off).
const ROUND_COVERS_P1: GroupBuy = {
  id: "gb1",
  name: "Round 1",
  description: "",
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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
