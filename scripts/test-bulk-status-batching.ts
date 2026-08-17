/**
 * Regression test for the P2028 transaction timeout on the store admin's bulk
 * "Change Status" action.
 *
 * The bug: bulkUpdateStorefrontOrderStatusAction issued SEQUENTIAL DB round
 * trips inside one interactive transaction — per order (1 updateMany + 1
 * re-read findFirst) and per LINE ITEM (1 product findFirst + 1 updateMany).
 * At the measured ~321ms/round-trip over Supabase's PgBouncer pooler, 17
 * selected orders cost ~92 round trips ≈ 29.5s, past withTenant()'s 20s budget,
 * so Prisma aborted the transaction with P2028 ("Transaction not found…") and
 * the owner saw a raw Prisma error dialog with nothing saved.
 *
 * What this locks in is the SHAPE of the work, not a wall-clock number:
 *   - the stock move costs O(1) reads + O(distinct changed products) writes,
 *     never O(line items)
 *   - the plan is computed once, in memory, so no order is re-read after its
 *     own write
 *
 * Covers:
 *   src/lib/storefront/bulk-status.ts     planBulkStatusChange()
 *   src/lib/storefront/inventory.ts       applyStockMovesToProducts()
 *   src/lib/storefront/stock-move-db.ts   applyOrderStockMovesBatched()
 *
 *   npm run test:bulk-status-batching
 */

import assert from "node:assert";

import type { OrderItem, OrderStatus, OrderStatusEvent } from "../src/storefront/types";
import { planBulkStatusChange, type BulkOrderRow } from "../src/lib/storefront/bulk-status";
import { applyStockMovesToProducts } from "../src/lib/storefront/inventory";
import {
  applyOrderStockMovesBatched,
  type StockMoveDb,
  type StockProductRow,
} from "../src/lib/storefront/stock-move-db";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
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

const NOW = "2026-08-17T00:00:00.000Z";
const ev = (status: OrderStatus, at = NOW): OrderStatusEvent => ({ status, at });

const line = (
  name: string,
  qty: number,
  productId?: string,
  variation?: string,
): OrderItem => ({
  name,
  qty,
  price: 1000,
  ...(productId ? { productId } : {}),
  ...(variation ? { variation } : {}),
});

const order = (
  id: string,
  status: OrderStatus,
  items: OrderItem[],
  extra: Partial<BulkOrderRow> = {},
): BulkOrderRow => ({ id, status, statusHistory: [ev("new")], imported: false, items, ...extra });

/** A fake of the narrow DB surface the batched stock move needs, counting every
 *  round trip it is asked to make. This counter IS the regression assertion. */
function fakeDb(rows: StockProductRow[]) {
  const reads: unknown[] = [];
  const writes: { id: string; data: unknown }[] = [];
  const db: StockMoveDb = {
    async findProducts(where) {
      reads.push(where);
      return rows.filter((r) => where.ids.includes(r.id) || where.names.includes(r.name));
    },
    async updateProduct(id, data) {
      writes.push({ id, data });
    },
  };
  return {
    db,
    reads,
    writes,
    get roundTrips() {
      return reads.length + writes.length;
    },
  };
}

const productRow = (
  id: string,
  name: string,
  stock: number,
  variations?: { name: string; price: number; stock?: number }[],
): StockProductRow => ({
  id,
  name,
  stock,
  metadata: variations ? { variations } : {},
});

