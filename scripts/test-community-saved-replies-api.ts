/**
 * Integration gate for saved replies: the REAL route handlers, auth and the
 * branding row against in-process PGlite (same harness as
 * test-community-moderation-api.ts).
 *
 *   npm run test:community-saved-replies-api
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
  const listRoute = await h("community/saved-replies/route", "GET");
  const createRoute = await h("community/saved-replies/route", "POST");
  const updateRoute = await h("community/saved-replies/[id]/route", "PATCH");
  const deleteRoute = await h("community/saved-replies/[id]/route", "DELETE");
  const inbox = await h("community/inbox/route", "GET");
  const messagesPost = await h("community/threads/[type]/[id]/messages/route", "POST");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const fStaff = await db.feature.create({ data: { key: "storefront.staff_accounts" } });
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const T = await db.tenant.create({
    data: {
      slug: "alpha",
      name: "Alpha Peps",
      status: "active",
      planId: plan.id,
      storeAdminEmail: "owner@alpha.test",
      storeAdminPasswordHash: hashPassword("owner-pass"),
      featureOverrides: { create: [{ featureId: fCommunity.id, enabled: true }, { featureId: fStaff.id, enabled: true }] },
    },
  });
  await db.branding.create({ data: { tenantId: T.id, config: { name: "Alpha Peps", communityJoin: "open" } } });
  await db.storefrontStaff.create({
    data: { tenantId: T.id, fullName: "Mo Mod", email: "mod@alpha.test", username: "mod", passwordHash: hashPassword("mod-pass"), permissions: ["community"] },
  });
  await db.storefrontStaff.create({
    data: { tenantId: T.id, fullName: "Cory Clerk", email: "clerk@alpha.test", username: "clerk", passwordHash: hashPassword("clerk-pass"), permissions: ["orders"] },
  });
  const ann = await db.storefrontCustomer.create({ data: { tenantId: T.id, email: "ann@buyer.test", name: "Ann Cruz", passwordHash: hashPassword("ann-pass") } });
  const { urlHash } = await import("../src/lib/community/uploads.server");
  const upload = (url: string, uploaderKey: string, kind = "image") =>
    db.communityUpload.create({ data: { tenantId: T.id, uploaderKey, kind, url, urlHash: urlHash(url), name: "p.jpg", size: 1000, mime: "image/jpeg", width: 800, height: 600 } });
  const P1 = "https://ik.imagekit.io/pep/community/price-1.jpg";
  const P2 = "https://ik.imagekit.io/pep/community/price-2.jpg";
  const ANN_PHOTO = "https://ik.imagekit.io/pep/community/ann.jpg";
  const DOC = "https://ik.imagekit.io/pep/community/terms.pdf";
  await upload(P1, "store");
  await upload(P2, "store");
  await upload(ANN_PHOTO, `c:${ann.id}`);
  await upload(DOC, "store", "file");

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
  let ipSeq = 0;
  const useIp = () => ((globalThis as { __testClientIp?: string }).__testClientIp = `198.51.100.${++ipSeq % 250}`);
  const token = async (email: string, pw: string) => {
    useIp();
    const r = await call(login, req("POST", "/auth/login", undefined, { email, password: pw }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  const list = (tok: string) => call(listRoute, req("GET", "/community/saved-replies", tok));
  const create = (tok: string, body: unknown) => call(createRoute, req("POST", "/community/saved-replies", tok, body));
  const update = (tok: string, id: string, body: unknown) => call(updateRoute, req("PATCH", `/community/saved-replies/${id}`, tok, body), { id });
  const remove = (tok: string, id: string) => call(deleteRoute, req("DELETE", `/community/saved-replies/${id}`, tok), { id });
  const config = async () => (await db.branding.findFirstOrThrow({ where: { tenantId: T.id } })).config as Json;

  const ownerTok = await token("owner@alpha.test", "owner-pass");
  const modTok = await token("mod@alpha.test", "mod-pass");
  const clerkTok = await token("clerk@alpha.test", "clerk-pass");
  const annTok = await token("ann@buyer.test", "ann-pass");

  console.log("\nwho can use saved replies");
  await test("the store team starts with an empty list", async () => {
    const r = await list(ownerTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.data.replies, []);
  });
  await test("customers can't read or save replies", async () => {
    assert.equal((await list(annTok)).status, 403);
    assert.equal((await create(annTok, { title: "x", body: "y" })).status, 403);
  });
  await test("staff without the community module can't either", async () => {
    assert.equal((await list(clerkTok)).status, 403);
  });

  console.log("\nshared across the whole team");
  let paymentId = "";
  await test("the owner saves a reply and a moderator sees it, with who saved it", async () => {
    const r = await create(ownerTok, { title: "Payment", body: "GCash 0917 000 0000 · send the proof here po" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    paymentId = r.json.data.replies[0].id;
    assert.ok(paymentId);
    const seen = await list(modTok);
    assert.equal(seen.json.data.replies.length, 1);
    assert.equal(seen.json.data.replies[0].title, "Payment");
    assert.equal(seen.json.data.replies[0].createdBy, "Store owner");
  });
  await test("a moderator edits it; the owner sees the edit and who made it", async () => {
    const r = await update(modTok, paymentId, { title: "Payment", body: "GCash or Maya · send the proof here po" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const seen = (await list(ownerTok)).json.data.replies[0];
    assert.equal(seen.body, "GCash or Maya · send the proof here po");
    assert.equal(seen.updatedBy, "Mo Mod");
    assert.equal(seen.createdBy, "Store owner");
  });
  await test("bad input and duplicate titles are refused with a reason", async () => {
    const empty = await create(ownerTok, { title: "", body: "x" });
    assert.equal(empty.status, 400);
    assert.ok(empty.json.error.message);
    const dup = await create(modTok, { title: "payment", body: "again" });
    assert.equal(dup.status, 400);
  });
  await test("two admins saving at the same moment both keep their reply", async () => {
    const [a, b] = await Promise.all([create(ownerTok, { title: "Shipping", body: "Ships Mon/Thu" }), create(modTok, { title: "Hours", body: "9am–6pm" })]);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(b.status, 200, JSON.stringify(b.json));
    const titles = (await list(ownerTok)).json.data.replies.map((r: Json) => r.title);
    assert.deepEqual(titles, ["Hours", "Payment", "Shipping"]);
  });
  await test("the rest of the store's settings are kept", async () => {
    const cfg = await config();
    assert.equal(cfg.name, "Alpha Peps");
    assert.equal(cfg.communityJoin, "open");
    assert.equal(cfg.communitySavedReplies.length, 3);
  });

  console.log("\nphotos");
  let priceId = "";
  await test("a reply with photos the team uploaded is saved with their sizes, in order", async () => {
    const r = await create(modTok, { title: "Price list", body: "Here po 👇", images: [{ url: P2 }, { url: P1 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const saved = r.json.data.replies.find((x: Json) => x.title === "Price list");
    priceId = saved.id;
    assert.deepEqual(saved.images, [
      { url: P2, width: 800, height: 600 },
      { url: P1, width: 800, height: 600 },
    ]);
  });
  await test("the owner sees the photos a moderator saved", async () => {
    const seen = (await list(ownerTok)).json.data.replies.find((x: Json) => x.id === priceId);
    assert.equal(seen.images.length, 2);
  });
  await test("a photo-only reply is fine", async () => {
    const r = await create(ownerTok, { title: "Menu", body: "", images: [{ url: P1 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  });
  await test("a customer's photo, a document or an unknown url can't be saved", async () => {
    for (const url of [ANN_PHOTO, DOC, "https://evil.example/x.jpg"]) {
      const r = await create(ownerTok, { title: `Bad ${url.length}`, body: "x", images: [{ url }] });
      assert.equal(r.status, 400, url);
    }
  });
  await test("another admin can send a saved photo into a chat without uploading it again", async () => {
    const boot = await call(inbox, req("GET", "/community/inbox", ownerTok));
    const general = boot.json.data.channels.find((c: Json) => c.postRole === "everyone").generalTopicId as string;
    const r = await call(
      messagesPost,
      req("POST", `/community/threads/topic/${general}/messages`, ownerTok, {
        kind: "image",
        clientId: "saved-photo-1",
        upload: { kind: "image", url: P2, name: "", size: 0, mime: "", width: null, height: null },
      }),
      { type: "topic", id: general },
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.image.url, P2);
  });
  await test("editing can drop photos", async () => {
    const r = await update(ownerTok, priceId, { title: "Price list", body: "Here po 👇", images: [{ url: P1 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(
      r.json.data.replies.find((x: Json) => x.id === priceId).images.map((i: Json) => i.url),
      [P1],
    );
  });

  console.log("\ndeleting");
  await test("an unknown id is a 404", async () => {
    assert.equal((await update(ownerTok, "missing", { title: "x", body: "y" })).status, 404);
    assert.equal((await remove(ownerTok, "missing")).status, 404);
  });
  await test("any admin can delete; it's gone for everyone", async () => {
    const r = await remove(modTok, paymentId);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const titles = (await list(ownerTok)).json.data.replies.map((x: Json) => x.title);
    assert.deepEqual(titles, ["Hours", "Menu", "Price list", "Shipping"]);
  });

  await flushAfter();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pg.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
