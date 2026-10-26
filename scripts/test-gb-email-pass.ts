/**
 * Gate for joining a paid group buy WITH JUST AN EMAIL — no sign-in, no
 * account. Runs the REAL website server actions (src/modules/paid-access/actions.ts),
 * the storefront viewer, the checkout gate and the sign-up actions against
 * in-process PGlite with Paid Access's DB rules applied. A cookie jar Map stands in
 * for one browser (scripts/mobile-test/stubs/next-headers.mjs).
 *
 *   npm run test:gb-email-pass
 *
 * Covers: the pass codec (tamper, scope, expiry); a visitor sees the round's
 * first step without saying who they are; email + proof in one go creates a
 * password-less guest and lands in review; the pass unlocks the catalog and
 * checkout only once approved; "Already approved?" from another device; an
 * unknown email gets nothing; an email pass can't cancel or open the proof;
 * the pass is per store; a guest can't sign in; sign-up claims the guest row.
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
import { encodeCustomerToken } from "../src/lib/auth/customer-token";
import { encodeGroupBuyPass, verifyGroupBuyPass, GB_PASS_COOKIE_NAME } from "../src/lib/auth/gb-pass-token";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 8).join("\n    ")}`);
  }
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const g = globalThis as { __testCookieJar?: Map<string, string>; __testHeaders?: Record<string, string>; __testClientIp?: string };
let device = 0;
/** A fresh browser on a store (its own cookies and IP). */
const browser = (host = "mnm.pepweb.store", ip = `198.51.100.${++device}`) => {
  g.__testCookieJar = new Map();
  g.__testHeaders = { "x-tenant-host": host };
  g.__testClientIp = ip;
  return g.__testCookieJar;
};

