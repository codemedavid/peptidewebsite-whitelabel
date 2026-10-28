/**
 * Integration gate for "admin fee once per group buy" — the REAL website order
 * action (placeStorefrontOrderAction) and the checkout's preview
 * (adminFeeWaivedAction) against in-process PGlite. Same harness as
 * test-gb-payment-mode.ts.
 *
 *   npm run test:admin-fee-once-flow
 *
 * The owner's rule (mnm-pepsabuy, 2026-10-28): while a group buy is live, a
 * member checking out several times pays the ₱250 admin fee on the FIRST
 * checkout only; every later checkout in the SAME round charges just the new
 * products. A new round starts over, and a store without the switch keeps
 * charging every order.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const FEE = 250;
const PROOF = "https://ik.imagekit.io/test/proof.png";
type Buyer = { name: string; email: string; phone: string };
const BEA: Buyer = { name: "Bea Cruz", email: "bea@buyer.test", phone: "09171234567" };
const CAL: Buyer = { name: "Cal Reyes", email: "cal@buyer.test", phone: "09179999999" };

async function main() {
  const ddl = execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${path.join(process.cwd(), "prisma", "schema.prisma")}" --script`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const pg = new PGlite();
  await pg.exec(ddl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  const { placeStorefrontOrderAction, adminFeeWaivedAction } = await import("../src/actions/orders");

  // ── seed ────────────────────────────────────────────────────────────────
  const features = await Promise.all(
    ["groupbuy.module", "groupbuy.product_assignment", "storefront.admin_fee"].map((key) =>
      db.feature.create({ data: { key } }),
    ),
  );
  const plan = await db.plan.create({ data: { key: "pro", name: "Pro" } });
  const A = await db.tenant.create({
    data: {
      slug: "mnm",
      name: "MNM",
      status: "active",
      planId: plan.id,
      featureOverrides: { create: features.map((f) => ({ featureId: f.id, enabled: true })) },
    },
  });
  const adminFee = (oncePerGroupBuy: boolean) => ({
    enabled: true, label: "Admin fee", mode: "fixed", amount: FEE, percent: 0, oncePerGroupBuy,
  });
  await db.branding.create({
    data: {
      tenantId: A.id,
      config: {
        name: "MNM",
        currency: "₱",
        paymentMethods: [{ id: "pm-gotyme", name: "GoTyme", account: "MNM", number: "0917", qrImage: "", order: 1, active: true }],
        requireProofOfPayment: true,
        couriers: [],
        shippingLocations: [],
        adminFee: adminFee(true),
      },
    },
  });
  const setOnce = async (on: boolean) => {
    const row = await db.branding.findUnique({ where: { tenantId: A.id } });
    await db.branding.update({ where: { tenantId: A.id }, data: { config: { ...(row?.config as Json), adminFee: adminFee(on) } } });
  };
  const tr30 = await db.product.create({
    data: { tenantId: A.id, sku: "TR30", slug: "tr30", name: "Tirzepatide 30mg (TR30)", priceCents: 300000, stock: 0, metadata: { productType: "gb", gbPrice: 2000 } },
  });
  const tr15 = await db.product.create({
    data: { tenantId: A.id, sku: "TR15", slug: "tr15", name: "Tirzepatide 15mg (TR15)", priceCents: 200000, stock: 0, metadata: { productType: "gb", gbPrice: 1200 } },
  });
  const bac = await db.product.create({ data: { tenantId: A.id, sku: "BAC", slug: "bac", name: "Bac Water", priceCents: 30000, stock: 50 } });
  const round1 = await db.groupBuy.create({
    data: { tenantId: A.id, name: "GB November", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tr30.id, tr15.id] },
  });

  // ── website checkout, as CartCheckout sends it ─────────────────────────
  const asStore = async <T,>(fn: () => Promise<T>): Promise<T> => {
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": "mnm.pepweb.store" };
    try {
      return await fn();
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  };
  const priceOf = (id: string) => (id === tr30.id ? 2000 : id === tr15.id ? 1200 : 300);
  const nameOf = (id: string) => (id === tr30.id ? tr30.name : id === tr15.id ? tr15.name : bac.name);
  let seq = 0;
  const checkout = (buyer: Buyer, productId: string, qty: number, shownFee: number) =>
    asStore(async () => {
      const res = await placeStorefrontOrderAction({
        id: `web-${++seq}`,
        status: "new",
        paymentStatus: "paid",
        paymentMethod: "GoTyme",
        paymentProof: PROOF,
        date: new Date().toISOString(),
        customer: { ...buyer, contactMethod: "Website" },
        shipping: { address: "1 Rizal St", barangay: "Poblacion", city: "Makati", province: "Metro Manila", postal: "1200", country: "Philippines", region: "", fee: 0 },
        courier: "",
        trackingNumber: "",
        items: [{ productId, name: nameOf(productId), qty, price: priceOf(productId) }],
        adminFee: { label: shownFee ? "Admin fee" : "", amount: shownFee },
        paymentFee: { label: "", amount: 0 },
      });
      if (!("ok" in res)) throw new Error(`order refused: ${JSON.stringify(res)}`);
      const row = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, orderNumber: res.order.orderNumber } });
      if (!row) throw new Error("the order was not stored");
      return row;
    });
  const feeOf = (row: { adminFee: unknown }) => Number((row.adminFee as Json | null)?.amount ?? 0);
  const preview = (buyer: Partial<Buyer>, productId: string) =>
    asStore(() => adminFeeWaivedAction({ customer: buyer, items: [{ productId, name: nameOf(productId), qty: 1 }] }));

  console.log("\none member, several checkouts in the same live group buy");
  let firstBeaOrder = "";
  await test("1st checkout: the ₱250 admin fee is in the order total", async () => {
    assert.deepEqual(await preview(BEA, tr30.id), { waived: false }, "nothing paid yet");
    const row = await checkout(BEA, tr30.id, 2, FEE);
    firstBeaOrder = row.id;
    assert.equal(row.groupBuyId, round1.id);
    assert.equal(feeOf(row), FEE);
  });
  await test("the checkout already knows: the next cart previews with no fee", async () => {
    assert.deepEqual(await preview(BEA, tr15.id), { waived: true });
    assert.deepEqual(await preview({ phone: "+63 917 123 4567" }, tr15.id), { waived: true }, "same phone, other format");
    assert.deepEqual(await preview({ email: "BEA@buyer.test" }, tr15.id), { waived: true }, "same email, other case");
  });
  await test("2nd checkout: only the new products are charged, no fee", async () => {
    const row = await checkout(BEA, tr15.id, 1, 0);
    assert.equal(row.groupBuyId, round1.id);
    assert.equal(row.adminFee, null, "no admin fee line at all");
    assert.equal((row.items as Json[]).reduce((s, it) => s + it.qty * it.price, 0), 1200);
  });
  await test("3rd checkout with only the phone matching: still no fee", async () => {
    const row = await checkout({ ...BEA, email: "" }, tr30.id, 1, 0);
    assert.equal(row.adminFee, null);
  });
  await test("in total the member paid the fee exactly once in this round", async () => {
    const rows = await db.storefrontOrder.findMany({ where: { tenantId: A.id, groupBuyId: round1.id } });
    assert.equal(rows.length, 3);
    assert.equal(rows.reduce((s, r) => s + feeOf(r), 0), FEE);
  });

  console.log("\nother members and other orders");
  await test("a different member pays their own fee on their first checkout", async () => {
    assert.deepEqual(await preview(CAL, tr30.id), { waived: false });
    const row = await checkout(CAL, tr30.id, 1, FEE);
    assert.equal(feeOf(row), FEE);
  });
  await test("the server charges a new member's fee even if a tampered checkout showed ₱0", async () => {
    const row = await checkout({ name: "Dee", email: "dee@buyer.test", phone: "09170000001" }, tr30.id, 1, 0);
    assert.equal(feeOf(row), FEE);
  });
  await test("an on-hand order (outside the group buy) is charged as usual", async () => {
    const row = await checkout(BEA, bac.id, 1, FEE);
    assert.equal(row.groupBuyId, null);
    assert.equal(feeOf(row), FEE);
  });
  await test("if the fee-paying order is cancelled, the next checkout pays it again", async () => {
    await db.storefrontOrder.update({ where: { id: firstBeaOrder }, data: { status: "cancelled" } });
    assert.deepEqual(await preview(BEA, tr15.id), { waived: false });
    const row = await checkout(BEA, tr15.id, 1, FEE);
    assert.equal(feeOf(row), FEE);
  });

  console.log("\na new group buy starts over");
  await test("the same member pays the fee again in the next round, once", async () => {
    await db.groupBuy.update({ where: { id: round1.id }, data: { status: "closed", closedAt: new Date() } });
    const round2 = await db.groupBuy.create({
      data: { tenantId: A.id, name: "GB December", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tr30.id, tr15.id] },
    });
    assert.deepEqual(await preview(BEA, tr30.id), { waived: false });
    const first = await checkout(BEA, tr30.id, 1, FEE);
    assert.equal(first.groupBuyId, round2.id);
    assert.equal(feeOf(first), FEE);
    const second = await checkout(BEA, tr15.id, 1, 0);
    assert.equal(second.adminFee, null);
  });

  console.log("\nstores without the switch");
  await test("switch off: every checkout carries the fee, and nothing previews as waived", async () => {
    await setOnce(false);
    assert.deepEqual(await preview(BEA, tr30.id), { waived: false });
    const row = await checkout(BEA, tr30.id, 1, FEE);
    assert.equal(feeOf(row), FEE);
  });

  await db.$disconnect();
  await pg.close();
}

main()
  .catch((e) => {
    failed++;
    console.error(e);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
