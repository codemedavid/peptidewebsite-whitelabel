/**
 * Gate for the group-buy payment mode (lib/storefront/gb-payment-mode.ts):
 * "pay before checkout" vs "pay after close", one per-store setting that the
 * website checkout, the app shop and the placement stamp all read.
 *
 *   npm run test:gb-payment-mode
 *
 * Part 1 is pure: the fallback for stores that predate the setting, the writers
 * that keep the mode and the invoice switch in step, the cart predicate, and the
 * app's byte-identical copy. Part 2 runs the REAL website order action and the
 * REAL app shop routes against in-process PGlite (same harness as
 * test-gb-invoice-flow.ts): a pay-after-close round order placed on the WEBSITE
 * needs no payment method and no proof, an on-hand order still pays, a stale tab
 * that already uploaded a proof keeps it, and switching the store to pay first
 * puts both the website and the app back on pay-at-checkout.
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
import {
  gbPaymentModeFor,
  isPayLaterCart,
  normalizeGbPaymentMode,
  syncGbPaymentModeToInvoice,
  withGbPaymentMode,
} from "../src/lib/storefront/gb-payment-mode";

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

const INVOICE_METHOD = "Pay on invoice (group buy)";

async function pure() {
  console.log("\nthe mode");
  await test("only the two modes are modes", () => {
    assert.equal(normalizeGbPaymentMode("pay_first"), "pay_first");
    assert.equal(normalizeGbPaymentMode("pay_later"), "pay_later");
    assert.equal(normalizeGbPaymentMode("later"), null);
    assert.equal(normalizeGbPaymentMode(undefined), null);
  });
  await test("a store with nothing set pays first", () => {
    assert.equal(gbPaymentModeFor(undefined), "pay_first");
    assert.equal(gbPaymentModeFor({}), "pay_first");
    assert.equal(gbPaymentModeFor("garbage"), "pay_first");
  });
  await test("a store that predates the setting keeps its invoice switch's answer", () => {
    assert.equal(gbPaymentModeFor({ groupBuyInvoice: { enabled: true } }), "pay_later");
    assert.equal(gbPaymentModeFor({ groupBuyInvoice: { enabled: false } }), "pay_first");
    assert.equal(gbPaymentModeFor({ groupBuyInvoice: { enabled: "yes" } }), "pay_first", "only a real true counts");
  });
  await test("an explicit mode wins over the invoice switch", () => {
    assert.equal(gbPaymentModeFor({ groupBuyPayment: { mode: "pay_first" }, groupBuyInvoice: { enabled: true } }), "pay_first");
    assert.equal(gbPaymentModeFor({ groupBuyPayment: { mode: "pay_later" }, groupBuyInvoice: { enabled: false } }), "pay_later");
  });
  await test("a garbage mode falls back instead of guessing", () => {
    assert.equal(gbPaymentModeFor({ groupBuyPayment: { mode: "soon" }, groupBuyInvoice: { enabled: true } }), "pay_later");
  });

  console.log("\nsaving keeps the invoice switch in step");
  const now = new Date("2026-10-26T08:00:00.000Z");
  await test("pay_later turns the invoice on and stamps enabledAt", () => {
    const next = withGbPaymentMode({ name: "Mica", groupBuyInvoice: { shippingFee: 250 } }, "pay_later", now);
    assert.deepEqual(next.groupBuyPayment, { mode: "pay_later" });
    assert.deepEqual(next.groupBuyInvoice, { shippingFee: 250, enabled: true, enabledAt: now.toISOString() });
    assert.equal(next.name, "Mica", "the rest of the config is carried over");
  });
  await test("an invoice already on keeps its enabledAt (old rounds stay un-invoiced)", () => {
    const next = withGbPaymentMode({ groupBuyInvoice: { enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" } }, "pay_later", now);
    assert.equal((next.groupBuyInvoice as Json).enabledAt, "2026-10-01T00:00:00.000Z");
  });
  await test("pay_first turns the invoice off and keeps its settings", () => {
    const next = withGbPaymentMode({ groupBuyInvoice: { enabled: true, enabledAt: "2026-10-01T00:00:00.000Z", shippingFee: 250 } }, "pay_first", now);
    assert.deepEqual(next.groupBuyPayment, { mode: "pay_first" });
    assert.deepEqual(next.groupBuyInvoice, { enabled: false, enabledAt: "2026-10-01T00:00:00.000Z", shippingFee: 250 });
  });
  await test("the saved config reads back as the saved mode", () => {
    assert.equal(gbPaymentModeFor(withGbPaymentMode({ groupBuyInvoice: { enabled: true } }, "pay_first", now)), "pay_first");
    assert.equal(gbPaymentModeFor(withGbPaymentMode({}, "pay_later", now)), "pay_later");
  });
  await test("an invoice save moves the mode with the switch (older app builds)", () => {
    assert.deepEqual(syncGbPaymentModeToInvoice({ groupBuyPayment: { mode: "pay_first" }, groupBuyInvoice: { enabled: true } }).groupBuyPayment, { mode: "pay_later" });
    assert.deepEqual(syncGbPaymentModeToInvoice({ groupBuyPayment: { mode: "pay_later" }, groupBuyInvoice: { enabled: false } }).groupBuyPayment, { mode: "pay_first" });
  });
  await test("the writers never touch their input", () => {
    const input = { groupBuyPayment: { mode: "pay_first" }, groupBuyInvoice: { enabled: false } };
    const snapshot = JSON.stringify(input);
    withGbPaymentMode(input, "pay_later", now);
    syncGbPaymentModeToInvoice(input);
    assert.equal(JSON.stringify(input), snapshot);
  });

  console.log("\nwhich carts skip the payment step");
  const round = { coversAll: false, productIds: ["tmb", "rt"] };
  await test("a round cart in a pay-later store", () => assert.equal(isPayLaterCart("pay_later", round, ["tmb"]), true));
  await test("an on-hand cart pays", () => assert.equal(isPayLaterCart("pay_later", round, ["bac"]), false));
  await test("a pay-first store always pays", () => assert.equal(isPayLaterCart("pay_first", round, ["tmb"]), false));
  await test("no live round, nothing to pay later for", () => assert.equal(isPayLaterCart("pay_later", null, ["tmb"]), false));
  await test("a round covering the whole catalog takes any cart", () =>
    assert.equal(isPayLaterCart("pay_later", { coversAll: true, productIds: [] }, ["bac"]), true));
  await test("an empty cart is not a round cart", () => assert.equal(isPayLaterCart("pay_later", round, []), false));

  console.log("\nthe app's copy");
  await test("mobile payment-mode.ts is byte-identical to the server's", () => {
    const server = readFileSync(path.join(process.cwd(), "src/lib/storefront/gb-payment-mode.ts"), "utf8");
    const app = readFileSync(path.join(process.cwd(), "mobile/src/features/admin/group-buys/payment-mode.ts"), "utf8");
    assert.ok(server === app, "copy src/lib/storefront/gb-payment-mode.ts over the app's payment-mode.ts");
  });
}

async function flow() {
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
  const ordersPost = await h("shop/orders/route", "POST");
  const { placeStorefrontOrderAction } = await import("../src/actions/orders");
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
  const baseConfig: Json = {
    name: "Mama Mica",
    currency: "₱",
    paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "Mica", number: "0917", qrImage: "", order: 1, active: true }],
    requireProofOfPayment: true,
    couriers: [{ id: "c-jnt", name: "J&T Express", trackingUrl: "", active: true }],
    shippingLocations: [{ id: "loc-luzon", courierId: "c-jnt", code: "LZ", name: "Luzon", price: 150, active: true }],
    groupBuyInvoice: { shippingFee: 250 },
  };
  await db.branding.create({ data: { tenantId: A.id, config: withGbPaymentMode(baseConfig, "pay_later") as Json } });
  const writeConfig = async (patch: (config: Json) => Json) => {
    const row = await db.branding.findUnique({ where: { tenantId: A.id } });
    await db.branding.update({ where: { tenantId: A.id }, data: { config: patch((row?.config ?? {}) as Json) } });
  };
  await db.storefrontCustomer.create({
    data: { tenantId: A.id, email: "ann@buyer.test", name: "Ann Cruz", phone: "9928214519", passwordHash: hashPassword("ann-pass") },
  });
  const tmb = await db.product.create({
    data: { tenantId: A.id, sku: "TMB", slug: "tmb", name: "MICABLEND 2.0 (TMB 2.0)", priceCents: 200000, stock: 0, metadata: { productType: "gb", gbPrice: 1690 } },
  });
  const onHand = await db.product.create({ data: { tenantId: A.id, sku: "BAC", slug: "bac", name: "Bac Water", priceCents: 30000, stock: 9 } });
  const round = await db.groupBuy.create({
    data: { tenantId: A.id, name: "GB 10/26", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tmb.id] },
  });

  // ── website ────────────────────────────────────────────────────────────
  const shipping = { address: "Site P4 Switzerland St.", barangay: "Ibabang Dupay", city: "Lucena City", province: "Quezon", postal: "4301", locationId: "loc-luzon" };
  let seq = 0;
  const webOrder = async (productId: string, name: string, price: number, pay: { method: string; proof: string | null }) => {
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": "mica.pepweb.store" };
    try {
      const res = await placeStorefrontOrderAction({
        id: `web-${++seq}`,
        status: "new",
        paymentStatus: pay.proof ? "paid" : "pending",
        paymentMethod: pay.method,
        ...(pay.proof ? { paymentProof: pay.proof } : {}),
        date: new Date().toISOString(),
        customer: { name: "Bea Web", email: "bea@buyer.test", phone: "9171234567", contactMethod: "Website" },
        shipping: { ...shipping, country: "Philippines", region: "", fee: 150 },
        courier: "J&T Express",
        trackingNumber: "",
        items: [{ productId, name, qty: 1, price }],
        adminFee: { label: "", amount: 0 },
        paymentFee: { label: "", amount: 0 },
      });
      if (!("ok" in res)) throw new Error(`order refused: ${JSON.stringify(res)}`);
      const row = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, orderNumber: res.order.orderNumber } });
      if (!row) throw new Error("the order was not stored");
      return row;
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  };
  const PROOF = "https://ik.imagekit.io/test/proof.png";

  console.log("\nwebsite checkout, pay after close");
  await test("a round order is placed with no payment method and no proof", async () => {
    const row = await webOrder(tmb.id, "MICABLEND 2.0 (TMB 2.0)", 1690, { method: "", proof: null });
    assert.equal(row.groupBuyId, round.id);
    assert.equal(row.paymentMethod, INVOICE_METHOD, "marked for the invoice");
    assert.equal(row.paymentStatus, "pending");
    assert.equal(row.paymentProofUrl, null);
    assert.equal((row.shipping as Json).fee, 250, "the round's flat fee, not the courier's ₱150");
  });
  await test("an on-hand order still pays the ordinary way", async () => {
    const row = await webOrder(onHand.id, "Bac Water", 300, { method: "GCash", proof: PROOF });
    assert.equal(row.paymentMethod, "GCash");
    assert.equal(row.paymentProofUrl, PROOF);
    assert.equal((row.shipping as Json).fee, 150);
  });
  await test("a stale tab that already uploaded a proof keeps that payment", async () => {
    const row = await webOrder(tmb.id, "MICABLEND 2.0 (TMB 2.0)", 1690, { method: "GCash", proof: PROOF });
    assert.equal(row.groupBuyId, round.id);
    assert.equal(row.paymentMethod, "GCash", "never re-billed on an invoice");
    assert.equal(row.paymentProofUrl, PROOF);
  });

  // ── app ────────────────────────────────────────────────────────────────
  let ipSeq = 0;
  const req = (method: string, url: string, token?: string, body?: unknown) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    return new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  const call = async (handler: Handler, r: Request) => {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const signIn = await call(login, req("POST", "/auth/login", undefined, { email: "ann@buyer.test", password: "ann-pass" }));
  assert.equal(signIn.status, 200, JSON.stringify(signIn.json));
  const tok = signIn.json.data.accessToken as string;
  const appBody = (over: Json = {}): Json => ({ id: `app-${++seq}`, lines: [{ productId: tmb.id, qty: 1 }], shipping, courier: "c-jnt", ...over });

  console.log("\napp shop, pay after close");
  await test("the catalog tells the app this round is paid after close", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.groupBuy?.invoice, { shippingFee: 250 });
    await flushAfter();
  });
  await test("an app round order is placed with no payment method", async () => {
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, appBody()));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = await db.storefrontOrder.findFirst({ where: { orderNumber: r.json.data.order.orderNumber } });
    assert.equal(row?.paymentMethod, INVOICE_METHOD);
  });

  console.log("\nthe store switches to pay before checkout");
  await writeConfig((c) => withGbPaymentMode(c, "pay_first"));
  await test("the website round order keeps its payment method and proof", async () => {
    const row = await webOrder(tmb.id, "MICABLEND 2.0 (TMB 2.0)", 1690, { method: "GCash", proof: PROOF });
    assert.equal(row.paymentMethod, "GCash");
    assert.equal(row.paymentProofUrl, PROOF);
    assert.equal((row.shipping as Json).fee, 150, "the courier's fee again");
  });
  await test("the app catalog no longer offers pay-later", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.groupBuy?.invoice ?? null, null);
    await flushAfter();
  });
  await test("an app round order needs a payment method again", async () => {
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, appBody()));
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error.message, "Please choose a payment method.");
  });

  console.log("\na hand-edited config where the two disagree");
  await writeConfig((c) => ({ ...c, groupBuyPayment: { mode: "pay_first" }, groupBuyInvoice: { ...c.groupBuyInvoice, enabled: true } }));
  await test("the mode wins: the app is not offered pay-later", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
    assert.equal(r.json.data.groupBuy?.invoice ?? null, null, JSON.stringify(r.json.data.groupBuy?.invoice));
    await flushAfter();
  });
  await test("the mode wins: the app order needs a payment method", async () => {
    const r = await call(ordersPost, req("POST", "/shop/orders", tok, appBody()));
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });

  console.log("\na store that predates the setting");
  await writeConfig((c) => {
    const { groupBuyPayment: _dropped, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, groupBuyInvoice: { enabled: true, shippingFee: 250, enabledAt: new Date().toISOString() } };
  });
  await test("its invoice switch alone still means pay after close — on the website too", async () => {
    const row = await webOrder(tmb.id, "MICABLEND 2.0 (TMB 2.0)", 1690, { method: "", proof: null });
    assert.equal(row.paymentMethod, INVOICE_METHOD);
  });

  await db.$disconnect();
}

async function main() {
  await pure();
  await flow();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