async function main() {
  console.log("\nThe email pass codec");
  const now = Math.floor(Date.now() / 1000);
  await test("round-trips, and refuses a tampered, expired or wrong-scope token", async () => {
    const t = encodeGroupBuyPass({ tenantId: "t1", customerId: "c1", iat: now, exp: now + 60 });
    assert.strictEqual(verifyGroupBuyPass(t)?.customerId, "c1");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ scope: "gbpass.v1", tenantId: "t1", customerId: "c2", iat: now, exp: now + 60 })).toString("base64url");
    assert.strictEqual(verifyGroupBuyPass(`${forged}.${sig}`), null, "swapped body");
    assert.strictEqual(verifyGroupBuyPass(`${body}.x`), null, "bad signature");
    assert.strictEqual(verifyGroupBuyPass(encodeGroupBuyPass({ tenantId: "t1", customerId: "c1", iat: now - 120, exp: now - 60 })), null, "expired");
    const account = encodeCustomerToken({ tenantId: "t1", customerId: "c1", sessionVersion: 1, iat: now, exp: now + 60 });
    assert.strictEqual(verifyGroupBuyPass(account), null, "an account cookie is not a pass");
  });

  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "src", "modules", "paid-access", "sql", "paid-access.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const features = await Promise.all(
    ["groupbuy.module", "groupbuy.paid_access", "storefront.customer_accounts"].map((key) => db.feature.create({ data: { key } })),
  );
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const grants = () => ({ create: features.map((f) => ({ featureId: f.id, enabled: true })) });
  const A = await db.tenant.create({ data: { slug: "mnm", name: "MNM", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@mnm.test" } });
  const O = await db.tenant.create({ data: { slug: "other", name: "Other", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@other.test" } });
  for (const t of [A, O]) {
    await db.branding.create({
      data: { tenantId: t.id, config: { name: t.name, currency: "₱", paymentMethods: [{ id: "gcash", name: "GCash", account: "MNM", number: "09170000000", active: true }] } },
    });
  }
  const gb = await db.groupBuy.create({ data: { tenantId: A.id, name: "Batch 10", status: "active", endsAt: new Date(Date.now() + 3 * 86_400_000) } });

  const B = await import("../src/modules/paid-access");
  const { presetSettings } = await import("../src/modules/paid-access/client");
  const act = await import("../src/modules/paid-access/actions");
  const { storefrontGroupBuyViewer, paidRoundCheckoutError } = await import("../src/lib/storefront/gb-access.server");
  const OWNER = { kind: "admin" as const, id: "owner", email: "owner@mnm.test" };
  const s = presetSettings("pay_then_approve");
  assert.ok((await B.updateSettings({ tenantId: A.id, groupBuyId: gb.id, admin: OWNER, input: { ...s, payment: { ...s.payment, amountCents: 25000 } } })).ok);

  const proofForm = (reference = "GC-1234-5678") => {
    const f = new FormData();
    f.set("groupBuyId", gb.id);
    f.set("file", new File([PNG], "receipt.png", { type: "image/png" }));
    f.set("reference", reference);
    f.set("method", "GCash");
    return f;
  };

  console.log("\nJoining with just an email");

  await test("a visitor with no account sees the first step (where to pay) — not a sign-in wall", async () => {
    browser();
    const page = await act.getPaidAccessJoinPageAction(gb.id);
    assert.strictEqual(page.viewer.kind, "guest");
    assert.ok(page.result.ok, JSON.stringify(page.result));
    assert.strictEqual(page.result.state.canJoin, true);
    assert.strictEqual(page.result.state.status, null);
    assert.strictEqual(page.result.state.stepper.steps[0]?.key, "payment");
    assert.ok(page.result.state.amountLabel.includes("250"), page.result.state.amountLabel);
    assert.strictEqual(page.result.state.paymentAccounts[0]?.name, "GCash");
    assert.strictEqual(await db.storefrontCustomer.count(), 0, "looking creates nothing");
  });

  await test("a bad email is refused before anything is created", async () => {
    browser();
    const page = await act.continuePaidAccessWithEmailAction(gb.id, "not-an-email");
    assert.strictEqual(page.result.ok, false);
    assert.strictEqual(await db.storefrontCustomer.count(), 0);
  });

  const jar = browser();
  await test("email + proof in one go: a password-less guest, the pass cookie, and the proof in review", async () => {
    const page = await act.continuePaidAccessWithEmailAction(gb.id, "Juan.Dela@Gmail.com");
    assert.ok(page.result.ok, JSON.stringify(page.result));
    assert.strictEqual(page.result.state.status, "payment_pending");
    const res = await act.submitPaidAccessProofAction(proofForm());
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(res.state.status, "payment_review");
    const row = await db.storefrontCustomer.findFirst({ where: { tenantId: A.id, email: "juan.dela@gmail.com" } });
    assert.ok(row, "guest row");
    assert.strictEqual(row!.passwordHash, "guest");
    assert.strictEqual(row!.name, "juan.dela");
    assert.ok(jar.get(GB_PASS_COOKIE_NAME), "pass cookie set");
    assert.strictEqual(jar.has("sf.customer"), false, "never an account session");
  });

  await test("the admin queue shows the request under the typed email", async () => {
    const q = await B.listQueue({ tenantId: A.id, groupBuyId: gb.id, tab: "payments" });
    assert.ok(q.ok);
    assert.ok(q.rows.some((r) => r.customerEmail === "juan.dela@gmail.com"));
  });

  await test("under review, the pass is a known viewer but checkout still refuses the round", async () => {
    const page = await act.getPaidAccessJoinPageAction(gb.id);
    assert.deepStrictEqual(page.viewer, { kind: "email", email: "juan.dela@gmail.com" });
    assert.strictEqual((await storefrontGroupBuyViewer(A.id)).kind, "customer");
    assert.match((await paidRoundCheckoutError(A.id, gb)) ?? "", /for members/);
  });

  await test("an email pass can't open the proof screenshot or leave the round", async () => {
    assert.strictEqual((await act.getPaidAccessReceiptUrlAction(gb.id)).ok, false);
    assert.strictEqual((await act.cancelPaidAccessJoinAction(gb.id)).ok, false);
  });

  await test("once the admin approves, the same browser checks out — no sign-in, no re-verify", async () => {
    const q = await B.listQueue({ tenantId: A.id, groupBuyId: gb.id, tab: "payments" });
    assert.ok(q.ok);
    const row = q.rows.find((r) => r.customerEmail === "juan.dela@gmail.com")!;
    assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: OWNER, alsoApprove: true })).ok);
    const page = await act.getPaidAccessJoinPageAction(gb.id);
    assert.ok(page.result.ok && page.result.state.canAccess, JSON.stringify(page.result));
    assert.strictEqual(await paidRoundCheckoutError(A.id, gb), null);
  });

  await test("\"Already approved?\" on another device picks the access back up by email", async () => {
    const other = browser();
    assert.match((await paidRoundCheckoutError(A.id, gb)) ?? "", /for members/, "a fresh browser is locked");
    const page = await act.verifyPaidAccessEmailAction(gb.id, "  JUAN.DELA@gmail.com ");
    assert.ok(page.result.ok && page.result.state.canAccess, JSON.stringify(page.result));
    assert.strictEqual(page.viewer.kind, "email");
    assert.ok(other.get(GB_PASS_COOKIE_NAME));
    assert.strictEqual(await paidRoundCheckoutError(A.id, gb), null);
  });

  await test("verifying an email with no request gives nothing away and creates nothing", async () => {
    const other = browser();
    const before = await db.storefrontCustomer.count();
    const page = await act.verifyPaidAccessEmailAction(gb.id, "nobody@gmail.com");
    assert.strictEqual(page.result.ok, false);
    assert.strictEqual(page.viewer.kind, "guest");
    assert.strictEqual(other.has(GB_PASS_COOKIE_NAME), false);
    assert.strictEqual(await db.storefrontCustomer.count(), before);
  });

  await test("\"Not you?\" drops the pass and the page is a visitor's again", async () => {
    browser();
    await act.verifyPaidAccessEmailAction(gb.id, "juan.dela@gmail.com");
    await act.forgetPaidAccessEmailAction();
    assert.strictEqual((await act.getPaidAccessJoinPageAction(gb.id)).viewer.kind, "guest");
  });

  await test("a pass is for its own store only", async () => {
    browser();
    await act.verifyPaidAccessEmailAction(gb.id, "juan.dela@gmail.com");
    g.__testHeaders = { "x-tenant-host": "other.pepweb.store" };
    assert.strictEqual((await storefrontGroupBuyViewer(O.id)).kind, "anonymous");
  });

  await test("a forged pass cookie is ignored", async () => {
    const forgedJar = browser();
    const row = await db.storefrontCustomer.findFirst({ where: { email: "juan.dela@gmail.com" } });
    forgedJar.set(GB_PASS_COOKIE_NAME, encodeGroupBuyPass({ tenantId: A.id, customerId: row!.id, iat: now, exp: now + 60 }, "attacker-secret"));
    assert.strictEqual((await storefrontGroupBuyViewer(A.id)).kind, "anonymous");
  });

  await test("too many email tries from one device are slowed down", async () => {
    browser();
    let last: Awaited<ReturnType<typeof act.verifyPaidAccessEmailAction>> | null = null;
    for (let i = 0; i < 11; i++) last = await act.verifyPaidAccessEmailAction(gb.id, `probe${i}@gmail.com`);
    assert.ok(last && !last.result.ok && last.result.code === "rate_limited", JSON.stringify(last?.result));
  });

  console.log("\nGuests and accounts");

  await test("nobody can sign in to a guest row", async () => {
    browser();
    const { signInCustomerAction } = await import("../src/actions/customer-accounts");
    const res = await signInCustomerAction({ email: "juan.dela@gmail.com", password: "guest" });
    assert.ok("error" in res, JSON.stringify(res));
  });

  await test("signing up with that email claims the guest row — the access comes along", async () => {
    const signUpJar = browser();
    const { signUpCustomerAction } = await import("../src/actions/customer-accounts");
    const before = await db.storefrontCustomer.findFirst({ where: { email: "juan.dela@gmail.com" } });
    const res = await signUpCustomerAction({ name: "Juan Dela Cruz", email: "juan.dela@gmail.com", phone: "9171234567", password: "correct horse battery" });
    assert.ok("ok" in res, JSON.stringify(res));
    const after = await db.storefrontCustomer.findFirst({ where: { email: "juan.dela@gmail.com" } });
    assert.strictEqual(after!.id, before!.id, "same row");
    assert.notStrictEqual(after!.passwordHash, "guest");
    assert.strictEqual(after!.name, "Juan Dela Cruz");
    assert.ok(signUpJar.get("sf.customer"), "signed in");
    const page = await act.getPaidAccessJoinPageAction(gb.id);
    assert.strictEqual(page.viewer.kind, "account");
    assert.ok(page.result.ok && page.result.state.canAccess);
  });

  await test("a real account's email can't be claimed by a second sign-up", async () => {
    browser();
    const { signUpCustomerAction } = await import("../src/actions/customer-accounts");
    const res = await signUpCustomerAction({ name: "Impostor", email: "juan.dela@gmail.com", phone: "9171234567", password: "another long password" });
    assert.ok("error" in res, JSON.stringify(res));
  });

  delete g.__testCookieJar;
  delete g.__testHeaders;
  delete g.__testClientIp;
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
