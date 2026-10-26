/**
 * Admin order-line edits on group-buy orders (2A: editOrderLinesAction /
 * modules/bunuan/server/order-edit.ts), against in-process PGlite.
 *
 *   npm run test:gb-order-edit
 *
 *   • prices never come from the browser: a kept line holds its snapshot
 *     price, extra vials are priced from the live catalog (the round's gbPrice)
 *     and appended as their own store-stamped line;
 *   • preview saves nothing; a save stamps storeEditedAt, audits the changes,
 *     and the customer sees "Changed by the store";
 *   • past the Bunuan allowance is allowed, with a warning — and an edit that
 *     fills the last kit closes Bunuan like a checkout would;
 *   • a deducted order moves stock by exactly the change;
 *   • a stale editor gets "conflict"; edits lock at Payment time and while
 *     Ligwak is locked; staff need `groupbuys` or `orders`.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/pglite-only";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "pepweb.store";
process.env.TENANT_ADMIN_SECRET = "test-secret";
delete process.env.EXPO_ACCESS_TOKEN;
delete process.env.IMAGEKIT_PRIVATE_KEY;

import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { withGbPaymentMode } from "../src/lib/storefront/gb-payment-mode";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

async function main() {
  const ddl = execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${path.join(process.cwd(), "prisma", "schema.prisma")}" --script`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "src/modules/ligwak/sql/gb-allocation.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const { editOrderLinesAction } = await import("../src/modules/bunuan/actions");
  const B = await import("../src/modules/bunuan/server");
  const L = await import("../src/modules/ligwak/server");
  const { runAsAppActor } = await import("../src/lib/auth/app-actor-scope");
  const { toShopOrder } = await import("../src/lib/mobile/shop-orders");
  const { dbOrderToStorefront } = await import("../src/lib/orders/db-mapping");

  // ── seed ────────────────────────────────────────────────────────────────
  const keys = ["groupbuy.module", "groupbuy.product_assignment", "groupbuy.bunuan", "groupbuy.ligwak"];
  const features = [];
  for (const key of keys) features.push(await db.feature.create({ data: { key } }));
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const A = await db.tenant.create({
    data: { slug: "mnm", name: "MNM", status: "active", planId: plan.id, featureOverrides: { create: features.map((f) => ({ featureId: f.id, enabled: true })) } },
  });
  await db.branding.create({ data: { tenantId: A.id, config: withGbPaymentMode({ name: "MNM", currency: "₱" }, "pay_later") as Json } });
  const tirz = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "TIRZ",
      slug: "tirz",
      name: "Tirzepatide",
      priceCents: 120000,
      stock: 50,
      metadata: {
        productType: "gb",
        gbPrice: 1000,
        vialsPerKit: 10,
        variations: [
          { name: "15mg", price: 1200, gbPrice: 1100 },
          { name: "30mg", price: 2000, gbPrice: 1800, kitSize: 5 },
        ],
      },
    },
  });
  const round = await db.groupBuy.create({ data: { tenantId: A.id, name: "GB", status: "active", stage: "bunuan", productIds: [tirz.id] } });
  let n = 1000;
  const line = (variation: string, qty: number, price: number) => ({ name: `Tirzepatide — ${variation}`, qty, price, productId: tirz.id, variation });
  const orderOf = (who: string, items: Json[], extra: Json = {}) =>
    db.storefrontOrder.create({
      data: {
        tenantId: A.id,
        orderNumber: `MNM-${++n}`,
        groupBuyId: round.id,
        customer: { name: who },
        shipping: { fee: 250 },
        items,
        statusHistory: [{ status: "new", at: new Date().toISOString() }],
        ...extra,
      },
    });
  // Placed when 15mg sold at ₱1000 — the catalog's 15mg is ₱1100 now.
  const ann = await orderOf("Ann", [line("15mg", 5, 1000)]);
  const ben = await orderOf("Ben", [line("15mg", 8, 1000), line("30mg", 5, 1800)], {
    status: "confirmed",
    paymentStatus: "paid",
    statusHistory: [{ status: "new", at: new Date().toISOString() }, { status: "confirmed", at: new Date().toISOString() }],
  });
  // 15mg: 13 vials → 7 open. 30mg: 5 → exact.
  const ctx = { tenantId: A.id, actor: "owner", caps: { bunuan: true, ligwak: true }, productAssignment: true };
  const edit = (orderId: string, lines: unknown, opts: Json = {}) => B.editOrderLines(ctx, { orderId, lines, ...opts });
  const row = (id: string) => db.storefrontOrder.findFirstOrThrow({ where: { id } });
  const stock = async () => (await db.product.findFirstOrThrow({ where: { id: tirz.id } })).stock;

  console.log("\npricing");
  await test("preview: raising 5 → 7 keeps the 5 at ₱1000 and prices the 2 new vials from the catalog (₱1100)", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 7 }], { preview: true });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.saved, false);
    assert.deepEqual(r.lines.map((l) => [l.qty, l.price, l.addedByStore]), [[5, 1000, false], [2, 1100, true]]);
    assert.deepEqual([r.subtotal, r.total], [7200, 7450]);
    assert.deepEqual(r.changes.map((c) => [c.kind, c.fromQty, c.toQty]), [["added", 0, 2]]);
  });
  await test("…and saved nothing", async () => {
    const o = await row(ann.id);
    assert.equal((o.items as Json[]).length, 1);
    assert.equal(o.storeEditedAt, null);
    assert.equal(await db.gbAuditEvent.count({ where: { kind: "order_edit" } }), 0);
  });
  await test("a price sent by the browser is ignored", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 5, price: 1 }, { productId: tirz.id, variation: "15mg", qty: 1, price: 1 }], { preview: true });
    assert.ok(r.ok && r.lines[1].price === 1100, JSON.stringify(r));
  });
  await test("junk is refused: an unknown option, a bad qty, a line that isn't on the order, an empty order", async () => {
    const unknown = await edit(ann.id, [{ index: 0, qty: 5 }, { productId: tirz.id, variation: "90mg", qty: 1 }], { preview: true });
    assert.ok(!unknown.ok && /no "90mg" option/.test(unknown.message), JSON.stringify(unknown));
    const bad = await edit(ann.id, [{ index: 0, qty: 2.5 }], { preview: true });
    assert.ok(!bad.ok && bad.code === "invalid_input");
    const stray = await edit(ann.id, [{ index: 4, qty: 1 }], { preview: true });
    assert.ok(!stray.ok);
    const empty = await edit(ann.id, [], { preview: true });
    assert.ok(!empty.ok && /cancel the order instead/.test(empty.message));
  });

  console.log("\nsave, Bunuan warning, audit");
  await test("adding 9 vials goes past the 7 open in Bunuan — allowed, with a warning", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 5 }, { productId: tirz.id, variation: "15mg", qty: 9 }], { preview: true });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /adding 9 vials, but only 7 vials are open in Bunuan/);
  });
  let annUpdatedAt = "";
  await test("save: lines written, storeEditedAt stamped, the change audited", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 7 }], { expectedUpdatedAt: ann.updatedAt.toISOString() });
    assert.ok(r.ok && r.saved, JSON.stringify(r));
    if (!r.ok) return;
    annUpdatedAt = r.updatedAt;
    const o = await row(ann.id);
    assert.deepEqual(
      (o.items as Json[]).map((i) => [i.qty, i.price, i.addedBy ?? null, i.changedByStore ?? false]),
      [[5, 1000, null, false], [2, 1100, "store", true]],
    );
    assert.ok(o.storeEditedAt);
    const ev = await db.gbAuditEvent.findFirstOrThrow({ where: { orderId: ann.id, kind: "order_edit" } });
    assert.equal(ev.actor, "owner");
    assert.deepEqual(((ev.data as Json).changes as Json[]).map((c) => c.kind), ["added"]);
  });
  await test("the customer sees 'Changed by the store' on the line and the order", async () => {
    const view = toShopOrder(dbOrderToStorefront((await row(ann.id)) as never), { ligwak: true });
    assert.equal(view.changedByStore, true);
    assert.deepEqual(view.items.map((i) => i.changedByStore ?? false), [false, true]);
  });
  await test("a stale editor gets a conflict instead of overwriting", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 5 }], { expectedUpdatedAt: ann.updatedAt.toISOString() });
    assert.ok(!r.ok && r.code === "conflict", JSON.stringify(r));
  });

  console.log("\nstock");
  await test("a confirmed (deducted) order: lowering 8 → 6 puts 2 back, removing the 30mg line puts 5 back", async () => {
    const before = await stock();
    const r = await edit(ben.id, [{ index: 0, qty: 6 }]);
    assert.ok(r.ok && r.saved, JSON.stringify(r));
    assert.equal(await stock(), before + 7);
    const o = await row(ben.id);
    assert.deepEqual((o.items as Json[]).map((i) => [i.variation, i.qty, i.changedByStore ?? false, i.originalQty ?? null]), [["15mg", 6, true, 8]]);
  });
  await test("…and raising it again takes them out", async () => {
    const before = await stock();
    const r = await edit(ben.id, [{ index: 0, qty: 7 }]);
    assert.ok(r.ok && r.saved, JSON.stringify(r));
    assert.equal(await stock(), before - 1);
  });
  await test("an unconfirmed order moves no stock", async () => {
    const before = await stock();
    const r = await edit(ann.id, [{ index: 0, qty: 5 }, { index: 1, qty: 1 }], { expectedUpdatedAt: annUpdatedAt });
    assert.ok(r.ok && r.saved, JSON.stringify(r));
    assert.equal(await stock(), before);
  });

  console.log("\nan edit that fills the last kit ends Bunuan");
  await test("15mg is at 5 + 1 + 7 = 13; adding 7 to Ann makes 20 → the round closes by itself", async () => {
    const r = await edit(ann.id, [{ index: 0, qty: 5 }, { index: 1, qty: 1 }, { productId: tirz.id, variation: "15mg", qty: 7 }]);
    assert.ok(r.ok && r.saved, JSON.stringify(r));
    const g = await db.groupBuy.findFirstOrThrow({ where: { id: round.id } });
    assert.deepEqual([g.stage, g.status], ["closed", "closed"]);
    const ev = await db.gbAuditEvent.findFirstOrThrow({ where: { groupBuyId: round.id, kind: "stage", actor: "system" } });
    assert.equal((ev.data as Json).byEdit, true);
  });

  console.log("\nlocks");
  await test("while Ligwak is locked, edits are refused (Recalculate first)", async () => {
    const lctx = { tenantId: A.id, actor: "owner", caps: { ligwak: true } };
    const rv = await L.reviewLigwak(lctx, round.id);
    assert.ok(rv.ok, JSON.stringify(rv));
    if (!rv.ok) return;
    const decisions = rv.review.suggestions.map((s) => ({ entryId: s.entryId, suggestQty: s.suggestQty, choice: "keep" as const }));
    assert.ok((await L.decideLigwak(lctx, round.id, decisions)).ok);
    assert.ok((await L.lockLigwak(lctx, round.id)).ok);
    const r = await edit(ann.id, [{ index: 0, qty: 4 }]);
    assert.ok(!r.ok && /Recalculate/.test(r.message), JSON.stringify(r));
  });
  await test("at Payment time edits are refused", async () => {
    assert.ok((await B.setStage(ctx, { roundId: round.id, stage: "payment" })).ok);
    const r = await edit(ann.id, [{ index: 0, qty: 4 }], { preview: true });
    assert.ok(!r.ok && /Payment time/.test(r.message), JSON.stringify(r));
  });
  await test("an on-hand order (no round) can't be edited here", async () => {
    const o = await db.storefrontOrder.create({ data: { tenantId: A.id, orderNumber: "MNM-9", items: [line("15mg", 1, 1000)] } });
    const r = await edit(o.id, [{ index: 0, qty: 2 }], { preview: true });
    assert.ok(!r.ok && r.code === "unavailable");
  });
  await test("a store without Bunuan / Ligwak has no order editor", async () => {
    const r = await B.editOrderLines({ ...ctx, caps: { bunuan: false, ligwak: false } }, { orderId: ann.id, lines: [] });
    assert.ok(!r.ok && r.code === "unavailable");
  });

  console.log("\npermissions (the store-admin action)");
  const staff = async (permissions: string[]) =>
    db.storefrontStaff.create({
      data: { tenantId: A.id, fullName: "S", email: `s${permissions.join("")}@mnm.test`, username: `s${permissions.join("")}`, passwordHash: "x", permissions },
    });
  const ordersOnly = await staff(["orders"]);
  const productsOnly = await staff(["products"]);
  const asStaff = (id: string) => (fn: () => Promise<unknown>) =>
    runAsAppActor({ tenantId: A.id, slug: "mnm", subject: { kind: "staff", id } }, fn as () => Promise<Json>);
  await test("staff with `orders` may use it", async () => {
    const r = (await asStaff(ordersOnly.id)(() => editOrderLinesAction(ann.id, [{ index: 0, qty: 4 }], { preview: true }))) as Json;
    assert.equal(r.code, "conflict", JSON.stringify(r)); // reached the rules (Payment time), not refused at the door
  });
  await test("staff without `groupbuys` or `orders` may not", async () => {
    const r = (await asStaff(productsOnly.id)(() => editOrderLinesAction(ann.id, [{ index: 0, qty: 4 }], { preview: true }))) as Json;
    assert.equal(r.code, "forbidden", JSON.stringify(r));
  });

  await db.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
