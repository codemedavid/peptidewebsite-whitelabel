/**
 * Peptide Tracker API gate (docs/mobile-admin/TRACKER.md §5, phase 2): the REAL
 * /api/mobile/v1/tracker/* handlers, auth, withTenant and Prisma against
 * in-process PGlite built from prisma/schema.prisma (same harness as
 * test-community-saved-replies-api.ts). No live database is touched.
 *
 *   npm run test:tracker-api
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";

process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/pglite-only";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "pepweb.store";
process.env.TENANT_ADMIN_SECRET = "test-secret";
delete process.env.EXPO_ACCESS_TOKEN;

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

const T0 = Date.parse("2026-11-10T00:00:00.000Z");
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const doseData = (id: string, minutes: number, extra: Json = {}) => ({
  id,
  createdAt: iso(0),
  updatedAt: iso(minutes),
  deletedAt: null,
  protocolId: "p1",
  name: "BPC-157",
  takenAt: iso(minutes),
  scheduledFor: null,
  dose: { value: 250, unit: "mcg" },
  volumeMl: null,
  units: null,
  route: "injection",
  site: null,
  vialId: null,
  note: null,
  ...extra,
});
const dose = (id: string, minutes: number, extra: Json = {}) => ({
  kind: "dose",
  id,
  data: doseData(id, minutes, extra),
  updatedAt: iso(minutes),
  deletedAt: null,
});
const tombstone = (kind: string, id: string, minutes: number) => ({
  kind,
  id,
  data: { id },
  updatedAt: iso(minutes),
  deletedAt: iso(minutes),
});
const settings = (minutes: number) => ({
  kind: "settings",
  id: "settings",
  updatedAt: iso(minutes),
  deletedAt: null,
  data: {
    weightUnit: "kg",
    defaultSyringe: "u100_1ml",
    doseReminders: true,
    refillReminders: true,
    checkinReminder: false,
    checkinTime: "20:00",
    showNamesInNotifications: true,
    suggestSites: true,
    updatedAt: iso(minutes),
  },
});

async function main() {
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${path.join(process.cwd(), "prisma", "schema.prisma")}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pg = new PGlite();
  await pg.exec(ddl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const V1 = "../src/app/api/mobile/v1";
  const h = async (p: string, method: string) => (await import(`${V1}/${p}`))[method] as Handler;
  const login = await h("auth/login/route", "POST");
  const syncRoute = await h("tracker/sync/route", "POST");
  const vialsRoute = await h("tracker/order-vials/route", "GET");
  const guidesRoute = await h("tracker/store-guides/route", "GET");
  const deleteAccount = await h("account/delete/route", "POST");

  // ── seed ────────────────────────────────────────────────────────────────
  const feature = (key: string) => db.feature.create({ data: { key } });
  const [fShop, fTracker, fGuide, fProtocols, fStaff] = await Promise.all([
    feature("mobile.shop"),
    feature("mobile.tracker"),
    feature("mobile.tracker.guide_import"),
    feature("storefront.protocols"),
    feature("storefront.staff_accounts"),
  ]);
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const store = async (slug: string, featureIds: string[], config: Json = {}) => {
    const t = await db.tenant.create({
      data: {
        slug,
        name: slug,
        status: "active",
        planId: plan.id,
        storeAdminEmail: `owner@${slug}.test`,
        storeAdminPasswordHash: hashPassword("owner-pass"),
        featureOverrides: { create: featureIds.map((featureId) => ({ featureId, enabled: true })) },
      },
    });
    await db.branding.create({ data: { tenantId: t.id, config: { name: slug, ...config } } });
    return t;
  };
  const A = await store("alpha", [fShop.id, fTracker.id, fGuide.id, fProtocols.id, fStaff.id], {
    protocols: [
      { name: "BPC-157", category: "Recovery", dosage: "250mcg", frequency: "Daily", duration: "4 weeks", storage: "Fridge", notes: ["Rotate sites"] },
      { name: "Dosing chart", mode: "image", images: ["https://ik.imagekit.io/pep/chart.jpg"] },
    ],
  });
  const B = await store("beta", [fShop.id, fTracker.id]);
  const C = await store("gamma", [fShop.id]);
  const customer = (tenantId: string, email: string) =>
    db.storefrontCustomer.create({ data: { tenantId, email, name: email.split("@")[0], passwordHash: hashPassword("pw-123456") } });
  const ann = await customer(A.id, "ann@buyer.test");
  const bob = await customer(A.id, "bob@buyer.test");
  const cat = await customer(B.id, "cat@buyer.test");
  await customer(C.id, "dan@buyer.test");
  const sam = await db.storefrontStaff.create({
    data: { tenantId: A.id, fullName: "Sam Staff", email: "sam@alpha.test", username: "sam", passwordHash: hashPassword("staff-pass") },
  });

  const bpc = await db.product.create({
    data: {
      tenantId: A.id,
      sku: "BPC",
      name: "BPC-157",
      priceCents: 100,
      images: ["https://ik.imagekit.io/pep/bpc.jpg"],
      metadata: { variations: [{ name: "10mg", price: 1, image: "https://ik.imagekit.io/pep/bpc-10.jpg" }] },
    },
  });
  let orderSeq = 1000;
  const order = (customerAccountId: string | null, status: string, items: Json[], extra: Json = {}) =>
    db.storefrontOrder.create({
      data: {
        tenantId: A.id,
        orderNumber: `A-${++orderSeq}`,
        status,
        customerAccountId,
        items,
        placedAt: new Date(T0 + orderSeq * 60_000),
        statusHistory: status === "delivered" ? [{ status: "new", at: iso(0) }, { status: "delivered", at: iso(90) }] : [],
        ...extra,
      },
    });
  const oShipped = await order(ann.id, "shipped", [{ productId: bpc.id, name: "BPC-157 (10mg)", qty: 2, price: 1, variation: "10mg" }]);
  const oDelivered = await order(ann.id, "delivered", [
    { productId: bpc.id, name: "BPC-157", qty: 1, price: 1 },
    { name: "Bac water", qty: 3, price: 1 },
  ]);
  await order(ann.id, "new", [{ productId: bpc.id, name: "BPC-157 5mg", qty: 1, price: 1 }]);
  await order(ann.id, "delivered", [{ productId: bpc.id, name: "Trashed 5mg", qty: 1, price: 1 }], { deletedAt: new Date() });
  await order(bob.id, "delivered", [{ productId: bpc.id, name: "Bob's 5mg", qty: 1, price: 1 }]);
  await order(null, "delivered", [{ productId: bpc.id, name: "Guest 5mg", qty: 1, price: 1 }]);

  // ── helpers ─────────────────────────────────────────────────────────────
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new Request(`https://app.pepweb.store/api/mobile/v1${url}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function call(handler: Handler, r: Request) {
    const res = await handler(r, { params: Promise.resolve({}) });
    return { status: res.status, json: (await res.json()) as Json };
  }
  let ipSeq = 0;
  const useIp = () => ((globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`);
  const token = async (email: string, pw: string, storeSlug?: string) => {
    useIp();
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: pw, ...(storeSlug ? { store: storeSlug } : {}) }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const sync = (tok: string | undefined, body: unknown) => call(syncRoute, req("POST", "/tracker/sync", tok, body));
  const vials = (tok: string) => call(vialsRoute, req("GET", "/tracker/order-vials", tok));
  const guides = (tok: string) => call(guidesRoute, req("GET", "/tracker/store-guides", tok));
  const rowsOf = (customerId: string) => db.trackerRecord.findMany({ where: { customerId } });
  /** Pull every page from `cursor`; returns all records + the final cursor. */
  const pullAll = async (tok: string, cursor: string | null) => {
    const out: Json[] = [];
    let c = cursor;
    let pages = 0;
    for (;;) {
      const r = await sync(tok, { cursor: c, push: [] });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      out.push(...r.json.data.pulled);
      c = r.json.data.cursor;
      pages++;
      if (!r.json.data.hasMore) return { records: out, cursor: c, pages };
      assert.ok(pages < 20, "paging never ended");
    }
  };

  const annTok = await token("ann@buyer.test", "pw-123456");
  const annTok2 = await token("ann@buyer.test", "pw-123456"); // Ann's second phone
  const bobTok = await token("bob@buyer.test", "pw-123456");
  const catTok = await token("cat@buyer.test", "pw-123456");
  const danTok = await token("dan@buyer.test", "pw-123456");
  const ownerTok = await token("owner@alpha.test", "owner-pass");
  const samTok = await token("sam@alpha.test", "staff-pass", "alpha");

  console.log("\nwho may call /tracker/*");
  await test("no token → 401", async () => assert.equal((await sync(undefined, { cursor: null, push: [] })).status, 401));
  await test("the store owner keeps their OWN tracker: sync works, rows are keyed 'owner'", async () => {
    const r = await sync(ownerTok, { cursor: null, push: [dose("o1", 3, { name: "Owner's own peptide" })] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.rejected, []);
    assert.deepEqual(r.json.data.pulled.map((x: Json) => x.id), ["o1"]);
    const row = await db.trackerRecord.findFirstOrThrow({ where: { tenantId: A.id, subject: "owner" } });
    assert.equal(row.customerId, null);
    assert.equal(row.staffId, null);
  });
  await test("the owner's order-vials are empty (the team buys nothing in the app); guides still load", async () => {
    const v = await vials(ownerTok);
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.deepEqual(v.json.data.vials, []);
    assert.equal((await guides(ownerTok)).status, 200);
  });
  await test("a staff member keeps their OWN tracker, separate from the owner's", async () => {
    const r = await sync(samTok, { cursor: null, push: [dose("o1", 4, { name: "Sam's dose" })] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.pulled.map((x: Json) => `${x.id}:${x.data.name}`), ["o1:Sam's dose"]);
    const row = await db.trackerRecord.findFirstOrThrow({ where: { subject: `staff:${sam.id}` } });
    assert.equal(row.staffId, sam.id);
    const owner = await pullAll(ownerTok, null);
    assert.deepEqual(owner.records.map((x) => `${x.id}:${(x.data as Json).name}`), ["o1:Owner's own peptide"]);
  });
  await test("tracker not granted → 404 not_found on every route", async () => {
    for (const r of [await sync(danTok, { cursor: null, push: [] }), await vials(danTok), await guides(danTok)]) {
      assert.equal(r.status, 404, JSON.stringify(r.json));
      assert.equal(r.json.error.code, "not_found");
    }
  });
  await test("store guides need guide import (beta has the tracker only) → 404", async () => {
    assert.equal((await guides(catTok)).status, 404);
    assert.equal((await sync(catTok, { cursor: null, push: [] })).status, 200);
  });

  console.log("\nsync — push, pull, idempotency");
  let annCursor: string | null = null;
  await test("first sync pushes 2 doses + settings and pulls them back", async () => {
    const r = await sync(annTok, { cursor: null, push: [dose("d1", 10), dose("d2", 11), settings(5)] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.rejected, []);
    assert.deepEqual(r.json.data.pulled.map((x: Json) => `${x.kind}:${x.id}`).sort(), ["dose:d1", "dose:d2", "settings:settings"]);
    assert.equal(r.json.data.hasMore, false);
    assert.equal(typeof r.json.data.cursor, "string");
    const d1 = r.json.data.pulled.find((x: Json) => x.id === "d1");
    assert.equal(d1.updatedAt, iso(10));
    assert.equal(d1.deletedAt, null);
    assert.equal(d1.data.name, "BPC-157");
    annCursor = r.json.data.cursor;
  });
  await test("re-pushing the same records is a no-op (no duplicates, nothing new to pull)", async () => {
    const r = await sync(annTok, { cursor: annCursor, push: [dose("d1", 10), dose("d2", 11), settings(5)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.pulled, []);
    assert.equal((await rowsOf(ann.id)).length, 3);
    annCursor = r.json.data.cursor;
  });
  await test("a bad record is rejected by itself; the rest still sync", async () => {
    const r = await sync(annTok, { cursor: annCursor, push: [dose("d3", 12), { ...dose("d4", 12), data: { ...doseData("d4", 12), dose: { value: -5, unit: "mg" } } }, { kind: "diary", id: "x", data: {}, updatedAt: iso(1), deletedAt: null }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.rejected.map((x: Json) => x.id).sort(), ["d4", "x"]);
    assert.deepEqual(r.json.data.pulled.map((x: Json) => x.id), ["d3"]);
    annCursor = r.json.data.cursor;
  });
  await test(`more than 500 records in one push → 400 invalid_input`, async () => {
    const r = await sync(annTok, { cursor: annCursor, push: Array.from({ length: 501 }, (_, i) => dose(`z${i}`, 1)) });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "invalid_input");
  });
  await test("a garbage cursor is a full re-pull, not an error", async () => {
    const r = await sync(annTok, { cursor: "garbage!!", push: [] });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.pulled.length, 4);
  });

  console.log("\nisolation");
  await test("another customer of the same store pulls none of Ann's records", async () => {
    const { records } = await pullAll(bobTok, null);
    assert.deepEqual(records, []);
  });
  await test("the store owner and staff pull none of their customers' records (no store-side read path)", async () => {
    for (const tok of [ownerTok, samTok]) {
      const { records } = await pullAll(tok, null);
      assert.deepEqual(records.map((x) => x.id), ["o1"]);
    }
  });
  await test("the same record id on Bob's account is his own record", async () => {
    const r = await sync(bobTok, { cursor: null, push: [dose("d1", 50, { name: "Bob's dose" })] });
    assert.equal(r.status, 200);
    assert.equal((await rowsOf(bob.id)).length, 1);
    const annD1 = (await rowsOf(ann.id)).find((x) => x.localId === "d1")!;
    assert.equal((annD1.data as Json).name, "BPC-157");
  });
  await test("a customer of another store sees only their own", async () => {
    await sync(catTok, { cursor: null, push: [dose("c1", 5)] });
    const { records } = await pullAll(catTok, null);
    assert.deepEqual(records.map((x) => x.id), ["c1"]);
    const row = await db.trackerRecord.findFirstOrThrow({ where: { customerId: cat.id } });
    assert.equal(row.tenantId, B.id);
  });

  console.log("\nlast write wins + tombstones (two phones)");
  let phone2Cursor: string | null = null;
  await test("phone 2 starts from scratch and gets everything", async () => {
    const { records, cursor } = await pullAll(annTok2, null);
    assert.equal(records.length, 4);
    phone2Cursor = cursor;
  });
  await test("a NEWER edit from phone 1 replaces the stored copy and reaches phone 2", async () => {
    const r = await sync(annTok, { cursor: annCursor, push: [dose("d1", 30, { note: "edited" })] });
    assert.equal(r.status, 200);
    const row = (await rowsOf(ann.id)).find((x) => x.localId === "d1")!;
    assert.equal((row.data as Json).note, "edited");
    assert.equal(row.updatedAt.toISOString(), iso(30));
    const p2 = await sync(annTok2, { cursor: phone2Cursor, push: [] });
    assert.deepEqual(p2.json.data.pulled.map((x: Json) => [x.id, x.data.note]), [["d1", "edited"]]);
    phone2Cursor = p2.json.data.cursor;
    annCursor = r.json.data.cursor;
  });
  await test("an OLDER edit from phone 2 loses; the server's newer copy comes back to it", async () => {
    const r = await sync(annTok2, { cursor: phone2Cursor, push: [dose("d1", 20, { note: "stale" })] });
    assert.equal(r.status, 200);
    const row = (await rowsOf(ann.id)).find((x) => x.localId === "d1")!;
    assert.equal((row.data as Json).note, "edited");
    assert.deepEqual(r.json.data.pulled.map((x: Json) => [x.id, x.data.note]), [["d1", "edited"]]);
    phone2Cursor = r.json.data.cursor;
  });
  await test("a tombstone deletes on every phone", async () => {
    const r = await sync(annTok2, { cursor: phone2Cursor, push: [tombstone("dose", "d2", 40)] });
    assert.equal(r.status, 200);
    const row = (await rowsOf(ann.id)).find((x) => x.localId === "d2")!;
    assert.equal(row.deletedAt?.toISOString(), iso(40));
    phone2Cursor = r.json.data.cursor;
    const p1 = await sync(annTok, { cursor: annCursor, push: [] });
    assert.deepEqual(p1.json.data.pulled.map((x: Json) => [x.id, x.deletedAt]), [["d2", iso(40)]]);
    annCursor = p1.json.data.cursor;
  });
  await test("an older live copy can't resurrect the tombstone", async () => {
    const r = await sync(annTok, { cursor: annCursor, push: [dose("d2", 35)] });
    const row = (await rowsOf(ann.id)).find((x) => x.localId === "d2")!;
    assert.equal(row.deletedAt?.toISOString(), iso(40));
    assert.deepEqual(r.json.data.pulled.map((x: Json) => [x.id, x.deletedAt]), [["d2", iso(40)]]);
    annCursor = r.json.data.cursor;
  });
  await test("a newer live copy after the delete brings it back", async () => {
    await sync(annTok, { cursor: annCursor, push: [dose("d2", 60)] });
    const row = (await rowsOf(ann.id)).find((x) => x.localId === "d2")!;
    assert.equal(row.deletedAt, null);
  });

  console.log("\npaging");
  await test("1,000 records page out 500 at a time with hasMore, no gaps, no repeats", async () => {
    for (let batch = 0; batch < 2; batch++) {
      const push = Array.from({ length: 500 }, (_, i) => dose(`bulk-${batch}-${i}`, 100 + i));
      const r = await sync(bobTok, { cursor: null, push });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data.rejected, []);
    }
    const first = await sync(bobTok, { cursor: null, push: [] });
    assert.equal(first.json.data.pulled.length, 500);
    assert.equal(first.json.data.hasMore, true);
    const { records, pages } = await pullAll(bobTok, null);
    assert.equal(pages, 3);
    const ids = records.map((x) => x.id);
    assert.equal(ids.length, 1001);
    assert.equal(new Set(ids).size, 1001);
  });

  console.log("\nrevoking the tracker");
  await test("revoked → 404; data kept; re-granted → it all comes back", async () => {
    await db.tenantFeatureOverride.updateMany({ where: { tenantId: A.id, featureId: fTracker.id }, data: { enabled: false } });
    assert.equal((await sync(annTok, { cursor: null, push: [] })).status, 404);
    assert.ok((await rowsOf(ann.id)).length > 0);
    await db.tenantFeatureOverride.updateMany({ where: { tenantId: A.id, featureId: fTracker.id }, data: { enabled: true } });
    const { records } = await pullAll(annTok, null);
    assert.equal(records.length, 4);
  });

  console.log("\norder vials");
  await test("Ann's shipped + delivered lines only, newest order first, keyed by order + line", async () => {
    const r = await vials(annTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = r.json.data.vials as Json[];
    assert.deepEqual(rows.map((x) => x.key), [`${oDelivered.id}:0`, `${oDelivered.id}:1`, `${oShipped.id}:0`]);
    const shipped = rows[2];
    assert.equal(shipped.orderNumber, oShipped.orderNumber);
    assert.equal(shipped.deliveredAt, null);
    assert.equal(shipped.variation, "10mg");
    assert.deepEqual(shipped.strength, { value: 10, unit: "mg" });
    assert.equal(shipped.quantity, 2);
    assert.match(shipped.imageUrl, /^https:\/\/ik\.imagekit\.io\/pep\/bpc-10\.jpg\?tr=/);
    assert.equal(rows[0].deliveredAt, iso(90));
    assert.equal(rows[0].strength, null);
    assert.equal(rows[1].productId, "");
    assert.equal(rows[1].imageUrl, null);
  });
  await test("never another buyer's, a guest's, a trashed or an unshipped order", async () => {
    const names = ((await vials(annTok)).json.data.vials as Json[]).map((x) => x.name).join("|");
    assert.ok(!/Bob|Guest|Trashed|5mg/.test(names), names);
    assert.deepEqual((await vials(catTok)).json.data.vials, []);
  });

  console.log("\nstore guides");
  await test("details-mode protocols only, mapped to TrackerStoreGuide", async () => {
    const r = await guides(annTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.guides, [
      { name: "BPC-157", category: "Recovery", dosage: "250mcg", frequency: "Daily", duration: "4 weeks", storage: "Fridge", notes: ["Rotate sites"] },
    ]);
  });

  console.log("\nstorage limits");
  await test("a body over 2 MB → 413 with the usual error shape, before it is parsed", async () => {
    const r = await sync(catTok, { cursor: null, push: [], pad: "x".repeat(2 * 1024 * 1024 + 10) });
    assert.equal(r.status, 413, JSON.stringify(r.json).slice(0, 200));
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error.code, "invalid_input");
    assert.equal(typeof r.json.error.message, "string");
  });
  await test("a tombstone pushed with its full last copy is stored as { id } only", async () => {
    const r = await sync(catTok, { cursor: null, push: [{ ...dose("c-del", 5), deletedAt: iso(5) }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = await db.trackerRecord.findFirstOrThrow({ where: { customerId: cat.id, localId: "c-del" } });
    assert.deepEqual(row.data, { id: "c-del" });
  });
  await test("tombstones older than 90 days are purged on sync; newer ones and live rows stay", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - 100 * day);
    const recent = new Date(Date.now() - 10 * day);
    const row = (localId: string, deletedAt: Date | null) => ({ tenantId: B.id, subject: `customer:${cat.id}`, customerId: cat.id, kind: "dose", localId, data: { id: localId }, updatedAt: deletedAt ?? recent, deletedAt });
    await db.trackerRecord.createMany({ data: [row("old-1", old), row("old-2", old), row("recent-1", recent), row("live-1", null)] });
    const r = await sync(catTok, { cursor: null, push: [dose("c-new", 6)] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ids = (await rowsOf(cat.id)).map((x) => x.localId);
    assert.ok(!ids.includes("old-1") && !ids.includes("old-2"), ids.join(","));
    assert.ok(ids.includes("recent-1") && ids.includes("live-1") && ids.includes("c-new"), ids.join(","));
  });
  await test("at 25,000 rows (live + tombstones) new records are refused as storage_full; edits still go through", async () => {
    const have = await db.trackerRecord.count({ where: { customerId: cat.id } });
    const fill = Array.from({ length: 25_000 - have }, (_, i) => ({
      tenantId: B.id,
      subject: `customer:${cat.id}`,
      customerId: cat.id,
      kind: "dose",
      localId: `fill-${i}`,
      data: { id: `fill-${i}` },
      updatedAt: new Date(T0),
      deletedAt: new Date(T0 + 1),
    }));
    await db.trackerRecord.createMany({ data: fill });
    const r = await sync(catTok, { cursor: null, push: [dose("c-over", 7), dose("c-new", 90, { note: "edited" })] });
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
    assert.deepEqual(r.json.data.rejected.map((x: Json) => [x.id, x.reason]), [["c-over", "storage_full"]]);
    const edited = (await rowsOf(cat.id)).find((x) => x.localId === "c-new")!;
    assert.equal((edited.data as Json).note, "edited");
    assert.equal(await db.trackerRecord.count({ where: { customerId: cat.id } }), 25_000);
  });

  console.log("\naccount deletion");
  await test("deleting the account deletes its tracker records (cascade); others untouched", async () => {
    assert.ok((await rowsOf(ann.id)).length > 0);
    useIp();
    const r = await call(deleteAccount, req("POST", "/account/delete", annTok, { password: "pw-123456" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await db.trackerRecord.count({ where: { customerId: ann.id } }), 0);
    assert.ok((await rowsOf(bob.id)).length > 0);
  });
  await test("deleting a staff member deletes their tracker records (cascade); the owner's stay", async () => {
    await db.storefrontStaff.delete({ where: { id: sam.id } });
    assert.equal(await db.trackerRecord.count({ where: { subject: `staff:${sam.id}` } }), 0);
    assert.equal(await db.trackerRecord.count({ where: { tenantId: A.id, subject: "owner" } }), 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pg.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
