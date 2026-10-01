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
  const dropsGet = await h("community/drops/route", "GET");
  const dropsPost = await h("community/drops/route", "POST");
  const dropEnd = await h("community/drops/[id]/end/route", "POST");
  const members = await h("community/members/route", "GET");
  const membersPatch = await h("community/members/route", "PATCH");
  const protocols = await h("community/protocols/route", "GET");
  const review = await h("community/members/[customerId]/review/route", "POST");
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
  await test("topic messages don't push", async () => {
    pushed.length = 0;
    await send(annTok, "topic", generalId, { clientId: "c-quiet", kind: "text", body: "quiet" });
    await flushAfter();
    assert.equal(pushed.length, 0);
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

  capture.close();
  await pg.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
