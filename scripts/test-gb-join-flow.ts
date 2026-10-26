/**
 * Integration gate for the paid group-buy JOIN flow — the customer half:
 * Join → pay → upload receipt + reference → wait for approval. Runs the REAL
 * app routes (/api/mobile/v1/shop/group-buy/*), which run the website's own
 * server actions as the signed-in shopper, against in-process PGlite with the
 * DB rules applied. ImageKit is unconfigured, so receipts are kept inline
 * (never in production — see uploadPrivateReceipt).
 *
 *   npm run test:gb-join-flow
 *
 * Covers: the join state (fee, the store's payment methods, sign-in, status
 * copy); starting a request uses the SERVER's fee and is idempotent (no double
 * requests); the receipt is validated at the boundary (reference, image type)
 * and moves the request to paid_pending_approval with an audit trail; only the
 * request's own customer can read its receipt; free / closed / foreign rounds
 * and stores without the feature can't be joined; a refunded customer may try
 * again.
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

// A 1×1 PNG — a real image, so the server-side type check has bytes to accept.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "group-buy-memberships.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const joinGet = await h("shop/group-buy/join/route", "GET");
  const joinPost = await h("shop/group-buy/join/route", "POST");
  const receiptPost = await h("shop/group-buy/receipt/route", "POST");
  const receiptGet = await h("shop/group-buy/receipt/route", "GET");
  const catalogGet = await h("shop/catalog/route", "GET");

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
    data: { slug: "other", name: "Other", status: "active", planId: plan.id, featureOverrides: grants([fCommunity.id, fGb.id, fAssign.id, fPaid.id]) },
  });
  const C = await db.tenant.create({
    data: { slug: "nofeature", name: "No Feature", status: "active", planId: plan.id, featureOverrides: grants([fCommunity.id, fGb.id, fAssign.id]) },
  });
  const paymentMethods = [
    { id: "pm-bpi", name: "BPI", account: "MNM Trading", number: "1234-5678-90", qrImage: "", order: 2, active: true },
    { id: "pm-gcash", name: "GCash", account: "MNM", number: "0917 000 0000", qrImage: "https://ik.imagekit.io/x/qr.png", order: 1, active: true },
    { id: "pm-old", name: "Old Maya", account: "x", number: "x", qrImage: "", order: 0, active: false },
  ];
  for (const t of [A, B, C]) await db.branding.create({ data: { tenantId: t.id, config: { name: t.name, currency: "₱", paymentMethods } } });

  const customer = (tenantId: string, email: string, name: string) =>
    db.storefrontCustomer.create({ data: { tenantId, email, name, phone: "9171234567", passwordHash: hashPassword("pass-1234") } });
  const ann = await customer(A.id, "ann@buyer.test", "Ann Cruz");
  await customer(A.id, "bea@buyer.test", "Bea Reyes");
  await customer(C.id, "cy@buyer.test", "Cy");

  const tirz = await db.product.create({ data: { tenantId: A.id, sku: "TIRZ", slug: "tirz", name: "TIRZ", priceCents: 300000, stock: 50, metadata: { productType: "gb", gbPrice: 1690 } } });
  const live = (tenantId: string, over: Json = {}) =>
    db.groupBuy.create({
      data: { tenantId, name: "Round 7", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [], paidJoin: true, joinFeeCents: 49950, ...over },
    });
  const round = await live(A.id, { productIds: [tirz.id] });
  const closed = await db.groupBuy.create({ data: { tenantId: A.id, name: "Round 6", status: "closed", closedAt: new Date(Date.now() - 86_400_000), paidJoin: true, joinFeeCents: 49950 } });
  const foreign = await live(B.id);
  const noFeature = await live(C.id);

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
  const upload = (token: string, fields: Record<string, string>, file?: { bytes: Buffer; name: string; type: string }) => {
    (globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    return new Request(`${base}/shop/group-buy/receipt`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  };
  async function call(handler: Handler, r: Request) {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  const tokenFor = async (email: string, store: string) => {
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: "pass-1234", store }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const annTok = await tokenFor("ann@buyer.test", "mnm");
  const beaTok = await tokenFor("bea@buyer.test", "mnm");
  const cyTok = await tokenFor("cy@buyer.test", "nofeature");
  const png = { bytes: PNG, name: "gcash-receipt.png", type: "image/png" };

  console.log("\njoin state");
  await test("shows the server's fee, the store's ACTIVE payment methods in order, and no request yet", async () => {
    const r = await call(joinGet, req("GET", `/shop/group-buy/join?round=${round.id}`, annTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const s = r.json.data;
    assert.equal(s.round.id, round.id);
    assert.equal(s.round.joinFeeCents, 49950);
    assert.equal(s.joinFeeLabel, "₱499.50");
    assert.equal(s.canJoin, true);
    assert.equal(s.request, null);
    assert.deepEqual(s.paymentMethods.map((m: Json) => m.id), ["pm-gcash", "pm-bpi"]);
    assert.equal(s.status.title, "Join this group buy");
  });

  console.log("\nstarting a request");
  await test("Join creates ONE pending_payment request at the server's price (client amount ignored)", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", annTok, { roundId: round.id, amountCents: 1 }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.request.status, "pending_payment");
    assert.equal(r.json.data.status.title, "Awaiting payment");
    assert.equal(r.json.data.canJoin, false);
    const rows = await db.groupBuyMembership.findMany({ where: { groupBuyId: round.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amountCents, 49950);
    assert.equal(rows[0].customerEmail, "ann@buyer.test");
    assert.equal(rows[0].customerName, "Ann Cruz");
  });
  await test("pressing Join again shows the same request — no double payment", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", annTok, { roundId: round.id }));
    assert.equal(r.status, 200);
    assert.equal(r.json.data.request.status, "pending_payment");
    assert.equal(await db.groupBuyMembership.count({ where: { groupBuyId: round.id } }), 1);
  });
  await test("the request's creation is in the audit log, attributed to the customer", async () => {
    const ev = await db.groupBuyMembershipEvent.findMany({ where: { tenantId: A.id } });
    assert.deepEqual(ev.map((e) => [e.fromStatus, e.toStatus, e.actorKind, e.actorId]), [[null, "pending_payment", "customer", ann.id]]);
  });

  console.log("\nthe receipt (validated at the boundary)");
  await test("a missing or too-short reference is refused", async () => {
    const r = await call(receiptPost, upload(annTok, { roundId: round.id, reference: "12", method: "GCash" }, png));
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(r.json.error.message, /reference/i);
  });
  await test("a PDF (or no file) is refused with a screenshot hint", async () => {
    const pdf = await call(receiptPost, upload(annTok, { roundId: round.id, reference: "1023 4567 8901" }, { bytes: Buffer.from("%PDF-1.4"), name: "receipt.pdf", type: "application/pdf" }));
    assert.equal(pdf.status, 400);
    assert.match(pdf.json.error.message, /screenshot/i);
    const none = await call(receiptPost, upload(annTok, { roundId: round.id, reference: "1023 4567 8901" }));
    assert.equal(none.status, 400);
  });
  await test("a good receipt moves the request to paid_pending_approval", async () => {
    const r = await call(receiptPost, upload(annTok, { roundId: round.id, reference: "1023 4567 8901", method: "GCash", paidAt: new Date(Date.now() - 3_600_000).toISOString(), amountCents: "1" }, png));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const s = r.json.data;
    assert.equal(s.request.status, "paid_pending_approval");
    assert.equal(s.status.title, "Payment received – waiting for admin approval");
    assert.equal(s.request.reference, "1023 4567 8901");
    assert.equal(s.request.method, "GCash");
    assert.equal(s.request.hasReceipt, true);
    assert.ok(!JSON.stringify(s).includes("base64"), "the receipt itself never rides on the state");
    const row = await db.groupBuyMembership.findFirstOrThrow({ where: { groupBuyId: round.id } });
    assert.equal(row.amountCents, 49950, "amount untouched");
    assert.ok(row.receiptFilePath, "receipt stored");
    assert.ok(row.submittedAt && row.paidAt);
  });
  await test("the submission is audited too", async () => {
    const ev = await db.groupBuyMembershipEvent.findMany({ where: { tenantId: A.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(ev.map((e) => e.toStatus), ["pending_payment", "paid_pending_approval"]);
  });
  await test("a second receipt can't be submitted once paid", async () => {
    const r = await call(receiptPost, upload(annTok, { roundId: round.id, reference: "9999 0000 1111" }, png));
    assert.equal(r.status, 409, JSON.stringify(r.json));
  });
  await test("the round is still locked for Ann until an admin approves", async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", annTok));
    assert.equal(r.json.data.groupBuyTeaser?.membership?.status, "paid_pending_approval");
  });

  console.log("\nwho can read a receipt");
  await test("the uploader gets a short-lived link to their own receipt", async () => {
    const r = await call(receiptGet, req("GET", `/shop/group-buy/receipt?round=${round.id}`, annTok));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(typeof r.json.data.url === "string" && r.json.data.url.length > 0);
  });
  await test("another customer of the same store gets nothing (they have no receipt)", async () => {
    const r = await call(receiptGet, req("GET", `/shop/group-buy/receipt?round=${round.id}`, beaTok));
    assert.equal(r.status, 404, JSON.stringify(r.json));
  });

  console.log("\nrounds that can't be joined");
  await test("a closed round can't be joined", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", beaTok, { roundId: closed.id }));
    assert.equal(r.status, 409, JSON.stringify(r.json));
  });
  await test("another store's round is not found (no cross-store joins)", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", beaTok, { roundId: foreign.id }));
    assert.equal(r.status, 404, JSON.stringify(r.json));
    assert.equal(await db.groupBuyMembership.count({ where: { groupBuyId: foreign.id } }), 0);
  });
  await test("a free round has nothing to join", async () => {
    await db.groupBuy.update({ where: { id: round.id }, data: { paidJoin: false } });
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", beaTok, { roundId: round.id }));
    assert.equal(r.status, 409, JSON.stringify(r.json));
    await db.groupBuy.update({ where: { id: round.id }, data: { paidJoin: true } });
  });
  await test("a store without the feature has nothing to join", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", cyTok, { roundId: noFeature.id }));
    assert.equal(r.status, 409, JSON.stringify(r.json));
  });
  await test("garbage round ids are a clean refusal", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", beaTok, { roundId: { $ne: null } }));
    assert.equal(r.status, 400, JSON.stringify(r.json));
  });
  await test("signed-out callers are refused", async () => {
    const r = await call(joinPost, req("POST", "/shop/group-buy/join", undefined, { roundId: round.id }));
    assert.equal(r.status, 401);
  });

  console.log("\nafter a refund");
  await test("a refunded customer may request again (and their status says so)", async () => {
    const m = await db.groupBuyMembership.findFirstOrThrow({ where: { groupBuyId: round.id, customerId: ann.id } });
    await db.groupBuyMembership.update({ where: { id: m.id }, data: { status: "rejected", reviewReason: "Amount short" } });
    const rej = await call(joinGet, req("GET", `/shop/group-buy/join?round=${round.id}`, annTok));
    assert.equal(rej.json.data.status.title, "Rejected: Amount short – refund in progress");
    assert.equal(rej.json.data.canJoin, false, "not until the refund is done");
    await db.groupBuyMembership.update({ where: { id: m.id }, data: { status: "refunded", refundReference: "GC-RF-1" } });
    const again = await call(joinPost, req("POST", "/shop/group-buy/join", annTok, { roundId: round.id }));
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.data.request.status, "pending_payment");
    assert.equal(await db.groupBuyMembership.count({ where: { groupBuyId: round.id, customerId: ann.id } }), 2);
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
