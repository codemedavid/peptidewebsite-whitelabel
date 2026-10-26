/**
 * Integration gate for the paid group-buy ADMIN half — the owner's per-round
 * switch, the review queue and the notifications. Runs the REAL website
 * store-admin actions through the app's admin bridge (/api/mobile/v1/admin/call,
 * which signs them in as the owner/staff session) and the real shopper routes,
 * against in-process PGlite with the DB rules applied. Pushes go to a local
 * capture server.
 *
 *   npm run test:gb-review-flow
 *
 * Covers: the paid-join switch + fee (validated, server-priced, never clobbered
 * by an ordinary round save); the queue lists only this store's requests with
 * filters, counts and a duplicate-reference flag; only owner/staff holding
 * `groupbuys` may review, never another store and never their own request;
 * approve / reject (reason required) / refund (reference required) / revoke
 * follow the lifecycle, are audited, and flip the shopper's access; admins read
 * receipts by signed link; the customer gets a chat DM + push on each decision
 * and the store team a push when a paid request arrives.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

const pushes: Json[] = [];
function startPushCapture(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const messages = JSON.parse(raw || "[]") as Json[];
      pushes.push(...messages);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const capture = await startPushCapture();
  process.env.MOBILE_PUSH_ENDPOINT_OVERRIDE = `http://127.0.0.1:${(capture.address() as AddressInfo).port}/`;

  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "group-buy-memberships.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const adminCall = await h("admin/call/route", "POST");
  const devices = await h("devices/route", "POST");
  const joinPost = await h("shop/group-buy/join/route", "POST");
  const joinGet = await h("shop/group-buy/join/route", "GET");
  const receiptPost = await h("shop/group-buy/receipt/route", "POST");
  const catalogGet = await h("shop/catalog/route", "GET");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const feature = (key: string) => db.feature.create({ data: { key } });
  const fs = await Promise.all(["mobile.community", "groupbuy.module", "groupbuy.product_assignment", "groupbuy.paid_access", "groupbuy.edit", "storefront.staff_accounts"].map(feature));
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const grants = () => ({ create: fs.map((f) => ({ featureId: f.id, enabled: true })) });
  const pw = hashPassword("pass-1234");
  const A = await db.tenant.create({ data: { slug: "mnm", name: "MNM", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@mnm.test", storeAdminPasswordHash: pw } });
  const B = await db.tenant.create({ data: { slug: "other", name: "Other", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@other.test", storeAdminPasswordHash: pw } });
  for (const t of [A, B]) {
    await db.branding.create({ data: { tenantId: t.id, config: { name: t.name, currency: "₱", paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "MNM", number: "0917", qrImage: "", order: 1, active: true }] } } });
  }
  const staffRow = (email: string, permissions: string[]) =>
    db.storefrontStaff.create({ data: { tenantId: A.id, email, fullName: email.split("@")[0], username: email.split("@")[0], passwordHash: pw, permissions } });
  const staffOk = await staffRow("gbteam@mnm.test", ["groupbuys"]);
  await staffRow("products@mnm.test", ["products"]);
  await staffRow("dee@buyer.test", ["groupbuys"]); // the same person is also a customer

  const customer = (email: string, name: string) =>
    db.storefrontCustomer.create({ data: { tenantId: A.id, email, name, phone: "9171234567", passwordHash: pw } });
  const ann = await customer("ann@buyer.test", "Ann Cruz");
  await customer("bea@buyer.test", "Bea Reyes");
  await customer("cy@buyer.test", "Cy Ramos");
  const dee = await customer("dee@buyer.test", "Dee Santos");

  const tirz = await db.product.create({ data: { tenantId: A.id, sku: "TIRZ", slug: "tirz", name: "TIRZ", priceCents: 300000, stock: 50, metadata: { productType: "gb", gbPrice: 1690 } } });
  const round = await db.groupBuy.create({ data: { tenantId: A.id, name: "Round 7", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tirz.id] } });
  const otherRound = await db.groupBuy.create({ data: { tenantId: B.id, name: "Their Round", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), paidJoin: true, joinFeeCents: 30000 } });

  // ── helpers ─────────────────────────────────────────────────────────────
  let ipSeq = 0;
  const base = "https://app.pepweb.store/api/mobile/v1";
  const req = (method: string, url: string, token?: string, body?: unknown) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    return new Request(`${base}${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  async function call(handler: Handler, r: Request) {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  const tokenFor = async (email: string, store: string) => {
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: "pass-1234", store }));
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
    return r.json.data.accessToken as string;
  };
  const admin = async (token: string, fn: string, ...args: unknown[]) => {
    const r = await call(adminCall, req("POST", "/admin/call", token, { fn, args }));
    assert.equal(r.status, 200, `${fn}: ${JSON.stringify(r.json)}`);
    return r.json.data as Json;
  };
  const sendReceipt = async (token: string, reference: string) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    const form = new FormData();
    form.set("roundId", round.id);
    form.set("reference", reference);
    form.set("method", "GCash");
    form.set("file", new File([new Uint8Array(PNG)], "receipt.png", { type: "image/png" }));
    const r = await call(receiptPost, new Request(`${base}/shop/group-buy/receipt`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };

  const owner = await tokenFor("owner@mnm.test", "mnm");
  const team = await tokenFor("gbteam@mnm.test", "mnm");
  const productsStaff = await tokenFor("products@mnm.test", "mnm");
  const deeStaff = await tokenFor("dee@buyer.test", "mnm"); // admin wins the tie on one store
  const otherOwner = await tokenFor("owner@other.test", "other");
  const annTok = await tokenFor("ann@buyer.test", "mnm");
  const beaTok = await tokenFor("bea@buyer.test", "mnm");
  const cyTok = await tokenFor("cy@buyer.test", "mnm");

  await call(devices, req("POST", "/devices", owner, { expoPushToken: "ExponentPushToken[owner-device-0001]", platform: "ios", newOrders: true, messages: true }));
  await call(devices, req("POST", "/devices", annTok, { expoPushToken: "ExponentPushToken[ann-device-00001]", platform: "ios", messages: true }));

  console.log("\nthe owner's paid-join switch");
  await test("turning paid join on needs a valid fee, priced by the server", async () => {
    const bad = await admin(owner, "saveGroupBuyPaidJoinAction", { id: round.id, paidJoin: true, joinFee: "0" });
    assert.ok(bad.error, JSON.stringify(bad));
    const ok = await admin(owner, "saveGroupBuyPaidJoinAction", { id: round.id, paidJoin: true, joinFee: "500" });
    assert.ok(ok.ok, JSON.stringify(ok));
    const row = await db.groupBuy.findUniqueOrThrow({ where: { id: round.id } });
    assert.deepEqual([row.paidJoin, row.joinFeeCents], [true, 50000]);
  });
  await test("an ordinary round save (a client that doesn't know the fields) never switches it off", async () => {
    const list = await admin(owner, "listGroupBuysAction");
    const gb = (list.groupBuys as Json[]).find((x) => x.id === round.id)!;
    const { paidJoin: _p, joinFeeCents: _f, ...legacy } = gb;
    void _p;
    void _f;
    const saved = await admin(owner, "saveGroupBuyAction", { ...legacy, name: "Round 7 (renamed)" });
    assert.ok(saved.ok, JSON.stringify(saved));
    const row = await db.groupBuy.findUniqueOrThrow({ where: { id: round.id } });
    assert.deepEqual([row.name, row.paidJoin, row.joinFeeCents], ["Round 7 (renamed)", true, 50000]);
  });
  await test("staff without the group-buys permission can't change it", async () => {
    const r = await admin(productsStaff, "saveGroupBuyPaidJoinAction", { id: round.id, paidJoin: false, joinFee: "500" });
    assert.ok(r.error);
    assert.equal((await db.groupBuy.findUniqueOrThrow({ where: { id: round.id } })).paidJoin, true);
  });
  await test("another store's round can't be touched", async () => {
    const r = await admin(otherOwner, "saveGroupBuyPaidJoinAction", { id: round.id, paidJoin: false, joinFee: "500" });
    assert.ok(r.error);
    assert.equal((await db.groupBuy.findUniqueOrThrow({ where: { id: round.id } })).paidJoin, true);
  });

  // Shoppers join and pay: Ann + Bea send receipts with the SAME reference (a red flag); Cy only joins.
  for (const tok of [annTok, beaTok, cyTok]) await call(joinPost, req("POST", "/shop/group-buy/join", tok, { roundId: round.id }));
  pushes.length = 0;
  await sendReceipt(annTok, "1023 4567 8901");
  await flushAfter();
  await sendReceipt(beaTok, "1023 4567 8901");
  await flushAfter();

  console.log("\nnew paid requests alert the store team");
  await test("the owner's phone is pushed when a paid request arrives (no reference on the lock screen)", async () => {
    const alert = pushes.find((p) => p.to === "ExponentPushToken[owner-device-0001]");
    assert.ok(alert, JSON.stringify(pushes));
    assert.equal(alert.data?.type, "gb_join_request");
    assert.ok(!JSON.stringify(alert).includes("1023"));
  });

  console.log("\nthe review queue");
  let ids: Record<string, string> = {};
  await test("lists this store's requests with amount, round, receipt flag and per-status counts", async () => {
    const r = await admin(owner, "listGroupBuyJoinRequestsAction", {});
    assert.ok(r.ok, JSON.stringify(r));
    const rows = r.requests as Json[];
    assert.deepEqual(rows.map((x) => x.customerName).sort(), ["Ann Cruz", "Bea Reyes", "Cy Ramos"]);
    ids = Object.fromEntries(rows.map((x) => [x.customerName.split(" ")[0].toLowerCase(), x.id]));
    const annRow = rows.find((x) => x.customerName === "Ann Cruz")!;
    assert.equal(annRow.amountCents, 50000);
    assert.equal(annRow.roundName, "Round 7 (renamed)");
    assert.equal(annRow.hasReceipt, true);
    assert.equal(annRow.reference, "1023 4567 8901");
    assert.ok(!("receiptFilePath" in annRow), "no receipt path in the list");
    assert.deepEqual(r.counts, { pending_payment: 1, paid_pending_approval: 2, approved: 0, rejected: 0, refunded: 0, revoked: 0 });
  });
  await test("filters by status and by round", async () => {
    const paid = await admin(team, "listGroupBuyJoinRequestsAction", { status: "paid_pending_approval" });
    assert.equal((paid.requests as Json[]).length, 2);
    const none = await admin(team, "listGroupBuyJoinRequestsAction", { groupBuyId: otherRound.id });
    assert.equal((none.requests as Json[]).length, 0);
  });
  await test("the same reference on two receipts is flagged for the reviewer", async () => {
    const r = await admin(owner, "listGroupBuyJoinRequestsAction", { status: "paid_pending_approval" });
    for (const row of r.requests as Json[]) assert.equal(row.duplicateReference, true, row.customerName);
  });
  await test("staff without the group-buys permission can't see the queue", async () => {
    const r = await admin(productsStaff, "listGroupBuyJoinRequestsAction", {});
    assert.ok(r.error);
  });
  await test("another store's owner sees none of it", async () => {
    const r = await admin(otherOwner, "listGroupBuyJoinRequestsAction", {});
    assert.deepEqual(r.requests, []);
  });

  console.log("\ndecisions");
  await test("another store's owner can't decide this store's request", async () => {
    const r = await admin(otherOwner, "reviewGroupBuyJoinRequestAction", { id: ids.ann, action: "approve" });
    assert.ok(r.error);
    assert.equal((await db.groupBuyMembership.findUniqueOrThrow({ where: { id: ids.ann } })).status, "paid_pending_approval");
  });
  await test("an unpaid request can't be approved (no skipping)", async () => {
    const r = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.cy, action: "approve" });
    assert.ok(r.error);
  });
  pushes.length = 0;
  await test("group-buy staff approve Ann: audited, and her shop opens", async () => {
    const r = await admin(team, "reviewGroupBuyJoinRequestAction", { id: ids.ann, action: "approve" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.request.status, "approved");
    const ev = await db.groupBuyMembershipEvent.findFirstOrThrow({ where: { membershipId: ids.ann, toStatus: "approved" } });
    assert.deepEqual([ev.actorKind, ev.actorId, ev.fromStatus], ["staff", staffOk.id, "paid_pending_approval"]);
    const cat = await call(catalogGet, req("GET", "/shop/catalog", annTok));
    assert.equal(cat.json.data.groupBuy?.id, round.id);
  });
  await test("Ann is told: a store DM in her chat + a push", async () => {
    await flushAfter();
    const convo = await db.communityConversation.findFirst({ where: { tenantId: A.id, OR: [{ lowKey: `c:${ann.id}` }, { highKey: `c:${ann.id}` }] } });
    assert.ok(convo, "a store ⇄ Ann conversation");
    const msgs = await db.communityMessage.findMany({ where: { conversationId: convo!.id } });
    assert.ok(msgs.some((m) => /approved/i.test(m.body ?? "") && m.authorKey === "bot"), JSON.stringify(msgs.map((m) => m.body)));
    const p = pushes.find((x) => x.to === "ExponentPushToken[ann-device-00001]");
    assert.ok(p && p.data?.type === "gb_join_update", JSON.stringify(pushes));
  });
  await test("a decision is never repeated: approving twice is refused", async () => {
    const r = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.ann, action: "approve" });
    assert.ok(r.error);
  });
  await test("reject needs a reason; with one, Bea sees it and a refund is owed", async () => {
    const bare = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.bea, action: "reject", reason: "  " });
    assert.ok(bare.error);
    const r = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.bea, action: "reject", reason: "Same reference as another receipt" });
    assert.ok(r.ok, JSON.stringify(r));
    const s = await call(joinGet, req("GET", `/shop/group-buy/join?round=${round.id}`, beaTok));
    assert.equal(s.json.data.status.title, "Rejected: Same reference as another receipt – refund in progress");
    const ev = await db.groupBuyMembershipEvent.findFirstOrThrow({ where: { membershipId: ids.bea, toStatus: "rejected" } });
    assert.deepEqual([ev.actorKind, ev.reason], ["owner", "Same reference as another receipt"]);
  });
  await test("mark refunded needs the refund reference", async () => {
    assert.ok((await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.bea, action: "refund" })).error);
    const r = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.bea, action: "refund", refundReference: "GC-RF-77" });
    assert.ok(r.ok, JSON.stringify(r));
    const row = await db.groupBuyMembership.findUniqueOrThrow({ where: { id: ids.bea } });
    assert.deepEqual([row.status, row.refundReference], ["refunded", "GC-RF-77"]);
  });
  await test("revoke needs a reason; Ann's shop locks again", async () => {
    assert.ok((await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.ann, action: "revoke" })).error);
    const r = await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.ann, action: "revoke", reason: "Shared the price list" });
    assert.ok(r.ok, JSON.stringify(r));
    const cat = await call(catalogGet, req("GET", "/shop/catalog", annTok));
    assert.equal(cat.json.data.groupBuy ?? null, null);
    assert.equal(cat.json.data.groupBuyTeaser?.membership?.status, "revoked");
  });
  await test("an unknown action or garbage id is a clean refusal", async () => {
    assert.ok((await admin(owner, "reviewGroupBuyJoinRequestAction", { id: ids.cy, action: "delete" })).error);
    assert.ok((await admin(owner, "reviewGroupBuyJoinRequestAction", { id: { $ne: 1 }, action: "approve" })).error);
  });

  console.log("\nself-review and receipts");
  await test("a staff member can't approve their own request (same email as the customer)", async () => {
    const m = await db.groupBuyMembership.create({ data: { tenantId: A.id, groupBuyId: round.id, customerId: dee.id, customerName: "Dee Santos", customerEmail: "dee@buyer.test", amountCents: 50000 } });
    await db.groupBuyMembership.update({ where: { id: m.id }, data: { status: "paid_pending_approval" } });
    const r = await admin(deeStaff, "reviewGroupBuyJoinRequestAction", { id: m.id, action: "approve" });
    assert.ok(r.error && /own/i.test(r.error), JSON.stringify(r));
    assert.equal((await db.groupBuyMembership.findUniqueOrThrow({ where: { id: m.id } })).status, "paid_pending_approval");
  });
  await test("admins open a receipt by short-lived link; another store's owner can't", async () => {
    const r = await admin(owner, "getGroupBuyJoinReceiptAction", ids.ann);
    assert.ok(r.ok && typeof r.url === "string" && r.url.length > 0, JSON.stringify(r).slice(0, 200));
    const other = await admin(otherOwner, "getGroupBuyJoinReceiptAction", ids.ann);
    assert.ok(other.error);
  });
  await test("the audit trail reads in order for a request", async () => {
    const r = await admin(owner, "listGroupBuyJoinRequestsAction", { status: "revoked" });
    const row = (r.requests as Json[])[0];
    assert.deepEqual((row.history as Json[]).map((e) => e.toStatus), ["pending_payment", "paid_pending_approval", "approved", "revoked"]);
    assert.equal((row.history as Json[])[3].reason, "Shared the price list");
  });

  await db.$disconnect();
  await pg.close();
  capture.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
