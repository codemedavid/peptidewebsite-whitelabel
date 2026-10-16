/**
 * Integration gate for pay-after-close group buys — the REAL app shop routes
 * (/api/mobile/v1/shop/*), the website's order engine and the invoice sender
 * (lib/community/gb-invoice.server.ts) against in-process PGlite. Same harness
 * as test-mobile-shop.ts.
 *
 *   npm run test:gb-invoice-flow
 *
 * Covers: the round's shipping fee replaces the courier's, once per customer
 * per round; the add-on joins the invoice with no fee; no payment is taken at
 * checkout for a round order (an on-hand order still needs one); at close the
 * customer gets ONE invoice in the store chat plus the payment images; resends
 * are idempotent and an order edited after close re-sends an updated invoice.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

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

function startPushCapture(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const messages = JSON.parse(raw || "[]") as Json[];
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const QR = "https://ik.imagekit.io/test/gotyme-qr.png";

async function main() {
  const capture = await startPushCapture();
  process.env.MOBILE_PUSH_ENDPOINT_OVERRIDE = `http://127.0.0.1:${(capture.address() as AddressInfo).port}/`;

  const ddl = execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${path.join(process.cwd(), "prisma", "schema.prisma")}" --script`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const pg = new PGlite();
  await pg.exec(ddl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const catalogGet = await h("shop/catalog/route", "GET");
  const quotePost = await h("shop/quote/route", "POST");
  const ordersPost = await h("shop/orders/route", "POST");
  const { sendGroupBuyInvoices } = await import("../src/lib/community/gb-invoice.server");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const fGb = await db.feature.create({ data: { key: "groupbuy.module" } });
  const fAssign = await db.feature.create({ data: { key: "groupbuy.product_assignment" } });
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const A = await db.tenant.create({
    data: {
      slug: "mica",
      name: "Mica",
      status: "active",
      planId: plan.id,
      featureOverrides: {
        create: [
          { featureId: fCommunity.id, enabled: true },
          { featureId: fGb.id, enabled: true },
          { featureId: fAssign.id, enabled: true },
        ],
      },
    },
  });
  const enabledAt = new Date(Date.now() - 86_400_000).toISOString();
  await db.branding.create({
    data: {
      tenantId: A.id,
      config: {
        name: "Mama Mica",
        currency: "₱",
        paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "Mica", number: "0917", qrImage: "", order: 1, active: true }],
        requireProofOfPayment: true,
        couriers: [{ id: "c-jnt", name: "J&T Express", trackingUrl: "", active: true }],
        shippingLocations: [{ id: "loc-luzon", courierId: "c-jnt", code: "LZ", name: "Luzon", price: 150, active: true }],
        groupBuyInvoice: {
          enabled: true,
          shippingFee: 250,
          enabledAt,
          paymentMethods: [
            { id: "gotyme", name: "GoTyme", details: "016793762828 - Niegel Belependio", imageUrl: QR },
            { id: "ub", name: "UnionBank", details: "109322081163 – Niegel Belependio", imageUrl: "" },
          ],
        },
      },
    },
  });
  const ann = await db.storefrontCustomer.create({
    data: { tenantId: A.id, email: "ann@buyer.test", name: "Ann Cruz", phone: "9928214519", passwordHash: hashPassword("ann-pass") },
  });
  const tmb = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "TMB",
      slug: "tmb",
      name: "MICABLEND 2.0 - 30mg of Tirzepatide and 5mg of Cagrilintide (TMB 2.0)",
      priceCents: 200000,
      stock: 0,
      metadata: { productType: "gb", gbPrice: 1690 },
    },
  });
  const rt = await db.product.create({
    data: { tenantId: A.id, sku: "RT30", slug: "rt30", name: "Retatrutide 30 MG (RT30)", priceCents: 180000, stock: 0, metadata: { productType: "gb", gbPrice: 1495 } },
  });
  const onHand = await db.product.create({ data: { tenantId: A.id, sku: "BAC", slug: "bac", name: "Bac Water", priceCents: 30000, stock: 9 } });
  const round = await db.groupBuy.create({
    data: {
      tenantId: A.id,
      name: "GB 10/2/2026",
      status: "active",
      endsAt: new Date(Date.now() + 3 * 86_400_000),
      productIds: [tmb.id, rt.id],
    },
  });

  // ── helpers ─────────────────────────────────────────────────────────────
  let ipSeq = 0;
  const req = (method: string, url: string, token?: string, body?: unknown) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    return new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  async function call(handler: Handler, r: Request) {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  const signIn = await call(login, req("POST", "/auth/login", undefined, { email: "ann@buyer.test", password: "ann-pass" }));
  assert.equal(signIn.status, 200, JSON.stringify(signIn.json));
  const tok = signIn.json.data.accessToken as string;
  const shipping = { address: "Site P4 Switzerland St.", barangay: "Ibabang Dupay", city: "Lucena City", province: "Quezon", postal: "4301", locationId: "loc-luzon" };
  let seq = 0;
  const body = (lines: Json[], over: Json = {}): Json => ({ id: `app-${++seq}`, lines, shipping, courier: "c-jnt", ...over });
  const dmMessages = async () => {
    const convo = await db.communityConversation.findFirst({ where: { tenantId: A.id } });
    if (!convo) return [];
    return db.communityMessage.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: "asc" } });
  };

  console.log("\ncheckout while the round is live");
  await test("the catalog tells the app this round is pay-after-close, with its fee", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.groupBuy?.id, round.id);
    assert.deepEqual(r.json.data.groupBuy.invoice, { shippingFee: 250 });
    await flushAfter();
  });
  await test("first order's quote: the round's flat fee replaces the courier's ₱150", async () => {
    const q = await call(quotePost, req("POST", "/shop/quote", tok, body([{ productId: tmb.id, qty: 2 }])));
    assert.equal(q.status, 200, JSON.stringify(q.json));
    assert.equal(q.json.data.shippingFee, 250);
    assert.equal(q.json.data.total, 3380 + 250);
    assert.deepEqual(q.json.data.invoice, { addOn: false, roundName: "GB 10/2/2026" });
  });
  await test("a round order is placed with no payment method and no proof", async () => {
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, body([{ productId: tmb.id, qty: 2 }])));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = await db.storefrontOrder.findFirst({ where: { orderNumber: r.json.data.order.orderNumber } });
    assert.equal(row?.groupBuyId, round.id);
    assert.equal((row?.shipping as Json).fee, 250);
    assert.equal(row?.paymentStatus, "pending");
    assert.equal(row?.paymentMethod, "Pay on invoice (group buy)", "marked for the invoice");
    assert.equal(row?.customerAccountId, ann.id, "the order is on Ann's account");
  });
  await test("ordering again in the round: an add-on, no second shipping fee", async () => {
    const q = await call(quotePost, req("POST", "/shop/quote", tok, body([{ productId: rt.id, qty: 1 }])));
    assert.equal(q.json.data?.shippingFee, 0, JSON.stringify(q.json));
    assert.equal(q.json.data.invoice?.addOn, true);
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, body([{ productId: rt.id, qty: 1 }])));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = await db.storefrontOrder.findFirst({ where: { orderNumber: r.json.data.order.orderNumber } });
    assert.equal((row?.shipping as Json).fee, 0);
  });
  await test("an on-hand order still pays at checkout", async () => {
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, body([{ productId: onHand.id, qty: 1 }])));
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error.message, "Please choose a payment method.");
  });

  console.log("\nat close");
  await test("a live round sends nothing", async () => {
    const res = await sendGroupBuyInvoices(A.id, round.id, "manual");
    assert.ok("error" in res && /closed/.test(res.error), JSON.stringify(res));
  });
  await db.groupBuy.update({ where: { id: round.id }, data: { status: "closed", closedAt: new Date() } });
  await test("closing sends ONE invoice for both orders, then the payment image", async () => {
    const res = await sendGroupBuyInvoices(A.id, round.id, "sweep");
    assert.deepEqual(res, { sent: 1, unchanged: 0, guests: 0, skipped: 0 });
    const msgs = await dmMessages();
    assert.equal(msgs.length, 2, JSON.stringify(msgs.map((m) => m.kind)));
    const [inv, img] = msgs;
    assert.equal(inv.kind, "order");
    assert.equal(inv.senderKey, "store");
    assert.equal(inv.authorKey, "bot");
    const text = inv.body ?? "";
    assert.ok(text.includes("TMB 2.0 - 2 vials = ₱3,380.00"), text);
    assert.ok(text.includes("RT30 - 1 vial = ₱1,495.00"), text);
    assert.ok(text.includes("💸 Shipping Fee: ₱250.00"), text);
    assert.ok(text.includes("Total w/ SF: ₱5,125.00"), text);
    assert.ok(text.includes("🏦 GoTyme\n016793762828 - Niegel Belependio"), text);
    assert.equal(img.kind, "image");
    assert.equal(img.imageUrl, QR);
    const convo = await db.communityConversation.findFirst({ where: { tenantId: A.id } });
    assert.ok([convo?.lowKey, convo?.highKey].includes(`c:${ann.id}`), "the store ⇄ customer DM");
  });
  await test("the automatic doors never send it twice", async () => {
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "sweep"), { sent: 0, unchanged: 1, guests: 0, skipped: 0 });
    assert.equal((await dmMessages()).length, 2);
  });
  await test("the owner's button re-sends nothing that hasn't changed", async () => {
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "manual"), { sent: 0, unchanged: 1, guests: 0, skipped: 0 });
  });
  await test("an order edited after close → the button sends the updated invoice", async () => {
    const row = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, groupBuyId: round.id, shipping: { path: ["fee"], equals: 0 } } });
    await db.storefrontOrder.update({ where: { id: row!.id }, data: { items: [{ name: "Retatrutide 30 MG (RT30)", qty: 2, price: 1495, productId: rt.id }] } });
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "manual"), { sent: 1, unchanged: 0, guests: 0, skipped: 0 });
    const msgs = await dmMessages();
    const latest = msgs.filter((m) => m.kind === "order").pop();
    assert.ok(latest?.body?.includes("Total w/ SF: ₱6,620.00"), latest?.body ?? "");
  });
  await test("an order in the round paid the ordinary way is never invoiced", async () => {
    await db.storefrontOrder.create({
      data: {
        tenantId: A.id,
        orderNumber: "PAID-1",
        groupBuyId: round.id,
        customerAccountId: ann.id,
        paymentMethod: "GCash",
        customer: { name: "Ann Cruz", phone: "9928214519" },
        shipping: { fee: 150 },
        items: [{ name: "Retatrutide 30 MG (RT30)", qty: 5, price: 1495 }],
      },
    });
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "manual"), { sent: 0, unchanged: 1, guests: 0, skipped: 0 });
  });
  await test("re-closing a reopened round sends the changed invoice; a sweep alone would not", async () => {
    const row = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, groupBuyId: round.id, paymentMethod: "Pay on invoice (group buy)", shipping: { path: ["fee"], equals: 0 } } });
    await db.storefrontOrder.update({ where: { id: row!.id }, data: { items: [{ name: "Retatrutide 30 MG (RT30)", qty: 3, price: 1495, productId: rt.id }] } });
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "sweep"), { sent: 0, unchanged: 1, guests: 0, skipped: 0 });
    assert.deepEqual(await sendGroupBuyInvoices(A.id, round.id, "close"), { sent: 1, unchanged: 0, guests: 0, skipped: 0 });
  });
  await test("guest orders are counted, not messaged", async () => {
    await db.storefrontOrder.create({
      data: {
        tenantId: A.id,
        orderNumber: "GUEST-1",
        groupBuyId: round.id,
        paymentMethod: "Pay on invoice (group buy)",
        customer: { name: "Guest", phone: "0917" },
        shipping: { fee: 250 },
        items: [{ name: "Retatrutide 30 MG (RT30)", qty: 1, price: 1495 }],
      },
    });
    const res = await sendGroupBuyInvoices(A.id, round.id, "manual");
    assert.ok(!("error" in res) && res.guests === 1, JSON.stringify(res));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  capture.close();
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
