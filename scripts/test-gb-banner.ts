/**
 * Tests for the storefront Group Buy banner + scope-filter core —
 * src/lib/storefront/group-buy-banner.ts.
 *
 * Two pure functions:
 *   buildGroupBuyBanner — the public presentation of the (at most one) LIVE round,
 *                         or null. coversAll is true when the round has no product
 *                         assignment (or the tenant lacks the capability): the whole
 *                         catalog IS the group buy, so a scope toggle is meaningless.
 *   scopedCatalog       — the products a visitor sees given the "Explore GB #N"
 *                         toggle. DEFAULT OFF → the full catalog. On (with an
 *                         assigned round) → only the round's products. A no-op when
 *                         there's no banner or the round covers the whole catalog.
 *
 *   npm run test:gb-banner
 */

import assert from "node:assert";

import {
  buildGroupBuyBanner,
  scopedCatalog,
  type GroupBuyBanner,
} from "../src/lib/storefront/group-buy-banner";
import { normalizeGroupBuy, type GroupBuy } from "../src/lib/storefront/group-buy";

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

const CAPS = { scheduled: true, productAssignment: true };
const NOW = new Date("2026-07-17T12:00:00.000Z");

function gb(partial: Partial<GroupBuy>): GroupBuy {
  return normalizeGroupBuy({
    id: "gb1",
    name: "GB #5",
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  });
}

function main() {
  console.log("\nGroup Buy storefront banner\n");

  check("no live round → null banner", () => {
    assert.equal(buildGroupBuyBanner([gb({ status: "draft" })], CAPS, NOW), null);
    assert.equal(buildGroupBuyBanner([], CAPS, NOW), null);
  });

  check("a live assigned round → banner scoped to its products (coversAll false)", () => {
    const banner = buildGroupBuyBanner(
      [gb({ productIds: ["p1", "p2"], name: "Holiday Round", deliveryEta: "3 weeks" })],
      CAPS,
      NOW,
    );
    assert.ok(banner);
    assert.equal(banner!.name, "Holiday Round");
    assert.equal(banner!.deliveryEta, "3 weeks");
    assert.equal(banner!.coversAll, false);
    assert.deepEqual(banner!.productIds, ["p1", "p2"]);
  });

  check("a live round with NO assignment → coversAll true (whole catalog)", () => {
    const banner = buildGroupBuyBanner([gb({ productIds: [] })], CAPS, NOW);
    assert.ok(banner);
    assert.equal(banner!.coversAll, true);
    assert.deepEqual(banner!.productIds, []);
  });

  check("without the productAssignment capability → coversAll true", () => {
    const banner = buildGroupBuyBanner(
      [gb({ productIds: ["p1"] })],
      { scheduled: true, productAssignment: false },
      NOW,
    );
    assert.ok(banner);
    assert.equal(banner!.coversAll, true);
  });

  check("a round whose window has lapsed (effectively closed) → null", () => {
    const lapsed = gb({ status: "active", endsAt: "2026-07-10T00:00:00.000Z" });
    assert.equal(buildGroupBuyBanner([lapsed], CAPS, NOW), null);
  });

  console.log("\nScoped catalog\n");

  const products = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const assigned: GroupBuyBanner = {
    id: "gb1",
    name: "GB #5",
    description: "",
    deliveryEta: "",
    productIds: ["p1", "p3"],
    coversAll: false,
    slotGoal: 0,
    endsAt: null,
    filled: 0,
  };

  check("no banner → full catalog regardless of the toggle", () => {
    assert.deepEqual(scopedCatalog(products, null, true), products);
    assert.deepEqual(scopedCatalog(products, null, false), products);
  });

  check("toggle OFF (default) → full catalog", () => {
    assert.deepEqual(scopedCatalog(products, assigned, false), products);
  });

  check("toggle ON with an assigned round → only the round's products", () => {
    assert.deepEqual(
      scopedCatalog(products, assigned, true).map((p) => p.id),
      ["p1", "p3"],
    );
  });

  check("toggle ON but the round covers the whole catalog → no-op (full catalog)", () => {
    const all: GroupBuyBanner = { ...assigned, coversAll: true, productIds: [] };
    assert.deepEqual(scopedCatalog(products, all, true), products);
  });

  check("scopedCatalog never mutates its input array", () => {
    const copy = [...products];
    scopedCatalog(products, assigned, true);
    assert.deepEqual(products, copy);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
