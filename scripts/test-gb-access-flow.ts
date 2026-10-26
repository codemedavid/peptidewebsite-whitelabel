/**
 * Integration gate for gated group-buy access — the REAL app shop routes
 * (/api/mobile/v1/shop/*), the website's storefront loader, its public price
 * refresh, its order engine and the chat card, against in-process PGlite with
 * Paid Access's DB rules (src/modules/paid-access/sql/paid-access.sql) applied. The round is
 * gated by a Paid Access flow ("Pay then approve") and members walk it through
 * Paid Access's public interface — every GB surface asks Paid Access, never its tables.
 * Same harness as test-gb-invoice-flow.ts.
 *
 *   npm run test:gb-access-flow
 *
 * Covers: shoppers who aren't in (no membership / payment under review /
 * anonymous) get no round products, no gbPrice anywhere, no banner — only the
 * teaser; an active member gets the full round; checkout and quote refuse a round order without
 * approval while on-hand orders still go through; store admins see everything;
 * the chat card is the teaser; the public refresh is gated too; revoking the
 * feature reopens the round; a store without the feature is untouched.
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

async function main() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "src", "modules", "paid-access", "sql", "paid-access.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const catalogGet = await h("shop/catalog/route", "GET");
  const quotePost = await h("shop/quote/route", "POST");
  const ordersPost = await h("shop/orders/route", "POST");
  const { loadStorefrontBrand } = await import("../src/lib/storefront/storefront-brand");
  const { ADMIN_VIEWER, GB_JOIN_REQUIRED_MESSAGE } = await import("../src/lib/storefront/gb-access.server");
  const { loadShopCatalog } = await import("../src/lib/mobile/shop-catalog");
  const { loadLiveGroupBuyCard, clearLiveGroupBuyCache } = await import("../src/lib/community/group-buy-cards.server");
  const { getStorefrontProductsAction } = await import("../src/actions/products");

  // ── seed ────────────────────────────────────────────────────────────────
  const feature = (key: string) => db.feature.create({ data: { key } });
  const [fCommunity, fGb, fAssign, fPaid] = await Promise.all(
    ["mobile.community", "groupbuy.module", "groupbuy.product_assignment", "groupbuy.paid_access"].map(feature),
  );
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const grants = (ids: string[]) => ({ create: ids.map((featureId) => ({ featureId, enabled: true })) });
  const A = await db.tenant.create({
    data: { slug: "mnm", name: "MNM", status: "active", planId: plan.id, featureOverrides: grants([fCommunity.id, fGb.id, fAssign.id, fPaid.id]) },
  });
  const B = await db.tenant.create({
    data: { slug: "free", name: "Free Store", status: "active", planId: plan.id, featureOverrides: grants([fCommunity.id, fGb.id, fAssign.id]) },
  });
  const config = {
    currency: "₱",
    paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "MNM", number: "0917", qrImage: "", order: 1, active: true }],
    requireProofOfPayment: false,
    couriers: [{ id: "c-jnt", name: "J&T Express", trackingUrl: "", active: true }],
    shippingLocations: [{ id: "loc-luzon", courierId: "c-jnt", code: "LZ", name: "Luzon", price: 150, active: true }],
  };
  await db.branding.create({ data: { tenantId: A.id, config: { name: "MNM", ...config } } });
  await db.branding.create({ data: { tenantId: B.id, config: { name: "Free", ...config } } });

  const customer = (tenantId: string, email: string, name: string) =>
    db.storefrontCustomer.create({ data: { tenantId, email, name, phone: "9171234567", passwordHash: hashPassword("pass-1234") } });
  const ann = await customer(A.id, "ann@buyer.test", "Ann");
  const bea = await customer(A.id, "bea@buyer.test", "Bea");
  await customer(A.id, "cy@buyer.test", "Cy");

  const product = (tenantId: string, sku: string, priceCents: number, metadata?: Json) =>
    db.product.create({ data: { tenantId, sku, slug: sku.toLowerCase(), name: sku, priceCents, stock: 50, metadata } });
  const tirz = await product(A.id, "TIRZ", 300000, { productType: "gb", gbPrice: 1690 });
  const reta = await product(A.id, "RETA", 280000, { variations: [{ name: "10mg", price: 2800, gbPrice: 1990 }] });
  const bac = await product(A.id, "BAC", 30000);
  const freeGb = await product(B.id, "FREEGB", 300000, { productType: "gb", gbPrice: 1500 });

  const round = await db.groupBuy.create({
    data: { tenantId: A.id, name: "MNM Round 7", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tirz.id, reta.id], description: "Supplier batch TR30-B7" },
  });
  // Same shape on a store WITHOUT the feature: a saved flow must be inert there.
  const freeRound = await db.groupBuy.create({
    data: { tenantId: B.id, name: "Free Round", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [freeGb.id] },
  });

  // The round's Paid Access flow: Pay then approve, ₱500, pending members see nothing.
  const paidAccess = await import("../src/modules/paid-access");
  const { presetSettings } = await import("../src/modules/paid-access/client");
  const OWNER = { kind: "admin" as const, id: "owner", email: "owner@mnm.test" };
  const flow = { ...presetSettings("pay_then_approve"), pendingVisibility: "nothing" as const };
  const saved = await paidAccess.updateSettings({ tenantId: A.id, groupBuyId: round.id, admin: OWNER, input: { ...flow, payment: { ...flow.payment, amountCents: 50000 } } });
  assert.ok(saved.ok, JSON.stringify(saved));
  // Store B has no Paid Access feature, so its interface refuses; plant the row directly to prove it's inert.
  await db.paidAccessFlow.create({ data: { tenantId: B.id, groupBuyId: freeRound.id, settings: { ...flow, payment: { ...flow.payment, amountCents: 50000 } } } });

  // Members walk the real flow through Paid Access's interface (the DB refuses shortcuts).
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const payIn = async (c: { id: string; name: string; email: string }, reference: string) => {
    assert.ok((await paidAccess.startJoin({ tenantId: A.id, groupBuyId: round.id, customer: c })).ok);
    const p = await paidAccess.submitStep({
      tenantId: A.id,
      groupBuyId: round.id,
      customer: c,
      step: "payment",
      data: { kind: "proof", file: new File([PNG], "r.png", { type: "image/png" }), reference, method: "GCash" },
    });
    assert.ok(p.ok, JSON.stringify(p));
  };
  await payIn({ id: ann.id, name: ann.name, email: ann.email }, "GC-ANN-0001");
  await payIn({ id: bea.id, name: bea.name, email: bea.email }, "GC-BEA-0001");
  const q = await paidAccess.listQueue({ tenantId: A.id, groupBuyId: round.id, tab: "payments" });
  assert.ok(q.ok);
  const annRow = q.rows.find((r) => r.customerEmail === ann.email)!;
  assert.ok((await paidAccess.confirmPayment({ tenantId: A.id, paymentId: annRow.payment!.id, admin: OWNER, alsoApprove: true })).ok);

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
  const tokenFor = async (email: string) => {
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: "pass-1234", store: "mnm" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const annTok = await tokenFor("ann@buyer.test");
  const beaTok = await tokenFor("bea@buyer.test");
  const cyTok = await tokenFor("cy@buyer.test");
  const shipping = { address: "1 Rizal St.", barangay: "Poblacion", city: "Lucena City", province: "Quezon", postal: "4301", locationId: "loc-luzon" };
  let seq = 0;
  const body = (lines: Json[]): Json => ({ id: `app-${++seq}`, lines, shipping, courier: "c-jnt", paymentMethod: "pm-gcash" });
  const ids = (cat: Json) => (cat.products as Json[]).map((p) => p.id).sort();

  console.log("\nlocked shoppers (app catalog)");
  for (const [who, tok, status] of [["no request (Cy)", cyTok, null], ["paid, proof being checked (Bea)", beaTok, "payment_review"]] as const) {
    await test(`${who}: no round products, no group-buy prices, no banner — only the teaser`, async () => {
      const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const cat = r.json.data;
      assert.deepEqual(ids(cat), [bac.id], "only on-hand stock is listed");
      assert.equal(cat.groupBuy ?? null, null);
      assert.ok(!JSON.stringify(cat).includes("1690") && !JSON.stringify(cat).includes("1990"), "no gb price serialized");
      assert.ok(!JSON.stringify(cat).includes("TR30-B7"), "no round description");
      assert.deepEqual(cat.groupBuyTeaser, {
        id: round.id,
        name: "MNM Round 7",
        startsAt: null,
        endsAt: round.endsAt!.toISOString(),
        state: "live",
        visibility: "nothing",
        summary: null,
        steps: ["Pay ₱500", "Admin approval", "Access"],
        joinFeeCents: 50000,
        amountLabel: "₱500",
        membership: status ? { status, reviewReason: "", headline: "Step 1 of 2: Checking your payment" } : null,
        // The store's own join-page words (public text; blank = built-in).
        copy: { intro: "", button: "", note: "" },
      });
    });
  }

  console.log("\napproved member");
  await test("Ann (active member) sees the round, its products and group-buy prices", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", annTok));
    const cat = r.json.data;
    assert.deepEqual(ids(cat), [bac.id, reta.id, tirz.id].sort());
    assert.equal(cat.groupBuy?.id, round.id);
    assert.equal(cat.groupBuyTeaser ?? null, null);
    assert.equal((cat.products as Json[]).find((p) => p.id === tirz.id)?.price, 1690, "round product at its gb price");
  });

  console.log("\ncheckout (server-side, whatever the client shows)");
  await test("Cy can't quote or order a round product (hand-rolled request)", async () => {
    const q = await call(quotePost, req("POST", "/shop/quote", cyTok, body([{ productId: tirz.id, qty: 1 }])));
    assert.notEqual(q.status, 200);
    assert.match(JSON.stringify(q.json), /for members/);
    const o = await call(ordersPost, req("POST", "/shop/orders", cyTok, body([{ productId: tirz.id, qty: 1 }])));
    assert.notEqual(o.status, 200);
    assert.ok(JSON.stringify(o.json).includes(GB_JOIN_REQUIRED_MESSAGE.slice(0, 40)));
  });
  await test("the website order action: a line sent by NAME (no productId) can't sneak a round product past the gate", async () => {
    const { placeStorefrontOrderAction } = await import("../src/actions/orders");
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": "mnm.pepweb.store" };
    try {
      const res = await placeStorefrontOrderAction({
        id: "web-name-only-1",
        status: "pending",
        paymentStatus: "pending",
        paymentMethod: "GCash",
        date: new Date().toISOString(),
        customer: { name: "Sneaky", email: "sneaky@buyer.test", phone: "9171234567", contactMethod: "sms" },
        shipping: { ...shipping, country: "PH", region: "Luzon", fee: 150 },
        courier: "J&T Express",
        trackingNumber: "",
        items: [{ name: "TIRZ", qty: 1, price: 1690 }],
      });
      assert.ok("error" in res, `order went through: ${JSON.stringify(res).slice(0, 200)}`);
      assert.match(res.error, /for members/);
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  });
  await test("Bea (paid, proof not yet checked) can't order into the round either", async () => {
    const o = await call(ordersPost, req("POST", "/shop/orders", beaTok, body([{ productId: reta.id, qty: 1, variation: "10mg" }])));
    assert.notEqual(o.status, 200, JSON.stringify(o.json));
  });
  await test("a locked shopper can still buy on-hand stock", async () => {
    const o = await call(ordersPost, req("POST", "/shop/orders", cyTok, body([{ productId: bac.id, qty: 1 }])));
    assert.equal(o.status, 200, JSON.stringify(o.json));
    const row = await db.storefrontOrder.findFirst({ where: { orderNumber: o.json.data.order.orderNumber } });
    assert.equal(row?.groupBuyId, null);
  });
  await test("Ann's round order goes through, attributed and at the group-buy price", async () => {
    const o = await call(ordersPost, req("POST", "/shop/orders", annTok, body([{ productId: tirz.id, qty: 2 }])));
    assert.equal(o.status, 200, JSON.stringify(o.json));
    const row = await db.storefrontOrder.findFirst({ where: { orderNumber: o.json.data.order.orderNumber } });
    assert.equal(row?.groupBuyId, round.id);
    assert.equal((row?.items as Json[])[0].price, 1690);
  });
  await test("nothing was written for the refused orders", async () => {
    const roundOrders = await db.storefrontOrder.count({ where: { tenantId: A.id, groupBuyId: round.id } });
    assert.equal(roundOrders, 1, "only Ann's");
  });

  console.log("\nstore admins, chat card, website refresh");
  await test("store admins see the full round (they price it)", async () => {
    const { products, brand } = await loadStorefrontBrand({ tenantId: A.id, slug: "mnm", isResellerUnlocked: async () => false, groupBuyViewer: async () => ADMIN_VIEWER });
    assert.deepEqual(products.map((p) => p.id).sort(), [bac.id, reta.id, tirz.id].sort());
    assert.equal(brand.groupBuyBanner?.id, round.id);
    assert.equal(brand.groupBuyTeaser, undefined);
    const preview = await loadShopCatalog({ tenantId: A.id, slug: "mnm", customer: null }, { viewer: ADMIN_VIEWER });
    assert.equal(preview.groupBuy?.id, round.id);
  });
  await test("the app's admin routes all declare the admin viewer", async () => {
    for (const f of ["admin/brand/route.ts", "admin/menu/route.ts", "admin/storefront/route.ts"]) {
      assert.match(readFileSync(path.join(process.cwd(), "src/app/api/mobile/v1", f), "utf8"), /ADMIN_VIEWER/, f);
    }
  });
  await test("the chat card for a paid round is the teaser: no photos, prices or product count", async () => {
    clearLiveGroupBuyCache();
    const card = await loadLiveGroupBuyCard({ tenantId: A.id, slug: "mnm" } as never, { fresh: true });
    assert.ok(card, "still a live, sendable card");
    assert.equal(card!.status, "open");
    assert.deepEqual([card!.productCount, card!.fromPriceLabel, card!.images.length, card!.description], [0, null, 0, ""]);
    assert.match(card!.terms, /Members only · Pay ₱500 → Admin approval/);
  });
  await test("the website's public price refresh is gated the same way (anonymous visitor)", async () => {
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": "mnm.pepweb.store" };
    try {
      const res = await getStorefrontProductsAction();
      assert.ok("ok" in res && res.ok, JSON.stringify(res));
      assert.deepEqual(res.products.map((p) => p.id), [bac.id]);
      assert.ok(!JSON.stringify(res.products).includes("gbPrice"));
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  });

  await test("share-link previews (always anonymous crawlers) hide the round's products", async () => {
    const { productVisibleToPublic } = await import("../src/lib/storefront/gb-access.server");
    assert.equal(await productVisibleToPublic(A.id, "mnm", { id: tirz.id, productType: "gb" }), false);
    assert.equal(await productVisibleToPublic(A.id, "mnm", { id: reta.id }), false, "assigned to the live round");
    assert.equal(await productVisibleToPublic(A.id, "mnm", { id: bac.id }), true);
    assert.equal(await productVisibleToPublic(B.id, "free", { id: freeGb.id, productType: "gb" }), true, "no feature → public");
  });

  console.log("\nfail closed: a round nobody set up");
  await test("a live round with no join settings is locked for shoppers and hidden from link previews", async () => {
    const C = await db.tenant.create({
      data: { slug: "fresh", name: "Fresh Store", status: "active", planId: plan.id, featureOverrides: grants([fCommunity.id, fGb.id, fAssign.id, fPaid.id]) },
    });
    await db.branding.create({ data: { tenantId: C.id, config: { name: "Fresh", ...config } } });
    const freshGb = await product(C.id, "FRESHGB", 300000, { productType: "gb", gbPrice: 1400 });
    const freshOnHand = await product(C.id, "FRESHBAC", 30000);
    await db.groupBuy.create({ data: { tenantId: C.id, name: "Fresh Round", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [freshGb.id] } });
    const { products, brand } = await loadStorefrontBrand({ tenantId: C.id, slug: "fresh", isResellerUnlocked: async () => false, groupBuyViewer: async () => ({ kind: "anonymous" }) });
    assert.deepEqual(products.map((p) => p.id), [freshOnHand.id], "round product hidden");
    assert.ok(!JSON.stringify(products).includes("1400"), "no gb price");
    assert.equal(brand.groupBuyTeaser?.name, "Fresh Round");
    assert.equal(brand.groupBuyBanner, undefined);
    const { productVisibleToPublic } = await import("../src/lib/storefront/gb-access.server");
    assert.equal(await productVisibleToPublic(C.id, "fresh", { id: freshGb.id, productType: "gb" }), false);
  });

  console.log("\nthe feature is the switch");
  await test("a store without groupbuy.paid_access is untouched, even with a Paid Access flow saved", async () => {
    const { products, brand } = await loadStorefrontBrand({ tenantId: B.id, slug: "free", isResellerUnlocked: async () => false, groupBuyViewer: async () => ({ kind: "anonymous" }) });
    assert.deepEqual(products.map((p) => p.id), [freeGb.id]);
    assert.equal(products[0].gbPrice, 1500);
    assert.equal(brand.groupBuyTeaser, undefined);
  });
  await test("revoking the feature reopens the round for everyone", async () => {
    await db.tenantFeatureOverride.updateMany({ where: { tenantId: A.id, featureId: fPaid.id }, data: { enabled: false } });
    const r = await call(catalogGet, req("GET", "/shop/catalog", cyTok));
    assert.deepEqual(ids(r.json.data), [bac.id, reta.id, tirz.id].sort());
    assert.equal(r.json.data.groupBuyTeaser ?? null, null);
  });

  await db.$disconnect();
  await pg.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
