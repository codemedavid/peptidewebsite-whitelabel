/**
 * Bunuan + Ligwak — what the DATABASE and the mapping layer guarantee (2A).
 *
 *   npm run test:bunuan-db
 *
 * Part 1 boots the real schema in PGlite, applies
 * src/modules/ligwak/sql/gb-allocation.sql twice (idempotent), then attacks it
 * with raw SQL: an allocation line always adds up, decisions / stages / modes
 * are from their sets, a refund only moves forward and "refunded" needs a
 * reference, and the audit trail can't be edited or deleted (but a store
 * deletion still cascades). Part 2 is the mapping layer: line stamps
 * (cancelledQty, store edits) come from the stored row only — never from a
 * checkout payload — the re-total columns map to the Order, stock moves skip
 * ligwak'd vials, and a variation's kitSize survives every product writer.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { dbOrderToStorefront, normalizeOrderInput, stockItems, type DbOrderRow } from "../src/lib/orders/db-mapping";
import { normalizeProductInput } from "../src/lib/storefront/product-input";
import { dbProductToStorefront, productToDbWrite, type DbProductRow } from "../src/lib/storefront/product-mapping";
import { buildVariationPlan } from "../src/lib/storefront/variation-plan";
import { computeOrderTotals } from "../src/storefront/admin/order-detail";
import { orderTotal as dashboardTotal } from "../src/lib/storefront/admin-dashboard";
import { orderTotal as analyticsTotal } from "../src/lib/analytics/events";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.match((e as Error).message, pattern);
    return;
  }
  assert.fail(`expected the database to refuse (${pattern})`);
}

async function database() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rules = readFileSync(path.join(process.cwd(), "src", "modules", "ligwak", "sql", "gb-allocation.sql"), "utf8");
  const pg = new PGlite();
  await pg.exec(ddl);

  console.log("\nthe rules file\n");
  await test("applies, and re-applies cleanly (idempotent)", async () => {
    await pg.exec(rules);
    await pg.exec(rules);
  });

  await pg.exec(`
    INSERT INTO plans (id, key, name) VALUES ('p_1', 'basic', 'Basic');
    INSERT INTO tenants (id, slug, name, "planId") VALUES ('t_a', 'store-a', 'Store A', 'p_1'), ('t_x', 'store-x', 'Store X', 'p_1');
    INSERT INTO group_buys (id, "tenantId", name, status) VALUES ('gb_a', 't_a', 'Round A', 'active'), ('gb_x', 't_x', 'Round X', 'active');
    INSERT INTO gb_allocations (id, "tenantId", "groupBuyId", version, "paymentMode", "updatedAt") VALUES ('al_1', 't_a', 'gb_a', 1, 'pay_later', now());
    INSERT INTO storefront_orders (id, "tenantId", "orderNumber") VALUES ('o_1', 't_a', 'A-1001'), ('o_x', 't_x', 'X-1001');
  `);
  const entry = (values: string) =>
    pg.query(`INSERT INTO gb_allocation_entries (id, "tenantId", "allocationId", "orderId", "lineIndex", "lineKey", quantity, "successQty", "cancelledQty", "suggestQty", decision, "updatedAt")
              VALUES ${values}`);

  console.log("\nallocation lines\n");
  await test("a line that adds up is stored (5 = 2 success + 3 cancelled)", async () => {
    await entry(`('e_ok', 't_a', 'al_1', 'o_1', 0, 'tirz::15mg', 5, 2, 3, 3, 'ligwak', now())`);
  });
  await test("successQty + cancelledQty must equal quantity", async () => {
    await rejects(entry(`('e_bad', 't_a', 'al_1', 'o_1', 1, 'k', 5, 2, 2, 2, 'ligwak', now())`), /gb_allocation_entries_qty_check/);
    await rejects(entry(`('e_bad', 't_a', 'al_1', 'o_1', 1, 'k', 5, 5, 1, 1, 'ligwak', now())`), /gb_allocation_entries_qty_check/);
  });
  await test("no negative vials, and a suggestion never exceeds the line", async () => {
    await rejects(entry(`('e_bad', 't_a', 'al_1', 'o_1', 1, 'k', 5, 6, -1, 0, null, now())`), /gb_allocation_entries_qty_check/);
    await rejects(entry(`('e_bad', 't_a', 'al_1', 'o_1', 1, 'k', 5, 5, 0, 6, null, now())`), /gb_allocation_entries_qty_check/);
  });
  await test("a decision is ligwak, keep, or none", async () => {
    await rejects(entry(`('e_bad', 't_a', 'al_1', 'o_1', 1, 'k', 5, 5, 0, 1, 'maybe', now())`), /gb_allocation_entries_decision_check/);
    await entry(`('e_keep', 't_a', 'al_1', 'o_1', 2, 'k', 5, 5, 0, 1, 'keep', now())`);
  });
  await test("an UPDATE that breaks the sum is refused too", async () => {
    await rejects(pg.query(`UPDATE gb_allocation_entries SET "cancelledQty" = 4 WHERE id = 'e_ok'`), /gb_allocation_entries_qty_check/);
  });
  await test("an allocation's mode is pay_first / pay_later, its version ≥ 1", async () => {
    await rejects(pg.query(`INSERT INTO gb_allocations (id, "tenantId", "groupBuyId", version, "paymentMode", "updatedAt") VALUES ('al_b', 't_a', 'gb_a', 2, 'later', now())`), /gb_allocations_mode_check/);
    await rejects(pg.query(`INSERT INTO gb_allocations (id, "tenantId", "groupBuyId", version, "paymentMode", "updatedAt") VALUES ('al_b', 't_a', 'gb_a', 0, 'pay_first', now())`), /gb_allocations_mode_check/);
  });
  await test("one allocation per round per version", async () => {
    await rejects(pg.query(`INSERT INTO gb_allocations (id, "tenantId", "groupBuyId", version, "paymentMode", "updatedAt") VALUES ('al_dup', 't_a', 'gb_a', 1, 'pay_later', now())`), /unique|duplicate/i);
  });

  console.log("\nrounds\n");
  await test("a new round starts Open; the stage is one of four", async () => {
    const r = await pg.query<{ stage: string }>(`SELECT stage FROM group_buys WHERE id = 'gb_a'`);
    assert.equal(r.rows[0].stage, "open");
    await rejects(pg.query(`UPDATE group_buys SET stage = 'ligwak' WHERE id = 'gb_a'`), /group_buys_stage_check/);
    await pg.query(`UPDATE group_buys SET stage = 'bunuan' WHERE id = 'gb_a'`);
  });
  await test("a round's payment mode is pay_first / pay_later (or not yet snapshotted)", async () => {
    await rejects(pg.query(`UPDATE group_buys SET "paymentMode" = 'invoice' WHERE id = 'gb_a'`), /group_buys_stage_check/);
    await pg.query(`UPDATE group_buys SET "paymentMode" = 'pay_first' WHERE id = 'gb_a'`);
  });

  console.log("\nrefunds\n");
  const setRefund = (sql: string) => pg.query(`UPDATE storefront_orders SET ${sql} WHERE id = 'o_1'`);
  await test("an order with no allocation reads NULL everywhere (exactly as today)", async () => {
    const r = await pg.query<Record<string, unknown>>(
      `SELECT "originalTotalCents", "adjustedTotalCents", "amountDueCents", "refundDueCents", "refundStatus", "gbTotals", "storeEditedAt" FROM storefront_orders WHERE id = 'o_1'`,
    );
    assert.ok(Object.values(r.rows[0]).every((v) => v === null), JSON.stringify(r.rows[0]));
  });
  await test("only the three refund statuses", async () => {
    await rejects(setRefund(`"refundStatus" = 'sent', "refundDueCents" = 500`), /storefront_orders_refund_check/);
  });
  await test("for_review → refund_pending → refunded (with a reference)", async () => {
    await setRefund(`"refundStatus" = 'for_review', "refundDueCents" = 500`);
    await setRefund(`"refundStatus" = 'refund_pending'`);
    await rejects(setRefund(`"refundStatus" = 'refunded'`), /storefront_orders_refund_check/);
    await setRefund(`"refundStatus" = 'refunded', "refundReference" = 'GC-881'`);
  });
  await test("never backwards, and a refunded order stays refunded", async () => {
    await rejects(setRefund(`"refundStatus" = 'refund_pending'`), /GB_REFUND_FINAL/);
    await rejects(setRefund(`"refundStatus" = NULL, "refundDueCents" = NULL`), /GB_REFUND_FINAL/);
  });
  await test("a pending refund can't jump back to for_review, nor be cleared while still due", async () => {
    await pg.query(`INSERT INTO storefront_orders (id, "tenantId", "orderNumber", "refundStatus", "refundDueCents") VALUES ('o_2', 't_a', 'A-1002', 'refund_pending', 300)`);
    await rejects(pg.query(`UPDATE storefront_orders SET "refundStatus" = 'for_review' WHERE id = 'o_2'`), /GB_REFUND_BACKWARDS/);
    await rejects(pg.query(`UPDATE storefront_orders SET "refundStatus" = NULL WHERE id = 'o_2'`), /GB_REFUND_BACKWARDS/);
  });
  await test("a for_review refund clears together with its amount (a Recalculate)", async () => {
    await pg.query(`INSERT INTO storefront_orders (id, "tenantId", "orderNumber", "refundStatus", "refundDueCents") VALUES ('o_3', 't_a', 'A-1003', 'for_review', 300)`);
    await pg.query(`UPDATE storefront_orders SET "refundStatus" = NULL, "refundDueCents" = NULL WHERE id = 'o_3'`);
  });
  await test("money columns are never negative", async () => {
    await rejects(pg.query(`UPDATE storefront_orders SET "amountDueCents" = -1 WHERE id = 'o_3'`), /storefront_orders_refund_check/);
    await rejects(pg.query(`UPDATE storefront_orders SET "adjustedTotalCents" = -1 WHERE id = 'o_3'`), /storefront_orders_refund_check/);
  });

  console.log("\nthe audit trail\n");
  await pg.exec(`
    INSERT INTO gb_audit_events (id, "tenantId", "groupBuyId", kind, actor) VALUES ('ev_1', 't_a', 'gb_a', 'stage', 'owner');
    INSERT INTO gb_audit_events (id, "tenantId", "groupBuyId", kind, actor) VALUES ('ev_x', 't_x', 'gb_x', 'stage', 'owner');
  `);
  await test("can't be edited", async () => {
    await rejects(pg.query(`UPDATE gb_audit_events SET reason = 'oops' WHERE id = 'ev_1'`), /GB_AUDIT_APPEND_ONLY/);
  });
  await test("can't be removed directly", async () => {
    await rejects(pg.query(`DELETE FROM gb_audit_events WHERE id = 'ev_1'`), /GB_AUDIT_APPEND_ONLY/);
  });
  await test("…but removing a whole store still cascades through it", async () => {
    await pg.query(`DELETE FROM tenants WHERE id = 't_x'`);
    const r = await pg.query(`SELECT id FROM gb_audit_events WHERE id = 'ev_x'`);
    assert.equal(r.rows.length, 0);
  });
  await pg.close();
}

const row = (over: Partial<DbOrderRow> = {}): DbOrderRow => ({
  id: "o1",
  orderNumber: "MNM-1001",
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "GCash",
  paymentProofUrl: null,
  customer: { name: "Ann" },
  shipping: { fee: 150 },
  items: [
    { name: "Tirz — 15mg", qty: 5, price: 100, productId: "tirz", variation: "15mg", cancelledQty: 3 },
    { name: "Tirz — 15mg", qty: 2, price: 100, productId: "tirz", variation: "15mg", addedBy: "store", changedByStore: true, placedAt: "2026-10-27T01:00:00.000Z" },
  ],
  statusHistory: [],
  adminFee: null,
  paymentFee: null,
  discount: null,
  courier: "",
  trackingNumber: "",
  shippingNote: "",
  customerNote: "",
  placedAt: new Date("2026-10-26T00:00:00.000Z"),
  ...over,
});

async function mapping() {
  console.log("\nline stamps come from the stored row only\n");
  await test("a checkout payload can't pre-cancel vials or pose as the store", () => {
    const o = normalizeOrderInput({ items: [{ name: "X", qty: 5, price: 1, cancelledQty: 5, addedBy: "store", changedByStore: true, placedAt: "2020-01-01" }] });
    assert.deepEqual(o.items, [{ name: "X", qty: 5, price: 1 }]);
  });
  await test("…nor carry a re-total", () => {
    const o = normalizeOrderInput({ adjustedTotal: 1, gbTotals: { newTotal: 1 }, refundStatus: "refunded", items: [] }) as Record<string, unknown>;
    assert.equal(o.adjustedTotal, undefined);
    assert.equal(o.gbTotals, undefined);
    assert.equal(o.refundStatus, undefined);
  });
  await test("a stored row keeps its stamps, index-aligned", () => {
    const o = dbOrderToStorefront(row());
    assert.equal(o.items[0].cancelledQty, 3);
    assert.deepEqual([o.items[1].addedBy, o.items[1].changedByStore, o.items[1].placedAt], ["store", true, "2026-10-27T01:00:00.000Z"]);
  });
  await test("a cancelledQty above the line is clamped", () => {
    const o = dbOrderToStorefront(row({ items: [{ name: "A", qty: 2, price: 1, cancelledQty: 9 }] }));
    assert.equal(o.items[0].cancelledQty, 2);
  });
  await test("stock moves cover only what survived Ligwak", () => {
    assert.deepEqual(stockItems(row().items).map((i) => i.qty), [2, 2]);
    assert.deepEqual(stockItems([{ name: "A", qty: 2, price: 1, cancelledQty: 2 }]), []);
  });

  console.log("\nthe re-total maps to every total surface\n");
  const gbTotals = { subtotal: 700, successSubtotal: 400, discount: 0, shipping: 150, adminFee: 0, paymentFee: 0, originalTotal: 850, newTotal: 550, amountDue: 550, refundDue: 0 };
  const allocated = dbOrderToStorefront(
    row({ adjustedTotalCents: 55000, amountDueCents: 55000, refundDueCents: 0, gbTotals, storeEditedAt: new Date("2026-10-27T02:00:00.000Z") }),
  );
  await test("the cents columns read back in major units", () => {
    assert.deepEqual([allocated.adjustedTotal, allocated.amountDue, allocated.refundDue], [550, 550, 0]);
    assert.equal(allocated.storeEditedAt, "2026-10-27T02:00:00.000Z");
    assert.equal(allocated.gbTotals?.originalTotal, 850);
  });
  await test("computeOrderTotals shows the re-total's breakdown", () => {
    assert.deepEqual(computeOrderTotals(allocated), { subtotal: 400, discount: 0, shipping: 150, fee: 0, paymentFee: 0, total: 550 });
  });
  await test("the dashboard and analytics totals read the re-total", () => {
    assert.equal(dashboardTotal(allocated), 550);
    assert.equal(analyticsTotal(allocated), 550);
  });
  await test("an order never allocated totals exactly as today", () => {
    const plain = dbOrderToStorefront(row({ items: [{ name: "A", qty: 2, price: 100 }] }));
    assert.equal(plain.adjustedTotal, undefined);
    assert.equal(computeOrderTotals(plain).total, 350);
    assert.equal(dashboardTotal(plain), 350);
  });
  await test("a junk refund status is dropped", () => {
    assert.equal(dbOrderToStorefront(row({ refundStatus: "sent" })).refundStatus, undefined);
  });

  console.log("\na variation's kit size survives every writer\n");
  const input = {
    id: "p1",
    name: "Tirzepatide",
    price: 1000,
    productType: "gb",
    vialsPerKit: 10,
    variations: [
      { name: "15mg", price: 1000, kitSize: 5 },
      { name: "30mg", price: 1800, kitSize: "" },
      { name: "60mg", price: 2500, kitSize: -3 },
    ],
  };
  await test("normalizeProductInput keeps a real kit size, drops blank / invalid ones", () => {
    const p = normalizeProductInput(input);
    assert.deepEqual(p.variations?.map((v) => v.kitSize), [5, undefined, undefined]);
  });
  await test("product → DB → product round-trips it", () => {
    const write = productToDbWrite(normalizeProductInput(input), "PHP", "₱");
    const back = dbProductToStorefront(
      {
        id: "p1",
        sku: "P1",
        slug: "p1",
        name: write.name,
        description: write.description,
        priceCents: write.priceCents,
        currency: "PHP",
        stock: write.stock,
        status: write.status,
        metadata: write.metadata,
      } as unknown as DbProductRow,
      "₱",
    );
    assert.deepEqual(back.variations?.map((v) => [v.name, v.kitSize]), [["15mg", 5], ["30mg", undefined], ["60mg", undefined]]);
    assert.equal(back.vialsPerKit, 10);
  });
  await test("MCP manage_product_variations sets, keeps and clears it", () => {
    const current = [{ name: "15mg", price: 1000, kitSize: 5 }, { name: "30mg", price: 1800 }];
    const set = buildVariationPlan(current, { mode: "add", variations: [{ name: "30mg", kitSize: 4 }] });
    assert.ok(!("error" in set), JSON.stringify(set));
    if ("error" in set) return;
    assert.deepEqual(set.variations.map((v) => v.kitSize), [5, 4], "an edit that doesn't name it leaves it");
    const cleared = buildVariationPlan(set.variations, { mode: "add", variations: [{ name: "15mg", kitSize: null }] });
    assert.ok(!("error" in cleared) && cleared.variations[0].kitSize === undefined);
    const bad = buildVariationPlan(current, { mode: "add", variations: [{ name: "15mg", kitSize: 2.5 }] });
    assert.ok("error" in bad && /kit size/.test(bad.error));
  });
}

async function main() {
  await database();
  await mapping();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
