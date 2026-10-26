/**
 * Ligwak end to end (2A): suggest → decide → lock → totals → recalculate →
 * lock → Payment time, then pay_first refunds — through the REAL website and
 * app checkouts, the Ligwak server, the supplier report and the customer's
 * order list, against in-process PGlite (with the gb-allocation.sql rules).
 *
 *   npm run test:ligwak-flow
 *
 * pay_later round, Tirzepatide 15mg, kit 10. Ann 8 (app), Ben 5, Cara 2 →
 * 15 vials = 1 kit + 5. Oldest first: Ann's 8 + 2 of Ben's make the kit; Ben's
 * last 3 and Cara's 2 are SUGGESTED. The admin ligwaks Ben's 3 and keeps
 * Cara's 2. Lock re-totals: Ben pays for 2 (+ shipping), Ann and Cara as
 * placed; Ann's app shows "Success". Then a pay_first round: a QR PH order
 * loses 2 vials → refund of the 2 vials only (the fee stays), moved through
 * for_review → refund_pending → refunded; deducted stock comes back at the
 * lock and goes out again on Recalculate.
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
import { hashPassword } from "../src/lib/auth/password-hash";
import { withGbPaymentMode } from "../src/lib/storefront/gb-payment-mode";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

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

  const { placeStorefrontOrderAction } = await import("../src/actions/orders");
  const { getGroupBuySupplierReportAction } = await import("../src/actions/group-buys");
  const { lockLigwakAction } = await import("../src/modules/ligwak/actions");
  const L = await import("../src/modules/ligwak/server");
  const B = await import("../src/modules/bunuan/server");
  const { runAsAppActor } = await import("../src/lib/auth/app-actor-scope");
  const { toShopOrder } = await import("../src/lib/mobile/shop-orders");
  const { dbOrderToStorefront } = await import("../src/lib/orders/db-mapping");
  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const ordersPost = await h("shop/orders/route", "POST");
  const ordersGet = await h("shop/orders/route", "GET");

  // ── seed ────────────────────────────────────────────────────────────────
  const keys = ["mobile.community", "groupbuy.module", "groupbuy.product_assignment", "groupbuy.supplier_reports", "groupbuy.bunuan", "groupbuy.ligwak"];
  const features: { id: string }[] = [];
  for (const key of keys) features.push(await db.feature.create({ data: { key } }));
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const store = async (slug: string) =>
    db.tenant.create({
      data: { slug, name: slug, status: "active", planId: plan.id, featureOverrides: { create: features.map((f) => ({ featureId: f.id, enabled: true })) } },
    });
  const A = await store("mnm");
  const P = await store("pf");
  const config: Json = {
    name: "Store",
    currency: "₱",
    paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "S", number: "0917", qrImage: "", order: 1, active: true }],
    requireProofOfPayment: false,
    couriers: [{ id: "c-jnt", name: "J&T Express", trackingUrl: "", active: true }],
    shippingLocations: [{ id: "loc-luzon", courierId: "c-jnt", code: "LZ", name: "Luzon", price: 150, active: true }],
    groupBuyInvoice: { shippingFee: 250 },
  };
  await db.branding.create({ data: { tenantId: A.id, config: withGbPaymentMode(config, "pay_later") as Json } });
  await db.branding.create({ data: { tenantId: P.id, config: withGbPaymentMode(config, "pay_first") as Json } });
  await db.storefrontCustomer.create({
    data: { tenantId: A.id, email: "ann@buyer.test", name: "Ann Cruz", phone: "9928214519", passwordHash: hashPassword("ann-pass") },
  });
  const product = (tenantId: string, stock: number) =>
    db.product.create({
      data: {
        tenantId,
        sku: "TIRZ",
        slug: "tirz",
        name: "Tirzepatide",
        priceCents: 120000,
        stock,
        metadata: { productType: "gb", gbPrice: 1000, vialsPerKit: 10, variations: [{ name: "15mg", price: 1200, gbPrice: 1000 }] },
      },
    });
  const tirz = await product(A.id, 0);
  const tirzP = await product(P.id, 100);
  const roundOf = (tenantId: string, productId: string, name: string) =>
    db.groupBuy.create({ data: { tenantId, name, status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [productId] } });
  const round = await roundOf(A.id, tirz.id, "GB later");
  const roundP = await roundOf(P.id, tirzP.id, "GB first");
  const ctxA = { tenantId: A.id, actor: "owner", caps: { bunuan: true, ligwak: true } };
  const ctxP = { tenantId: P.id, actor: "staff:s1", caps: { bunuan: true, ligwak: true } };
  const stageCtx = (c: typeof ctxA) => ({ ...c, productAssignment: true });

  // ── helpers ─────────────────────────────────────────────────────────────
  const shipping = { address: "Site P4", barangay: "Ibabang Dupay", city: "Lucena City", province: "Quezon", postal: "4301", locationId: "loc-luzon" };
  let seq = 0;
  const place = async (host: string, tenantId: string, productId: string, who: string, qty: number) => {
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": `${host}.pepweb.store` };
    try {
      const r = await placeStorefrontOrderAction({
        id: `web-${++seq}`,
        status: "new",
        paymentStatus: "pending",
        paymentMethod: "GCash",
        date: new Date().toISOString(),
        customer: { name: who, email: `${who.toLowerCase()}@buyer.test`, phone: "9171234567", contactMethod: "Website" },
        shipping: { ...shipping, country: "Philippines", region: "", fee: 150 },
        courier: "J&T Express",
        trackingNumber: "",
        items: [{ productId, name: "Tirzepatide — 15mg", variation: "15mg", qty, price: 1 }],
        adminFee: { label: "", amount: 0 },
        paymentFee: { label: "", amount: 0 },
      });
      if (!("ok" in r)) throw new Error(`order refused: ${JSON.stringify(r)}`);
      return db.storefrontOrder.findFirstOrThrow({ where: { orderNumber: r.order.orderNumber, tenantId } });
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  };
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (handler: Handler, r: Request) => {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const order = (id: string) => db.storefrontOrder.findFirstOrThrow({ where: { id } });
  const review = async (ctx: typeof ctxA, roundId: string) => {
    const r = await L.reviewLigwak(ctx, roundId);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.review;
  };

  // ── pay_later: orders ───────────────────────────────────────────────────
  const signIn = await call(login, req("POST", "/auth/login", undefined, { email: "ann@buyer.test", password: "ann-pass" }));
  assert.equal(signIn.status, 200, JSON.stringify(signIn.json));
  const tok = signIn.json.data.accessToken as string;
  const appOrder = await call(
    ordersPost,
    req("POST", "/shop/orders", tok, { id: "app-1", lines: [{ productId: tirz.id, variation: "15mg", qty: 8 }], shipping, courier: "c-jnt" }),
  );
  assert.equal(appOrder.status, 200, JSON.stringify(appOrder.json));
  const ann = await db.storefrontOrder.findFirstOrThrow({ where: { orderNumber: appOrder.json.data.order.orderNumber, tenantId: A.id } });
  const ben = await place("mnm", A.id, tirz.id, "Ben", 5);
  const cara = await place("mnm", A.id, tirz.id, "Cara", 2);

  console.log("\nbefore the round closes");
  await test("Ligwak won't review an open round", async () => {
    const r = await L.decideLigwak(ctxA, round.id, []);
    assert.ok(!r.ok && /close the round/i.test(r.message), JSON.stringify(r));
  });
  await test("…and a store without Ligwak has no Ligwak at all", async () => {
    const r = await L.reviewLigwak({ ...ctxA, caps: { ligwak: false } }, round.id);
    assert.ok(!r.ok && r.code === "unavailable");
  });
  await test("the customer's lines read Pending while the round is open", async () => {
    const r = await call(ordersGet, req("GET", "/shop/orders", tok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = (r.json.data.orders as Json[]).find((x) => x.orderNumber === ann.orderNumber)!;
    assert.deepEqual([o.items[0].variation, o.items[0].lineStatus, o.items[0].lineStatusLabel], ["15mg", "pending", "Pending"]);
    assert.equal(r.json.data.rounds[0].stage, "open");
  });

  assert.ok((await B.setStage(stageCtx(ctxA), { roundId: round.id, stage: "closed" })).ok);

  console.log("\nsuggest");
  await test("15 vials @ 10: Ben's last 3 and Cara's 2 are suggested (oldest kept, split per vial)", async () => {
    const rv = await review(ctxA, round.id);
    assert.deepEqual(
      rv.suggestions.map((s) => [s.customerName, s.quantity, s.keepQty, s.suggestQty]),
      [["Ben", 5, 2, 3], ["Cara", 2, 0, 2]],
    );
    assert.deepEqual(rv.kits.map((k) => [k.vials, k.fullKits, k.keepVials, k.ligwakVials]), [[15, 1, 10, 5]]);
    assert.deepEqual([rv.undecided, rv.complete, rv.locked, rv.impact.length], [2, false, false, 0]);
  });
  await test("Lock is refused while any suggestion is undecided", async () => {
    const r = await L.lockLigwak(ctxA, round.id);
    assert.ok(!r.ok && r.code === "blocked" && /2 suggested lines need a decision/.test(r.message), JSON.stringify(r));
  });
  await test("Payment time waits for the lock", async () => {
    const r = await B.setStage(stageCtx(ctxA), { roundId: round.id, stage: "payment" });
    assert.ok(!r.ok && /lock ligwak/i.test(r.message), JSON.stringify(r));
  });

  console.log("\ndecide");
  const id = (o: { id: string }) => `${o.id}#0`;
  await test("junk decisions are refused whole", async () => {
    const r = await L.decideLigwak(ctxA, round.id, [{ entryId: id(ben), suggestQty: 3, choice: "maybe" }]);
    assert.ok(!r.ok && r.code === "invalid_input");
  });
  await test("Ben → Ligwak, Cara → Keep: complete, and the impact preview shows Ben's new total", async () => {
    const r = await L.decideLigwak(ctxA, round.id, [
      { entryId: id(ben), suggestQty: 3, choice: "ligwak" },
      { entryId: id(cara), suggestQty: 2, choice: "keep" },
    ]);
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.deepEqual([r.review.undecided, r.review.complete], [0, true]);
    assert.deepEqual(
      r.review.impact.map((i) => [i.customerName, i.originalTotal, i.newTotal, i.amountDue, i.nextAction]),
      [["Ben", 5250, 2250, 2250, "collect"]],
    );
    assert.deepEqual(r.review.suggestions.map((s) => s.decision), ["ligwak", "keep"]);
  });
  await test("a decision for a suggestion that has since changed counts as undecided", async () => {
    const r = await L.decideLigwak(ctxA, round.id, [{ entryId: id(cara), suggestQty: 1, choice: "keep" }]);
    assert.ok(r.ok && r.review.undecided === 1, JSON.stringify(r));
    const fix = await L.decideLigwak(ctxA, round.id, [{ entryId: id(cara), suggestQty: 2, choice: "keep" }]);
    assert.ok(fix.ok && fix.review.complete);
  });
  await test("decisions are saved on a draft allocation and audited", async () => {
    const alloc = await db.gbAllocation.findFirstOrThrow({ where: { groupBuyId: round.id } });
    assert.deepEqual([alloc.version, alloc.lockedAt], [1, null]);
    assert.ok((await db.gbAuditEvent.count({ where: { groupBuyId: round.id, kind: "ligwak_decide" } })) >= 2);
  });

  console.log("\nlock");
  await test("Lock (through the store-admin action) writes the allocation", async () => {
    const r = await runAsAppActor({ tenantId: A.id, slug: "mnm", subject: { kind: "owner" } }, () => lockLigwakAction(round.id));
    assert.ok(r.ok && r.review.locked, JSON.stringify(r));
    const alloc = await db.gbAllocation.findFirstOrThrow({ where: { groupBuyId: round.id } });
    assert.ok(alloc.lockedAt);
    assert.equal(alloc.lockedBy, "owner");
    const entries = await db.gbAllocationEntry.findMany({ where: { allocationId: alloc.id } });
    const byOrder = new Map(entries.map((e) => [e.orderId, e]));
    assert.deepEqual([byOrder.get(ann.id)?.successQty, byOrder.get(ann.id)?.cancelledQty], [8, 0]);
    assert.deepEqual([byOrder.get(ben.id)?.successQty, byOrder.get(ben.id)?.cancelledQty, byOrder.get(ben.id)?.decision], [2, 3, "ligwak"]);
    assert.deepEqual([byOrder.get(cara.id)?.successQty, byOrder.get(cara.id)?.decision], [2, "keep"]);
    assert.ok((await db.groupBuy.findFirstOrThrow({ where: { id: round.id } })).ligwakLockedAt);
  });
  await test("every counted order is re-totalled: Ben pays for 2 + shipping; Ann and Cara as placed", async () => {
    const b = await order(ben.id);
    assert.deepEqual([b.originalTotalCents, b.adjustedTotalCents, b.amountDueCents, b.refundDueCents, b.refundStatus], [525000, 225000, 225000, 0, null]);
    assert.equal((b.items as Json[])[0].cancelledQty, 3);
    assert.equal((b.gbTotals as Json).successSubtotal, 2000);
    const a = await order(ann.id);
    assert.deepEqual([a.originalTotalCents, a.adjustedTotalCents], [825000, 825000]);
    const c = await order(cara.id);
    assert.equal((c.items as Json[])[0].cancelledQty, undefined, "kept vials aren't cancelled");
  });
  await test("the customer's app shows each line's outcome, the old total struck next to the new", async () => {
    const r = await call(ordersGet, req("GET", "/shop/orders", tok));
    const o = (r.json.data.orders as Json[]).find((x) => x.orderNumber === ann.orderNumber)!;
    assert.deepEqual([o.items[0].lineStatus, o.items[0].successQty, o.items[0].lineStatusLabel], ["success", 8, "Success"]);
    assert.deepEqual([o.total, o.originalTotal, o.amountDue], [8250, 8250, 8250]);
    assert.equal(r.json.data.rounds[0].ligwakLocked, true);
    const benView = toShopOrder(dbOrderToStorefront((await order(ben.id)) as never), { ligwak: true });
    assert.deepEqual([benView.items[0].lineStatusLabel, benView.total, benView.originalTotal], ["2 Success · 3 Cancelled", 2250, 5250]);
  });
  await test("the supplier report counts success vials only, kits per variation", async () => {
    const r = await runAsAppActor({ tenantId: A.id, slug: "mnm", subject: { kind: "owner" } }, () => getGroupBuySupplierReportAction(round.id));
    assert.ok("ok" in r, JSON.stringify(r));
    if (!("ok" in r)) return;
    assert.deepEqual(r.productsToOrder.map((p) => { const k = p as typeof p & { vialsPerKit?: number | null; kits?: number | null }; return [k.variation, k.vials, k.vialsPerKit, k.kits]; }), [["15mg", 12, 10, 2]]);
  });
  await test("after the lock: decisions and order edits are locked, Reopen is blocked", async () => {
    const d = await L.decideLigwak(ctxA, round.id, [{ entryId: id(cara), suggestQty: 2, choice: "ligwak" }]);
    assert.ok(!d.ok && /recalculate/i.test(d.message));
    const v = await B.getRoundStage(stageCtx(ctxA), round.id);
    assert.ok(v.ok && v.round.editsLocked && v.round.reportFinal);
    if (!v.ok) return;
    assert.deepEqual(v.round.options.map((o) => `${o.stage}:${o.allowed ? "ok" : "blocked"}`), ["open:blocked", "payment:ok"]);
    const again = await L.lockLigwak(ctxA, round.id);
    assert.ok(!again.ok && /already locked/.test(again.message));
  });

  console.log("\nrecalculate");
  await test("needs a reason", async () => {
    const r = await L.recalculateLigwak(ctxA, round.id, " ");
    assert.ok(!r.ok && r.code === "invalid_input");
  });
  await test("puts every order back to un-allocated, supersedes v1, carries the decisions into v2", async () => {
    const r = await L.recalculateLigwak(ctxA, round.id, "Ben asked to keep one more");
    assert.ok(r.ok && !r.review.locked && r.review.version === 2 && r.review.complete, JSON.stringify(r));
    const b = await order(ben.id);
    assert.deepEqual([b.adjustedTotalCents, b.amountDueCents, b.gbTotals], [null, null, null]);
    assert.equal((b.items as Json[])[0].cancelledQty, undefined);
    const v1 = await db.gbAllocation.findFirstOrThrow({ where: { groupBuyId: round.id, version: 1 } });
    assert.ok(v1.supersededAt);
    assert.equal((await db.groupBuy.findFirstOrThrow({ where: { id: round.id } })).ligwakLockedAt, null);
    const ev = await db.gbAuditEvent.findFirstOrThrow({ where: { groupBuyId: round.id, kind: "ligwak_recalculate" } });
    assert.equal(ev.reason, "Ben asked to keep one more");
  });
  await test("lock v2, then Payment time with a due date", async () => {
    assert.ok((await L.lockLigwak(ctxA, round.id)).ok);
    const due = "2026-11-05T00:00:00.000Z";
    const r = await B.setStage(stageCtx(ctxA), { roundId: round.id, stage: "payment", paymentDueAt: due });
    assert.ok(r.ok && r.round.stage === "payment" && r.round.paymentDueAt === due, JSON.stringify(r));
    const o = await call(ordersGet, req("GET", "/shop/orders", tok));
    assert.deepEqual([o.json.data.rounds[0].stage, o.json.data.rounds[0].paymentDueAt], ["payment", due]);
  });
  await test("no Recalculate once Payment time started", async () => {
    const r = await L.recalculateLigwak(ctxA, round.id, "late change");
    assert.ok(!r.ok && /payment time/i.test(r.message));
  });

  // ── pay_first: refunds, stock ───────────────────────────────────────────
  console.log("\npay_first: refunds and stock");
  const gia = await place("pf", P.id, tirzP.id, "Gia", 6);
  const hal = await place("pf", P.id, tirzP.id, "Hal", 6);
  // Payment checked + confirmed (stock deducted at confirm), Hal paid by QR PH.
  const confirmed = [{ status: "new", at: new Date().toISOString() }, { status: "confirmed", at: new Date().toISOString() }];
  await db.storefrontOrder.updateMany({ where: { id: { in: [gia.id, hal.id] } }, data: { paymentStatus: "paid", status: "confirmed", statusHistory: confirmed } });
  await db.storefrontOrder.updateMany({ where: { id: hal.id }, data: { paymentFee: { label: "QR PH (2%)", amount: 128 } } });
  await db.product.updateMany({ where: { id: tirzP.id }, data: { stock: 100 - 12 } });
  const ivy = await place("pf", P.id, tirzP.id, "Ivy", 1);
  assert.ok((await B.setStage(stageCtx(ctxP), { roundId: roundP.id, stage: "closed" })).ok);

  await test("Lock is blocked while a pay_first order still awaits its payment check (listed)", async () => {
    const rv = await review(ctxP, roundP.id);
    assert.deepEqual(rv.blockers.map((b) => b.customerName), ["Ivy"]);
    const r = await L.lockLigwak(ctxP, roundP.id);
    assert.ok(!r.ok && r.code === "blocked" && r.blockers?.[0]?.orderId === ivy.id, JSON.stringify(r));
  });
  await db.storefrontOrder.updateMany({ where: { id: ivy.id }, data: { status: "cancelled" } });
  await test("12 vials @ 10: Hal's last 2 are suggested; ligwak them and lock", async () => {
    const rv = await review(ctxP, roundP.id);
    assert.deepEqual(rv.suggestions.map((s) => [s.customerName, s.suggestQty]), [["Hal", 2]]);
    assert.ok((await L.decideLigwak(ctxP, roundP.id, [{ entryId: `${hal.id}#0`, suggestQty: 2, choice: "ligwak" }])).ok);
    const r = await L.lockLigwak(ctxP, roundP.id);
    assert.ok(r.ok, JSON.stringify(r));
  });
  await test("Hal is refunded the 2 vials only — the QR PH fee is kept", async () => {
    const o = await order(hal.id);
    // 6 × 1000 + 150 shipping + 128 QR PH = 6278 paid; 4 × 1000 + 150 + 128 = 4278 kept.
    assert.deepEqual([o.originalTotalCents, o.adjustedTotalCents, o.refundDueCents, o.amountDueCents, o.refundStatus], [627800, 427800, 200000, 0, "for_review"]);
    assert.equal((o.gbTotals as Json).paymentFee, 128);
  });
  await test("the ligwak'd vials of a deducted order go back into stock", async () => {
    assert.equal((await db.product.findFirstOrThrow({ where: { id: tirzP.id } })).stock, 90);
  });
  await test("refund: for_review → refund_pending; refunded needs a reference; nothing to refund on a kept order", async () => {
    const noRef = await L.setRefundStatus(ctxP, { orderId: hal.id, status: "refunded", reference: "" });
    assert.ok(!noRef.ok && noRef.code === "invalid_input");
    const pend = await L.setRefundStatus(ctxP, { orderId: hal.id, status: "refund_pending" });
    assert.ok(pend.ok && pend.refund.status === "refund_pending", JSON.stringify(pend));
    const none = await L.setRefundStatus(ctxP, { orderId: gia.id, status: "refund_pending" });
    assert.ok(!none.ok && /no refund due/.test(none.message), "Gia owes nothing back");
  });
  await test("Recalculate is refused once a refund is on its way", async () => {
    const r = await L.recalculateLigwak(ctxP, roundP.id, "mistake");
    assert.ok(!r.ok && r.code === "blocked" && r.message.includes(hal.orderNumber), JSON.stringify(r));
  });
  await test("refunded with the reference, never backwards; the refunds list shows the whole trail", async () => {
    const done = await L.setRefundStatus(ctxP, { orderId: hal.id, status: "refunded", reference: "GC-77812" });
    assert.ok(done.ok, JSON.stringify(done));
    const back = await L.setRefundStatus(ctxP, { orderId: hal.id, status: "refund_pending" });
    assert.ok(!back.ok);
    const list = await L.listRefunds(ctxP, roundP.id);
    assert.ok(list.ok, JSON.stringify(list));
    if (!list.ok) return;
    assert.deepEqual(
      list.refunds.map((r) => [r.customerName, r.amountPaid, r.refundDue, r.status, r.reference]),
      [["Hal", 6278, 2000, "refunded", "GC-77812"]],
    );
    assert.deepEqual(list.refunds[0].trail.map((s) => [s.status, s.by]), [["for_review", "staff:s1"], ["refund_pending", "staff:s1"], ["refunded", "staff:s1"]]);
  });

  console.log("\nrecalculate puts stock back out");
  const R = await store("rc");
  await db.branding.create({ data: { tenantId: R.id, config: withGbPaymentMode(config, "pay_first") as Json } });
  const tirzR = await product(R.id, 100);
  const roundR = await roundOf(R.id, tirzR.id, "GB rc");
  const ctxR = { tenantId: R.id, actor: "owner", caps: { bunuan: true, ligwak: true } };
  const jo = await place("rc", R.id, tirzR.id, "Jo", 13);
  await db.storefrontOrder.updateMany({ where: { id: jo.id }, data: { paymentStatus: "paid", status: "confirmed", statusHistory: confirmed } });
  await db.product.updateMany({ where: { id: tirzR.id }, data: { stock: 87 } });
  assert.ok((await B.setStage(stageCtx(ctxR), { roundId: roundR.id, stage: "closed" })).ok);
  assert.ok((await L.decideLigwak(ctxR, roundR.id, [{ entryId: `${jo.id}#0`, suggestQty: 3, choice: "ligwak" }])).ok);
  await test("lock restocks 3, Recalculate takes them out again", async () => {
    assert.ok((await L.lockLigwak(ctxR, roundR.id)).ok);
    assert.equal((await db.product.findFirstOrThrow({ where: { id: tirzR.id } })).stock, 90);
    assert.ok((await L.recalculateLigwak(ctxR, roundR.id, "re-run")).ok);
    assert.equal((await db.product.findFirstOrThrow({ where: { id: tirzR.id } })).stock, 87);
    assert.equal(((await order(jo.id)).items as Json[])[0].cancelledQty, undefined);
  });

  await db.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
