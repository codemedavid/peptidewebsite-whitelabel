/**
 * Integration gate for the Pepweb app community (/api/mobile/v1/community/*)
 * and customer sign-in. Same harness as test-mobile-api.ts: the REAL route
 * handlers, auth, withTenant() and push fan-out against in-process PGlite —
 * DATABASE_URL is forced unreachable, pushes go to a local capture server.
 *
 *   npm run test:community-api
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
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
type Params = Record<string, string>;
type Handler = (req: Request, ctx: { params: Promise<Params> }) => Promise<Response>;

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

const pushed: Json[] = [];
function startPushCapture(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const messages = JSON.parse(raw) as Json[];
      pushed.push(...messages);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }));
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

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const refresh = await h("auth/refresh/route", "POST");
  const me = await h("me/route", "GET");
  const orders = await h("orders/route", "GET");
  const devices = await h("devices/route", "POST");
  const inbox = await h("community/inbox/route", "GET");
  const channelsPost = await h("community/channels/route", "POST");
  const channelGet = await h("community/channels/[id]/route", "GET");
  const channelPatch = await h("community/channels/[id]/route", "PATCH");
  const channelDelete = await h("community/channels/[id]/route", "DELETE");
  const channelMute = await h("community/channels/[id]/mute/route", "PUT");
  const topicsPost = await h("community/channels/[id]/topics/route", "POST");
  const topicPatch = await h("community/topics/[id]/route", "PATCH");
  const topicDelete = await h("community/topics/[id]/route", "DELETE");
  const messagesGet = await h("community/threads/[type]/[id]/messages/route", "GET");
  const messagesPost = await h("community/threads/[type]/[id]/messages/route", "POST");
  const readPost = await h("community/threads/[type]/[id]/read/route", "POST");
  const sharedGet = await h("community/threads/[type]/[id]/shared/route", "GET");
  const messagePatch = await h("community/messages/[id]/route", "PATCH");
  const messageDelete = await h("community/messages/[id]/route", "DELETE");
  const search = await h("community/search/route", "GET");
  const dms = await h("community/dms/route", "POST");
  const profileGet = await h("community/profile/route", "GET");
  const profilePatch = await h("community/profile/route", "PATCH");
  const profilesGet = await h("community/profiles/[key]/route", "GET");
  const uploads = await h("community/uploads/route", "POST");
  const videoTicket = await h("community/uploads/video/route", "POST");
  const videoConfirm = await h("community/uploads/video/confirm/route", "POST");
  const dropsGet = await h("community/drops/route", "GET");
  const dropsPost = await h("community/drops/route", "POST");
  const dropEnd = await h("community/drops/[id]/end/route", "POST");
  const groupBuyGet = await h("community/group-buy/route", "GET");
  const groupBuyBroadcast = await h("community/group-buy/broadcast/route", "POST");
  const { clearLiveGroupBuyCache } = await import("../src/lib/community/group-buy-cards.server");
  const members = await h("community/members/route", "GET");
  const membersPatch = await h("community/members/route", "PATCH");
  const protocols = await h("community/protocols/route", "GET");
  const review = await h("community/members/[customerId]/review/route", "POST");
  const memberPatch = await h("community/members/[customerId]/route", "PATCH");
  const reapply = await h("community/reapply/route", "POST");
  const storePreview = await h("stores/[store]/route", "GET");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const fStaff = await db.feature.create({ data: { key: "storefront.staff_accounts" } });
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const fProtocols = await db.feature.create({ data: { key: "storefront.protocols" } });
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth", features: { create: [{ featureId: fStaff.id }] } } });
  const mkTenant = (slug: string, name: string, community: boolean) =>
    db.tenant.create({
      data: {
        slug,
        name,
        status: "active",
        planId: plan.id,
        storeAdminEmail: `owner@${slug}.test`,
        storeAdminPasswordHash: hashPassword("owner-pass"),
        featureOverrides: {
          create: [
            ...(community ? [{ featureId: fCommunity.id, enabled: true }] : []),
            { featureId: fProtocols.id, enabled: true },
          ],
        },
      },
    });
  const A = await mkTenant("alpha", "Alpha", true);
  const B = await mkTenant("beta", "Beta", true);
  const C = await mkTenant("gamma", "Gamma", false);
  await db.branding.create({
    data: {
      tenantId: A.id,
      config: {
        name: "Alpha Glow",
        currency: "₱",
        communityJoin: "approval", // Beta keeps the default: open

        protocols: [{ category: "Healing", name: "BPC Protocol", dosage: "250mcg", frequency: "Daily", duration: "4 weeks", notes: [], storage: "", mode: "details" }],
      },
    },
  });
  await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Mo Mod", email: "mod@alpha.test", username: "mod", passwordHash: hashPassword("mod-pass"), permissions: ["community"] },
  });
  await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Cory Clerk", email: "clerk@alpha.test", username: "clerk", passwordHash: hashPassword("clerk-pass"), permissions: ["orders"] },
  });
  const mkCustomer = (tenantId: string, email: string, name: string, pw: string, status = "active") =>
    db.storefrontCustomer.create({ data: { tenantId, email, name, passwordHash: hashPassword(pw), status } });
  const ann = await mkCustomer(A.id, "ann@buyer.test", "Ann Cruz", "ann-pass");
  let qId = "";
  const bob = await mkCustomer(A.id, "bob@buyer.test", "Bob Reyes", "bob-pass");
  await mkCustomer(A.id, "dis@buyer.test", "Dis Abled", "dis-pass", "disabled");
  await mkCustomer(A.id, "mod@alpha.test", "Mod As Customer", "mod-pass"); // admin must win this tie
  const eve = await mkCustomer(A.id, "eve@buyer.test", "Eve", "eve-pass");
  const carl = await mkCustomer(B.id, "carl@buyer.test", "Carl B", "carl-pass");
  const fay = await mkCustomer(A.id, "fay@buyer.test", "Fay Flood", "fay-pass");
  qId = (await mkCustomer(A.id, "qq.secret.handle@buyer.test", "Q", "q-pass")).id;
  await mkCustomer(C.id, "dora@buyer.test", "Dora C", "dora-pass");
  const product = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "BPC",
      slug: "bpc",
      name: "BPC-157",
      priceCents: 100000,
      stock: 7,
      metadata: { variations: [{ name: "10mg", price: 1800, stock: 3 }] },
    },
  });
  const draft = await db.product.create({ data: { tenantId: A.id, sku: "DR", slug: "dr", name: "Unreleased", priceCents: 1000, stock: 5, status: "draft" } });
  const bProduct = await db.product.create({ data: { tenantId: B.id, sku: "X", slug: "x", name: "Beta Thing", priceCents: 5000, stock: 1 } });

  // ── helpers ─────────────────────────────────────────────────────────────
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function call(handler: Handler, r: Request, params: Params = {}) {
    const res = await handler(r, { params: Promise.resolve(params) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  // Many sign-ins from one test process: give each its own client IP so the
  // (correct) per-IP login limiter doesn't trip.
  let ipSeq = 0;
  const signIn = (email: string, pw: string, store?: string) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    return call(login, req("POST", "/auth/login", undefined, { email, password: pw, ...(store ? { store } : {}) }));
  };
  const token = async (email: string, pw: string) => {
    const r = await signIn(email, pw);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const send = (tok: string, type: string, id: string, body: Json) =>
    call(messagesPost, req("POST", `/community/threads/${type}/${id}/messages`, tok, body), { type, id });
  const list = (tok: string, type: string, id: string, qs = "") =>
    call(messagesGet, req("GET", `/community/threads/${type}/${id}/messages${qs}`, tok), { type, id });

  console.log("\ncustomer sign-in");
  const annLogin = await signIn("ann@buyer.test", "ann-pass");
  let annTok = annLogin.json.data?.accessToken as string;
  let annRefresh = "";
  await test("an active customer signs in to the customer app, pending approval", async () => {
    assert.equal(annLogin.status, 200, JSON.stringify(annLogin.json));
    const m = annLogin.json.data.me;
    assert.equal(m.mode, "customer");
    assert.equal(m.actor.kind, "customer");
    assert.equal(m.store.slug, "alpha");
    assert.deepEqual(m.webModules, []);
    assert.equal(Object.values(m.can).some(Boolean), false);
    assert.equal(m.community.enabled, true);
    assert.equal(m.community.membership, "pending");
    assert.equal(m.community.myKey, null);
    assert.equal(m.community.profile.displayName, "Ann Cruz");
    assert.equal(await db.communityMember.count({ where: { customerId: ann.id, status: "pending" } }), 1);
  });
  await test("disabled customer → the same generic error", async () => {
    const r = await signIn("dis@buyer.test", "dis-pass");
    assert.equal(r.status, 401);
    assert.equal(r.json.error.message, "Incorrect email or password.");
  });
  await test("store without the community feature → customers can't sign in", async () => {
    const r = await signIn("dora@buyer.test", "dora-pass");
    assert.equal(r.status, 401);
    assert.equal(await db.communityMember.count({ where: { tenantId: C.id } }), 0);
  });
  await test("admin wins the tie when the same credentials are staff and customer", async () => {
    const r = await signIn("mod@alpha.test", "mod-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.mode, "admin");
    assert.equal(r.json.data.me.actor.kind, "staff");
    assert.equal(r.json.data.me.community.membership, "moderator");
  });
  await test("failed customer logins are audited as customer events", async () => {
    await signIn("ann@buyer.test", "wrong");
    assert.ok((await db.authAudit.count({ where: { tenantId: A.id, event: "customer_app_login_failed" } })) >= 1);
    assert.ok((await db.authAudit.count({ where: { tenantId: A.id, event: "customer_app_login" } })) >= 1);
  });
  await test("a customer session is refused on every admin route", async () => {
    const r = await call(orders, req("GET", "/orders", annTok));
    assert.equal(r.status, 403);
    assert.equal(r.json.error.message, "This is for the store team.");
    assert.equal((await call(me, req("GET", "/me", annTok))).status, 200, "/me works for customers");
  });
  await test("a new member's default name is their account name, never their email", async () => {
    const r = await signIn("qq.secret.handle@buyer.test", "q-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.community.profile.displayName, "Member");
  });

  console.log("\ncustomer sign-up (create account in the app)");
  const register = await h("auth/register/route", "POST");
  const signUp = (body: Json, ip = `192.0.2.${++ipSeq % 250}`) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = ip;
    return call(register, req("POST", "/auth/register", undefined, body));
  };
  const NEW_SHOPPER = {
    store: "beta",
    firstName: "Nina",
    lastName: "Nuevo",
    email: "  Nina@Buyer.test ",
    phone: "0917 555 0101",
    age: 27,
    gender: "female",
    password: "nina-pass-1",
  };
  await test("a new shopper creates an account and is signed straight in", async () => {
    const r = await signUp(NEW_SHOPPER);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.data.accessToken && r.json.data.refreshToken);
    assert.equal(r.json.data.me.mode, "customer");
    assert.equal(r.json.data.me.store.slug, "beta");
    assert.equal(r.json.data.me.community.profile.displayName, "Nina Nuevo");
    const row = await db.storefrontCustomer.findFirst({ where: { tenantId: B.id, email: "nina@buyer.test" } });
    assert.ok(row, "the account is stored with a normalized email");
    assert.equal(row.name, "Nina Nuevo");
    assert.equal(row.phone, "0917 555 0101");
    assert.equal(row.age, 27);
    assert.equal(row.gender, "female");
    assert.ok(row.passwordHash.startsWith("scrypt$"), "the password is hashed, never stored");
  });
  await test("the new account then signs in like any customer", async () => {
    const r = await signIn("nina@buyer.test", "nina-pass-1");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.store.slug, "beta");
  });
  await test("an email already on the store → conflict, whoever holds it", async () => {
    const dupe = await signUp({ ...NEW_SHOPPER, email: "NINA@buyer.test" });
    const owner = await signUp({ ...NEW_SHOPPER, email: "owner@beta.test" });
    assert.equal(dupe.status, 409, JSON.stringify(dupe.json));
    assert.equal(owner.status, 409, JSON.stringify(owner.json));
    assert.equal(owner.json.error.message, dupe.json.error.message, "an owner email is not singled out");
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: B.id, email: "owner@beta.test" } }), 0);
  });
  await test("the same email can open an account on another store", async () => {
    const r = await signUp({ ...NEW_SHOPPER, store: "alpha.pepweb.store" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.store.slug, "alpha");
    // Alpha runs approval mode: drop the pending application so the moderation
    // tests below still see only their own queue.
    const nina = await db.storefrontCustomer.findFirstOrThrow({ where: { tenantId: A.id, email: "nina@buyer.test" } });
    await db.communityMember.deleteMany({ where: { customerId: nina.id } });
    await db.storefrontCustomer.delete({ where: { id: nina.id } });
  });
  await test("a store without the app community takes no sign-ups", async () => {
    const r = await signUp({ ...NEW_SHOPPER, store: "gamma", email: "new@buyer.test" });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: C.id, email: "new@buyer.test" } }), 0);
  });
  await test("no store, unknown store, bad details → clear errors, nothing created", async () => {
    const before = await db.storefrontCustomer.count();
    assert.equal((await signUp({ ...NEW_SHOPPER, store: "" })).json.error.code, "invalid_input");
    assert.equal((await signUp({ ...NEW_SHOPPER, store: "nosuchstore" })).json.error.code, "not_found");
    const short = await signUp({ ...NEW_SHOPPER, email: "x@buyer.test", password: "short" });
    assert.equal(short.status, 400);
    assert.match(short.json.error.message, /at least 8/);
    assert.equal((await signUp({ ...NEW_SHOPPER, email: "not-an-email" })).status, 400);
    assert.equal((await signUp({ ...NEW_SHOPPER, email: "y@buyer.test", firstName: "  " })).status, 400);
    assert.equal(await db.storefrontCustomer.count(), before);
  });
  await test("last name, mobile number and age are required; gender is optional", async () => {
    const before = await db.storefrontCustomer.count();
    const noLast = await signUp({ ...NEW_SHOPPER, email: "l@buyer.test", lastName: "" });
    assert.equal(noLast.status, 400);
    assert.match(noLast.json.error.message, /last name/);
    const noPhone = await signUp({ ...NEW_SHOPPER, email: "p@buyer.test", phone: "" });
    assert.equal(noPhone.status, 400);
    assert.match(noPhone.json.error.message, /mobile number/);
    const noAge = await signUp({ ...NEW_SHOPPER, email: "a@buyer.test", age: undefined });
    assert.equal(noAge.status, 400);
    assert.match(noAge.json.error.message, /age/);
    assert.equal(await db.storefrontCustomer.count(), before, "nothing is created");
    const unsaid = await signUp({ ...NEW_SHOPPER, email: "g@buyer.test", gender: undefined });
    assert.equal(unsaid.status, 200, JSON.stringify(unsaid.json));
    const row = await db.storefrontCustomer.findFirstOrThrow({ where: { tenantId: B.id, email: "g@buyer.test" } });
    assert.equal(row.gender, null, "no gender = not said");
  });
  await test("sign-ups are rate limited per device", async () => {
    const ip = "192.0.2.251";
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await signUp({ ...NEW_SHOPPER, email: `burst${i}@buyer.test` }, ip);
      codes.push(r.status === 200 ? "ok" : r.json.error.code);
    }
    assert.deepEqual(codes, ["ok", "ok", "ok", "ok", "ok", "rate_limited"]);
  });

  console.log("\nsupabase exchange (a partner app's login becomes a store customer)");
  // A fake Supabase Auth: GET /auth/v1/user answers per bearer token.
  const supabaseUsers: Record<string, Json> = {
    "tok-mica": { id: "sb-user-mica", email: "Mica@Mama.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false, user_metadata: { display_name: "Mica Santos" } },
    "tok-mica-new-id": { id: "sb-user-other", email: "mica@mama.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false, user_metadata: {} },
    "tok-anon": { id: "sb-anon", email: null, is_anonymous: true, user_metadata: {} },
    "tok-unconfirmed": { id: "sb-unconf", email: "late@mama.test", email_confirmed_at: null, is_anonymous: false, user_metadata: {} },
    "tok-taken": { id: "sb-taken", email: "ann@buyer.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false, user_metadata: {} },
    "tok-owner": { id: "sb-owner", email: "owner@mamamica.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false, user_metadata: {} },
  };
  const supabaseCalls: { path: string; apikey: string | undefined }[] = [];
  const fakeSupabase = createServer((rq, rs) => {
    supabaseCalls.push({ path: rq.url ?? "", apikey: rq.headers.apikey as string | undefined });
    const user = supabaseUsers[(rq.headers.authorization ?? "").replace(/^Bearer /, "")];
    rs.statusCode = rq.url === "/auth/v1/user" && user ? 200 : 401;
    rs.setHeader("Content-Type", "application/json");
    rs.end(JSON.stringify(user ?? { msg: "invalid JWT" }));
  });
  await new Promise<void>((r) => fakeSupabase.listen(0, "127.0.0.1", () => r()));
  process.env.MOBILE_SUPABASE_URL_OVERRIDE = `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`;
  const M = await mkTenant("mamamica", "Mama Mica", true);
  const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
  await db.branding.create({ data: { tenantId: M.id, config: { supabaseExchange: { url: SUPABASE_URL, anonKey: "anon-key-public" } } } });
  // A website (password) customer already holds ann@buyer.test on this store.
  await mkCustomer(M.id, "ann@buyer.test", "Ann Website", "ann-pass");
  const exchangeRoute = await h("auth/exchange/route", "POST");
  const exchange = (body: Json, ip = `198.51.100.${++ipSeq % 250}`) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = ip;
    return call(exchangeRoute, req("POST", "/auth/exchange", undefined, body));
  };
  await test("a confirmed partner-app user is signed in as a new store customer", async () => {
    const r = await exchange({ store: "mamamica", supabaseAccessToken: "tok-mica" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.data.accessToken && r.json.data.refreshToken);
    assert.equal(r.json.data.me.mode, "customer");
    assert.equal(r.json.data.me.store.slug, "mamamica");
    const row = await db.storefrontCustomer.findFirstOrThrow({ where: { tenantId: M.id, email: "mica@mama.test" } });
    assert.equal(row.name, "Mica Santos");
    assert.equal(row.passwordHash, "external:supabase:abcdefghijklmnopqrst:sb-user-mica", "bound to that Supabase user, no password");
    assert.deepEqual(supabaseCalls.at(-1), { path: "/auth/v1/user", apikey: "anon-key-public" });
  });
  await test("the same user exchanging again reuses the customer", async () => {
    const r = await exchange({ store: "mamamica", supabaseAccessToken: "tok-mica" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: M.id, email: "mica@mama.test" } }), 1);
  });
  await test("an exchanged account has no password to sign in with", async () => {
    const r = await signIn("mica@mama.test", "external:supabase:abcdefghijklmnopqrst:sb-user-mica", "mamamica");
    assert.equal(r.status, 401, JSON.stringify(r.json));
  });
  await test("an email held by a password account or the team is never taken over", async () => {
    const website = await exchange({ store: "mamamica", supabaseAccessToken: "tok-taken" });
    const owner = await exchange({ store: "mamamica", supabaseAccessToken: "tok-owner" });
    const otherId = await exchange({ store: "mamamica", supabaseAccessToken: "tok-mica-new-id" });
    for (const r of [website, owner, otherId]) assert.equal(r.status, 409, JSON.stringify(r.json));
    const ann = await db.storefrontCustomer.findFirstOrThrow({ where: { tenantId: M.id, email: "ann@buyer.test" } });
    assert.ok(ann.passwordHash.startsWith("scrypt$"), "the website account is untouched");
  });
  await test("guests and unconfirmed emails are refused", async () => {
    assert.equal((await exchange({ store: "mamamica", supabaseAccessToken: "tok-anon" })).status, 403);
    assert.equal((await exchange({ store: "mamamica", supabaseAccessToken: "tok-unconfirmed" })).status, 403);
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: M.id, email: "late@mama.test" } }), 0);
  });
  await test("a token Supabase rejects → unauthenticated", async () => {
    const r = await exchange({ store: "mamamica", supabaseAccessToken: "forged" });
    assert.equal(r.status, 401, JSON.stringify(r.json));
  });
  await test("stores without an exchange config, or without the app, refuse", async () => {
    assert.equal((await exchange({ store: "beta", supabaseAccessToken: "tok-mica" })).status, 403);
    assert.equal((await exchange({ store: "gamma", supabaseAccessToken: "tok-mica" })).status, 403);
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: B.id, email: "mica@mama.test" } }), 0);
  });
  await test("a config pointing anywhere but a supabase.co project is never called", async () => {
    await db.branding.update({ where: { tenantId: M.id }, data: { config: { supabaseExchange: { url: "https://evil.example.com", anonKey: "k" } } } });
    const before = supabaseCalls.length;
    const r = await exchange({ store: "mamamica", supabaseAccessToken: "tok-mica" });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(supabaseCalls.length, before, "no request left the server");
    await db.branding.update({ where: { tenantId: M.id }, data: { config: { supabaseExchange: { url: SUPABASE_URL, anonKey: "anon-key-public" } } } });
  });
  await test("missing store or token → invalid input", async () => {
    assert.equal((await exchange({ store: "mamamica" })).json.error.code, "invalid_input");
    assert.equal((await exchange({ supabaseAccessToken: "tok-mica" })).json.error.code, "invalid_input");
  });
  await test("an exchanged member deletes their account with a fresh app token, never a password", async () => {
    const accountDelete = await h("account/delete/route", "POST");
    const signedIn = await exchange({ store: "mamamica", supabaseAccessToken: "tok-mica" });
    const token = signedIn.json.data.accessToken as string;
    const marker = "external:supabase:abcdefghijklmnopqrst:sb-user-mica";
    const asPassword = await call(accountDelete, req("POST", "/account/delete", token, { password: marker }));
    const otherUser = await call(accountDelete, req("POST", "/account/delete", token, { supabaseAccessToken: "tok-owner" }));
    const forged = await call(accountDelete, req("POST", "/account/delete", token, { supabaseAccessToken: "forged" }));
    assert.equal(asPassword.status, 400, JSON.stringify(asPassword.json));
    for (const r of [otherUser, forged]) assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: M.id, email: "mica@mama.test" } }), 1, "nothing deleted yet");
    const r = await call(accountDelete, req("POST", "/account/delete", token, { supabaseAccessToken: "tok-mica" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.outcome, "deleted");
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: M.id, email: "mica@mama.test" } }), 0);
  });
  await test("a password customer cannot delete with an app token instead of the password", async () => {
    const accountDelete = await h("account/delete/route", "POST");
    const signedIn = await signIn("ann@buyer.test", "ann-pass", "mamamica");
    const r = await call(accountDelete, req("POST", "/account/delete", signedIn.json.data.accessToken, { supabaseAccessToken: "tok-taken" }));
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: M.id, email: "ann@buyer.test" } }), 1);
  });
  fakeSupabase.close();

  console.log("\nstore link (which seller a customer's app belongs to)");
  const preview = (store: string) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `203.0.113.${++ipSeq % 250}`;
    return call(storePreview, req("GET", `/stores/${encodeURIComponent(store)}`), { store: encodeURIComponent(store) });
  };
  await test("a store code resolves to the store's public preview", async () => {
    const r = await preview("alpha");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = r.json.data;
    assert.equal(d.slug, "alpha");
    assert.equal(d.name, "Alpha Glow");
    assert.equal(d.address, "alpha.pepweb.store");
    assert.equal(d.websiteUrl, "https://alpha.pepweb.store");
    assert.equal(d.signUpUrl, "https://alpha.pepweb.store/#account");
    assert.equal(d.customerSignIn, true);
    assert.ok(d.theme?.palette?.bg, "carries the store's theme for the signed-out screens");
  });
  await test("the preview never exposes store credentials or customers", async () => {
    const raw = JSON.stringify((await preview("alpha")).json);
    assert.ok(!raw.includes("owner@alpha.test"));
    assert.ok(!raw.includes("buyer.test"));
    assert.ok(!raw.includes(A.id), "no tenant id — the app never holds one");
  });
  await test("a full store address or /app link resolves the same store", async () => {
    assert.equal((await preview("alpha.pepweb.store")).json.data?.slug, "alpha");
    assert.equal((await preview("https://alpha.pepweb.store/app")).json.data?.slug, "alpha");
  });
  await test("a store without the app community says customers can't sign in yet", async () => {
    const r = await preview("gamma");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.customerSignIn, false);
  });
  await test("unknown and not-yet-live stores answer the same not_found", async () => {
    await db.tenant.create({ data: { slug: "delta", name: "Delta", status: "pending_setup", planId: plan.id } });
    const unknown = await preview("nosuchstore");
    const pending = await preview("delta");
    assert.equal(unknown.status, 404);
    assert.equal(pending.status, 404);
    assert.equal(unknown.json.error.message, pending.json.error.message);
  });
  await test("junk and reserved labels are rejected before any lookup", async () => {
    assert.equal((await preview("../../etc")).status, 400);
    assert.equal((await preview("admin")).status, 400);
  });
  await test("a linked sign-in is checked against THAT store only", async () => {
    const wrong = await signIn("carl@buyer.test", "carl-pass", "alpha");
    assert.equal(wrong.status, 401, "Carl's account lives at Beta, not Alpha");
    assert.equal(wrong.json.error.message, "Incorrect email or password.");
    const right = await signIn("carl@buyer.test", "carl-pass", "beta");
    assert.equal(right.status, 200, JSON.stringify(right.json));
    assert.equal(right.json.data.me.store.slug, "beta");
    assert.equal(right.json.data.me.mode, "customer");
  });
  await test("the store team can still sign in on a phone linked to their store", async () => {
    const r = await signIn("owner@alpha.test", "owner-pass", "alpha");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.me.mode, "admin");
  });

  await test("every login attempt spends the same number of scrypt hashes", async () => {
    const cryptoMod = createRequire(path.join(process.cwd(), "x.js"))("node:crypto") as { scryptSync: (...a: unknown[]) => unknown };
    const real = cryptoMod.scryptSync;
    let n = 0;
    cryptoMod.scryptSync = (...a: unknown[]) => {
      n++;
      return real(...a);
    };
    const count = async (email: string, pw: string, store?: string) => {
      n = 0;
      await signIn(email, pw, store);
      return n;
    };
    try {
      const counts = [
        await count("owner@alpha.test", "owner-pass", "alpha"), // admin ok
        await count("ann@buyer.test", "ann-pass", "alpha"), // customer ok
        await count("ann@buyer.test", "nope", "alpha"), // customer, wrong password
        await count("nobody@x.test", "nope", "alpha"), // unknown email
        await count("dora@buyer.test", "dora-pass", "gamma"), // feature off
        await count("owner@gamma.test", "owner-pass", "gamma"), // admin ok, feature off
      ];
      assert.ok(counts.every((c) => c === counts[0]), `scrypt counts differ: ${counts.join(",")}`);
      const noStore = await count("nobody-at-all@x.test", "nope");
      assert.equal(noStore, counts[0], "an email with no store costs the same as one store");
    } finally {
      cryptoMod.scryptSync = real;
    }
  });
  await test("refresh works for customer sessions", async () => {
    const r = await call(refresh, req("POST", "/auth/refresh", undefined, { refreshToken: annLogin.json.data.refreshToken }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    annTok = r.json.data.accessToken;
    annRefresh = r.json.data.refreshToken;
  });
  await test("refresh while the store is suspended doesn't burn the refresh token", async () => {
    await db.tenant.update({ where: { id: A.id }, data: { status: "suspended" } });
    const blocked = await call(refresh, req("POST", "/auth/refresh", undefined, { refreshToken: annRefresh }));
    await db.tenant.update({ where: { id: A.id }, data: { status: "active" } });
    assert.equal(blocked.json.error.code, "store_unavailable");
    const again = await call(refresh, req("POST", "/auth/refresh", undefined, { refreshToken: annRefresh }));
    assert.equal(again.status, 200, JSON.stringify(again.json));
    annTok = again.json.data.accessToken;
  });

  console.log("\nmembership + moderation");
  const ownerTok = await token("owner@alpha.test", "owner-pass");
  const modTok = await token("mod@alpha.test", "mod-pass");
  const clerkTok = await token("clerk@alpha.test", "clerk-pass");
  let bobTok = await token("bob@buyer.test", "bob-pass");
  const eveTok = await token("eve@buyer.test", "eve-pass");
  await test("a pending customer sees no community data", async () => {
    const r = await call(inbox, req("GET", "/community/inbox", annTok));
    assert.equal(r.status, 403);
  });
  await test("staff without the Community module can't moderate", async () => {
    assert.equal((await call(inbox, req("GET", "/community/inbox", clerkTok))).status, 403);
    assert.equal((await call(members, req("GET", "/community/members", clerkTok))).status, 403);
  });
  let generalId = "";
  let announceGeneralId = "";
  let communityChannelId = "";
  let announceChannelId = "";
  await test("the first moderator inbox bootstraps Announcements + Community", async () => {
    const r = await call(inbox, req("GET", "/community/inbox", ownerTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const names = r.json.data.channels.map((c: Json) => c.name);
    assert.deepEqual(names, ["Announcements", "Community"]);
    const announce = r.json.data.channels[0];
    const community = r.json.data.channels[1];
    assert.equal(announce.postRole, "admins");
    assert.equal(community.postRole, "everyone");
    generalId = community.generalTopicId;
    announceGeneralId = announce.generalTopicId;
    communityChannelId = community.id;
    announceChannelId = announce.id;
    const again = await call(inbox, req("GET", "/community/inbox", modTok));
    assert.equal(again.json.data.channels.length, 2, "bootstrap runs once");
  });
  await test("moderators see the queue; /me counts pending applications", async () => {
    const r = await call(members, req("GET", "/community/members?status=pending", ownerTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ids = r.json.data.members.map((m: Json) => m.customerId).sort();
    assert.deepEqual(ids, [ann.id, bob.id, eve.id, qId].sort());
    assert.equal(r.json.data.counts.pending, 4);
    const m = await call(me, req("GET", "/me", ownerTok));
    assert.equal(m.json.data.community.pendingApplications, 4);
  });
  await test("declining needs a reason; approve lets members in", async () => {
    const noReason = await call(review, req("POST", `/community/members/${eve.id}/review`, ownerTok, { approve: false }), { customerId: eve.id });
    assert.equal(noReason.status, 400);
    const dec = await call(review, req("POST", `/community/members/${eve.id}/review`, modTok, { approve: false, reason: "Not a customer yet" }), { customerId: eve.id });
    assert.equal(dec.status, 200, JSON.stringify(dec.json));
    assert.equal(dec.json.data.status, "rejected");
    for (const c of [ann, bob]) {
      const r = await call(review, req("POST", `/community/members/${c.id}/review`, ownerTok, { approve: true }), { customerId: c.id });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    const m = await call(me, req("GET", "/me", annTok));
    assert.equal(m.json.data.community.membership, "approved");
    assert.equal(m.json.data.community.myKey, `c:${ann.id}`);
    const e = await call(me, req("GET", "/me", eveTok));
    assert.equal(e.json.data.community.membership, "rejected");
    assert.equal(e.json.data.community.rejectionReason, "Not a customer yet");
  });
  await test("a declined customer can re-apply; customers only", async () => {
    assert.equal((await call(reapply, req("POST", "/community/reapply", ownerTok, { displayName: "X Y" }))).status, 403);
    const r = await call(reapply, req("POST", "/community/reapply", eveTok, { displayName: "Eve Again" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.membership, "pending");
    assert.equal((await call(reapply, req("POST", "/community/reapply", eveTok, { displayName: "Eve Again" }))).status, 400);
    assert.equal((await call(reapply, req("POST", "/community/reapply", eveTok, { displayName: "Eve Again" }))).status, 400);
    assert.equal((await call(reapply, req("POST", "/community/reapply", eveTok, { displayName: "Eve Again" }))).status, 429, "3 a day");
  });

  console.log("\nopen community (the default)");
  await test("an open store lets a new customer straight in", async () => {
    const r = await signIn("carl@buyer.test", "carl-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const c = r.json.data.me.community;
    assert.equal(c.joinMode, "open");
    assert.equal(c.membership, "approved");
    assert.equal(c.myKey, `c:${carl.id}`);
    const row = await db.communityMember.findFirst({ where: { customerId: carl.id } });
    assert.equal(row?.status, "approved");
    assert.equal(row?.reviewedBy, "auto");
  });
  await test("a customer who arrives first finds the starter channels and can post", async () => {
    const carlTok = await token("carl@buyer.test", "carl-pass");
    const r = await call(inbox, req("GET", "/community/inbox", carlTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.channels.map((c: Json) => c.name), ["Announcements", "Community"]);
    const general = r.json.data.channels[1].generalTopicId as string;
    assert.equal((await db.communityTopic.findFirst({ where: { id: general } }))?.createdByKey, "store");
    const sent = await send(carlTok, "topic", general, { kind: "text", body: "first one here", clientId: "carl-1" });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    const after = await call(inbox, req("GET", "/community/inbox", carlTok));
    assert.equal(after.json.data.channels[1].previewTopic, "General", "channel rows name the topic of their latest message");
    const announceGeneral = r.json.data.channels[0].generalTopicId as string;
    assert.equal((await send(carlTok, "topic", announceGeneral, { kind: "text", body: "nope", clientId: "carl-2" })).status, 403, "announcements stay store-only");
  });
  await test("switching to open lets everyone waiting in; moderators only", async () => {
    assert.equal((await call(membersPatch, req("PATCH", "/community/members", annTok, { joinMode: "open" }))).status, 403);
    assert.equal((await call(membersPatch, req("PATCH", "/community/members", ownerTok, { joinMode: "anyone" }))).status, 400);
    const waiting = (await db.communityMember.findMany({ where: { tenantId: A.id, status: "pending" }, select: { customerId: true } })).map((m) => m.customerId);
    assert.ok(waiting.includes(eve.id));
    const r = await call(membersPatch, req("PATCH", "/community/members", ownerTok, { joinMode: "open" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.joinMode, "open");
    assert.equal(await db.communityMember.count({ where: { tenantId: A.id, status: "pending" } }), 0);
    assert.equal((await db.communityMember.findFirst({ where: { customerId: eve.id } }))?.status, "approved", "eve re-applied → let in");
    const cfg = (await db.branding.findFirst({ where: { tenantId: A.id } }))?.config as Json;
    assert.equal(cfg.name, "Alpha Glow", "other branding keys survive");
    await call(membersPatch, req("PATCH", "/community/members", ownerTok, { joinMode: "approval" }));
    // Put Alpha back the way the rest of the suite expects it.
    await db.communityMember.updateMany({ where: { customerId: { in: waiting } }, data: { status: "pending", reviewedAt: null, reviewedBy: null } });
  });

  console.log("\nchannels, topics, messages");
  await test("an approved member reads the inbox; admins-only channel says why", async () => {
    const r = await call(inbox, req("GET", "/community/inbox", annTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const announce = r.json.data.channels.find((c: Json) => c.id === announceChannelId);
    assert.equal(announce.canPost, false);
    assert.equal(announce.canManage, false);
    const t = await list(annTok, "topic", announceGeneralId);
    assert.equal(t.json.data.thread.canPost, false);
    assert.equal(t.json.data.thread.postBlockedReason, "Only the store team posts here.");
  });
  let annMsgId = "";
  await test("members post in everyone channels, not in admins-only ones", async () => {
    const r = await send(annTok, "topic", generalId, { clientId: "c-1", kind: "text", body: "Hello https://ex.test/a !" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    annMsgId = r.json.data.id;
    assert.equal(r.json.data.mine, true);
    assert.equal(r.json.data.canEdit, true);
    const blocked = await send(annTok, "topic", announceGeneralId, { clientId: "c-2", kind: "text", body: "hi" });
    assert.equal(blocked.status, 403);
    assert.equal((await send(ownerTok, "topic", announceGeneralId, { clientId: "o-1", kind: "text", body: "Welcome" })).status, 200);
  });
  await test("re-sending the same clientId never posts twice", async () => {
    const r = await send(annTok, "topic", generalId, { clientId: "c-1", kind: "text", body: "Hello https://ex.test/a !" });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.id, annMsgId);
    const topic = await db.communityTopic.findUnique({ where: { id: generalId } });
    assert.equal(topic!.messageCount, 1);
    assert.ok(topic!.lastMessageAt);
  });
  await test("empty / oversized text refused", async () => {
    assert.equal((await send(annTok, "topic", generalId, { clientId: "c-e", kind: "text", body: "  " })).status, 400);
    assert.equal((await send(annTok, "topic", generalId, { clientId: "c-f", kind: "text", body: "x".repeat(2001) })).status, 400);
  });
  await test("product + protocol cards are re-read server-side; foreign ids refused", async () => {
    const p = await send(bobTok, "topic", generalId, { clientId: "b-p", kind: "product", productId: product.id, variationId: "10mg" });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.data.product.name, "BPC-157");
    assert.equal(p.json.data.product.variationName, "10mg");
    assert.equal(p.json.data.product.price, 1800);
    assert.equal(p.json.data.product.stockLeft, 3);
    const foreign = await send(bobTok, "topic", generalId, { clientId: "b-x", kind: "product", productId: bProduct.id });
    assert.equal(foreign.status, 400);
    const badVar = await send(bobTok, "topic", generalId, { clientId: "b-v", kind: "product", productId: product.id, variationId: "99mg" });
    assert.equal(badVar.status, 400);
    const proto = await send(bobTok, "topic", generalId, { clientId: "b-pr", kind: "protocol", protocolId: "p-bpc-protocol" });
    assert.equal(proto.status, 200, JSON.stringify(proto.json));
    assert.equal(proto.json.data.protocol.dose, "250mcg");
    assert.equal((await send(bobTok, "topic", generalId, { clientId: "b-pq", kind: "protocol", protocolId: "p-nope" })).status, 400);
  });
  let replyId = "";
  await test("members list the store's protocols to share; others can't", async () => {
    const r = await call(protocols, req("GET", "/community/protocols", annTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.protocols.map((p: Json) => p.name), ["BPC Protocol"]);
    assert.equal((await call(protocols, req("GET", "/community/protocols", eveTok))).status, 403, "not a member");
  });
  await test("replies quote the original", async () => {
    const r = await send(bobTok, "topic", generalId, { clientId: "b-r", kind: "text", body: "Hi Ann", replyToId: annMsgId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.replyTo.id, annMsgId);
    assert.equal(r.json.data.replyTo.senderName, "Ann Cruz");
    assert.equal(typeof r.json.data.replyTo.senderHue, "number", "the quote wears Ann's name colour");
    assert.equal(r.json.data.replyTo.senderIsTeam, false);
    replyId = r.json.data.id;
  });
  await test("edit: own text within 15 minutes only", async () => {
    const other = await call(messagePatch, req("PATCH", `/community/messages/${annMsgId}`, bobTok, { body: "hacked" }), { id: annMsgId });
    assert.equal(other.status, 403);
    const mine = await call(messagePatch, req("PATCH", `/community/messages/${annMsgId}`, annTok, { body: "Hello again https://ex.test/a" }), { id: annMsgId });
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json.data.body, "Hello again https://ex.test/a");
    assert.ok(mine.json.data.editedAt);
    await db.communityMessage.update({ where: { id: replyId }, data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const late = await call(messagePatch, req("PATCH", `/community/messages/${replyId}`, bobTok, { body: "late" }), { id: replyId });
    assert.equal(late.status, 403);
  });
  let pollCursor = "";
  await test("paging: newest first with an older cursor", async () => {
    const r = await list(annTok, "topic", generalId, "?limit=2");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.messages.length, 2);
    assert.ok(r.json.data.olderCursor);
    const older = await list(annTok, "topic", generalId, `?before=${r.json.data.olderCursor}`);
    assert.ok(older.json.data.messages.length >= 1);
    const ids = new Set(r.json.data.messages.map((m: Json) => m.id));
    assert.ok(older.json.data.messages.every((m: Json) => !ids.has(m.id)));
    pollCursor = (await list(annTok, "topic", generalId)).json.data.pollCursor;
  });
  await test("delete: members can't delete others; moderators can in topics; poll reports it", async () => {
    assert.equal((await call(messageDelete, req("DELETE", `/community/messages/${annMsgId}`, bobTok), { id: annMsgId })).status, 403);
    const newer = await send(bobTok, "topic", generalId, { clientId: "b-new", kind: "text", body: "new one" });
    const del = await call(messageDelete, req("DELETE", `/community/messages/${replyId}`, modTok), { id: replyId });
    assert.equal(del.status, 200, JSON.stringify(del.json));
    const poll = await list(annTok, "topic", generalId, `?after=${pollCursor}`);
    assert.equal(poll.status, 200, JSON.stringify(poll.json));
    assert.deepEqual(poll.json.data.messages.map((m: Json) => m.id), [newer.json.data.id]);
    const changed = poll.json.data.changed.find((m: Json) => m.id === replyId);
    assert.ok(changed?.deletedAt, "the deletion reaches pollers");
    assert.equal(changed.body, null, "deleted content is not re-served");
    const again = await list(annTok, "topic", generalId, `?after=${poll.json.data.pollCursor}`);
    assert.equal(again.json.data.messages.length, 0);
    assert.equal(again.json.data.changed.length, 0);
  });
  await test("search is scoped to threads the reader can see", async () => {
    const r = await call(search, req("GET", "/community/search?q=hello&scope=everywhere", bobTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.data.hits.some((hit: Json) => hit.message.id === annMsgId));
    assert.equal((await call(search, req("GET", "/community/search?q=h", bobTok))).status, 400);
  });
  await test("shared: links and listings tabs", async () => {
    const links = await call(sharedGet, req("GET", `/community/threads/topic/${generalId}/shared?tab=links`, annTok), { type: "topic", id: generalId });
    assert.equal(links.status, 200, JSON.stringify(links.json));
    assert.ok(links.json.data.items.some((m: Json) => m.id === annMsgId));
    const listings = await call(sharedGet, req("GET", `/community/threads/topic/${generalId}/shared?tab=listings`, annTok), { type: "topic", id: generalId });
    assert.ok(listings.json.data.items.some((m: Json) => m.kind === "product"));
  });
  let topicId = "";
  await test("topics: members create in everyone channels; moderators manage; General stays", async () => {
    const t = await call(topicsPost, req("POST", `/community/channels/${communityChannelId}/topics`, annTok, { name: "Stacks", emoji: "🧪", imageUrl: null }), { id: communityChannelId });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    topicId = t.json.data.id;
    assert.equal((await call(topicsPost, req("POST", `/community/channels/${announceChannelId}/topics`, annTok, { name: "Nope", emoji: "", imageUrl: null }), { id: announceChannelId })).status, 403);
    assert.equal((await call(topicPatch, req("PATCH", `/community/topics/${topicId}`, annTok, { name: "Renamed", emoji: "", imageUrl: null }), { id: topicId })).status, 403);
    assert.equal((await call(topicPatch, req("PATCH", `/community/topics/${topicId}`, ownerTok, { name: "Stacks 2", emoji: "🧪", imageUrl: null, isPinned: true }), { id: topicId })).status, 200);
    assert.equal((await call(topicDelete, req("DELETE", `/community/topics/${generalId}`, ownerTok), { id: generalId })).status, 403);
    const detail = await call(channelGet, req("GET", `/community/channels/${communityChannelId}`, annTok), { id: communityChannelId });
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.equal(detail.json.data.topics.length, 2);
    assert.equal(detail.json.data.topics[0].isPinned || detail.json.data.topics[0].isGeneral, true);
    assert.equal((await call(topicDelete, req("DELETE", `/community/topics/${topicId}`, ownerTok), { id: topicId })).status, 200);
  });
  await test("channels: moderator-only CRUD", async () => {
    assert.equal((await call(channelsPost, req("POST", "/community/channels", annTok, { name: "Mine", description: "", emoji: "", imageUrl: null, postRole: "everyone" }))).status, 403);
    const c = await call(channelsPost, req("POST", "/community/channels", modTok, { name: "Deals", description: "", emoji: "🔥", imageUrl: null, postRole: "admins" }));
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const id = c.json.data.id;
    assert.ok(c.json.data.generalTopicId);
    assert.equal((await call(channelPatch, req("PATCH", `/community/channels/${id}`, ownerTok, { name: "Hot deals", description: "x", emoji: "🔥", imageUrl: null, postRole: "admins" }), { id })).status, 200);
    assert.equal((await call(channelDelete, req("DELETE", `/community/channels/${id}`, annTok), { id })).status, 403);
    assert.equal((await call(channelDelete, req("DELETE", `/community/channels/${id}`, ownerTok), { id })).status, 200);
    assert.equal(await db.communityTopic.count({ where: { channelId: id } }), 0);
  });

  console.log("\nDMs, unread, push");
  const ownerDevice = "ExponentPushToken[owner-device-0001]";
  const annDevice = "ExponentPushToken[ann-device-00001]";
  const bobDevice = "ExponentPushToken[bob-device-00001]";
  await test("devices: customers register (never for new orders)", async () => {
    assert.equal((await call(devices, req("POST", "/devices", ownerTok, { expoPushToken: ownerDevice, platform: "ios", newOrders: true }))).status, 200);
    const a = await call(devices, req("POST", "/devices", annTok, { expoPushToken: annDevice, platform: "android", newOrders: true }));
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.data.newOrders, false);
    assert.equal((await call(devices, req("POST", "/devices", bobTok, { expoPushToken: bobDevice, platform: "ios", newOrders: false }))).status, 200);
    const row = await db.mobilePushDevice.findUnique({ where: { expoPushToken: annDevice } });
    assert.equal(row!.newOrders, false);
    assert.equal(row!.messages, true);
  });
  await test("a live session can't take over another account's device token", async () => {
    const r = await call(devices, req("POST", "/devices", bobTok, { expoPushToken: annDevice, platform: "ios", newOrders: false }));
    assert.equal(r.status, 400, JSON.stringify(r.json));
    const row = await db.mobilePushDevice.findUnique({ where: { expoPushToken: annDevice }, include: { session: true } });
    assert.equal(row!.session.subject, `customer:${ann.id}`);
  });
  let dmId = "";
  await test("opening a DM is idempotent from either side", async () => {
    const r = await call(dms, req("POST", "/community/dms", annTok, { peerKey: "store" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    dmId = r.json.data.conversationId;
    assert.equal((await call(dms, req("POST", "/community/dms", annTok, { peerKey: "store" }))).json.data.conversationId, dmId);
    assert.equal((await call(dms, req("POST", "/community/dms", ownerTok, { peerKey: `c:${ann.id}` }))).json.data.conversationId, dmId);
    assert.equal((await call(dms, req("POST", "/community/dms", annTok, { peerKey: `c:${eve.id}` }))).status, 403, "eve isn't approved");
    assert.equal((await call(dms, req("POST", "/community/dms", annTok, { peerKey: `c:${carl.id}` }))).status, 403, "other store's customer");
  });
  await test("a DM pushes the store's phones, with no message text on the lock screen", async () => {
    // Channel messages posted earlier queued their pushes; deliver those first.
    await flushAfter();
    pushed.length = 0;
    const r = await send(annTok, "dm", dmId, { clientId: "dm-1", kind: "text", body: "Secret dosing question" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await flushAfter();
    assert.equal(pushed.length, 1, JSON.stringify(pushed));
    assert.equal(pushed[0].to, ownerDevice);
    assert.deepEqual(pushed[0].data, { type: "dm", threadId: dmId });
    assert.ok(!JSON.stringify(pushed[0]).includes("Secret"));
    assert.ok(String(pushed[0].body).includes("Ann"));
  });
  await test("DM pushes are throttled per conversation per recipient", async () => {
    pushed.length = 0;
    assert.equal((await send(annTok, "dm", dmId, { clientId: "dm-2", kind: "text", body: "and another" })).status, 200);
    await flushAfter();
    assert.equal(pushed.length, 0, "second DM within 3 minutes stays quiet");
  });
  await test("unread counts from server-side read markers; reading clears them", async () => {
    const box = await call(inbox, req("GET", "/community/inbox", ownerTok));
    const conv = box.json.data.conversations.find((c: Json) => c.id === dmId);
    assert.equal(conv.unread, 2);
    assert.equal(conv.peer.name, "Ann Cruz");
    assert.ok(box.json.data.unreadChats >= 1);
    const read = await call(readPost, req("POST", `/community/threads/dm/${dmId}/read`, modTok, { at: new Date().toISOString() }), { type: "dm", id: dmId });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    const after = await call(inbox, req("GET", "/community/inbox", ownerTok));
    assert.equal(after.json.data.conversations.find((c: Json) => c.id === dmId).unread, 0, "one shared store inbox");
    await call(readPost, req("POST", `/community/threads/dm/${dmId}/read`, ownerTok, { at: "2020-01-01T00:00:00Z" }), { type: "dm", id: dmId });
    const still = await call(inbox, req("GET", "/community/inbox", ownerTok));
    assert.equal(still.json.data.conversations.find((c: Json) => c.id === dmId).unread, 0, "never moves backwards");
  });
  await test("the store replies; the customer's phone is pushed; store can't delete the customer's DM", async () => {
    pushed.length = 0;
    const r = await send(modTok, "dm", dmId, { clientId: "s-1", kind: "text", body: "Happy to help" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.sender.isTeam, true);
    assert.equal(r.json.data.authorName, "Mo Mod", "moderators see which teammate wrote it");
    await flushAfter();
    assert.deepEqual(pushed.map((p) => p.to), [annDevice]);
    const annView = await list(annTok, "dm", dmId);
    const teamMsg = annView.json.data.messages.find((m: Json) => m.id === r.json.data.id);
    assert.equal(teamMsg.authorName, null, "customers never see the staffer");
    const annFirst = annView.json.data.messages.find((m: Json) => m.body === "Secret dosing question");
    assert.equal((await call(messageDelete, req("DELETE", `/community/messages/${annFirst.id}`, ownerTok), { id: annFirst.id })).status, 403);
    assert.equal((await list(bobTok, "dm", dmId)).status, 404, "outsiders can't read a DM");
  });
  let pushTopicId = "";
  await test("channel mute: members only, a visible channel, an explicit boolean", async () => {
    const mute = (tok: string, id: string, body: Json) => call(channelMute, req("PUT", `/community/channels/${id}/mute`, tok, body), { id });
    assert.equal((await mute(ownerTok, communityChannelId, { muted: true })).status, 403, "the store team gets no channel pushes");
    assert.equal((await mute(bobTok, communityChannelId, { muted: "yes" })).status, 400);
    assert.equal((await mute(bobTok, "no-such-channel", { muted: true })).status, 404);
    const r = await mute(bobTok, communityChannelId, { muted: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data, { channelId: communityChannelId, muted: true });
    assert.equal((await mute(bobTok, communityChannelId, { muted: true })).status, 200, "muting twice is fine");
    assert.equal(await db.communityChannelMute.count({ where: { channelId: communityChannelId } }), 1);
    const box = await call(inbox, req("GET", "/community/inbox", bobTok));
    assert.equal(box.json.data.channels.find((c: Json) => c.id === communityChannelId).muted, true);
    const teamBox = await call(inbox, req("GET", "/community/inbox", ownerTok));
    assert.equal(teamBox.json.data.channels.find((c: Json) => c.id === communityChannelId).muted, undefined, "no toggle for the team");
  });
  await test("a channel message pushes the other members, never the sender or anyone who muted it", async () => {
    await flushAfter();
    pushed.length = 0;
    await send(annTok, "topic", generalId, { clientId: "c-muted", kind: "text", body: "Secret restock chat" });
    await flushAfter();
    assert.equal(pushed.length, 0, "bob muted the channel, ann sent it, the store gets no channel pushes");
  });
  await test("unmuted again, the member is pushed — channel and sender named, never the message", async () => {
    const r = await call(channelMute, req("PUT", `/community/channels/${communityChannelId}/mute`, bobTok, { muted: false }), { id: communityChannelId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await db.communityChannelMute.count({ where: { channelId: communityChannelId } }), 0);
    // A fresh topic: the General topic's earlier messages already used bob's throttle slot.
    const t = await call(topicsPost, req("POST", `/community/channels/${communityChannelId}/topics`, ownerTok, { name: "Restock talk", emoji: "📦", imageUrl: null }), { id: communityChannelId });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    pushTopicId = t.json.data.id;
    pushed.length = 0;
    await send(annTok, "topic", pushTopicId, { clientId: "c-loud", kind: "text", body: "Secret restock chat" });
    await flushAfter();
    assert.deepEqual(pushed.map((p) => p.to), [bobDevice]);
    assert.deepEqual(pushed[0].data, { type: "topic", threadId: pushTopicId });
    assert.equal(pushed[0].body, "Ann posted in Restock talk");
    assert.ok(!JSON.stringify(pushed[0]).includes("Secret"));
  });
  await test("channel pushes are throttled per topic per recipient", async () => {
    pushed.length = 0;
    await send(annTok, "topic", pushTopicId, { clientId: "c-again", kind: "text", body: "and another" });
    await flushAfter();
    assert.equal(pushed.length, 0, "bob was just pushed for this topic");
  });
  let dropId = "";
  await test("a drop posts into the channel's General topic and pushes every member", async () => {
    pushed.length = 0;
    assert.equal((await call(dropsPost, req("POST", "/community/drops", annTok, {}))).status, 403);
    const r = await call(dropsPost, req("POST", "/community/drops", ownerTok, {
      productId: product.id, variationId: null, headline: "Fresh BPC restock", note: "", durationMinutes: 120, channelId: communityChannelId,
    }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    dropId = r.json.data.id;
    assert.equal(r.json.data.topicId, generalId);
    assert.equal(r.json.data.product.stockLeft, 10, "whole product: base pool + tracked variation");
    await flushAfter();
    assert.deepEqual(pushed.map((p) => p.to).sort(), [annDevice, bobDevice].sort());
    assert.deepEqual(pushed[0].data, { type: "drop", threadId: generalId });
    const t = await list(annTok, "topic", generalId);
    const dropMsg = t.json.data.messages.find((m: Json) => m.kind === "drop");
    assert.equal(dropMsg.drop.id, dropId);
    assert.equal(dropMsg.canEdit, false);
    const live = await call(dropsGet, req("GET", "/community/drops", annTok));
    assert.equal(live.json.data.drops.length, 1);
    assert.equal((await call(dropEnd, req("POST", `/community/drops/${dropId}/end`, ownerTok), { id: dropId })).status, 200);
    assert.equal((await call(dropsGet, req("GET", "/community/drops", annTok))).json.data.drops.length, 0);
  });
  // ── group buy in chat ──────────────────────────────────────────────────
  const fGb = await db.feature.create({ data: { key: "groupbuy.module" } });
  await db.tenantFeatureOverride.create({ data: { tenantId: A.id, featureId: fGb.id, enabled: true } });
  await db.product.create({
    data: { tenantId: A.id, sku: "TIRZ", slug: "tirz", name: "Tirzepatide", priceCents: 300000, stock: 0, metadata: { productType: "gb", gbPrice: 2200 } },
  });
  const round = await db.groupBuy.create({
    data: { tenantId: A.id, name: "GB #5", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), deliveryEta: "3 weeks after close", slotGoal: 20 },
  });
  await test("group buy: the live round is a card, and anyone may share it while it's open", async () => {
    const live = await call(groupBuyGet, req("GET", "/community/group-buy", annTok));
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal(live.json.data.groupBuy?.id, round.id);
    assert.equal(live.json.data.groupBuy.status, "open");
    assert.equal(live.json.data.groupBuy.fromPriceLabel, "₱2,200");
    assert.equal(live.json.data.canBroadcast, false);
    assert.equal((await call(groupBuyGet, req("GET", "/community/group-buy", ownerTok))).json.data.canBroadcast, true);

    const sent = await call(messagesPost, req("POST", `/community/threads/topic/${generalId}/messages`, annTok, { clientId: "gb-share-1", kind: "groupbuy", groupBuyId: round.id, body: "Join me!" }), { type: "topic", id: generalId });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.data.kind, "groupbuy");
    assert.equal(sent.json.data.groupBuy.status, "open", "the sender sees the live card");
    assert.equal(sent.json.data.groupBuy.slotGoal, 20);
    const t = await list(bobTok, "topic", generalId);
    const card = t.json.data.messages.find((m: Json) => m.kind === "groupbuy");
    assert.equal(card.groupBuy.name, "GB #5");
    assert.equal(card.groupBuy.status, "open", "readers see it live too");
  });
  await test("group buy: a made-up or stale round id is refused", async () => {
    const r = await call(messagesPost, req("POST", `/community/threads/topic/${generalId}/messages`, annTok, { clientId: "gb-share-bad", kind: "groupbuy", groupBuyId: "not-a-round" }), { type: "topic", id: generalId });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /isn't open/);
  });
  await test("group buy: send to everyone is moderator-only, posts per channel, pushes once, and a retry posts nothing", async () => {
    pushed.length = 0;
    const body = { clientId: "bc1", channelIds: [communityChannelId], note: "Slots filling fast" };
    assert.equal((await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", annTok, body))).status, 403);
    const r = await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", ownerTok, body));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.posted, 1);
    assert.deepEqual(r.json.data.topicIds, [generalId]);
    await flushAfter();
    assert.deepEqual(pushed.map((p) => p.to).sort(), [annDevice, bobDevice].sort());
    assert.deepEqual(pushed[0].data, { type: "group_buy", threadId: generalId });

    pushed.length = 0;
    const again = await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", ownerTok, body));
    assert.equal(again.json.data.posted, 0, "same clientId → nothing new");
    await flushAfter();
    assert.equal(pushed.length, 0, "and nobody is pushed twice");
    const t = await list(annTok, "topic", generalId);
    const fromStore = t.json.data.messages.filter((m: Json) => m.kind === "groupbuy" && m.body === "Slots filling fast");
    assert.equal(fromStore.length, 1);
    assert.equal(fromStore[0].sender.isTeam, true);

    // Another staff member re-announces: the card posts, but members aren't buzzed again so soon.
    const second = await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", modTok, { clientId: "bc-mod", channelIds: [communityChannelId], note: "Reminder" }));
    assert.equal(second.json.data.posted, 1);
    await flushAfter();
    assert.equal(pushed.length, 0, "one push per round per store every 30 minutes");
  });
  await test("group buy: once the round closes, every card reads ended and nothing new can be shared", async () => {
    await db.groupBuy.update({ where: { id: round.id }, data: { status: "closed", closedAt: new Date() } });
    clearLiveGroupBuyCache(A.id); // the live card is cached per tenant for 15 s
    const t = await list(annTok, "topic", generalId);
    const cards = t.json.data.messages.filter((m: Json) => m.kind === "groupbuy");
    assert.ok(cards.length >= 2);
    for (const c of cards) assert.equal(c.groupBuy.status, "ended");
    assert.equal((await call(groupBuyGet, req("GET", "/community/group-buy", annTok))).json.data.groupBuy, null);
    const r = await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", ownerTok, { clientId: "bc2", channelIds: [communityChannelId] }));
    assert.equal(r.status, 400);
  });
  await test("profiles: members edit theirs; others read it", async () => {
    const p = await call(profilePatch, req("PATCH", "/community/profile", annTok, { displayName: "Ann C", bio: "BPC fan" }));
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.data.name, "Ann C");
    assert.equal((await call(profileGet, req("GET", "/community/profile", annTok))).json.data.bio, "BPC fan");
    const other = await call(profilesGet, req("GET", `/community/profiles/c:${ann.id}`, bobTok), { key: `c:${ann.id}` });
    assert.equal(other.json.data.name, "Ann C");
    assert.equal((await call(profilesGet, req("GET", `/community/profiles/c:${eve.id}`, bobTok), { key: `c:${eve.id}` })).status, 404);
  });
  await test("account profile: a customer's nickname + photo show on their card everywhere", async () => {
    const accountPatch = (await import("../src/app/api/mobile/v1/account/profile/route")).PATCH;
    const photoPost = (await import("../src/app/api/mobile/v1/account/profile/photo/route")).POST;
    const r = await accountPatch(req("PATCH", "/account/profile", annTok, { name: "Ann Cruz", nickname: "Annie", bio: "Peptide nerd" }));
    assert.equal(r.status, 200);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000020000000308060000", "hex");
    const form = new FormData();
    form.append("file", new File([png], "me.png", { type: "image/png" }));
    const up = await photoPost(
      new Request("https://app.pepweb.store/api/mobile/v1/account/profile/photo", { method: "POST", headers: { authorization: `Bearer ${annTok}` }, body: form }),
    );
    assert.equal(up.status, 200);
    const card = (await call(profilesGet, req("GET", `/community/profiles/c:${ann.id}`, bobTok), { key: `c:${ann.id}` })).json.data;
    assert.equal(card.name, "Annie", "nickname shown to other members");
    assert.ok(String(card.imageUrl).startsWith("data:image/png"), "photo shown to other members");
    assert.equal(card.bio, "Peptide nerd", "bio mirrored onto the community row");
    const row = await db.communityMember.findFirst({ where: { customerId: ann.id } });
    assert.equal(row!.displayName, "Ann Cruz", "name mirrored onto the community row");
  });
  await test("uploads: sniffed images become an inline URL when ImageKit is off", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000020000000308060000", "hex");
    const form = new FormData();
    form.append("file", new File([png], "photo.bin", { type: "application/octet-stream" }));
    const r = await uploads(
      new Request("https://app.pepweb.store/api/mobile/v1/community/uploads", { method: "POST", headers: { authorization: `Bearer ${annTok}` }, body: form }),
      { params: Promise.resolve({}) },
    );
    const json = (await r.json()) as Json;
    assert.equal(r.status, 200, JSON.stringify(json));
    assert.equal(json.data.kind, "image");
    assert.equal(json.data.width, 2);
    assert.equal(json.data.height, 3);
    const sent = await send(annTok, "topic", generalId, { clientId: "c-img", kind: "image", upload: json.data });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.data.image.width, 2);
    const bad = new FormData();
    bad.append("file", new File([Buffer.from("MZ\x90\x00")], "x.exe", { type: "application/pdf" }));
    const r2 = await uploads(
      new Request("https://app.pepweb.store/api/mobile/v1/community/uploads", { method: "POST", headers: { authorization: `Bearer ${annTok}` }, body: bad }),
      { params: Promise.resolve({}) },
    );
    assert.equal(r2.status, 400);
  });

  console.log("\nsecurity hardening");
  const png = (w: number, h: number) =>
    Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.from([0, 0, 0, w, 0, 0, 0, h, 8, 6, 0, 0, 0])]);
  const upload = async (tok: string, bytes: Buffer, name: string, type = "") => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    const res = await uploads(
      new Request("https://app.pepweb.store/api/mobile/v1/community/uploads", { method: "POST", headers: { authorization: `Bearer ${tok}` }, body: form }),
      { params: Promise.resolve({}) },
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
  await test("attachments must be this participant's own upload; metadata comes from the record", async () => {
    const forged = await send(annTok, "topic", generalId, {
      clientId: "f-1", kind: "image", upload: { kind: "image", url: "https://evil.test/x.png", name: "x.png", size: 1, mime: "image/png", width: 1, height: 1 },
    });
    assert.equal(forged.status, 400, JSON.stringify(forged.json));
    const up = await upload(annTok, png(4, 5), "a.png");
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const stolen = await send(ownerTok, "topic", generalId, { clientId: "f-2", kind: "image", upload: up.json.data });
    assert.equal(stolen.status, 400, "someone else's upload");
    const lying = await send(annTok, "topic", generalId, { clientId: "f-3", kind: "image", upload: { ...up.json.data, width: 9999, height: 9999 } });
    assert.equal(lying.status, 200, JSON.stringify(lying.json));
    assert.deepEqual([lying.json.data.image.width, lying.json.data.image.height], [4, 5]);
    const asFile = await send(annTok, "topic", generalId, { clientId: "f-4", kind: "file", upload: { ...up.json.data, kind: "file" } });
    assert.equal(asFile.status, 400, "an image record can't be sent as a file");
  });
  await test("channel/topic pictures must be the store's own uploads", async () => {
    const bad = await call(channelsPost, req("POST", "/community/channels", ownerTok, { name: "Pics", description: "", emoji: "📷", imageUrl: "https://evil.test/p.png", postRole: "everyone" }));
    assert.equal(bad.status, 400, "forged picture URL");
    const annPic = await upload(annTok, png(2, 2), "p.png");
    const notMine = await call(channelsPost, req("POST", "/community/channels", ownerTok, { name: "Pics", description: "", emoji: "📷", imageUrl: annPic.json.data.url, postRole: "everyone" }));
    assert.equal(notMine.status, 400, "a member's upload as a channel picture");
    const pic = await upload(ownerTok, png(3, 3), "p.png");
    const good = await call(channelsPost, req("POST", "/community/channels", modTok, { name: "Pics", description: "", emoji: "📷", imageUrl: pic.json.data.url, postRole: "everyone" }));
    assert.equal(good.status, 200, JSON.stringify(good.json));
    assert.equal((await call(topicsPost, req("POST", `/community/channels/${communityChannelId}/topics`, annTok, { name: "Mine", emoji: "🧪", imageUrl: pic.json.data.url }), { id: communityChannelId })).status, 400, "member topic with the store's picture");
    assert.equal((await call(channelsPost, req("POST", "/community/channels", ownerTok, { name: "Words", description: "", emoji: "ab", imageUrl: null, postRole: "everyone" }))).status, 400);
  });
  await test("inline uploads (no ImageKit) are capped at 2 MB", async () => {
    const big = Buffer.concat([png(2, 2), Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await upload(annTok, big, "big.png")).status, 400);
  });
  await test("control and bidi characters are stripped from file names", async () => {
    const up = await upload(annTok, Buffer.from("%PDF-1.7\n"), "inv\u202Efdp.exe.pdf");
    assert.equal(up.status, 200, JSON.stringify(up.json));
    assert.equal(up.json.data.name, "invfdp.exe.pdf");
  });
  await test("draft products can't be shared or dropped", async () => {
    assert.equal((await send(annTok, "topic", generalId, { clientId: "d-1", kind: "product", productId: draft.id })).status, 400);
    const drop = await call(dropsPost, req("POST", "/community/drops", ownerTok, { productId: draft.id, variationId: null, headline: "Soon", note: "", durationMinutes: null, channelId: communityChannelId }));
    assert.equal(drop.status, 400);
  });
  await test("a malformed profile key is simply not found", async () => {
    assert.equal((await call(profilesGet, req("GET", "/community/profiles/%E0%A4%A", annTok), { key: "%E0%A4%A" })).status, 404);
  });
  const fayTok = await token("fay@buyer.test", "fay-pass");
  await call(review, req("POST", `/community/members/${fay.id}/review`, ownerTok, { approve: true }), { customerId: fay.id });
  await test("rate limits: 30 sends a minute", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await send(fayTok, "topic", generalId, { clientId: `flood-${i}`, kind: "text", body: `flood ${i}` });
      assert.equal(r.status, 200, `send ${i}: ${JSON.stringify(r.json)}`);
    }
    const over = await send(fayTok, "topic", generalId, { clientId: "flood-x", kind: "text", body: "one too many" });
    assert.equal(over.status, 429);
  });
  await test("rate limits: 10 searches a minute, 10 DM opens an hour", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await call(search, req("GET", "/community/search?q=flood", fayTok))).status, 200);
    assert.equal((await call(search, req("GET", "/community/search?q=flood", fayTok))).status, 429);
    for (let i = 0; i < 10; i++) assert.equal((await call(dms, req("POST", "/community/dms", fayTok, { peerKey: "store" }))).status, 200);
    assert.equal((await call(dms, req("POST", "/community/dms", fayTok, { peerKey: "store" }))).status, 429);
  });
  await test("rate limits: 5 topics an hour", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call(topicsPost, req("POST", `/community/channels/${communityChannelId}/topics`, fayTok, { name: `Fay ${i}`, emoji: "", imageUrl: null }), { id: communityChannelId });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    assert.equal((await call(topicsPost, req("POST", `/community/channels/${communityChannelId}/topics`, fayTok, { name: "Fay 6", emoji: "", imageUrl: null }), { id: communityChannelId })).status, 429);
  });
  await test("rate limits: 10 profile edits an hour", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await call(profilePatch, req("PATCH", "/community/profile", fayTok, { displayName: `Fay ${i}`, bio: "" }))).status, 200);
    assert.equal((await call(profilePatch, req("PATCH", "/community/profile", fayTok, { displayName: "Fay X", bio: "" }))).status, 429);
  });

  console.log("\nverified resellers hub + welcome message");
  {
    const D = await mkTenant("resell", "Resell", true); // open community
    const rita = await mkCustomer(D.id, "rita@buyer.test", "Rita Reseller", "rita-pass");
    await mkCustomer(D.id, "nora@buyer.test", "Nora Normal", "nora-pass");
    const dOwnerTok = await token("owner@resell.test", "owner-pass");
    const ritaTok = await token("rita@buyer.test", "rita-pass");
    const noraTok = await token("nora@buyer.test", "nora-pass");
    let hubId = "";
    let onHandId = "";
    let lookingForId = "";
    const channelNames = async (tok: string) =>
      ((await call(inbox, req("GET", "/community/inbox", tok))).json.data.channels as Json[]).map((c) => c.name);
    const hubTopics = async (tok: string) =>
      (await call(channelGet, req("GET", `/community/channels/${hubId}`, tok), { id: hubId })).json.data.topics as Json[];

    await test("the owner opens a Verified Resellers Hub with On hand + Looking for", async () => {
      const r = await call(channelsPost, req("POST", "/community/channels", dOwnerTok, { name: "Verified Resellers Hub", description: "", emoji: "🤝", imageUrl: null, postRole: "everyone", audience: "hub" }));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.audience, "hub");
      assert.equal(r.json.data.topicCount, 2, "a hub always opens as its topic list");
      hubId = r.json.data.id;
      onHandId = r.json.data.generalTopicId;
      const topics = await hubTopics(dOwnerTok);
      assert.deepEqual(topics.map((t) => t.name), ["On hand", "Looking for"]);
      lookingForId = topics.find((t) => !t.isGeneral)!.id;
      assert.equal((await send(dOwnerTok, "topic", onHandId, { kind: "text", body: "wholesale tirz on hand", clientId: "rs-1" })).status, 200);
    });
    await test("the old resellers-only audience and unknown audiences are refused", async () => {
      assert.equal((await call(channelsPost, req("POST", "/community/channels", dOwnerTok, { name: "Old", audience: "resellers" }))).status, 400);
      assert.equal((await call(channelsPost, req("POST", "/community/channels", dOwnerTok, { name: "VIP", audience: "vip" }))).status, 400);
    });
    await test("every member sees and reads the hub, and searches it", async () => {
      assert.ok((await channelNames(noraTok)).includes("Verified Resellers Hub"));
      const r = await list(noraTok, "topic", onHandId);
      assert.equal(r.status, 200);
      assert.equal(r.json.data.thread.title, "On hand");
      const found = await call(search, req("GET", "/community/search?q=wholesale", noraTok));
      assert.equal(found.json.data.hits.length, 1);
    });
    await test("a member who isn't a verified reseller posts in Looking for, not On hand", async () => {
      const onHand = await list(noraTok, "topic", onHandId);
      assert.equal(onHand.json.data.thread.canPost, false);
      assert.match(onHand.json.data.thread.postBlockedReason, /verified resellers/i);
      assert.equal((await send(noraTok, "topic", onHandId, { kind: "text", body: "selling mine", clientId: "n-1" })).status, 403);
      const lf = await list(noraTok, "topic", lookingForId);
      assert.equal(lf.json.data.thread.canPost, true);
      assert.match(lf.json.data.thread.composerHint, /looking for/i);
      assert.equal((await send(noraTok, "topic", lookingForId, { kind: "text", body: "need 2 vials of BPC", clientId: "n-2" })).status, 200);
      const t = (await hubTopics(noraTok)).map((x) => [x.name, x.canPost]);
      assert.deepEqual(t, [["On hand", false], ["Looking for", true]]);
      const detail = await call(channelGet, req("GET", `/community/channels/${hubId}`, noraTok), { id: hubId });
      assert.equal(detail.json.data.channel.canPost, false, "members don't add topics to a hub");
      assert.equal((await call(topicsPost, req("POST", `/community/channels/${hubId}/topics`, noraTok, { name: "Sneaky" }), { id: hubId })).status, 403);
    });
    await test("only the team can verify a reseller", async () => {
      const r = await call(memberPatch, req("PATCH", `/community/members/${rita.id}`, ritaTok, { verifiedReseller: true }), { customerId: rita.id });
      assert.equal(r.status, 403);
      const bad = await call(memberPatch, req("PATCH", `/community/members/${rita.id}`, dOwnerTok, { verifiedReseller: "yes" }), { customerId: rita.id });
      assert.equal(bad.status, 400);
      const other = await call(memberPatch, req("PATCH", `/community/members/${ann.id}`, dOwnerTok, { verifiedReseller: true }), { customerId: ann.id });
      assert.equal(other.status, 404, "another store's customer is not found");
    });
    await test("a verified reseller posts their on-hand stock", async () => {
      const r = await call(memberPatch, req("PATCH", `/community/members/${rita.id}`, dOwnerTok, { verifiedReseller: true }), { customerId: rita.id });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.verifiedReseller, true);
      const listed = await call(members, req("GET", "/community/members", dOwnerTok));
      assert.equal((listed.json.data.members as Json[]).find((m) => m.customerId === rita.id)?.verifiedReseller, true);
      const onHand = await list(ritaTok, "topic", onHandId);
      assert.equal(onHand.json.data.thread.canPost, true);
      assert.match(onHand.json.data.thread.composerHint, /on hand/i);
      assert.equal((await send(ritaTok, "topic", onHandId, { kind: "text", body: "5x BPC on hand", clientId: "r-1" })).status, 200);
      assert.equal((await send(ritaTok, "topic", lookingForId, { kind: "text", body: "I have it, DM me", clientId: "r-2" })).status, 200);
      const seen = await list(noraTok, "topic", onHandId);
      const post = (seen.json.data.messages as Json[]).find((m) => m.body === "5x BPC on hand")!;
      assert.equal(post.sender.isVerifiedReseller, true, "members see who is verified");
    });
    await test("un-verifying stops On hand posts but keeps the hub", async () => {
      await call(memberPatch, req("PATCH", `/community/members/${rita.id}`, dOwnerTok, { verifiedReseller: false }), { customerId: rita.id });
      assert.ok((await channelNames(ritaTok)).includes("Verified Resellers Hub"));
      assert.equal((await send(ritaTok, "topic", onHandId, { kind: "text", body: "more stock", clientId: "r-3" })).status, 403);
      assert.equal((await send(ritaTok, "topic", lookingForId, { kind: "text", body: "still here", clientId: "r-4" })).status, 200);
    });
    await test("turning an existing channel into a hub adds its topics", async () => {
      const c = await call(channelsPost, req("POST", "/community/channels", dOwnerTok, { name: "Trading", emoji: "💬", imageUrl: null, postRole: "admins" }));
      const id = c.json.data.id as string;
      const u = await call(channelPatch, req("PATCH", `/community/channels/${id}`, dOwnerTok, { name: "Trading", emoji: "💬", imageUrl: null, postRole: "admins", audience: "hub" }), { id });
      assert.equal(u.status, 200, JSON.stringify(u.json));
      assert.equal(u.json.data.postRole, "everyone");
      const topics = (await call(channelGet, req("GET", `/community/channels/${id}`, dOwnerTok), { id })).json.data.topics as Json[];
      assert.deepEqual(topics.map((t) => t.name), ["On hand", "Looking for"]);
      const again = await call(channelPatch, req("PATCH", `/community/channels/${id}`, dOwnerTok, { name: "Trading 2", emoji: "💬", imageUrl: null, postRole: "everyone", audience: "hub" }), { id });
      assert.equal(again.json.data.topicCount, 2, "saving a hub again never duplicates its topics");
    });

    const welcomeDms = (customerId: string) =>
      db.communityMessage.count({ where: { tenantId: D.id, senderKey: "store", clientId: { startsWith: `welcome:${customerId}` } } });
    const setWelcomeAs = (tok: string, welcome: unknown) => call(membersPatch, req("PATCH", "/community/members", tok, { welcome }));
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
    let photoUrl = "";
    let videoUrl = "";
    await test("the welcome message is off by default", async () => {
      const r = await call(members, req("GET", "/community/members", dOwnerTok));
      assert.deepEqual(r.json.data.welcome, { enabled: false, messages: [], message: "" });
      assert.equal(await welcomeDms(rita.id), 0);
    });
    await test("the team uploads a welcome photo and video; members can't upload video", async () => {
      const photo = await upload(dOwnerTok, png(4, 3), "shop.png");
      assert.equal(photo.status, 200, JSON.stringify(photo.json));
      photoUrl = photo.json.data.url;
      const video = await upload(dOwnerTok, mp4, "intro.MOV", "video/quicktime");
      assert.equal(video.status, 200, JSON.stringify(video.json));
      assert.equal(video.json.data.kind, "video");
      assert.equal(video.json.data.mime, "video/mp4", "type comes from the bytes, not the name");
      videoUrl = video.json.data.url;
      assert.equal((await upload(noraTok, mp4, "clip.mp4", "video/mp4")).status, 400);
    });
    await test("video tickets: team only; without ImageKit the app is told to upload inline", async () => {
      const t = await call(videoTicket, req("POST", "/community/uploads/video", dOwnerTok, { name: "intro.mp4" }));
      assert.equal(t.status, 200, JSON.stringify(t.json));
      assert.deepEqual(t.json.data, { mode: "inline" });
      assert.equal((await call(videoTicket, req("POST", "/community/uploads/video", noraTok, { name: "x.mp4" }))).status, 403);
      assert.equal((await call(videoConfirm, req("POST", "/community/uploads/video/confirm", noraTok, { fileId: "abc" }))).status, 403);
      assert.equal((await call(videoConfirm, req("POST", "/community/uploads/video/confirm", dOwnerTok, { fileId: "../etc" }))).status, 400);
    });
    await test("the owner sets several welcome messages; bad input is refused", async () => {
      assert.equal((await setWelcomeAs(dOwnerTok, { enabled: true, messages: [] })).status, 400);
      assert.equal((await setWelcomeAs(dOwnerTok, { enabled: true, messages: [{ text: "  ", media: null }] })).status, 400);
      assert.equal((await setWelcomeAs(noraTok, { enabled: true, messages: [{ text: "hi" }] })).status, 403);
      const forged = await setWelcomeAs(dOwnerTok, { enabled: true, messages: [{ text: "", media: { kind: "image", url: "https://evil.example/x.png" } }] });
      assert.equal(forged.status, 400, "media must be this store's own upload");
      const wrongKind = await setWelcomeAs(dOwnerTok, { enabled: true, messages: [{ text: "", media: { kind: "video", url: photoUrl } }] });
      assert.equal(wrongKind.status, 400, "a photo can't pose as a video");
      const r = await setWelcomeAs(dOwnerTok, {
        enabled: true,
        messages: [
          { text: "Welcome to Delta! 💜", media: null },
          { text: "This is our shop", media: { kind: "image", url: photoUrl } },
          { text: "", media: { kind: "video", url: videoUrl } },
        ],
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const w = r.json.data.welcome;
      assert.equal(w.enabled, true);
      assert.equal(w.message, "Welcome to Delta! 💜");
      assert.deepEqual(w.messages.map((m: Json) => [m.text, m.media?.kind ?? null]), [["Welcome to Delta! 💜", null], ["This is our shop", "image"], ["", "video"]]);
      assert.deepEqual([w.messages[1].media.width, w.messages[1].media.height], [4, 3], "dimensions come from the upload record");
      assert.equal(new Set(w.messages.map((m: Json) => m.id)).size, 3, "every message gets its own id");
      const branding = await db.branding.findUnique({ where: { tenantId: D.id } });
      assert.equal((branding?.config as Json).communityJoin, undefined, "the join mode is left alone");
    });
    await test("reordering and deleting keep the ids the app sent", async () => {
      const current = (await call(members, req("GET", "/community/members", dOwnerTok))).json.data.welcome;
      const [a, b, c] = current.messages as Json[];
      const reordered = [c, a, b].map((m) => ({ id: m.id, text: m.text, media: m.media ? { kind: m.media.kind, url: m.media.url } : null }));
      const r = await setWelcomeAs(dOwnerTok, { enabled: true, messages: reordered });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.data.welcome.messages.map((m: Json) => m.id), [c.id, a.id, b.id]);
      const back = [a, b, c].map((m) => ({ id: m.id, text: m.text, media: m.media ? { kind: m.media.kind, url: m.media.url } : null }));
      assert.equal((await setWelcomeAs(dOwnerTok, { enabled: true, messages: back })).status, 200);
    });
    await test("an older app build saving { enabled, message } only edits the first message", async () => {
      const r = await setWelcomeAs(dOwnerTok, { enabled: true, message: "Welcome to Delta! 💜" });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.welcome.messages.length, 3, "photo and video survive");
    });
    await test("a new member gets every welcome message, in order, exactly once", async () => {
      const wen = await mkCustomer(D.id, "wen@buyer.test", "Wen New", "wen-pass");
      const wenTok = await token("wen@buyer.test", "wen-pass");
      const first = await call(inbox, req("GET", "/community/inbox", wenTok));
      assert.equal(first.status, 200, JSON.stringify(first.json));
      const dm = (first.json.data.conversations as Json[]).find((c) => c.peer.key === "store");
      assert.ok(dm, "a DM with the store is opened");
      assert.equal(dm.preview.text, "🎬 Video", "the last message is the preview");
      assert.equal(dm.unread, 3);
      const thread = await list(wenTok, "dm", dm.id);
      assert.equal(thread.status, 200, JSON.stringify(thread.json));
      const msgs = [...(thread.json.data.messages as Json[])].reverse();
      assert.deepEqual(msgs.map((m) => m.kind), ["text", "image", "video"]);
      assert.equal(msgs[0].body, "Welcome to Delta! 💜");
      assert.equal(msgs[1].body, "This is our shop");
      assert.equal(msgs[1].image.url, photoUrl);
      assert.equal(msgs[2].video.url, videoUrl);
      assert.equal(msgs[2].video.mime, "video/mp4");
      assert.equal(msgs[2].video.posterUrl, null, "inline uploads have no still frame");
      assert.equal(msgs[2].file, null, "a video is not a document card");
      await call(inbox, req("GET", "/community/inbox", wenTok));
      assert.equal(await welcomeDms(wen.id), 3, "never sent twice");
    });
    await test("turning the welcome off stops it for the next new member", async () => {
      await setWelcomeAs(dOwnerTok, { enabled: false, messages: [{ text: "Welcome to Delta! 💜", media: null }] });
      const zed = await mkCustomer(D.id, "zed@buyer.test", "Zed Later", "zed-pass");
      const zedTok = await token("zed@buyer.test", "zed-pass");
      const r = await call(inbox, req("GET", "/community/inbox", zedTok));
      assert.equal(r.status, 200);
      assert.equal(await welcomeDms(zed.id), 0);
    });
  }

  console.log("\ncommunity admins (members the team promotes)");
  {
    const E = await mkTenant("admins", "Admins", true); // open community
    const ada = await mkCustomer(E.id, "ada@buyer.test", "Ada Admin", "ada-pass");
    const pia = await mkCustomer(E.id, "pia@buyer.test", "Pia Peer", "pia-pass");
    const nell = await mkCustomer(E.id, "nell@buyer.test", "Nell Normal", "nell-pass");
    const eOwnerTok = await token("owner@admins.test", "owner-pass");
    const adaTok = await token("ada@buyer.test", "ada-pass");
    await token("pia@buyer.test", "pia-pass"); // first sign-in joins
    const nellTok = await token("nell@buyer.test", "nell-pass");
    const setAdmin = (tok: string, customerId: string, isAdmin: unknown) =>
      call(memberPatch, req("PATCH", `/community/members/${customerId}`, tok, { isAdmin }), { customerId });
    const sanction = await h("community/members/[customerId]/sanction/route", "POST");
    const savedReplies = await h("community/saved-replies/route", "GET");
  const tagsPatch = await h("community/tags/route", "PATCH");
    const moderation = await h("community/moderation/route", "GET");
    let teamChannel = "";
    let teamGeneral = "";

    await test("only the store team can make a member an admin", async () => {
      assert.equal((await setAdmin(adaTok, ada.id, true)).status, 403, "a member can't promote themselves");
      assert.equal((await setAdmin(eOwnerTok, ada.id, "yes")).status, 400);
      assert.equal((await setAdmin(eOwnerTok, ann.id, true)).status, 404, "another store's customer is not found");
      const r = await setAdmin(eOwnerTok, ada.id, true);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.data, { customerId: ada.id, isAdmin: true });
      const listed = await call(members, req("GET", "/community/members", eOwnerTok));
      assert.equal((listed.json.data.members as Json[]).find((m) => m.customerId === ada.id)?.isAdmin, true);
    });
    await test("/me tells the app the member is a community admin, not the store team", async () => {
      const c = (await call(me, req("GET", "/me", adaTok))).json.data.community;
      assert.equal(c.membership, "approved");
      assert.equal(c.isAdmin, true);
      assert.equal(c.isModerator, false, "older app builds must not show team-only tools");
      assert.equal(c.myKey, `c:${ada.id}`, "an admin still speaks as themselves");
      assert.equal((await call(me, req("GET", "/me", nellTok))).json.data.community.isAdmin, false);
    });
    await test("an admin posts in team-only channels and manages channels", async () => {
      const c = await call(channelsPost, req("POST", "/community/channels", eOwnerTok, { name: "Announcements", description: "", emoji: "📣", imageUrl: null, postRole: "admins" }));
      assert.equal(c.status, 200, JSON.stringify(c.json));
      teamChannel = c.json.data.id;
      teamGeneral = c.json.data.generalTopicId;
      const blocked = await send(nellTok, "topic", teamGeneral, { kind: "text", body: "me too", clientId: "nell-a" });
      assert.equal(blocked.status, 403, "a regular member still can't post here");
      const posted = await send(adaTok, "topic", teamGeneral, { kind: "text", body: "New batch Friday", clientId: "ada-a" });
      assert.equal(posted.status, 200, JSON.stringify(posted.json));
      assert.equal(posted.json.data.sender.key, `c:${ada.id}`);
      const own = await call(channelsPost, req("POST", "/community/channels", adaTok, { name: "Ada's corner", description: "", emoji: "🌸", imageUrl: null, postRole: "everyone" }));
      assert.equal(own.status, 200, JSON.stringify(own.json));
      const renamed = await call(channelPatch, req("PATCH", `/community/channels/${teamChannel}`, adaTok, { name: "News", description: "", emoji: "📣", imageUrl: null, postRole: "admins" }), { id: teamChannel });
      assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
      const listed = (await call(inbox, req("GET", "/community/inbox", adaTok))).json.data.channels as Json[];
      assert.equal(listed.find((ch) => ch.id === teamChannel)?.canManage, true);
      const nellView = (await call(inbox, req("GET", "/community/inbox", nellTok))).json.data.channels as Json[];
      assert.equal(nellView.find((ch) => ch.id === teamChannel)?.canManage, false);
    });
    await test("an admin deletes a member's message in a channel", async () => {
      const corner = ((await call(inbox, req("GET", "/community/inbox", nellTok))).json.data.channels as Json[]).find((ch) => ch.name === "Ada's corner");
      const sent = await send(nellTok, "topic", corner!.generalTopicId, { kind: "text", body: "spam spam", clientId: "nell-b" });
      assert.equal(sent.status, 200, JSON.stringify(sent.json));
      const id = sent.json.data.id;
      const r = await call(messageDelete, req("DELETE", `/community/messages/${id}`, adaTok), { id });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    });
    await test("an admin can't delete what the store team posted", async () => {
      const corner = ((await call(inbox, req("GET", "/community/inbox", eOwnerTok))).json.data.channels as Json[]).find((ch) => ch.name === "Ada's corner");
      const storeMsg = await send(eOwnerTok, "topic", corner!.generalTopicId, { kind: "text", body: "Official notice", clientId: "own-n" });
      assert.equal(storeMsg.status, 200, JSON.stringify(storeMsg.json));
      const id = storeMsg.json.data.id;
      const r = await call(messageDelete, req("DELETE", `/community/messages/${id}`, adaTok), { id });
      assert.equal(r.status, 403, JSON.stringify(r.json));
    });
    await test("admins are shown with an admin badge", async () => {
      const p = await call(profilesGet, req("GET", `/community/profiles/c:${ada.id}`, nellTok), { key: `c:${ada.id}` });
      assert.equal(p.status, 200, JSON.stringify(p.json));
      assert.equal(p.json.data.isAdmin, true);
      assert.equal(p.json.data.isTeam, false);
      const thread = await list(nellTok, "topic", teamGeneral);
      assert.equal((thread.json.data.messages as Json[])[0].sender.isAdmin, true);
      assert.equal(p.json.data.isVerifiedReseller, false, "no VR tag until the team adds one");
    });
    await test("a member can carry both the admin and the VR tag", async () => {
      const vr = await call(memberPatch, req("PATCH", `/community/members/${ada.id}`, eOwnerTok, { verifiedReseller: true }), { customerId: ada.id });
      assert.equal(vr.status, 200, JSON.stringify(vr.json));
      const row = (await call(members, req("GET", "/community/members", eOwnerTok))).json.data.members as Json[];
      const listed = row.find((m) => m.customerId === ada.id);
      assert.equal(listed?.isAdmin, true, "adding VR keeps the admin tag");
      assert.equal(listed?.verifiedReseller, true);
      const p = await call(profilesGet, req("GET", `/community/profiles/c:${ada.id}`, nellTok), { key: `c:${ada.id}` });
      assert.equal(p.json.data.isAdmin, true);
      assert.equal(p.json.data.isVerifiedReseller, true);
      const sender = ((await list(nellTok, "topic", teamGeneral)).json.data.messages as Json[])[0].sender;
      assert.equal(sender.isVerifiedReseller, true, "chat names carry the VR tag");
      const mine = (await call(me, req("GET", "/me", adaTok))).json.data.community;
      assert.equal(mine.isVerifiedReseller, true, "/me lets the profile show the VR tag");
      assert.equal(mine.isAdmin, true);
      await call(memberPatch, req("PATCH", `/community/members/${ada.id}`, eOwnerTok, { verifiedReseller: false }), { customerId: ada.id });
      const after = await call(profilesGet, req("GET", `/community/profiles/c:${ada.id}`, nellTok), { key: `c:${ada.id}` });
      assert.equal(after.json.data.isVerifiedReseller, false);
      assert.equal(after.json.data.isAdmin, true, "removing VR keeps the admin tag");
      assert.equal((await call(me, req("GET", "/me", adaTok))).json.data.community.isVerifiedReseller, false);
    });
    await test("the team and community admins restyle the member tags; members can't", async () => {
      const fresh = (await call(me, req("GET", "/me", nellTok))).json.data.community.tags;
      assert.equal(fresh.admin.label, "Admin", "defaults until someone saves");
      const design = { label: "Mod", icon: "flash", color: "#e11d48", style: "solid", shape: "rounded" };
      const r = await call(tagsPatch, req("PATCH", "/community/tags", eOwnerTok, { tags: { admin: design } }));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.data.tags.admin, { ...design, color: "#E11D48" });
      assert.equal(r.json.data.tags.reseller.label, "Verified reseller", "the other tag is untouched");
      const byAdmin = await call(tagsPatch, req("PATCH", "/community/tags", adaTok, { tags: { reseller: { label: "VR", icon: null, color: null, style: "outline", shape: "pill" } } }));
      assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.json));
      assert.equal(byAdmin.json.data.tags.admin.label, "Mod", "an admin's save keeps the owner's admin tag");
      const seen = (await call(me, req("GET", "/me", nellTok))).json.data.community.tags;
      assert.equal(seen.admin.label, "Mod", "every member's /me carries the new look");
      assert.equal(seen.reseller.label, "VR");
      assert.equal((await call(tagsPatch, req("PATCH", "/community/tags", nellTok, { tags: { admin: design } }))).status, 403);
      const bad = await call(tagsPatch, req("PATCH", "/community/tags", eOwnerTok, { tags: { admin: { ...design, color: "red" } } }));
      assert.equal(bad.status, 400);
      assert.match(bad.json.error.message, /colour/i);
    });
    await test("an admin sees the member list without anyone's email or phone", async () => {
      const w = await call(membersPatch, req("PATCH", "/community/members", eOwnerTok, { welcome: { enabled: true, messages: [{ text: "Hi from the team!", media: null }] } }));
      assert.equal(w.status, 200, JSON.stringify(w.json));
      const r = await call(members, req("GET", "/community/members", adaTok));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const rows = r.json.data.members as Json[];
      assert.ok(rows.length >= 3);
      assert.ok(rows.every((m) => m.email === "" && m.phone === ""), "contact details are the store's only");
      assert.ok(rows.every((m) => !m.offenses), "the safety bot's record is the team's");
      assert.equal(r.json.data.welcome.enabled, true, "admins run the welcome messages too");
      assert.equal(r.json.data.welcome.messages[0].text, "Hi from the team!");
      const owner = await call(members, req("GET", "/community/members", eOwnerTok));
      assert.equal((owner.json.data.members as Json[]).find((m) => m.customerId === nell.id)?.email, "nell@buyer.test");
    });
    await test("an admin revokes and re-admits a regular member", async () => {
      const off = await call(review, req("POST", `/community/members/${nell.id}/review`, adaTok, { approve: false, reason: "Spamming links" }), { customerId: nell.id });
      assert.equal(off.status, 200, JSON.stringify(off.json));
      assert.equal(off.json.data.email, "", "the review reply hides contact details too");
      assert.equal((await call(inbox, req("GET", "/community/inbox", nellTok))).status, 403);
      const row = await db.communityMember.findFirst({ where: { customerId: nell.id } });
      assert.equal(row?.reviewedBy, `c:${ada.id}`, "the review records which admin did it");
      const back = await call(review, req("POST", `/community/members/${nell.id}/review`, adaTok, { approve: true }), { customerId: nell.id });
      assert.equal(back.status, 403, "taking a removed member back is the team's call");
      const team = await call(review, req("POST", `/community/members/${nell.id}/review`, eOwnerTok, { approve: true }), { customerId: nell.id });
      assert.equal(team.status, 200, JSON.stringify(team.json));
    });
    await test("an admin works the approval queue", async () => {
      assert.equal((await call(membersPatch, req("PATCH", "/community/members", eOwnerTok, { joinMode: "approval" }))).status, 200);
      const quinn = await mkCustomer(E.id, "quinn@buyer.test", "Quinn Queue", "quinn-pass");
      await token("quinn@buyer.test", "quinn-pass"); // first sign-in applies
      const ok1 = await call(review, req("POST", `/community/members/${quinn.id}/review`, adaTok, { approve: true }), { customerId: quinn.id });
      assert.equal(ok1.status, 200, JSON.stringify(ok1.json));
      assert.equal((await db.communityMember.findFirst({ where: { customerId: quinn.id } }))?.status, "approved");
      assert.equal((await call(membersPatch, req("PATCH", "/community/members", eOwnerTok, { joinMode: "open" }))).status, 200);
    });
    await test("an admin can't revoke another admin or take away a role", async () => {
      assert.equal((await setAdmin(eOwnerTok, pia.id, true)).status, 200);
      const r = await call(review, req("POST", `/community/members/${pia.id}/review`, adaTok, { approve: false, reason: "No reason" }), { customerId: pia.id });
      assert.equal(r.status, 403, JSON.stringify(r.json));
      assert.equal((await setAdmin(adaTok, pia.id, false)).status, 403);
      assert.equal((await db.communityMember.findFirst({ where: { customerId: pia.id } }))?.status, "approved");
    });
    await test("an admin manages the welcome: uploads a video, keeps the owner's photo", async () => {
      const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
      const ownerPhoto = await upload(eOwnerTok, png(4, 3), "shop.png");
      assert.equal(ownerPhoto.status, 200, JSON.stringify(ownerPhoto.json));
      const first = await call(membersPatch, req("PATCH", "/community/members", eOwnerTok, { welcome: { enabled: true, messages: [{ text: "Our shop", media: { kind: "image", url: ownerPhoto.json.data.url } }] } }));
      assert.equal(first.status, 200, JSON.stringify(first.json));
      const photoId = first.json.data.welcome.messages[0].id;

      const video = await upload(adaTok, mp4, "how-to-order.mp4", "video/mp4");
      assert.equal(video.status, 200, JSON.stringify(video.json));
      assert.equal(video.json.data.kind, "video", "admins may upload welcome videos");
      const r = await call(
        membersPatch,
        req("PATCH", "/community/members", adaTok, {
          welcome: {
            enabled: true,
            messages: [
              { id: photoId, text: "Our shop", media: { kind: "image", url: ownerPhoto.json.data.url } },
              { text: "How to order", media: { kind: "video", url: video.json.data.url } },
            ],
          },
        }),
      );
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const w = r.json.data.welcome;
      assert.equal(w.messages.length, 2);
      assert.equal(w.messages[0].media.url, ownerPhoto.json.data.url, "the owner's saved photo survives an admin's save");
      assert.equal(w.messages[1].media.kind, "video");
      assert.ok(w.messages[1].media.posterUrl !== undefined);

      const foreign = await upload(eOwnerTok, png(2, 2), "other.png");
      const stolen = await call(membersPatch, req("PATCH", "/community/members", adaTok, { welcome: { enabled: true, messages: [{ text: "x", media: { kind: "image", url: foreign.json.data.url } }] } }));
      assert.equal(stolen.status, 400, "a NEW photo must be the admin's own upload");
      assert.equal((await upload(nellTok, mp4, "clip.mp4", "video/mp4")).status, 400, "members still can't upload video");
      assert.equal((await call(videoTicket, req("POST", "/community/uploads/video", adaTok, { name: "x.mp4" }))).status, 200, "admins get large-video tickets");
      assert.equal((await call(videoTicket, req("POST", "/community/uploads/video", nellTok, { name: "x.mp4" }))).status, 403, "members don't");
      assert.equal((await call(membersPatch, req("PATCH", "/community/members", nellTok, { welcome: { enabled: false, messages: [] } }))).status, 403, "members can't edit it");
    });
    await test("store-team tools stay team-only", async () => {
      assert.equal((await call(membersPatch, req("PATCH", "/community/members", adaTok, { joinMode: "approval" }))).status, 403, "join mode");
      assert.equal((await call(memberPatch, req("PATCH", `/community/members/${nell.id}`, adaTok, { verifiedReseller: true }), { customerId: nell.id })).status, 403, "reseller");
      assert.equal((await setAdmin(adaTok, nell.id, true)).status, 403, "promoting others");
      assert.equal((await call(dropsPost, req("POST", "/community/drops", adaTok, { title: "x" }))).status, 403, "drops");
      assert.equal((await call(groupBuyBroadcast, req("POST", "/community/group-buy/broadcast", adaTok, {}))).status, 403, "group-buy broadcast");
      assert.equal((await call(savedReplies, req("GET", "/community/saved-replies", adaTok))).status, 403, "saved replies");
      assert.equal((await call(moderation, req("GET", "/community/moderation", adaTok))).status, 403, "safety queue");
      assert.equal((await call(sanction, req("POST", `/community/members/${nell.id}/sanction`, adaTok, { action: "mute" }), { customerId: nell.id })).status, 403, "mute/ban");
    });
    await test("a muted admin loses admin powers until unmuted", async () => {
      assert.equal((await call(sanction, req("POST", `/community/members/${ada.id}/sanction`, eOwnerTok, { action: "mute" }), { customerId: ada.id })).status, 200);
      assert.equal((await send(adaTok, "topic", teamGeneral, { kind: "text", body: "still here?", clientId: "ada-m" })).status, 403);
      assert.equal((await call(me, req("GET", "/me", adaTok))).json.data.community.isAdmin, false);
      assert.equal((await call(sanction, req("POST", `/community/members/${ada.id}/sanction`, eOwnerTok, { action: "unmute" }), { customerId: ada.id })).status, 200);
      assert.equal((await send(adaTok, "topic", teamGeneral, { kind: "text", body: "back", clientId: "ada-u" })).status, 200);
    });
    await test("taking the role back removes the powers", async () => {
      assert.equal((await setAdmin(eOwnerTok, ada.id, false)).status, 200);
      assert.equal((await send(adaTok, "topic", teamGeneral, { kind: "text", body: "hello?", clientId: "ada-x" })).status, 403);
      assert.equal((await call(members, req("GET", "/community/members", adaTok))).status, 403);
      assert.equal((await call(me, req("GET", "/me", adaTok))).json.data.community.isAdmin, false);
    });
    await test("only approved members can be made admins, and revoking one clears the role", async () => {
      await call(review, req("POST", `/community/members/${pia.id}/review`, eOwnerTok, { approve: false, reason: "Left the group" }), { customerId: pia.id });
      assert.equal((await db.communityMember.findFirst({ where: { customerId: pia.id } }))?.isAdmin, false);
      const r = await setAdmin(eOwnerTok, pia.id, true);
      assert.equal(r.status, 400, JSON.stringify(r.json));
    });
  }

  console.log("\nisolation + revocation");
  const bOwnerTok = await token("owner@beta.test", "owner-pass");
  await test("two moderators opening an empty community at once bootstrap it once", async () => {
    const bModTok = await token("owner@beta.test", "owner-pass");
    await Promise.all([call(inbox, req("GET", "/community/inbox", bOwnerTok)), call(inbox, req("GET", "/community/inbox", bModTok))]);
    assert.equal(await db.communityChannel.count({ where: { tenantId: B.id } }), 2);
  });
  const carlTok = await token("carl@buyer.test", "carl-pass"); // first sign-in files the application
  await call(review, req("POST", `/community/members/${carl.id}/review`, bOwnerTok, { approve: true }), { customerId: carl.id });
  await test("another store's approved member can't touch this store's threads or messages", async () => {
    assert.equal((await call(inbox, req("GET", "/community/inbox", carlTok))).status, 200);
    assert.equal((await list(carlTok, "topic", generalId)).status, 404);
    assert.equal((await list(carlTok, "dm", dmId)).status, 404);
    assert.equal((await send(carlTok, "topic", generalId, { clientId: "x-1", kind: "text", body: "hi" })).status, 404);
    assert.equal((await call(messagePatch, req("PATCH", `/community/messages/${annMsgId}`, carlTok, { body: "x" }), { id: annMsgId })).status, 404);
    assert.equal((await call(messageDelete, req("DELETE", `/community/messages/${annMsgId}`, bOwnerTok), { id: annMsgId })).status, 404);
    assert.equal((await call(channelGet, req("GET", `/community/channels/${communityChannelId}`, carlTok), { id: communityChannelId })).status, 404);
    assert.equal((await call(review, req("POST", `/community/members/${ann.id}/review`, bOwnerTok, { approve: false, reason: "cross tenant" }), { customerId: ann.id })).status, 404);
    const s = await call(search, req("GET", "/community/search?q=hello", carlTok));
    assert.equal(s.json.data.hits.length, 0);
  });
  await test("revoking a member closes the community to them", async () => {
    await call(review, req("POST", `/community/members/${bob.id}/review`, ownerTok, { approve: false, reason: "Posting spam links" }), { customerId: bob.id });
    assert.equal((await call(inbox, req("GET", "/community/inbox", bobTok))).status, 403);
    const m = await call(me, req("GET", "/me", bobTok));
    assert.equal(m.json.data.community.membership, "revoked");
    bobTok = "";
  });
  await test("a sessionVersion bump on the website signs the phone out", async () => {
    await db.storefrontCustomer.update({ where: { id: ann.id }, data: { sessionVersion: { increment: 1 } } });
    const r = await call(me, req("GET", "/me", annTok));
    assert.equal(r.json.error.code, "session_revoked");
    assert.equal(await db.mobilePushDevice.count({ where: { expoPushToken: annDevice } }), 0);
  });
  await test("the store losing the feature signs customers out", async () => {
    await db.tenantFeatureOverride.update({ where: { tenantId_featureId: { tenantId: B.id, featureId: fCommunity.id } }, data: { enabled: false } });
    const r = await call(me, req("GET", "/me", carlTok));
    assert.equal(r.json.error.code, "session_revoked");
  });

  // ── preview access: a store that lets pending customers look around ──────
  console.log("\npreview access");
  const shopOrders = await h("shop/orders/route", "POST");
  const shopProof = await h("shop/proof/route", "POST");
  const previewGet = await h("community/preview/route", "GET");
  const previewPatch = await h("community/preview/route", "PATCH");
  const D = await mkTenant("preview-shop", "Preview Shop", true);
  await db.branding.create({ data: { tenantId: D.id, config: { name: "Delta Glow", communityJoin: "approval" } } });
  await mkCustomer(D.id, "prue@preview.test", "Pia Preview", "pia-pass");
  const dOwner = await token("owner@preview-shop.test", "owner-pass");
  // The owner's first visit seeds the starter channels (Announcements, Community).
  const seeded = await call(inbox, req("GET", "/community/inbox", dOwner));
  const [dAnnounce, dChat] = seeded.json.data.channels as Json[];
  let piaTok = await token("prue@preview.test", "pia-pass");
  await test("preview off (the default): a pending customer is kept out as before", async () => {
    const r = await call(inbox, req("GET", "/community/inbox", piaTok));
    assert.equal(r.status, 403);
    assert.match(r.json.error.message, /waiting for the store's approval/);
    const m = await call(me, req("GET", "/me", piaTok));
    assert.equal(m.json.data.community.preview, null);
  });
  await test("only moderators read and change the preview policy; bad input is refused", async () => {
    assert.equal((await call(previewGet, req("GET", "/community/preview", piaTok))).status, 403);
    const g = await call(previewGet, req("GET", "/community/preview", dOwner));
    assert.equal(g.json.data.policy.enabled, false);
    assert.equal((await call(previewPatch, req("PATCH", "/community/preview", dOwner, { enabled: "yes" }))).status, 400);
    const p = await call(previewPatch, req("PATCH", "/community/preview", dOwner, { enabled: true }));
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.data.policy.enabled, true);
    assert.equal(p.json.data.policy.placeOrders, false, "browse only by default");
  });
  await test("moderators see each channel's preview setting (locked by default) and can change it", async () => {
    assert.equal(dAnnounce.previewAccess, "locked");
    const r = await call(channelPatch, req("PATCH", `/community/channels/${dAnnounce.id}`, dOwner, { name: "Announcements", postRole: "admins", previewAccess: "read" }), { id: dAnnounce.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.previewAccess, "read");
    const bad = await call(channelPatch, req("PATCH", `/community/channels/${dAnnounce.id}`, dOwner, { name: "Announcements", previewAccess: "all" }), { id: dAnnounce.id });
    assert.equal(bad.status, 400);
    // An edit without the field (an older app) keeps the setting.
    await call(channelPatch, req("PATCH", `/community/channels/${dAnnounce.id}`, dOwner, { name: "Announcements", postRole: "admins" }), { id: dAnnounce.id });
    assert.equal((await db.communityChannel.findFirst({ where: { id: dAnnounce.id } }))?.previewAccess, "read");
  });
  piaTok = await token("prue@preview.test", "pia-pass");
  await test("in preview: /me carries the policy and the member's key", async () => {
    const m = await call(me, req("GET", "/me", piaTok));
    assert.equal(m.json.data.community.membership, "pending");
    assert.equal(m.json.data.community.preview.enabled, true);
    assert.match(m.json.data.community.myKey, /^c:/);
  });
  await test("in preview: readable channels open, locked ones list by name only, hidden ones not at all", async () => {
    await send(dOwner, "topic", dChat.generalTopicId, { kind: "text", body: "members-only secret", clientId: "d-secret-1" });
    await send(dOwner, "topic", dAnnounce.generalTopicId, { kind: "text", body: "sale starts friday", clientId: "d-ann-1" });
    const r = await call(inbox, req("GET", "/community/inbox", piaTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const byId = new Map<string, Json>((r.json.data.channels as Json[]).map((c) => [c.id, c]));
    const row = (id: string) => byId.get(id) ?? {};
    assert.equal(row(dAnnounce.id).locked, undefined);
    assert.equal(row(dChat.id).locked, true);
    assert.equal(row(dChat.id).preview, null, "a locked row never leaks its last message");
    assert.equal(row(dChat.id).previewAccess, undefined, "members never see the setting");
    assert.equal(JSON.stringify(r.json).includes("members-only secret"), false);
    assert.equal((await call(channelGet, req("GET", `/community/channels/${dChat.id}`, piaTok), { id: dChat.id })).status, 404);
    assert.equal((await list(piaTok, "topic", dChat.generalTopicId)).status, 404);
    const read = await list(piaTok, "topic", dAnnounce.generalTopicId);
    assert.equal(read.status, 200);
    assert.equal(read.json.data.thread.canPost, false);
    const s = await call(search, req("GET", "/community/search?q=secret", piaTok));
    assert.equal(s.json.data.hits.length, 0, "search skips locked channels");
    await call(channelPatch, req("PATCH", `/community/channels/${dChat.id}`, dOwner, { name: "Community", previewAccess: "hidden" }), { id: dChat.id });
    const hidden = await call(inbox, req("GET", "/community/inbox", piaTok));
    assert.equal((hidden.json.data.channels as Json[]).some((c) => c.id === dChat.id), false);
  });
  await test("in preview: posting needs a chat channel; topics, DMs and team tools stay closed", async () => {
    const no = await send(piaTok, "topic", dAnnounce.generalTopicId, { kind: "text", body: "hi", clientId: "pia-1" });
    assert.equal(no.status, 403);
    await call(channelPatch, req("PATCH", `/community/channels/${dChat.id}`, dOwner, { name: "Community", previewAccess: "chat" }), { id: dChat.id });
    const yes = await send(piaTok, "topic", dChat.generalTopicId, { kind: "text", body: "hello from preview", clientId: "pia-2" });
    assert.equal(yes.status, 200, JSON.stringify(yes.json));
    const topic = await call(topicsPost, req("POST", `/community/channels/${dChat.id}/topics`, piaTok, { name: "My topic" }), { id: dChat.id });
    assert.equal(topic.status, 403);
    const dm = await call(dms, req("POST", "/community/dms", piaTok, { peerKey: "store" }));
    assert.equal(dm.status, 403);
    assert.equal((await call(members, req("GET", "/community/members", piaTok))).status, 403);
    assert.equal((await call(protocols, req("GET", "/community/protocols", piaTok))).status, 403, "routes that don't opt in refuse preview");
    assert.equal((await call(profilesGet, req("GET", "/community/profiles/store", piaTok), { key: "store" })).status, 403, "other people's profiles wait for approval");
    const mine = await call(profilePatch, req("PATCH", "/community/profile", piaTok, { displayName: "Pia Preview", bio: "New here" }));
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json.data.bio, "New here", "their own profile saves and reads back");
  });
  await test("in preview: the store's DM opens once the owner allows it", async () => {
    await call(previewPatch, req("PATCH", "/community/preview", dOwner, { messageStore: true }));
    piaTok = await token("prue@preview.test", "pia-pass");
    const dm = await call(dms, req("POST", "/community/dms", piaTok, { peerKey: "store" }));
    assert.equal(dm.status, 200, JSON.stringify(dm.json));
    const sent = await send(piaTok, "dm", dm.json.data.conversationId, { kind: "text", body: "can I order?", clientId: "pia-dm-1" });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
  });
  await test("in preview: orders and payment uploads are refused until the owner allows them", async () => {
    const order = await call(shopOrders, req("POST", "/shop/orders", piaTok, { id: "pia-order-1", lines: [{ productId: "x", qty: 1 }] }));
    assert.equal(order.status, 403);
    assert.match(order.json.error.message, /approves your membership/);
    const proof = await call(shopProof, new Request("https://app.pepweb.store/api/mobile/v1/shop/proof", { method: "POST", headers: { authorization: `Bearer ${piaTok}` }, body: new FormData() }));
    assert.equal(proof.status, 403);
  });
  await test("approval ends preview: full member, no policy on /me", async () => {
    const pia = await db.storefrontCustomer.findFirst({ where: { tenantId: D.id, email: "prue@preview.test" } });
    const r = await call(review, req("POST", `/community/members/${pia!.id}/review`, dOwner, { approve: true }), { customerId: pia!.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const m = await call(me, req("GET", "/me", piaTok));
    assert.equal(m.json.data.community.membership, "approved");
    assert.equal(m.json.data.community.preview, null);
    assert.equal((await call(channelGet, req("GET", `/community/channels/${dChat.id}`, piaTok), { id: dChat.id })).status, 200);
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