async function main() {
  console.log("\nBulk status change — batching & round-trip budget\n");

  // ── planBulkStatusChange: one in-memory pass, no per-order re-reads ────────
  console.log("planBulkStatusChange()");

  await check("produces one write per genuinely changed order, none for no-ops", () => {
    const plan = planBulkStatusChange(
      [
        order("o1", "new", [line("Alpha", 1, "p-alpha")]),
        order("o2", "confirmed", [line("Alpha", 1, "p-alpha")]),
      ],
      "confirmed",
      NOW,
    );
    assert.deepEqual(
      plan.writes.map((w) => w.id),
      ["o1"],
      "only the order that actually changed should be written",
    );
    assert.equal(plan.writes[0].status, "confirmed");
  });

  await check("appends exactly one journey event to a changed order", () => {
    const plan = planBulkStatusChange(
      [order("o1", "new", [line("Alpha", 1, "p-alpha")])],
      "confirmed",
      NOW,
    );
    assert.deepEqual(plan.writes[0].statusHistory, [ev("new"), ev("confirmed")]);
  });

  await check("collects a stock move for each order whose transition moves stock", () => {
    const plan = planBulkStatusChange(
      [
        order("o1", "new", [line("Alpha", 2, "p-alpha")]),
        order("o2", "new", [line("Beta", 3, "p-beta")]),
      ],
      "confirmed",
      NOW,
    );
    assert.equal(plan.stockMoves.length, 2);
    assert.ok(plan.stockMoves.every((m) => m.move === "deduct"));
  });

  await check("collects no stock move for an imported order", () => {
    const plan = planBulkStatusChange(
      [order("o1", "new", [line("Alpha", 2, "p-alpha")], { imported: true })],
      "confirmed",
      NOW,
    );
    assert.equal(plan.writes.length, 1, "an imported order's status still moves");
    assert.equal(plan.stockMoves.length, 0, "but its stock is frozen");
  });

  await check("returns prevStatus per changed order so no re-read is needed", () => {
    const plan = planBulkStatusChange(
      [order("o1", "processing", [line("Alpha", 1, "p-alpha")])],
      "shipped",
      NOW,
    );
    assert.deepEqual(plan.changed, [
      {
        id: "o1",
        prevStatus: "processing",
        status: "shipped",
        statusHistory: [ev("new"), ev("shipped")],
      },
    ]);
  });

  await check("restocks on cancel only when the items are currently deducted", () => {
    const deducted = order("o1", "confirmed", [line("Alpha", 2, "p-alpha")], {
      statusHistory: [ev("new"), ev("confirmed")],
    });
    const never = order("o2", "new", [line("Beta", 2, "p-beta")]);
    const plan = planBulkStatusChange([deducted, never], "cancelled", NOW);
    assert.equal(plan.stockMoves.length, 1);
    assert.equal(plan.stockMoves[0].move, "restock");
  });

  // ── applyStockMovesToProducts: fold many orders onto one product list ──────
  console.log("\napplyStockMovesToProducts()");

  await check("folds several orders' deductions onto the same product", () => {
    const products = [{ id: "p-alpha", name: "Alpha", stock: 10 }];
    const next = applyStockMovesToProducts(products, [
      { items: [line("Alpha", 2, "p-alpha")], move: "deduct" },
      { items: [line("Alpha", 3, "p-alpha")], move: "deduct" },
    ]);
    assert.equal(next[0].stock, 5);
  });

  await check("nets a deduct and a restock across orders", () => {
    const products = [{ id: "p-alpha", name: "Alpha", stock: 10 }];
    const next = applyStockMovesToProducts(products, [
      { items: [line("Alpha", 4, "p-alpha")], move: "deduct" },
      { items: [line("Alpha", 1, "p-alpha")], move: "restock" },
    ]);
    assert.equal(next[0].stock, 7);
  });

  await check("moves a tracked variation's own pool and leaves the base column alone", () => {
    const products = [
      {
        id: "p-alpha",
        name: "Alpha",
        stock: 10,
        variations: [
          { name: "10mg", price: 1000, stock: 6 },
          { name: "5mg", price: 500, stock: 4 },
        ],
      },
    ];
    const next = applyStockMovesToProducts(products, [
      { items: [line("Alpha 10mg", 2, "p-alpha", "10mg")], move: "deduct" },
    ]);
    assert.equal(next[0].stock, 10, "base column untouched for a tracked variation");
    assert.equal(next[0].variations?.[0].stock, 4);
    assert.equal(next[0].variations?.[1].stock, 4, "sibling variation untouched");
  });

  await check("clamps at zero rather than going negative", () => {
    const products = [{ id: "p-alpha", name: "Alpha", stock: 1 }];
    const next = applyStockMovesToProducts(products, [
      { items: [line("Alpha", 5, "p-alpha")], move: "deduct" },
    ]);
    assert.equal(next[0].stock, 0);
  });

  await check("matches legacy lines (no productId) by exact name", () => {
    const products = [{ id: "p-alpha", name: "Alpha", stock: 9 }];
    const next = applyStockMovesToProducts(products, [
      { items: [line("Alpha", 4)], move: "deduct" },
    ]);
    assert.equal(next[0].stock, 5);
  });

  // ── applyOrderStockMovesBatched: THE round-trip budget ────────────────────
  console.log("\napplyOrderStockMovesBatched() — round-trip budget");

  await check("reads every product it needs in exactly ONE query", async () => {
    const f = fakeDb([
      productRow("p-alpha", "Alpha", 100),
      productRow("p-beta", "Beta", 100),
      productRow("p-gamma", "Gamma", 100),
    ]);
    const moves = Array.from({ length: 20 }, () => ({
      items: [line("Alpha", 1, "p-alpha"), line("Beta", 1, "p-beta"), line("Gamma", 1, "p-gamma")],
      move: "deduct" as const,
    }));
    await applyOrderStockMovesBatched(f.db, moves);
    assert.equal(f.reads.length, 1, `expected 1 read, made ${f.reads.length}`);
  });

  await check("writes at most once per distinct product, not once per line item", async () => {
    const f = fakeDb([
      productRow("p-alpha", "Alpha", 100),
      productRow("p-beta", "Beta", 100),
      productRow("p-gamma", "Gamma", 100),
      productRow("p-delta", "Delta", 100),
    ]);
    // 20 orders x 3 lines = 60 line items over 4 distinct products.
    const moves = Array.from({ length: 20 }, () => ({
      items: [line("Alpha", 1, "p-alpha"), line("Beta", 1, "p-beta"), line("Gamma", 1, "p-gamma")],
      move: "deduct" as const,
    }));
    await applyOrderStockMovesBatched(f.db, moves);
    assert.ok(
      f.writes.length <= 4,
      `expected <= 4 writes (distinct products), made ${f.writes.length}`,
    );
    const written = new Set(f.writes.map((w) => w.id));
    assert.equal(written.size, f.writes.length, "no product written twice");
  });

  await check(
    "the 17-order case that timed out now costs a bounded number of round trips",
    async () => {
      // The real pepstack-davao shape: ~1.63 line items per order (521 items /
      // 320 orders), spread over a handful of products. The old code cost
      // 1 + 17*2 + 28*2 = 91 round trips; at ~321ms each that blew the 20s budget.
      const catalog = ["alpha", "beta", "gamma", "delta", "epsilon"];
      const f = fakeDb(catalog.map((n, i) => productRow(`p-${n}`, `P${i}`, 500)));
      const moves = Array.from({ length: 17 }, (_, i) => ({
        items: [
          line(`P${i % 5}`, 1, `p-${catalog[i % 5]}`),
          line(`P${(i + 1) % 5}`, 1, `p-${catalog[(i + 1) % 5]}`),
        ],
        move: "deduct" as const,
      }));
      await applyOrderStockMovesBatched(f.db, moves);
      assert.ok(
        f.roundTrips <= 6,
        `expected <= 6 round trips (1 read + <=5 products), made ${f.roundTrips}`,
      );
    },
  );

  await check("skips the write entirely for a product whose net delta is zero", async () => {
    const f = fakeDb([productRow("p-alpha", "Alpha", 50), productRow("p-beta", "Beta", 50)]);
    await applyOrderStockMovesBatched(f.db, [
      { items: [line("Alpha", 3, "p-alpha")], move: "deduct" },
      { items: [line("Alpha", 3, "p-alpha")], move: "restock" },
      { items: [line("Beta", 1, "p-beta")], move: "deduct" },
    ]);
    assert.deepEqual(
      f.writes.map((w) => w.id),
      ["p-beta"],
      "a product that nets out unchanged must not be written",
    );
  });

  await check("makes no round trips at all when there is nothing to move", async () => {
    const f = fakeDb([productRow("p-alpha", "Alpha", 50)]);
    await applyOrderStockMovesBatched(f.db, []);
    assert.equal(f.roundTrips, 0);
  });

  await check("persists the netted stock value, not a per-order intermediate", async () => {
    const f = fakeDb([productRow("p-alpha", "Alpha", 10)]);
    await applyOrderStockMovesBatched(f.db, [
      { items: [line("Alpha", 2, "p-alpha")], move: "deduct" },
      { items: [line("Alpha", 3, "p-alpha")], move: "deduct" },
    ]);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].data, { stock: 5 });
  });

  await check(
    "writes a tracked variation through metadata, leaving base stock out of the patch",
    async () => {
      const f = fakeDb([
        productRow("p-alpha", "Alpha", 10, [{ name: "10mg", price: 1000, stock: 6 }]),
      ]);
      await applyOrderStockMovesBatched(f.db, [
        { items: [line("Alpha 10mg", 2, "p-alpha", "10mg")], move: "deduct" },
      ]);
      assert.equal(f.writes.length, 1);
      const data = f.writes[0].data as {
        stock?: number;
        metadata?: { variations?: { stock?: number }[] };
      };
      assert.equal(data.stock, undefined, "base column must not be patched for a tracked variation");
      assert.equal(data.metadata?.variations?.[0].stock, 4);
    },
  );

  await check("ignores a line whose product is missing from the catalog", async () => {
    const f = fakeDb([productRow("p-alpha", "Alpha", 10)]);
    await applyOrderStockMovesBatched(f.db, [
      { items: [line("Ghost", 5, "p-ghost")], move: "deduct" },
    ]);
    assert.equal(f.writes.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
