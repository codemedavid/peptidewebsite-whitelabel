/**
 * Integration gate for the in-app native shop (/api/mobile/v1/shop/*) —
 * docs/mobile-admin/SHOP.md. Same harness as test-community-api.ts: the REAL
 * route handlers, auth, withTenant() and the website's own order engine
 * (placeStorefrontOrderAction / quoteStorefrontOrderAction) against in-process
 * PGlite. DATABASE_URL is forced unreachable, pushes go to a local capture
 * server, ImageKit is unconfigured (proofs round-trip as data URLs).
 *
 *   npm run test:mobile-shop
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

const PAYMENT_METHODS = [
  { id: "pm-gcash", name: "GCash", account: "Alpha Glow", number: "0917", qrImage: "", order: 1, active: true },
  { id: "pm-off", name: "Old Bank", account: "Alpha Glow", number: "123", qrImage: "", order: 2, active: false },
];
const COURIERS = [
  { id: "c-lbc", name: "LBC", trackingUrl: "", active: true },
  { id: "c-lala", name: "Lalamove", trackingUrl: "", active: true, noLocation: true },
];
const LOCATIONS = [
  { id: "loc-mm", courierId: "c-lbc", code: "MM", name: "Metro Manila", price: 150, active: true },
  { id: "loc-off", courierId: "c-lbc", code: "VIS", name: "Visayas", price: 300, active: false },
];
const PROMOS = [
  { id: "p1", code: "SECRET10", type: "percent", value: 10, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: true },
  { id: "p2", code: "DEADCODE", type: "fixed", value: 100, minPurchase: 0, usageLimit: null, used: 0, expiry: null, active: false },
];

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
  const proofPost = await h("shop/proof/route", "POST");
  const ordersPost = await h("shop/orders/route", "POST");
  const ordersGet = await h("shop/orders/route", "GET");
  const previewGet = await h("admin/storefront/route", "GET");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const fAccess = await db.feature.create({ data: { key: "storefront.access_code" } });
  const fStaff = await db.feature.create({ data: { key: "storefront.staff_accounts" } });
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth", features: { create: [{ featureId: fStaff.id }] } } });
  const mkTenant = (slug: string, community: boolean, extra: Record<string, unknown> = {}) =>
    db.tenant.create({
      data: {
        slug,
        name: slug,
        status: "active",
        planId: plan.id,
        storeAdminEmail: `owner@${slug}.test`,
        storeAdminPasswordHash: hashPassword("owner-pass"),
        featureOverrides: { create: community ? [{ featureId: fCommunity.id, enabled: true }] : [] },
        ...extra,
      },
    });
  const A = await mkTenant("alpha", true);
  const B = await mkTenant("beta", true);
  await mkTenant("gamma", false);
  const P = await mkTenant("priv", true, { accessCodeHash: hashPassword("letmein"), accessCodeVersion: 1 });
  await db.tenantFeatureOverride.create({ data: { tenantId: P.id, featureId: fAccess.id, enabled: true } });

  const alphaConfig = {
    name: "Alpha Glow",
    currency: "₱",
    categories: [{ id: "healing", label: "Healing" }, { id: "empty", label: "Nothing here" }],
    paymentMethods: PAYMENT_METHODS,
    couriers: COURIERS,
    shippingLocations: LOCATIONS,
    promoCodes: PROMOS,
    requireProofOfPayment: true,
    checkoutNote: "Pay within 24h.",
    resellerAccessCodeHash: "should-never-ship",
  };
  await db.branding.create({ data: { tenantId: A.id, config: alphaConfig } });
  await db.branding.create({ data: { tenantId: B.id, config: { name: "Beta", currency: "₱" } } });
  await db.branding.create({ data: { tenantId: P.id, config: { name: "Private", currency: "₱", accessGate: { enabled: true } } } });

  const mkCustomer = (tenantId: string, email: string, name: string, pw: string) =>
    db.storefrontCustomer.create({ data: { tenantId, email, name, phone: "0917 000 0000", passwordHash: hashPassword(pw) } });
  const ann = await mkCustomer(A.id, "ann@buyer.test", "Ann Cruz", "ann-pass");
  await mkCustomer(A.id, "bob@buyer.test", "Bob Reyes", "bob-pass");
  await mkCustomer(B.id, "carl@buyer.test", "Carl B", "carl-pass");
  await mkCustomer(P.id, "pia@buyer.test", "Pia P", "pia-pass");

  const bpc = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "BPC",
      slug: "bpc",
      name: "BPC-157",
      priceCents: 100000,
      stock: 7,
      metadata: {
        category: "healing",
        variations: [{ name: "10mg", price: 1800, stock: 3 }],
        wholesale: { enabled: true, moq: 50, price: 500 },
        reseller: { vialsOnly: 400 },
      },
    },
  });
  const sale = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "TB",
      slug: "tb",
      name: "TB-500",
      priceCents: 200000,
      stock: 2,
      metadata: { category: "healing", discountEnabled: true, discountPrice: 1500 },
    },
  });
  const paused = await db.product.create({
    data: { tenantId: A.id, sku: "PZ", slug: "pz", name: "Paused One", priceCents: 50000, stock: 9, metadata: { purchasable: false } },
  });
  await db.product.create({ data: { tenantId: A.id, sku: "DR", slug: "dr", name: "Unreleased Draft", priceCents: 1000, stock: 5, status: "draft" } });
  const bProduct = await db.product.create({ data: { tenantId: B.id, sku: "X", slug: "x", name: "Beta Thing", priceCents: 5000, stock: 5 } });
  const pProduct = await db.product.create({ data: { tenantId: P.id, sku: "Y", slug: "y", name: "Private Thing", priceCents: 5000, stock: 5 } });

  // ── helpers ─────────────────────────────────────────────────────────────
  let ipSeq = 0;
  const freshIp = () => ((globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`);
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function call(handler: Handler, r: Request) {
    freshIp();
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  const token = async (email: string, pw: string) => {
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: pw }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const annTok = await token("ann@buyer.test", "ann-pass");
  const bobTok = await token("bob@buyer.test", "bob-pass");
  const carlTok = await token("carl@buyer.test", "carl-pass");
  const piaTok = await token("pia@buyer.test", "pia-pass");
  const ownerTok = await token("owner@alpha.test", "owner-pass");

  const catalog = (qs: string, tok?: string) => call(catalogGet, req("GET", `/shop/catalog${qs}`, tok));
  const quote = (body: Json, tok?: string) => call(quotePost, req("POST", "/shop/quote", tok, body));
  const place = (body: Json, tok?: string) => call(ordersPost, req("POST", "/shop/orders", tok, body));
  const shipping = { address: "1 Main St", barangay: "Poblacion", city: "Makati", province: "NCR", postal: "1200", locationId: "loc-mm" };
  let seq = 0;
  const order = (over: Json = {}): Json => ({
    id: `app-${++seq}`,
    lines: [{ productId: sale.id, qty: 1 }],
    shipping,
    courier: "c-lbc",
    paymentMethod: "pm-gcash",
    paymentProof: "https://ik.imagekit.io/x/proof.jpg",
    ...over,
  });

  console.log("\ncatalog");
  await test("guest reads a store's catalog by store code", async () => {
    const r = await catalog("?store=alpha");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = r.json.data;
    assert.equal(d.store.slug, "alpha");
    assert.equal(d.store.name, "Alpha Glow");
    assert.equal(d.store.currency, "₱");
    assert.equal(d.open, true);
    assert.equal(d.private, false);
    assert.deepEqual(d.categories.map((c: Json) => c.id), ["healing"], "only categories with products");
    assert.equal(d.checkout.requireProofOfPayment, true);
    assert.equal(d.checkout.note, "Pay within 24h.");
    assert.deepEqual(d.checkout.paymentMethods.map((m: Json) => m.id), ["pm-gcash"], "active methods only");
    assert.deepEqual(d.checkout.shippingLocations.map((l: Json) => l.id), ["loc-mm"], "active locations only");
    assert.deepEqual(d.checkout.couriers.map((c: Json) => [c.id, c.needsLocation]), [["c-lbc", true], ["c-lala", false]]);
  });
  await test("a full store address resolves the same catalog", async () => {
    assert.equal((await catalog("?store=alpha.pepweb.store")).json.data?.store.slug, "alpha");
  });
  await test("missing store → invalid_input; unknown store → not_found", async () => {
    assert.equal((await catalog("")).status, 400);
    assert.equal((await catalog("?store=nosuchstore")).status, 404);
  });
  await test("a store without the customer app answers not_found", async () => {
    assert.equal((await catalog("?store=gamma")).status, 404);
  });
  await test("a pending store answers not_found", async () => {
    await db.tenant.create({ data: { slug: "delta", name: "Delta", status: "pending_setup", planId: plan.id } });
    assert.equal((await catalog("?store=delta")).status, 404);
  });
  await test("a private (access code) store is forbidden to guests", async () => {
    const r = await catalog("?store=priv");
    assert.equal(r.status, 403);
    assert.equal(r.json.error.message, "This store is private. Sign in to shop.");
  });
  await test("a signed-in customer of the private store can browse it", async () => {
    const r = await catalog("", piaTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.store.slug, "priv");
    assert.equal(r.json.data.products[0].id, pProduct.id);
  });
  await test("the session store wins over ?store=", async () => {
    const r = await catalog("?store=beta", annTok);
    assert.equal(r.json.data.store.slug, "alpha");
  });
  await test("a bad token is 401, an admin token is forbidden", async () => {
    assert.equal((await catalog("?store=alpha", "garbage")).status, 401);
    assert.equal((await catalog("?store=alpha", ownerTok)).status, 403);
  });
  await test("catalog never ships drafts, promo codes, reseller/wholesale data or credentials", async () => {
    const r = await catalog("?store=alpha");
    const raw = JSON.stringify(r.json);
    assert.ok(!raw.includes("Unreleased Draft"));
    assert.ok(!raw.includes("SECRET10"));
    assert.ok(!raw.includes("promo"));
    assert.ok(!raw.includes("wholesale"));
    assert.ok(!raw.includes("reseller"));
    assert.ok(!raw.includes("should-never-ship"));
    assert.ok(!raw.includes("owner@alpha.test"));
    assert.ok(!raw.includes(A.id), "no tenant id");
  });
  await test("variation prices, stock and sale price", async () => {
    const products = (await catalog("?store=alpha")).json.data.products as Json[];
    const b = products.find((p) => p.id === bpc.id)!;
    assert.equal(b.price, 1000);
    assert.equal(b.compareAtPrice, null);
    assert.equal(b.stock, 7);
    assert.equal(b.baseSelectable, true, "₱1000 base differs from the 10mg price → Standard is offered");
    assert.deepEqual(b.variations, [{ name: "10mg", price: 1800, compareAtPrice: null, stock: 3, image: null }]);
    const t = products.find((p) => p.id === sale.id)!;
    assert.equal(t.price, 1500);
    assert.equal(t.compareAtPrice, 2000);
    assert.equal(t.badge, "25% off");
    assert.equal(t.purchasable, true);
    const z = products.find((p) => p.id === paused.id)!;
    assert.equal(z.purchasable, false, "paused product listed but not buyable");
  });

  console.log("\nquote");
  await test("guest quote reprices, applies the shipping location fee", async () => {
    const r = await quote({ store: "alpha", lines: [{ productId: sale.id, qty: 2 }], courier: "c-lbc", shipping: { locationId: "loc-mm" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const q = r.json.data;
    assert.equal(q.items[0].price, 1500);
    assert.equal(q.subtotal, 3000);
    assert.equal(q.shippingFee, 150);
    assert.equal(q.courier, "LBC");
    assert.equal(q.total, 3150);
  });
  await test("a tampered client price is ignored", async () => {
    const r = await quote({ store: "alpha", lines: [{ productId: bpc.id, variation: "10mg", qty: 1, price: 1 }] });
    assert.equal(r.json.data.items[0].price, 1800);
    assert.equal(r.json.data.items[0].name, "BPC-157 — 10mg");
  });
  await test("a valid promo code discounts; an invalid one is refused", async () => {
    const ok = await quote({ store: "alpha", lines: [{ productId: sale.id, qty: 2 }], promoCode: "secret10" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.discount.amount, 300);
    assert.equal(ok.json.data.total, 2700);
    const bad = await quote({ store: "alpha", lines: [{ productId: sale.id, qty: 1 }], promoCode: "DEADCODE" });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error.message, /discount code/i);
    const unknown = await quote({ store: "alpha", lines: [{ productId: sale.id, qty: 1 }], promoCode: "NOPE" });
    assert.equal(unknown.status, 400);
  });
  await test("the quote never bumps promo usage or writes an order", async () => {
    const cfg = (await db.branding.findUnique({ where: { tenantId: A.id } }))!.config as Json;
    assert.equal(cfg.promoCodes[0].used, 0);
    assert.equal(await db.storefrontOrder.count(), 0);
  });
  await test("over-stock and unknown products fail the quote", async () => {
    const over = await quote({ store: "alpha", lines: [{ productId: sale.id, qty: 5 }] });
    assert.equal(over.status, 400);
    assert.match(over.json.error.message, /Only 2/);
    const gone = await quote({ store: "alpha", lines: [{ productId: bProduct.id, qty: 1 }] });
    assert.equal(gone.status, 400);
    const bad = await quote({ store: "alpha", lines: [] });
    assert.equal(bad.status, 400);
  });
  await test("a private store refuses guest quotes", async () => {
    assert.equal((await quote({ store: "priv", lines: [{ productId: pProduct.id, qty: 1 }] })).status, 403);
  });

  console.log("\nplace order");
  let placedNumber = "";
  await test("a customer places an order linked to their account", async () => {
    const body = order({ lines: [{ productId: sale.id, qty: 1 }], promoCode: "SECRET10", customerNote: "Ring twice" });
    const r = await place(body, annTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const o = r.json.data.order;
    placedNumber = o.orderNumber;
    assert.ok(placedNumber);
    assert.equal(o.total, 1500 - 150 + 150);
    assert.equal(o.paymentStatus, "paid");
    const row = (await db.storefrontOrder.findFirst({ where: { tenantId: A.id } }))!;
    assert.equal(row.customerAccountId, ann.id);
    assert.equal(row.paymentMethod, "GCash");
    assert.equal(row.courier, "LBC");
    assert.equal(row.customerNote, "Ring twice");
    assert.equal((row.customer as Json).name, "Ann Cruz", "contact defaults from the account");
    assert.equal((row.customer as Json).email, "ann@buyer.test");
    assert.equal((row.customer as Json).contactMethod, "App");
    await flushAfter();
    const cfg = (await db.branding.findUnique({ where: { tenantId: A.id } }))!.config as Json;
    assert.equal(cfg.promoCodes[0].used, 1, "a real placement counts the code");
  });
  await test("placement is idempotent on the client id", async () => {
    const body = order({ id: "app-idem" });
    const a = await place(body, annTok);
    const b = await place(body, annTok);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.data.order.orderNumber, b.json.data.order.orderNumber);
    assert.equal(await db.storefrontOrder.count({ where: { clientId: "app-idem" } }), 1);
  });
  await test("guests can't place orders; admins are forbidden", async () => {
    assert.equal((await place(order())).status, 401);
    assert.equal((await place(order(), ownerTok)).status, 403);
  });
  await test("an inactive or unknown payment method is refused", async () => {
    assert.equal((await place(order({ paymentMethod: "pm-off" }), annTok)).status, 400);
    assert.equal((await place(order({ paymentMethod: "nope" }), annTok)).status, 400);
  });
  await test("proof of payment is required when the store asks for it", async () => {
    const r = await place(order({ paymentProof: undefined }), annTok);
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /proof/i);
  });
  await test("over-stock is refused", async () => {
    const r = await place(order({ lines: [{ productId: bpc.id, variation: "10mg", qty: 4 }] }), annTok);
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /Only 3/);
  });
  await test("a paused product is refused", async () => {
    assert.equal((await place(order({ lines: [{ productId: paused.id, qty: 1 }] }), annTok)).status, 400);
  });
  await test("a customer of store B can't order store A's products", async () => {
    const before = await db.storefrontOrder.count({ where: { tenantId: A.id } });
    const r = await place(order({ lines: [{ productId: sale.id, qty: 1 }] }), carlTok);
    assert.equal(r.status, 400);
    assert.equal(await db.storefrontOrder.count({ where: { tenantId: A.id } }), before);
  });
  await test("a closed store refuses orders (and says so in the catalog)", async () => {
    await db.branding.update({ where: { tenantId: A.id }, data: { config: { ...alphaConfig, promoCodes: PROMOS, storeStatus: { open: false, headline: "Back Monday", message: "On a break" } } } });
    const cat = await catalog("?store=alpha");
    assert.equal(cat.json.data.open, false);
    assert.ok(cat.json.data.closedMessage);
    const r = await place(order(), annTok);
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /closed/);
    await db.branding.update({ where: { tenantId: A.id }, data: { config: alphaConfig } });
  });

  console.log("\nproof + my orders");
  await test("proof upload returns a hosted (or inline) URL", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "receipt.jpg", { type: "image/jpeg" }));
    freshIp();
    const res = await proofPost(
      new Request("https://app.pepweb.store/api/mobile/v1/shop/proof", { method: "POST", headers: { authorization: `Bearer ${annTok}` }, body: form }),
      { params: Promise.resolve({}) },
    );
    const json = (await res.json()) as Json;
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.match(json.data.url, /^(https:|data:image\/jpeg)/);
  });
  await test("proof upload needs a customer session", async () => {
    const form = new FormData();
    const res = await proofPost(new Request("https://app.pepweb.store/api/mobile/v1/shop/proof", { method: "POST", body: form }), { params: Promise.resolve({}) });
    assert.equal(res.status, 401);
  });
  await test("my orders lists the customer's own orders, newest first", async () => {
    const r = await call(ordersGet, req("GET", "/shop/orders", annTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const list = r.json.data.orders as Json[];
    assert.equal(list.length, 2);
    assert.ok(list.some((o) => o.orderNumber === placedNumber));
    assert.ok(list.every((o) => typeof o.total === "number" && o.paymentStatus && o.placedAt));
    assert.ok(!JSON.stringify(list).includes("proof.jpg"), "no proof URL in the list");
  });
  await test("my orders carry their group-buy round, and the rounds come with them", async () => {
    const round = await db.groupBuy.create({
      data: { tenantId: A.id, name: "Round 3", status: "closed", deliveryEta: "2 weeks after close", closedAt: new Date("2026-09-20T00:00:00Z") },
    });
    const row = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, orderNumber: placedNumber } });
    await db.storefrontOrder.update({ where: { id: row!.id }, data: { groupBuyId: round.id, groupBuyName: "Round 3" } });
    try {
      const r = await call(ordersGet, req("GET", "/shop/orders", annTok));
      const gb = (r.json.data.orders as Json[]).find((o) => o.orderNumber === placedNumber)!;
      assert.equal(gb.groupBuyId, round.id);
      assert.equal(gb.groupBuyName, "Round 3");
      assert.ok((r.json.data.orders as Json[]).some((o) => o.groupBuyId === null), "on-hand orders stay unfiled");
      assert.deepEqual(r.json.data.rounds, [
        {
          id: round.id,
          name: "Round 3",
          batch: "",
          state: "closed",
          deliveryEta: "2 weeks after close",
          endsAt: null,
          closedAt: "2026-09-20T00:00:00.000Z",
          // The round's stage (docs/bunuan) — a round the editor closed reads Closed.
          stage: "closed",
          stageLabel: "Closed",
          paymentDueAt: null,
          ligwakLocked: false,
        },
      ]);
    } finally {
      await db.storefrontOrder.update({ where: { id: row!.id }, data: { groupBuyId: null, groupBuyName: null } });
      await db.groupBuy.delete({ where: { id: round.id } });
    }
  });
  await test("another customer, or another store's customer, sees none of them", async () => {
    assert.equal((await call(ordersGet, req("GET", "/shop/orders", bobTok))).json.data.orders.length, 0);
    assert.equal((await call(ordersGet, req("GET", "/shop/orders", carlTok))).json.data.orders.length, 0);
    assert.equal((await call(ordersGet, req("GET", "/shop/orders", ownerTok))).status, 403);
  });

  console.log("\nstore team preview (/admin/storefront)");
  await test("the owner previews their own store's shopper catalog", async () => {
    const r = await call(previewGet, req("GET", "/admin/storefront", ownerTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const guest = (await catalog("?store=alpha")).json.data;
    assert.equal(r.json.data.store.slug, "alpha");
    assert.deepEqual(r.json.data.products.map((p: Json) => p.id), guest.products.map((p: Json) => p.id), "same listing as shoppers");
  });
  await test("a customer token or no token cannot use the admin preview", async () => {
    assert.equal((await call(previewGet, req("GET", "/admin/storefront"))).status, 401);
    assert.notEqual((await call(previewGet, req("GET", "/admin/storefront", annTok))).status, 200);
  });

  console.log("\nshopper scope");
  const { runAsAppShopper } = await import("../src/lib/auth/app-shopper-scope");
  const { getSignedInCustomer } = await import("../src/lib/auth/customer-session");
  const { getTenantIdOrNull } = await import("../src/lib/tenant/headers");
  await test("the scope names the tenant and the (active) customer", async () => {
    const got = await runAsAppShopper({ tenantId: A.id, slug: "alpha", customerId: ann.id }, async () => ({
      tenant: await getTenantIdOrNull(),
      me: await getSignedInCustomer(A.id),
    }));
    assert.equal(got.tenant, A.id);
    assert.equal(got.me?.id, ann.id);
  });
  await test("a scope for another tenant, a guest scope, or a disabled account → no customer", async () => {
    assert.equal(await runAsAppShopper({ tenantId: B.id, slug: "beta", customerId: ann.id }, () => getSignedInCustomer(A.id)), null);
    assert.equal(await runAsAppShopper({ tenantId: A.id, slug: "alpha", customerId: ann.id }, () => getSignedInCustomer(B.id)), null);
    assert.equal(await runAsAppShopper({ tenantId: A.id, slug: "alpha", customerId: null }, () => getSignedInCustomer(A.id)), null);
    await db.storefrontCustomer.update({ where: { id: ann.id }, data: { status: "disabled" } });
    assert.equal(await runAsAppShopper({ tenantId: A.id, slug: "alpha", customerId: ann.id }, () => getSignedInCustomer(A.id)), null);
  });
  await test("outside a scope the cookie path is unchanged (no cookie → null)", async () => {
    assert.equal(await getSignedInCustomer(A.id), null);
  });

  capture.close();
  await pg.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
