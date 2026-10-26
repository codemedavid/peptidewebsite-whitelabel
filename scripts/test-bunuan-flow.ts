/**
 * Bunuan end to end (2A): stages + the checkout cap + the race + auto-close,
 * through the REAL website order action, the REAL app catalog route and the
 * Bunuan server, against in-process PGlite (same harness as
 * test-gb-payment-mode.ts).
 *
 *   npm run test:bunuan-flow
 *
 * Round: Tirzepatide 15mg (kit 10, the product's vialsPerKit) and 30mg (its
 * own kitSize 5). 13 vials of 15mg → 1 kit + 3 → 7 open; 5 of 30mg → exact,
 * closed. pay_first: Start Bunuan is blocked until every order's payment is
 * checked. In Bunuan the shopper sees only "15mg, up to 7"; 8 is refused, 5 is
 * sold, then two buyers race for the last 2 — exactly one wins, and that order
 * closes the round by itself.
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
import { withGbPaymentMode } from "../src/lib/storefront/gb-payment-mode";

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

async function main() {
  const ddl = execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${path.join(process.cwd(), "prisma", "schema.prisma")}" --script`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "src/modules/ligwak/sql/gb-allocation.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const { placeStorefrontOrderAction, quoteStorefrontOrderAction } = await import("../src/actions/orders");
  const { saveGroupBuyAction } = await import("../src/actions/group-buys");
  const { setGbStageAction } = await import("../src/modules/bunuan/actions");
  const B = await import("../src/modules/bunuan/server");
  const { runAsAppActor } = await import("../src/lib/auth/app-actor-scope");
  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const catalogGet = await h("shop/catalog/route", "GET");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const keys = ["mobile.community", "groupbuy.module", "groupbuy.product_assignment", "groupbuy.edit", "groupbuy.bunuan", "groupbuy.ligwak"];
  const features = [];
  for (const key of keys) features.push(await db.feature.create({ data: { key } }));
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const A = await db.tenant.create({
    data: {
      slug: "mnm",
      name: "MNM Pepsabuy",
      status: "active",
      planId: plan.id,
      featureOverrides: { create: features.map((f) => ({ featureId: f.id, enabled: true })) },
    },
  });
  const config: Json = {
    name: "MNM Pepsabuy",
    currency: "₱",
    paymentMethods: [{ id: "pm-gcash", name: "GCash", account: "MNM", number: "0917", qrImage: "", order: 1, active: true }],
    requireProofOfPayment: false,
    couriers: [{ id: "c-jnt", name: "J&T Express", trackingUrl: "", active: true }],
    shippingLocations: [{ id: "loc-luzon", courierId: "c-jnt", code: "LZ", name: "Luzon", price: 150, active: true }],
  };
  await db.branding.create({ data: { tenantId: A.id, config: withGbPaymentMode(config, "pay_first") as Json } });
  await db.storefrontCustomer.create({
    data: { tenantId: A.id, email: "ann@buyer.test", name: "Ann Cruz", phone: "9928214519", passwordHash: hashPassword("ann-pass") },
  });
  const tirz = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "TIRZ",
      slug: "tirz",
      name: "Tirzepatide",
      priceCents: 120000,
      stock: 0,
      metadata: {
        productType: "gb",
        gbPrice: 1000,
        vialsPerKit: 10,
        variations: [
          { name: "15mg", price: 1200, gbPrice: 1000 },
          { name: "30mg", price: 2000, gbPrice: 1800, kitSize: 5 },
        ],
      },
    },
  });
  const round = await db.groupBuy.create({
    data: { tenantId: A.id, name: "GB 10/27", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000), productIds: [tirz.id] },
  });
  const ctx = { tenantId: A.id, actor: "owner", caps: { bunuan: true, ligwak: true }, productAssignment: true };

  // ── helpers ─────────────────────────────────────────────────────────────
  const shipping = { address: "Site P4", barangay: "Ibabang Dupay", city: "Lucena City", province: "Quezon", postal: "4301", locationId: "loc-luzon" };
  let seq = 0;
  const payload = (who: string, variation: string, qty: number) => ({
    id: `web-${++seq}`,
    status: "new",
    paymentStatus: "pending",
    paymentMethod: "GCash",
    date: new Date().toISOString(),
    customer: { name: who, email: `${who.toLowerCase()}@buyer.test`, phone: "9171234567", contactMethod: "Website" },
    shipping: { ...shipping, country: "Philippines", region: "", fee: 150 },
    courier: "J&T Express",
    trackingNumber: "",
    items: [{ productId: tirz.id, name: `Tirzepatide — ${variation}`, variation, qty, price: 1 }],
    adminFee: { label: "", amount: 0 },
    paymentFee: { label: "", amount: 0 },
  });
  const asWebsite = async <T,>(fn: () => Promise<T>): Promise<T> => {
    (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders = { "x-tenant-host": "mnm.pepweb.store" };
    try {
      return await fn();
    } finally {
      delete (globalThis as { __testHeaders?: Record<string, string> }).__testHeaders;
    }
  };
  const place = (who: string, variation: string, qty: number) => asWebsite(() => placeStorefrontOrderAction(payload(who, variation, qty)));
  const quote = (who: string, variation: string, qty: number) => asWebsite(() => quoteStorefrontOrderAction(payload(who, variation, qty)));
  const placed = async (who: string, variation: string, qty: number) => {
    const r = await place(who, variation, qty);
    if (!("ok" in r)) throw new Error(`order refused: ${JSON.stringify(r)}`);
    return r.order;
  };
  const roundRow = () => db.groupBuy.findFirstOrThrow({ where: { id: round.id } });
  const confirmAll = () => db.storefrontOrder.updateMany({ where: { groupBuyId: round.id, paymentStatus: "pending" }, data: { paymentStatus: "paid" } });

  // app shopper, for the catalog's Bunuan state
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (handler: Handler, r: Request) => {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const signIn = await call(login, req("POST", "/auth/login", undefined, { email: "ann@buyer.test", password: "ann-pass" }));
  assert.equal(signIn.status, 200, JSON.stringify(signIn.json));
  const tok = signIn.json.data.accessToken as string;
  const appRound = async () => {
    const r = await call(catalogGet, req("GET", "/shop/catalog", tok));
    await flushAfter();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return (r.json.data.groupBuy ?? null) as Json | null;
  };

  // ── Open ────────────────────────────────────────────────────────────────
  console.log("\nOpen");
  await placed("Ann", "15mg", 8);
  await placed("Ben", "15mg", 5);
  await placed("Cara", "30mg", 5);

  await test("the stage bar offers Start Bunuan and Close; Bunuan is blocked by unchecked payments", async () => {
    const r = await B.getRoundStage(ctx, round.id);
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.round.stage, "open");
    assert.deepEqual(r.round.options.map((o) => `${o.stage}:${o.allowed ? "ok" : "blocked"}`), ["bunuan:blocked", "closed:ok"]);
    assert.equal(r.round.blockers.length, 3);
    assert.deepEqual(r.round.blockers.map((b) => b.customerName), ["Ann", "Ben", "Cara"], "oldest first, named");
  });
  await test("Start Bunuan refused with the list of orders awaiting a payment check", async () => {
    const r = await B.setStage(ctx, { roundId: round.id, stage: "bunuan" });
    assert.ok(!r.ok && r.code === "blocked" && r.blockers?.length === 3, JSON.stringify(r));
    assert.equal((await roundRow()).stage, "open");
  });
  await test("a junk stage is refused", async () => {
    const r = await B.setStage(ctx, { roundId: round.id, stage: "ligwak" });
    assert.ok(!r.ok && r.code === "invalid_input", JSON.stringify(r));
  });

  await confirmAll();
  await test("once every payment is checked, Start Bunuan works: no timer, mode snapshotted, audited", async () => {
    const r = await B.setStage(ctx, { roundId: round.id, stage: "bunuan" });
    assert.ok(r.ok, JSON.stringify(r));
    const row = await roundRow();
    assert.deepEqual([row.stage, row.status, row.endsAt, row.paymentMode], ["bunuan", "active", null, "pay_first"]);
    const ev = await db.gbAuditEvent.findFirst({ where: { groupBuyId: round.id, kind: "stage" } });
    assert.deepEqual([ev?.actor, (ev?.data as Json).from, (ev?.data as Json).to], ["owner", "open", "bunuan"]);
  });

  // ── Bunuan ──────────────────────────────────────────────────────────────
  console.log("\nBunuan time");
  await test("the admin counter: 15mg 13 vials, 7 needed; 30mg exact", async () => {
    const r = await B.getBunuanCounter(ctx, round.id);
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.deepEqual(
      r.counter.kits.map((k) => [k.variation, k.vials, k.kitSize, k.vialsNeeded]),
      [["15mg", 13, 10, 7], ["30mg", 5, 5, 0]],
    );
    assert.deepEqual([r.counter.openCount, r.counter.allFilled, r.counter.stage], [1, false, "bunuan"]);
  });
  await test("the app shows only 15mg, up to 7 — no other option", async () => {
    const gb = await appRound();
    assert.equal(gb?.stage, "bunuan");
    assert.deepEqual(gb?.bunuan?.open, [{ productId: tirz.id, variation: "15mg", name: "Tirzepatide — 15mg", allowance: 7 }]);
  });
  await test("8 vials of 15mg is refused — at the quote and at placement", async () => {
    const q = await quote("Dan", "15mg", 8);
    assert.ok("error" in q && /Only 7 vials/.test(q.error), JSON.stringify(q));
    const r = await place("Dan", "15mg", 8);
    assert.ok("error" in r && /Only 7 vials/.test(r.error), JSON.stringify(r));
  });
  await test("30mg (its kit is full) is refused", async () => {
    const r = await place("Dan", "30mg", 1);
    assert.ok("error" in r && /isn't open/.test(r.error), JSON.stringify(r));
  });
  await test("5 of the 7 is sold — counted at once, pending its payment check", async () => {
    await placed("Dan", "15mg", 5);
    const r = await B.getBunuanCounter(ctx, round.id);
    assert.ok(r.ok);
    if (!r.ok) return;
    const k = r.counter.kits.find((x) => x.variation === "15mg")!;
    assert.deepEqual([k.vials, k.vialsNeeded, k.pendingVials], [18, 2, 5]);
  });
  await test("the race: two buyers ask for the last 2 at once — exactly one is sold", async () => {
    const [e, f] = await Promise.all([place("Eve", "15mg", 2), place("Fay", "15mg", 2)]);
    const wins = [e, f].filter((r) => "ok" in r);
    const losses = [e, f].filter((r) => "error" in r) as { error: string }[];
    assert.equal(wins.length, 1, JSON.stringify([e, f]));
    assert.match(losses[0].error, /full|closed|isn't open/i);
    const sold = await db.storefrontOrder.findMany({ where: { groupBuyId: round.id } });
    const vials15 = sold.flatMap((o) => o.items as Json[]).filter((i) => i.variation === "15mg").reduce((s, i) => s + i.qty, 0);
    assert.equal(vials15, 20, "13 + 5 + 2 = exactly two kits, never more");
  });
  await test("…and that order closed the round by itself (stage + status), audited as the system", async () => {
    const row = await roundRow();
    assert.deepEqual([row.stage, row.status], ["closed", "closed"]);
    assert.ok(row.closedAt);
    const ev = await db.gbAuditEvent.findFirst({ where: { groupBuyId: round.id, kind: "stage", actor: "system" } });
    assert.ok(ev, "auto-close audited");
    assert.equal((ev?.data as Json).auto, true);
  });
  await test("the closed round is gone from the app shop", async () => {
    assert.equal(await appRound(), null);
  });

  // ── Closed ──────────────────────────────────────────────────────────────
  console.log("\nClosed");
  await test("pay_first Closed offers only Reopen (before the Ligwak lock)", async () => {
    const r = await B.getRoundStage(ctx, round.id);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.round.options.map((o) => `${o.stage}:${o.allowed ? "ok" : "blocked"}`), ["open:ok"]);
    assert.equal(r.round.reportReady, true);
    assert.equal(r.round.reportFinal, false, "final only once Ligwak locks");
  });
  await test("Reopen: active again, stage Open, audited — through the store-admin action", async () => {
    const r = await runAsAppActor({ tenantId: A.id, slug: "mnm", subject: { kind: "owner" } }, () => setGbStageAction(round.id, "open"));
    assert.ok(r.ok, JSON.stringify(r));
    const row = await roundRow();
    assert.deepEqual([row.stage, row.status], ["open", "active"]);
  });
  await test("the old round editor closing it moves the stage to Closed too", async () => {
    const gb = await roundRow();
    const r = await runAsAppActor({ tenantId: A.id, slug: "mnm", subject: { kind: "owner" } }, () =>
      saveGroupBuyAction({ ...gb, status: "closed", productIds: [tirz.id], startsAt: null, endsAt: null }),
    );
    assert.ok("ok" in r, JSON.stringify(r));
    const row = await roundRow();
    assert.deepEqual([row.stage, row.status], ["closed", "closed"]);
  });
  await test("Payment time isn't offered to a pay_first round", async () => {
    const r = await B.setStage(ctx, { roundId: round.id, stage: "payment" });
    assert.ok(!r.ok, JSON.stringify(r));
  });

  // ── a store without Bunuan / Ligwak ─────────────────────────────────────
  console.log("\na store without Bunuan / Ligwak");
  await test("no stage moves at all, and the action says so", async () => {
    const r = await B.setStage({ ...ctx, caps: { bunuan: false, ligwak: false } }, { roundId: round.id, stage: "open" });
    assert.ok(!r.ok && r.code === "unavailable", JSON.stringify(r));
    const v = await B.getRoundStage({ ...ctx, caps: { bunuan: false, ligwak: false } }, round.id);
    assert.ok(v.ok && v.round.options.length === 0);
  });

  await db.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
