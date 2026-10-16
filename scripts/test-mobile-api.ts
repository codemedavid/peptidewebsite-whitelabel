/**
 * Integration gate for the Pepweb Admin mobile API (/api/mobile/v1/*).
 *
 * Runs the REAL route handlers, auth, withTenant(), the order engine and the
 * push fan-out against an in-process Postgres (PGlite) — no Next server, no
 * network, and NO access to any real database: DATABASE_URL is forced to an
 * unreachable address and the Prisma singleton is replaced BEFORE any app
 * module loads. Four Next runtime modules are stubbed (scripts/mobile-test/).
 * Pushes go to a local capture server, never to Expo.
 *
 *   npm run test:mobile-api
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

// ── safety first: nothing below may reach a real database ──────────────────
process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/pglite-only";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "pepweb.store";
process.env.TENANT_ADMIN_SECRET = "test-secret";
delete process.env.EXPO_ACCESS_TOKEN;
// Never upload to the real ImageKit: photo uploads fall back to inline data URLs.
delete process.env.IMAGEKIT_PRIVATE_KEY;

import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password-hash";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// Route handlers differ only in their params shape; the tests always pass { id }.
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

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

// ── push capture server (stands in for exp.host) ────────────────────────────
const pushed: Json[] = [];
function startPushCapture(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const messages = JSON.parse(raw) as Json[];
      pushed.push(...messages);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: messages.map((_, i) => ({ status: "ok", id: `t${pushed.length}-${i}` })) }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

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

  // App modules load only now, so they bind to the PGlite-backed singleton.
  const login = (await import("../src/app/api/mobile/v1/auth/login/route")).POST as Handler;
  const refresh = (await import("../src/app/api/mobile/v1/auth/refresh/route")).POST as Handler;
  const logout = (await import("../src/app/api/mobile/v1/auth/logout/route")).POST as Handler;
  const me = (await import("../src/app/api/mobile/v1/me/route")).GET as Handler;
  const orders = (await import("../src/app/api/mobile/v1/orders/route")).GET as Handler;
  const orderRoute = await import("../src/app/api/mobile/v1/orders/[id]/route");
  const trashRoute = await import("../src/app/api/mobile/v1/orders/[id]/trash/route");
  const products = (await import("../src/app/api/mobile/v1/products/route")).GET as Handler;
  const productPatch = (await import("../src/app/api/mobile/v1/products/[id]/route")).PATCH as Handler;
  const devices = (await import("../src/app/api/mobile/v1/devices/route")).POST as Handler;
  const storeStatus = (await import("../src/app/api/mobile/v1/store-status/route")).PUT as Handler;
  const password = (await import("../src/app/api/mobile/v1/account/password/route")).POST as Handler;
  const dashboard = (await import("../src/app/api/mobile/v1/dashboard/route")).GET as Handler;
  const profileRoute = await import("../src/app/api/mobile/v1/account/profile/route");
  const photoRoute = await import("../src/app/api/mobile/v1/account/profile/photo/route");
  const { notifyNewOrder } = await import("../src/lib/mobile/push");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed: two branded stores sharing an owner email, one suspended store ──
  const staffFeature = await db.feature.create({ data: { key: "storefront.staff_accounts" } });
  const analyticsFeature = await db.feature.create({ data: { key: "storefront.sales_analytics" } });
  const plan = await db.plan.create({
    data: {
      key: "growth",
      name: "Growth",
      features: { create: [{ featureId: staffFeature.id }, { featureId: analyticsFeature.id }] },
    },
  });
  const SHARED_EMAIL = "owner@shared.test";
  const mkTenant = (slug: string, name: string, pw: string, status = "active") =>
    db.tenant.create({
      data: { slug, name, status, planId: plan.id, storeAdminEmail: SHARED_EMAIL, storeAdminPasswordHash: hashPassword(pw) },
    });
  const A = await mkTenant("alpha", "Alpha", "alpha-pass");
  const B = await mkTenant("beta", "Beta", "beta-pass");
  await mkTenant("gamma", "Gamma", "gamma-pass", "suspended");
  // One person running two stores with the SAME email and password.
  const TWIN_EMAIL = "twin@shared.test";
  for (const [slug, name] of [["twin-one", "Twin One"], ["twin-two", "Twin Two"]] as const) {
    await db.tenant.create({
      data: { slug, name, status: "active", planId: plan.id, storeAdminEmail: TWIN_EMAIL, storeAdminPasswordHash: hashPassword("twin-pass") },
    });
  }
  await db.branding.create({
    data: { tenantId: A.id, config: { name: "Alpha Glow", button: "#0b6e4f", currency: "₱", heroTitle: "keep-me" } },
  });
  await db.branding.create({ data: { tenantId: B.id, config: { name: "Beta Labs", button: "#7c3aed" } } });

  await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Pat Packer", email: "packer@alpha.test", username: "packer", passwordHash: hashPassword("packer-pass"), permissions: ["products"] },
  });
  const clerk = await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Cory Clerk", email: "clerk@alpha.test", username: "clerk", passwordHash: hashPassword("clerk-pass"), permissions: ["orders"] },
  });

  const p1 = await db.product.create({ data: { tenantId: A.id, sku: "BPC", slug: "bpc", name: "BPC-157", priceCents: 100000, stock: 10 } });
  await db.product.create({ data: { tenantId: A.id, sku: "TB", slug: "tb", name: "TB-500", priceCents: 150000, stock: 2 } });
  const mto = await db.product.create({
    data: { tenantId: A.id, sku: "MTO", slug: "mto", name: "Custom Kit", priceCents: 50000, stock: 0, metadata: { madeToOrder: true } },
  });

  const mkOrder = (tenantId: string, orderNumber: string, customer: string, status = "new") =>
    db.storefrontOrder.create({
      data: {
        tenantId,
        orderNumber,
        status,
        paymentMethod: "GCash",
        customer: { name: customer, email: `${customer.toLowerCase().split(" ")[0]}@buyer.test`, phone: "0917", contactMethod: "sms" },
        shipping: { address: "1 Main", city: "Makati", province: "NCR", postal: "1200", country: "PH", region: "NCR", fee: 150 },
        items: [{ name: "BPC-157", qty: 2, price: 1000, productId: p1.id }],
        statusHistory: [{ status, at: new Date().toISOString() }],
      },
    });
  const a1 = await mkOrder(A.id, "ALP-1001", "Ana Cruz");
  await mkOrder(A.id, "ALP-1002", "Ben Reyes", "confirmed");
  const b1 = await mkOrder(B.id, "BET-2001", "Ana Cruz");

  // ── helpers ──────────────────────────────────────────────────────────────
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const NO_PARAMS = { params: Promise.resolve({ id: "" }) };
  async function call(h: Handler, r: Request, p = NO_PARAMS) {
    const res = await h(r, p);
    return { status: res.status, json: (await res.json()) as Json };
  }
  async function signIn(store: string, email: string, pw: string) {
    return call(login, req("POST", "/auth/login", undefined, { store, email, password: pw }));
  }

  console.log("\nauth + branding");
  const aLogin = await signIn("alpha", SHARED_EMAIL, "alpha-pass");
  const aTok = aLogin.json.data?.accessToken as string;
  await test("owner signs in with the website credentials", async () => {
    assert.equal(aLogin.status, 200, JSON.stringify(aLogin.json));
    assert.equal(aLogin.json.data.me.actor.kind, "owner");
    assert.equal(aLogin.json.data.me.store.slug, "alpha");
  });
  const bLogin = await signIn("https://Beta.pepweb.store/#admin", SHARED_EMAIL, "beta-pass");
  const bTok = bLogin.json.data?.accessToken as string;
  await test("same email, other store: the store address disambiguates", async () => {
    assert.equal(bLogin.status, 200, JSON.stringify(bLogin.json));
    assert.equal(bLogin.json.data.me.store.slug, "beta");
  });
  await test("two tenants get their own distinct branding", async () => {
    assert.equal(aLogin.json.data.me.theme.name, "Alpha Glow");
    assert.equal(aLogin.json.data.me.theme.primary, "#0b6e4f");
    assert.equal(bLogin.json.data.me.theme.name, "Beta Labs");
    assert.equal(bLogin.json.data.me.theme.primary, "#7c3aed");
    assert.notEqual(aLogin.json.data.me.theme.version, bLogin.json.data.me.theme.version);
  });
  await test("wrong password / other store's password → one generic error", async () => {
    const r1 = await signIn("alpha", SHARED_EMAIL, "nope");
    const r2 = await signIn("alpha", SHARED_EMAIL, "beta-pass");
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r1.json.error.message, "Incorrect email or password.");
    assert.equal(r2.json.error.message, r1.json.error.message);
  });
  await test("unknown store → not found; suspended store → unavailable", async () => {
    assert.equal((await signIn("nosuchstore", SHARED_EMAIL, "x")).json.error.code, "not_found");
    assert.equal((await signIn("gamma", SHARED_EMAIL, "gamma-pass")).json.error.code, "store_unavailable");
  });
  const emailOnly = (email: string, pw: string, extra: Record<string, unknown> = {}) =>
    call(login, req("POST", "/auth/login", undefined, { email, password: pw, ...extra }));
  await test("email + password only: the password picks the store", async () => {
    const a = await emailOnly(SHARED_EMAIL, "alpha-pass");
    const b = await emailOnly("  OWNER@Shared.test ", "beta-pass");
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.data.me.store.slug, "alpha");
    assert.equal(b.json.data.me.store.slug, "beta");
  });
  await test("email-only works for staff too", async () => {
    const r = await emailOnly("clerk@alpha.test", "clerk-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.actor.kind, "staff");
    assert.equal(r.json.data.me.store.slug, "alpha");
  });
  await test("email-only: wrong password or unknown email → the same generic error", async () => {
    const r1 = await emailOnly(SHARED_EMAIL, "nope");
    const r2 = await emailOnly("nobody@nowhere.test", "nope");
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
    assert.equal(r1.json.error.message, r2.json.error.message);
  });
  await test("email-only: the only matching store is suspended → store unavailable", async () => {
    const r = await emailOnly(SHARED_EMAIL, "gamma-pass");
    assert.equal(r.json.error.code, "store_unavailable");
  });
  await test("same email + password on two stores → pick a store, then sign in to it", async () => {
    const r = await emailOnly("twin@shared.test", "twin-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.accessToken, undefined);
    const slugs = (r.json.data.chooseStore as Array<{ slug: string; name: string }>).map((c) => c.slug).sort();
    assert.deepEqual(slugs, ["twin-one", "twin-two"]);
    const pick = await emailOnly("twin@shared.test", "twin-pass", { store: "twin-two" });
    assert.equal(pick.status, 200, JSON.stringify(pick.json));
    assert.equal(pick.json.data.me.store.slug, "twin-two");
  });
  await test("the store list is never shown without the right password", async () => {
    const r = await emailOnly("twin@shared.test", "wrong");
    assert.equal(r.status, 401);
    assert.equal(JSON.stringify(r.json).includes("twin-one"), false);
  });
  await test("no token / junk token → unauthenticated", async () => {
    assert.equal((await call(me, req("GET", "/me"))).status, 401);
    assert.equal((await call(me, req("GET", "/me", "x".repeat(43)))).json.error.code, "unauthenticated");
  });

  console.log("\norders: isolation, rules, concurrency");
  await test("list shows only this tenant's orders", async () => {
    const r = await call(orders, req("GET", "/orders?filter=all", aTok));
    const nums = r.json.data.orders.map((o: Json) => o.orderNumber).sort();
    assert.deepEqual(nums, ["ALP-1001", "ALP-1002"]);
    assert.deepEqual(r.json.data.counts, { new: 1, toFulfil: 1 });
  });
  await test("cross-tenant order ids are not found (both directions)", async () => {
    assert.equal((await call(orderRoute.GET as Handler, req("GET", `/orders/${b1.id}`, aTok), params(b1.id))).status, 404);
    assert.equal((await call(orderRoute.GET as Handler, req("GET", `/orders/${a1.id}`, bTok), params(a1.id))).status, 404);
    const patch = await call(
      orderRoute.PATCH as Handler,
      req("PATCH", `/orders/${b1.id}`, aTok, { status: "cancelled", expectedUpdatedAt: b1.updatedAt.toISOString() }),
      params(b1.id),
    );
    assert.equal(patch.status, 404);
    assert.equal((await db.storefrontOrder.findUnique({ where: { id: b1.id } }))!.status, "new");
  });
  await test("search is tenant-scoped (same customer name in both stores)", async () => {
    const r = await call(orders, req("GET", "/orders?filter=all&q=ana", aTok));
    assert.deepEqual(r.json.data.orders.map((o: Json) => o.orderNumber), ["ALP-1001"]);
  });

  await test("orders file per group buy: round bar counts + round filter", async () => {
    const live = await db.groupBuy.create({ data: { tenantId: A.id, name: "Round 7", status: "active", batchNumber: "TR7" } });
    const other = await db.groupBuy.create({ data: { tenantId: B.id, name: "Beta round", status: "active" } });
    const a2 = await db.storefrontOrder.findFirst({ where: { tenantId: A.id, orderNumber: "ALP-1002" } });
    await db.storefrontOrder.update({ where: { id: a2!.id }, data: { groupBuyId: live.id, groupBuyName: "Round 7" } });
    try {
      const all = await call(orders, req("GET", "/orders?filter=all", aTok));
      assert.deepEqual(
        all.json.data.rounds.map((f: Json) => [f.key, f.name, f.batch, f.state, f.count]),
        [
          [live.id, "Round 7", "TR7", "live", 1],
          ["on-hand", "On-hand", "", "on-hand", 1],
        ],
      );
      const gbOrder = all.json.data.orders.find((o: Json) => o.orderNumber === "ALP-1002");
      assert.equal(gbOrder.groupBuyId, live.id);

      const inRound = await call(orders, req("GET", `/orders?filter=all&round=${live.id}`, aTok));
      assert.deepEqual(inRound.json.data.orders.map((o: Json) => o.orderNumber), ["ALP-1002"]);
      assert.equal(inRound.json.data.rounds.length, 2, "the bar keeps every chip while one is picked");

      const onHand = await call(orders, req("GET", "/orders?filter=all&round=on-hand", aTok));
      assert.deepEqual(onHand.json.data.orders.map((o: Json) => o.orderNumber), ["ALP-1001"]);

      const status = await call(orders, req("GET", "/orders?filter=new", aTok));
      assert.deepEqual(status.json.data.rounds.map((f: Json) => [f.key, f.count]), [["on-hand", 1]], "counts honour the status filter");

      const foreign = await call(orders, req("GET", `/orders?filter=all&round=${other.id}`, aTok));
      assert.deepEqual(foreign.json.data.orders, [], "another store's round shows nothing");
    } finally {
      await db.storefrontOrder.update({ where: { id: a2!.id }, data: { groupBuyId: null, groupBuyName: null } });
      await db.groupBuy.deleteMany({ where: { id: { in: [live.id, other.id] } } });
    }
  });

  let a1Updated = a1.updatedAt.toISOString();
  await test("confirm runs the website engine: status, journey, stock deduction", async () => {
    const r = await call(
      orderRoute.PATCH as Handler,
      req("PATCH", `/orders/${a1.id}`, aTok, { status: "confirmed", expectedUpdatedAt: a1Updated }),
      params(a1.id),
    );
    await flushAfter();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.status, "confirmed");
    assert.equal(r.json.data.timeline.length, 2);
    assert.equal((await db.product.findUnique({ where: { id: p1.id } }))!.stock, 8);
    a1Updated = r.json.data.updatedAt;
  });
  await test("a stale write is refused with the latest version (409)", async () => {
    const r = await call(
      orderRoute.PATCH as Handler,
      req("PATCH", `/orders/${a1.id}`, aTok, { status: "cancelled", expectedUpdatedAt: a1.updatedAt.toISOString() }),
      params(a1.id),
    );
    assert.equal(r.status, 409);
    assert.equal(r.json.error.current.status, "confirmed");
    assert.equal((await db.product.findUnique({ where: { id: p1.id } }))!.stock, 8, "no restock on a refused write");
  });
  await test("paymentStatus cannot be written from the app", async () => {
    const r = await call(
      orderRoute.PATCH as Handler,
      req("PATCH", `/orders/${a1.id}`, aTok, { paymentStatus: "paid", shippingNote: "Fragile", expectedUpdatedAt: a1Updated }),
      params(a1.id),
    );
    assert.equal(r.status, 200);
    const row = await db.storefrontOrder.findUnique({ where: { id: a1.id } });
    assert.equal(row!.paymentStatus, "pending");
    assert.equal(row!.shippingNote, "Fragile");
    a1Updated = r.json.data.updatedAt;
  });
  await test("trash hides the order; undo restores it", async () => {
    assert.equal((await call(trashRoute.POST as Handler, req("POST", `/orders/${a1.id}/trash`, aTok), params(a1.id))).status, 200);
    assert.equal((await call(orderRoute.GET as Handler, req("GET", `/orders/${a1.id}`, aTok), params(a1.id))).status, 404);
    assert.equal((await call(trashRoute.DELETE as Handler, req("DELETE", `/orders/${a1.id}/trash`, aTok), params(a1.id))).status, 200);
    assert.equal((await call(orderRoute.GET as Handler, req("GET", `/orders/${a1.id}`, aTok), params(a1.id))).status, 200);
  });

  console.log("\nstaff permissions");
  const packerTok = (await signIn("alpha", "packer@alpha.test", "packer-pass")).json.data.accessToken as string;
  await test("staff without the Orders grant is refused orders, allowed products", async () => {
    assert.equal((await call(orders, req("GET", "/orders", packerTok))).status, 403);
    assert.equal((await call(products, req("GET", "/products", packerTok))).status, 200);
    const meRes = await call(me, req("GET", "/me", packerTok));
    assert.equal(meRes.json.data.can.orders, false);
  });
  const clerkTok = (await signIn("alpha", "clerk@alpha.test", "clerk-pass")).json.data.accessToken as string;
  await test("suspending a staffer signs their phone out on the next call", async () => {
    assert.equal((await call(orders, req("GET", "/orders", clerkTok))).status, 200);
    await db.storefrontStaff.update({ where: { id: clerk.id }, data: { status: "suspended" } });
    const r = await call(orders, req("GET", "/orders", clerkTok));
    assert.equal(r.json.error.code, "session_revoked");
  });
  await test("staff can't flip the store switch without the grant", async () => {
    assert.equal((await call(storeStatus, req("PUT", "/store-status", packerTok, { open: false }))).status, 403);
  });

  console.log("\nsessions");
  await test("refresh rotates; replaying the old refresh token kills the session", async () => {
    const s = await signIn("alpha", SHARED_EMAIL, "alpha-pass");
    const r1 = await call(refresh, req("POST", "/auth/refresh", undefined, { refreshToken: s.json.data.refreshToken }));
    assert.equal(r1.status, 200);
    assert.equal((await call(me, req("GET", "/me", s.json.data.accessToken))).status, 401, "old access token retired");
    assert.equal((await call(me, req("GET", "/me", r1.json.data.accessToken))).status, 200);
    const replay = await call(refresh, req("POST", "/auth/refresh", undefined, { refreshToken: s.json.data.refreshToken }));
    assert.equal(replay.json.error.code, "session_revoked");
    assert.equal((await call(me, req("GET", "/me", r1.json.data.accessToken))).json.error.code, "session_revoked");
  });
  await test("changing the password keeps this phone, signs out the others", async () => {
    const phone1 = (await signIn("alpha", SHARED_EMAIL, "alpha-pass")).json.data.accessToken as string;
    const phone2 = (await signIn("alpha", SHARED_EMAIL, "alpha-pass")).json.data.accessToken as string;
    const r = await call(password, req("POST", "/account/password", phone1, { currentPassword: "alpha-pass", newPassword: "alpha-pass-2" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await call(me, req("GET", "/me", phone1))).status, 200);
    assert.equal((await call(me, req("GET", "/me", phone2))).json.error.code, "session_revoked");
    assert.equal((await call(me, req("GET", "/me", aTok))).json.error.code, "session_revoked");
  });

  console.log("\npush notifications");
  const a2 = (await signIn("alpha", SHARED_EMAIL, "alpha-pass-2")).json.data.accessToken as string;
  const TOKEN = "ExponentPushToken[test-device-000001]";
  const aPhone = (await signIn("alpha", SHARED_EMAIL, "alpha-pass-2")).json.data.accessToken as string;
  await test("a live session of another account can't take over a phone's token", async () => {
    assert.equal((await call(devices, req("POST", "/devices", aPhone, { expoPushToken: TOKEN, platform: "ios", newOrders: true }))).status, 200);
    const steal = await call(devices, req("POST", "/devices", bTok, { expoPushToken: TOKEN, platform: "ios", newOrders: true }));
    assert.equal(steal.status, 400);
    assert.equal((await db.mobilePushDevice.findUnique({ where: { expoPushToken: TOKEN } }))!.tenantId, A.id);
    // The same account re-registering (app relaunch) is fine.
    assert.equal((await call(devices, req("POST", "/devices", aPhone, { expoPushToken: TOKEN, platform: "ios", newOrders: true }))).status, 200);
  });
  await test("a phone's token moves with its session — never two stores", async () => {
    assert.equal((await db.mobilePushDevice.findUnique({ where: { expoPushToken: TOKEN } }))!.tenantId, A.id);
    // The phone leaves store A (its session is revoked / expires) and signs into B.
    const row = await db.mobilePushDevice.findUnique({ where: { expoPushToken: TOKEN } });
    await db.mobileSession.update({ where: { id: row!.sessionId }, data: { revokedAt: new Date() } });
    assert.equal((await call(devices, req("POST", "/devices", bTok, { expoPushToken: TOKEN, platform: "ios", newOrders: true }))).status, 200);
    assert.equal((await db.mobilePushDevice.findUnique({ where: { expoPushToken: TOKEN } }))!.tenantId, B.id);
    pushed.length = 0;
    await notifyNewOrder(A.id, { id: "alpha-new-1", orderNumber: "ALP-1003" }, "Alpha Glow");
    assert.equal(pushed.length, 0, "store A must not reach a phone now bound to store B");
  });
  await test("new-order push: lock-screen safe, delivered once per order", async () => {
    pushed.length = 0;
    await notifyNewOrder(B.id, { id: b1.id, orderNumber: "BET-2001" }, "Beta Labs");
    await notifyNewOrder(B.id, { id: b1.id, orderNumber: "BET-2001" }, "Beta Labs");
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].to, TOKEN);
    assert.deepEqual(pushed[0].data, { type: "order", orderId: b1.id });
    assert.ok(!JSON.stringify(pushed[0]).includes("Ana"), "no customer name on the lock screen");
    const alert = await db.mobileOrderAlert.findUnique({ where: { orderId: b1.id } });
    assert.equal(alert!.sent, 1);
  });
  await test("logout revokes the session and removes the device", async () => {
    assert.equal((await call(logout, req("POST", "/auth/logout", bTok, {}))).status, 200);
    assert.equal(await db.mobilePushDevice.count({ where: { expoPushToken: TOKEN } }), 0);
    assert.equal((await call(me, req("GET", "/me", bTok))).status, 401);
    pushed.length = 0;
    await notifyNewOrder(B.id, { id: "beta-new-2", orderNumber: "BET-2002" }, "Beta Labs");
    assert.equal(pushed.length, 0);
  });

  console.log("\nproducts, store switch, dashboard");
  await test("product quick edit: availability + stale refusal + made-to-order guard", async () => {
    const list = (await call(products, req("GET", "/products", a2))).json.data.products as Json[];
    const bpc = list.find((p) => p.name === "BPC-157")!;
    const off = await call(productPatch, req("PATCH", `/products/${p1.id}`, a2, { available: false, expectedUpdatedAt: bpc.updatedAt }), params(p1.id));
    assert.equal(off.status, 200, JSON.stringify(off.json));
    const row = await db.product.findUnique({ where: { id: p1.id } });
    assert.equal(row!.status, "draft");
    assert.equal(row!.active, false);
    const stale = await call(productPatch, req("PATCH", `/products/${p1.id}`, a2, { stock: 5, expectedUpdatedAt: bpc.updatedAt }), params(p1.id));
    assert.equal(stale.status, 409);
    const custom = list.find((p) => p.name === "Custom Kit")!;
    assert.equal(custom.stock, null);
    const mtoEdit = await call(productPatch, req("PATCH", `/products/${mto.id}`, a2, { stock: 3, expectedUpdatedAt: custom.updatedAt }), params(mto.id));
    assert.equal(mtoEdit.status, 400);
  });
  await test("store switch closes the shop and keeps every other setting", async () => {
    const r = await call(storeStatus, req("PUT", "/store-status", a2, { open: false }));
    assert.equal(r.status, 200);
    const config = (await db.branding.findUnique({ where: { tenantId: A.id } }))!.config as Json;
    assert.equal(config.storeStatus.open, false);
    assert.equal(config.heroTitle, "keep-me");
    assert.equal(config.button, "#0b6e4f");
  });
  await test("dashboard: real counts, today's revenue only when entitled, low stock", async () => {
    const r = await call(dashboard, req("GET", "/dashboard", a2));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.store.open, false);
    assert.deepEqual(r.json.data.queue, { newOrders: 0, toFulfil: 2 });
    assert.ok(r.json.data.today, "analytics entitled → today present");
    assert.ok(r.json.data.lowStock.some((p: Json) => p.name === "TB-500"));
    const packerDash = await call(dashboard, req("GET", "/dashboard", packerTok));
    assert.equal(packerDash.json.data.today, null, "no orders grant → no money");
    assert.equal(packerDash.json.data.recent.length, 0);
  });

  console.log("\naccount profiles");
  const PNG_1PX = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = (token: string, bytes: Buffer, name: string, type: string) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    return new Request("https://app.pepweb.store/api/mobile/v1/account/profile/photo", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };
  const bOwner = (await signIn("beta", SHARED_EMAIL, "beta-pass")).json.data.accessToken as string;
  await test("an account with no profile shows its own name and no photo", async () => {
    const r = await call(me, req("GET", "/me", a2));
    assert.deepEqual(r.json.data.account, { name: "Store owner", nickname: null, avatarUrl: null, displayName: "Store owner" });
  });
  await test("the owner sets a name + nickname; /me shows the nickname", async () => {
    const r = await call(profileRoute.PATCH as Handler, req("PATCH", "/account/profile", a2, { name: "  Ana   Reyes ", nickname: "Ana" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const m = (await call(me, req("GET", "/me", a2))).json.data;
    assert.equal(m.account.name, "Ana Reyes");
    assert.equal(m.account.displayName, "Ana");
    assert.equal(m.actor.displayName, "Ana");
  });
  await test("profiles are per store: the same owner email on another store is untouched", async () => {
    const r = await call(profileRoute.GET as Handler, req("GET", "/account/profile", bOwner));
    assert.equal(r.json.data.name, "Store owner");
    assert.equal(await db.accountProfile.count({ where: { tenantId: B.id } }), 0);
  });
  await test("staff get their own profile, separate from the owner's", async () => {
    const r = await call(profileRoute.PATCH as Handler, req("PATCH", "/account/profile", packerTok, { name: "Paolo", nickname: "" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.displayName, "Paolo");
    assert.equal(r.json.data.nickname, null);
    const owner = (await call(profileRoute.GET as Handler, req("GET", "/account/profile", a2))).json.data;
    assert.equal(owner.displayName, "Ana");
  });
  await test("bad names are refused; signed-out calls are refused", async () => {
    assert.equal((await call(profileRoute.PATCH as Handler, req("PATCH", "/account/profile", a2, { name: "a" }))).status, 400);
    assert.equal((await call(profileRoute.PATCH as Handler, req("PATCH", "/account/profile", a2, { name: "Ana", nickname: "x".repeat(25) }))).status, 400);
    assert.equal((await call(profileRoute.PATCH as Handler, req("PATCH", "/account/profile", undefined, { name: "Ana" }))).status, 401);
  });
  await test("photo upload: an image is set, a non-image is refused, remove clears it", async () => {
    const up = await call(photoRoute.POST as Handler, upload(a2, PNG_1PX, "me.png", "image/png"));
    assert.equal(up.status, 200, JSON.stringify(up.json));
    assert.ok(String(up.json.data.avatarUrl).startsWith("data:image/png;base64,"), "inline fallback without ImageKit");
    const fake = await call(photoRoute.POST as Handler, upload(a2, Buffer.from("not an image at all"), "me.png", "image/png"));
    assert.equal(fake.status, 400);
    assert.ok((await call(me, req("GET", "/me", a2))).json.data.account.avatarUrl, "a refused upload keeps the old photo");
    const del = await call(photoRoute.DELETE as Handler, req("DELETE", "/account/profile/photo", a2));
    assert.equal(del.json.data.avatarUrl, null);
    assert.equal(del.json.data.displayName, "Ana", "removing the photo keeps the name");
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
