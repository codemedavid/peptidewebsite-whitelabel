/**
 * Integration gate for in-app account deletion (POST /api/mobile/v1/account/delete,
 * Apple guideline 5.1.1(v)).
 *
 * Runs the REAL route handler, auth and withTenant() against an in-process
 * Postgres (PGlite) — no Next server, no network, and NO access to any real
 * database: DATABASE_URL is forced to an unreachable address and the Prisma
 * singleton is replaced BEFORE any app module loads (scripts/mobile-test/).
 *
 *   npm run test:account-delete
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";

// ── safety first: nothing below may reach a real database ──────────────────
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
  const me = (await import("../src/app/api/mobile/v1/me/route")).GET as Handler;
  const del = (await import("../src/app/api/mobile/v1/account/delete/route")).POST as Handler;

  // ── seed: two community stores; the same shopper email on both ───────────
  const fStaff = await db.feature.create({ data: { key: "storefront.staff_accounts" } });
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const plan = await db.plan.create({
    data: { key: "growth", name: "Growth", features: { create: [{ featureId: fStaff.id }, { featureId: fCommunity.id }] } },
  });
  const mkTenant = (slug: string) =>
    db.tenant.create({
      data: {
        slug,
        name: slug,
        status: "active",
        planId: plan.id,
        storeAdminEmail: `owner@${slug}.test`,
        storeAdminPasswordHash: hashPassword("owner-pass"),
      },
    });
  const A = await mkTenant("alpha");
  const B = await mkTenant("beta");
  const staff = await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Pat Packer", email: "packer@alpha.test", username: "packer", passwordHash: hashPassword("packer-pass"), permissions: ["orders"] },
  });
  const mkCustomer = (tenantId: string, email: string, name: string, pw: string) =>
    db.storefrontCustomer.create({ data: { tenantId, email, name, phone: "0917 555 0101", passwordHash: hashPassword(pw) } });
  const ann = await mkCustomer(A.id, "ann@buyer.test", "Ann Cruz", "ann-pass");
  const annB = await mkCustomer(B.id, "ann@buyer.test", "Ann (Beta)", "ann-beta-pass");
  await mkCustomer(A.id, "eve@buyer.test", "Eve", "eve-pass");

  // Ann's footprint on Alpha: orders, community, profile, a DM, an upload.
  const mkOrder = (tenantId: string, orderNumber: string, customerAccountId: string | null) =>
    db.storefrontOrder.create({
      data: {
        tenantId,
        orderNumber,
        paymentMethod: "GCash",
        customerAccountId,
        customer: { name: "Ann Cruz", email: "ann@buyer.test", phone: "0917", contactMethod: "sms" },
        items: [{ name: "BPC-157", qty: 1, price: 1000 }],
      },
    });
  await mkOrder(A.id, "ALP-1", ann.id);
  await mkOrder(A.id, "ALP-2", ann.id);
  await mkOrder(B.id, "BET-1", annB.id);
  const annKey = `c:${ann.id}`;
  for (const [tenantId, customerId, name] of [[A.id, ann.id, "Ann Cruz"], [B.id, annB.id, "Ann B"]] as const) {
    await db.communityMember.create({ data: { tenantId, customerId, displayName: name, bio: "I like peptides", status: "approved" } });
    await db.accountProfile.create({ data: { tenantId, subject: `customer:${customerId}`, name, nickname: "Annie", avatarUrl: "https://ik.test/ann.png" } });
  }
  const channel = await db.communityChannel.create({ data: { tenantId: A.id, name: "General" } });
  const topic = await db.communityTopic.create({ data: { tenantId: A.id, channelId: channel.id, name: "General", isGeneral: true } });
  const annMsg = await db.communityMessage.create({
    data: { tenantId: A.id, topicId: topic.id, senderKey: annKey, kind: "image", body: "my address is 1 Main St", imageUrl: "https://ik.test/x.png", clientId: "m1" },
  });
  const storeMsg = await db.communityMessage.create({
    data: { tenantId: A.id, topicId: topic.id, senderKey: "store", authorKey: "owner", kind: "text", body: "Welcome!", replyToId: annMsg.id },
  });
  const dm = await db.communityConversation.create({ data: { tenantId: A.id, lowKey: annKey, highKey: "store" } });
  await db.communityMessage.create({ data: { tenantId: A.id, conversationId: dm.id, senderKey: annKey, kind: "text", body: "call me on 0917" } });
  await db.communityRead.create({ data: { tenantId: A.id, participantKey: annKey, threadType: "topic", threadId: topic.id, lastReadAt: new Date() } });
  await db.communityUpload.create({
    data: { tenantId: A.id, uploaderKey: annKey, kind: "image", url: "https://ik.test/x.png", urlHash: "h", name: "x.png", size: 10, mime: "image/png" },
  });
  // Beta has its own message from ITS Ann, which must survive.
  const bChannel = await db.communityChannel.create({ data: { tenantId: B.id, name: "General" } });
  const bTopic = await db.communityTopic.create({ data: { tenantId: B.id, channelId: bChannel.id, name: "General", isGeneral: true } });
  await db.communityMessage.create({ data: { tenantId: B.id, topicId: bTopic.id, senderKey: `c:${annB.id}`, kind: "text", body: "hi from beta" } });

  // ── helpers ──────────────────────────────────────────────────────────────
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function call(h: Handler, r: Request) {
    const res = await h(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  let ipSeq = 0;
  async function signIn(email: string, pw: string, store: string) {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    return call(login, req("POST", "/auth/login", undefined, { store, email, password: pw }));
  }
  async function token(email: string, pw: string, store: string): Promise<string> {
    const r = await signIn(email, pw, store);
    assert.equal(r.status, 200, `sign-in ${email}@${store}: ${JSON.stringify(r.json)}`);
    return r.json.data.accessToken as string;
  }
  const deleteWith = (tok: string | undefined, password: unknown) => call(del, req("POST", "/account/delete", tok, { password }));
  const meStatus = async (tok: string) => (await call(me, req("GET", "/me", tok))).status;
  /** A push registration on the session behind an access token. */
  async function addDevice(tok: string, pushToken: string) {
    const { hashToken } = await import("../src/lib/mobile/tokens");
    const s = await db.mobileSession.findUniqueOrThrow({ where: { accessTokenHash: hashToken(tok) } });
    await db.mobilePushDevice.create({ data: { tenantId: s.tenantId, sessionId: s.id, expoPushToken: pushToken, platform: "ios" } });
  }

  const annPhone1 = await token("ann@buyer.test", "ann-pass", "alpha");
  const annPhone2 = await token("ann@buyer.test", "ann-pass", "alpha");
  const annBeta = await token("ann@buyer.test", "ann-beta-pass", "beta");
  await addDevice(annPhone1, "ExponentPushToken[ann-1]");
  await addDevice(annPhone2, "ExponentPushToken[ann-2]");
  await addDevice(annBeta, "ExponentPushToken[ann-beta]");

  console.log("\nguards");
  await test("no session → 401", async () => {
    assert.equal((await deleteWith(undefined, "ann-pass")).status, 401);
  });
  await test("an empty password → 400, nothing changes", async () => {
    const r = await deleteWith(annPhone1, "   ");
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });
  await test("wrong password → 401 wrong_password (not a session error); account and session intact", async () => {
    const r = await deleteWith(annPhone1, "nope");
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.equal(r.json.error.code, "wrong_password");
    assert.ok(await db.storefrontCustomer.findUnique({ where: { id: ann.id } }));
    assert.equal(await meStatus(annPhone1), 200, "a wrong password must not sign the phone out");
  });
  await test("another store's password for the same email is wrong here", async () => {
    const r = await deleteWith(annPhone1, "ann-beta-pass");
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "wrong_password");
  });
  await test("repeated wrong passwords are rate-limited (429)", async () => {
    const eve = await token("eve@buyer.test", "eve-pass", "alpha");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await deleteWith(eve, `wrong-${i}`)).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
    // Even the right password waits out the window.
    assert.equal((await deleteWith(eve, "eve-pass")).status, 429);
    assert.ok(await db.storefrontCustomer.findFirst({ where: { email: "eve@buyer.test" } }));
  });

  console.log("\ncustomer: personal data deleted now");
  const res = await deleteWith(annPhone1, "ann-pass");
  await test("the right password → 200 { outcome: deleted }", async () => {
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.data.outcome, "deleted");
    assert.ok(String(res.json.data.message).length > 0);
  });
  await test("the account row (name, email, phone, password hash) is gone", async () => {
    assert.equal(await db.storefrontCustomer.findUnique({ where: { id: ann.id } }), null);
    assert.equal(await db.storefrontCustomer.count({ where: { tenantId: A.id, email: "ann@buyer.test" } }), 0);
  });
  await test("profile, community membership, read markers and upload records are gone", async () => {
    assert.equal(await db.accountProfile.count({ where: { tenantId: A.id, subject: `customer:${ann.id}` } }), 0);
    assert.equal(await db.communityMember.count({ where: { customerId: ann.id } }), 0);
    assert.equal(await db.communityRead.count({ where: { tenantId: A.id, participantKey: annKey } }), 0);
    assert.equal(await db.communityUpload.count({ where: { tenantId: A.id, uploaderKey: annKey } }), 0);
  });
  await test("her community messages are blanked + marked deleted; threads and the store's reply survive", async () => {
    const mine = await db.communityMessage.findMany({ where: { tenantId: A.id, senderKey: annKey } });
    assert.equal(mine.length, 2, "rows kept so replies/counters keep their shape");
    for (const m of mine) {
      assert.ok(m.deletedAt, "marked deleted");
      assert.equal(m.body, null);
      assert.equal(m.imageUrl, null);
    }
    const reply = await db.communityMessage.findUniqueOrThrow({ where: { id: storeMsg.id } });
    assert.equal(reply.body, "Welcome!");
    assert.equal(reply.deletedAt, null);
    assert.ok(await db.communityConversation.findUnique({ where: { id: dm.id } }), "the store keeps its side of the DM");
  });
  await test("orders are KEPT for the store's books, unlinked from the deleted account", async () => {
    const orders = await db.storefrontOrder.findMany({ where: { tenantId: A.id }, orderBy: { orderNumber: "asc" } });
    assert.deepEqual(orders.map((o) => o.orderNumber), ["ALP-1", "ALP-2"]);
    assert.ok(orders.every((o) => o.customerAccountId === null));
  });
  await test("EVERY phone is signed out and every push registration dropped", async () => {
    const sessions = await db.mobileSession.findMany({ where: { tenantId: A.id, subject: `customer:${ann.id}` } });
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every((s) => s.revokedAt !== null));
    assert.equal(await db.mobilePushDevice.count({ where: { tenantId: A.id, sessionId: { in: sessions.map((s) => s.id) } } }), 0);
    assert.equal(await meStatus(annPhone1), 401);
    assert.equal(await meStatus(annPhone2), 401);
  });
  await test("the old credentials no longer sign in", async () => {
    assert.equal((await signIn("ann@buyer.test", "ann-pass", "alpha")).status, 401);
  });

  console.log("\ncross-tenant isolation");
  await test("the same email on another store is untouched (account, profile, member, message, order, session, push)", async () => {
    const other = await db.storefrontCustomer.findUnique({ where: { id: annB.id } });
    assert.equal(other?.name, "Ann (Beta)");
    assert.equal(other?.phone, "0917 555 0101");
    assert.equal(await db.accountProfile.count({ where: { tenantId: B.id } }), 1);
    assert.equal(await db.communityMember.count({ where: { tenantId: B.id } }), 1);
    const bMsg = await db.communityMessage.findFirstOrThrow({ where: { tenantId: B.id } });
    assert.equal(bMsg.body, "hi from beta");
    assert.equal(bMsg.deletedAt, null);
    const bOrder = await db.storefrontOrder.findFirstOrThrow({ where: { tenantId: B.id } });
    assert.equal(bOrder.customerAccountId, annB.id);
    assert.equal(await meStatus(annBeta), 200);
    assert.equal(await db.mobilePushDevice.count({ where: { expoPushToken: "ExponentPushToken[ann-beta]" } }), 1);
  });

  console.log("\nowner / staff: a request, never an automatic store wipe");
  const ownerPhone1 = await token("owner@alpha.test", "owner-pass", "alpha");
  const ownerPhone2 = await token("owner@alpha.test", "owner-pass", "alpha");
  const staffPhone = await token("packer@alpha.test", "packer-pass", "alpha");
  const betaOwner = await token("owner@beta.test", "owner-pass", "beta");
  await addDevice(ownerPhone1, "ExponentPushToken[owner-1]");
  await addDevice(staffPhone, "ExponentPushToken[staff-1]");

  await test("owner, wrong password → 401 wrong_password, no request recorded, still signed in", async () => {
    const r = await deleteWith(ownerPhone1, "nope");
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "wrong_password");
    assert.equal(await db.accountDeletionRequest.count(), 0);
    assert.equal(await meStatus(ownerPhone1), 200);
  });
  const ownerRes = await deleteWith(ownerPhone1, "owner-pass");
  await test("owner, right password → 200 { outcome: requested } with the 30-day notice", async () => {
    assert.equal(ownerRes.status, 200, JSON.stringify(ownerRes.json));
    assert.equal(ownerRes.json.data.outcome, "requested");
    assert.equal(ownerRes.json.data.message, "We received your request; your account and data will be deleted within 30 days.");
  });
  await test("a pending request is recorded for the platform", async () => {
    const rows = await db.accountDeletionRequest.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenantId, A.id);
    assert.equal(rows[0].subject, "owner");
    assert.equal(rows[0].role, "owner");
    assert.equal(rows[0].email, "owner@alpha.test");
    assert.equal(rows[0].status, "pending");
  });
  await test("every owner phone is signed out; push dropped", async () => {
    assert.equal(await meStatus(ownerPhone1), 401);
    assert.equal(await meStatus(ownerPhone2), 401);
    assert.equal(await db.mobilePushDevice.count({ where: { expoPushToken: "ExponentPushToken[owner-1]" } }), 0);
  });
  await test("the store itself is NOT destroyed; staff and other stores keep working", async () => {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: A.id } });
    assert.equal(t.status, "active");
    assert.ok(t.storeAdminPasswordHash);
    assert.equal(await db.storefrontOrder.count({ where: { tenantId: A.id } }), 2);
    assert.equal(await meStatus(staffPhone), 200);
    assert.equal(await meStatus(betaOwner), 200);
  });
  await test("asking again while one is pending doesn't duplicate the request", async () => {
    const again = await token("owner@alpha.test", "owner-pass", "alpha");
    const r = await deleteWith(again, "owner-pass");
    assert.equal(r.status, 200);
    assert.equal(await db.accountDeletionRequest.count({ where: { tenantId: A.id, subject: "owner" } }), 1);
    assert.equal(await meStatus(again), 401);
  });
  await test("staff → their own request (staff:<id>), only their phones signed out", async () => {
    const r = await deleteWith(staffPhone, "packer-pass");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.outcome, "requested");
    const row = await db.accountDeletionRequest.findFirstOrThrow({ where: { subject: `staff:${staff.id}` } });
    assert.equal(row.role, "staff");
    assert.equal(row.email, "packer@alpha.test");
    assert.equal(row.tenantId, A.id);
    assert.equal(await meStatus(staffPhone), 401);
    assert.equal(await db.mobilePushDevice.count({ where: { expoPushToken: "ExponentPushToken[staff-1]" } }), 0);
    assert.ok(await db.storefrontStaff.findUnique({ where: { id: staff.id } }), "the staff login itself waits for the operator");
    assert.equal(await meStatus(betaOwner), 200);
    assert.equal(await db.accountDeletionRequest.count({ where: { tenantId: B.id } }), 0);
  });

  await pg.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
