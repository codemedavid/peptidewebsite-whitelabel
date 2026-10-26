/**
 * Paid Access end to end — the module's PUBLIC interface (src/modules/paid-access/index.ts)
 * against in-process PGlite with the real schema and the DB rules applied.
 * Nothing here touches a paid_access_* table except to assert on it.
 *
 *   npm run test:paid-access-flow
 *
 * Covers: each of the five presets on its own GB, side by side; settings
 * snapshots (an edit never moves an in-flight member) and the audit trail of
 * the edit; access denied server-side for every not-yet-active status;
 * double-click join / pay; paying after the GB closes; online payments only
 * via a SIGNED webhook, duplicates ignored; the payment window releasing a
 * slot; the slot limit under concurrent joins; waitlist on/off; each refund
 * policy; what pending members may see; and who may approve whom.
 */
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/pglite-only";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "pepweb.store";
process.env.PAID_ACCESS_FAKE_PROVIDER_SECRET = "whsec_test_fake";
delete process.env.EXPO_ACCESS_TOKEN;
delete process.env.IMAGEKIT_PRIVATE_KEY;
delete process.env.POSTHOG_API_KEY;

import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split("\n").slice(0, 3).join("\n    ")}`);
  }
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const receipt = () => new File([PNG], "receipt.png", { type: "image/png" });
const MIN = 60_000;
const DAY = 86_400_000;

async function main() {
  const schema = path.join(process.cwd(), "prisma", "schema.prisma");
  const ddl = execSync(`npx prisma migrate diff --from-empty --to-schema-datamodel "${schema}" --script`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(readFileSync(path.join(process.cwd(), "src", "modules", "paid-access", "sql", "paid-access.sql"), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  (globalThis as { prisma?: PrismaClient }).prisma = db;

  const B = await import("../src/modules/paid-access");
  const { presetSettings } = await import("../src/modules/paid-access/client");

  // ── seed ────────────────────────────────────────────────────────────────
  const features = await Promise.all(["groupbuy.module", "groupbuy.paid_access", "groupbuy.scheduled"].map((key) => db.feature.create({ data: { key } })));
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const grants = () => ({ create: features.map((f) => ({ featureId: f.id, enabled: true })) });
  const A = await db.tenant.create({ data: { slug: "mnm", name: "MNM", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@mnm.test" } });
  const Other = await db.tenant.create({ data: { slug: "other", name: "Other", status: "active", planId: plan.id, featureOverrides: grants(), storeAdminEmail: "owner@other.test" } });
  const Off = await db.tenant.create({ data: { slug: "off", name: "Off", status: "active", planId: plan.id, storeAdminEmail: "owner@off.test" } });
  for (const t of [A, Other, Off]) await db.branding.create({ data: { tenantId: t.id, config: { name: t.name, currency: "₱" } } });

  let cust = 0;
  const customer = async (tenantId = A.id) => {
    const n = ++cust;
    const c = await db.storefrontCustomer.create({
      data: { tenantId, email: `buyer${n}@buyer.test`, name: `Buyer ${n}`, phone: "9171234567", passwordHash: "x" },
    });
    return { id: c.id, name: c.name, email: c.email };
  };
  const round = (name: string, tenantId = A.id, endsAt = new Date(Date.now() + 3 * DAY)) =>
    db.groupBuy.create({ data: { tenantId, name, status: "active", endsAt } });

  const OWNER = { kind: "admin" as const, id: "owner", email: "owner@mnm.test" };
  const STAFF = { kind: "admin" as const, id: "staff:s1", email: "gbteam@mnm.test" };
  const priced = (id: Parameters<typeof presetSettings>[0], extra: Json = {}) => {
    const s = presetSettings(id);
    return { ...s, payment: { ...s.payment, amountCents: 50000 }, ...extra };
  };
  async function configure(gbId: string, settings: Json, tenantId = A.id, admin = OWNER) {
    const r = await B.updateSettings({ tenantId, groupBuyId: gbId, admin, input: settings });
    assert.ok(r.ok, `updateSettings: ${JSON.stringify(r)}`);
    return r;
  }
  const join = (gb: string, c: { id: string; name: string; email: string }, now?: Date) => B.startJoin({ tenantId: A.id, groupBuyId: gb, customer: c, now });
  const access = (gb: string, customerId: string | null, now?: Date) => B.getAccess({ tenantId: A.id, groupBuyId: gb, customerId, now });
  const proof = (gb: string, c: { id: string; name: string; email: string }, reference = `GC-${Math.random().toString(36).slice(2, 10)}`, now?: Date) =>
    B.submitStep({ tenantId: A.id, groupBuyId: gb, customer: c, step: "payment", data: { kind: "proof", file: receipt(), reference, method: "GCash" }, now });
  async function queue(gb: string, tab: "payments" | "approvals" | "refunds" | "all") {
    const r = await B.listQueue({ tenantId: A.id, groupBuyId: gb, tab });
    assert.ok(r.ok, JSON.stringify(r));
    return r.rows;
  }
  const rowFor = async (gb: string, c: { email: string }, tab: "payments" | "approvals" | "refunds" | "all" = "all") => {
    const row = (await queue(gb, tab)).find((r) => r.customerEmail === c.email);
    assert.ok(row, `no ${tab} row for ${c.email}`);
    return row!;
  };
  const sign = (body: string) => createHmac("sha256", process.env.PAID_ACCESS_FAKE_PROVIDER_SECRET!).update(body).digest("hex");
  const webhook = (event: Json, signature?: string) => {
    const body = JSON.stringify(event);
    return B.handleWebhook({ provider: "fake", rawBody: body, headers: new Headers({ "x-paid-access-signature": signature ?? sign(body) }) });
  };
  const paymentsOf = async (membershipId: string) => db.paidAccessPayment.findMany({ where: { membershipId } });

  const gbOpen = await round("Open round");
  const gbPay = await round("Pay to join round");
  const gbPta = await round("Pay then approve round");
  const gbAtp = await round("Approve then pay round");
  const gbApply = await round("Apply round");
  await configure(gbOpen.id, presetSettings("open"));
  await configure(gbPay.id, priced("pay_to_join"));
  await configure(gbPta.id, priced("pay_then_approve"));
  await configure(gbAtp.id, priced("approve_then_pay"));
  await configure(gbApply.id, presetSettings("apply_then_approve"));

  console.log("\nPresets, each on its own GB, side by side");

  await test("Open: everyone has access at once — no join, no payment, no approval screens", async () => {
    const c = await customer();
    assert.strictEqual((await access(gbOpen.id, null)).canAccess, true, "anonymous");
    const a = await access(gbOpen.id, c.id);
    assert.strictEqual(a.canAccess, true);
    assert.strictEqual(a.nextStep, null);
    const j = await join(gbOpen.id, c);
    assert.ok(j.ok && j.state.canAccess && j.state.stepper.steps.length === 0);
    assert.strictEqual((await queue(gbOpen.id, "all")).length, 0, "nothing to review");
  });

  await test("a GB nobody has set up is members-only (Pay then approve) — not Open", async () => {
    const bare = await round("Never configured");
    const c = await customer();
    const anon = await access(bare.id, null);
    const signedIn = await access(bare.id, c.id);
    assert.strictEqual(anon.gated, true);
    assert.strictEqual(anon.canAccess, false, "anonymous");
    assert.strictEqual(signedIn.canAccess, false, "signed in, not a member");
    const s = await B.getSettings({ tenantId: A.id, groupBuyId: bare.id });
    assert.ok(s.ok && !s.exists);
    assert.deepStrictEqual(s.settings.steps, ["payment", "approval"], "the panel opens on Pay then approve");
  });

  await test("…and joining it stays paused until the store saves its settings", async () => {
    const bare = await round("Not set up yet");
    const c = await customer();
    const j = await join(bare.id, c);
    assert.ok(!j.ok && j.code === "closed", JSON.stringify(j));
    assert.match(j.message, /setting up/i);
    const st = await B.getJoinState({ tenantId: A.id, groupBuyId: bare.id, customer: c });
    assert.ok(st.ok && st.state.gated && !st.state.canJoin && !st.state.canAccess);
    assert.match(st.state.window.message, /setting up/i);
    assert.strictEqual(await db.paidAccessMembership.count({ where: { groupBuyId: bare.id } }), 0);
    await configure(bare.id, priced("pay_then_approve"));
    assert.ok((await join(bare.id, c)).ok, "open for joining once saved");
  });

  await test("Open is an explicit choice: saving the Open preset lets everyone in", async () => {
    const gb = await round("Chosen open");
    assert.strictEqual((await access(gb.id, null)).canAccess, false);
    await configure(gb.id, presetSettings("open"));
    assert.strictEqual((await access(gb.id, null)).canAccess, true);
  });

  await test("Pay to join: pay → (store checks proof) → in; never in the approval queue", async () => {
    const c = await customer();
    const j = await join(gbPay.id, c);
    assert.ok(j.ok);
    assert.strictEqual(j.state.status, "payment_pending");
    assert.strictEqual(j.state.stepper.action?.kind, "pay");
    assert.strictEqual((await access(gbPay.id, c.id)).canAccess, false);
    const p = await proof(gbPay.id, c);
    assert.ok(p.ok && p.state.status === "payment_review", JSON.stringify(p));
    assert.strictEqual((await queue(gbPay.id, "approvals")).length, 0);
    const row = await rowFor(gbPay.id, c, "payments");
    const r = await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: OWNER });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual((await access(gbPay.id, c.id)).canAccess, true);
    assert.strictEqual((await queue(gbPay.id, "approvals")).length, 0, "still never pending approval");
  });

  await test("Pay then approve (default): pay → payment checked → waiting for approval → approved → in", async () => {
    const c = await customer();
    assert.ok((await join(gbPta.id, c)).ok);
    assert.ok((await proof(gbPta.id, c)).ok);
    const row = await rowFor(gbPta.id, c, "payments");
    assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: OWNER })).ok);
    const pending = await access(gbPta.id, c.id);
    assert.strictEqual(pending.status, "approval_pending");
    assert.strictEqual(pending.canAccess, false);
    const j = await B.getJoinState({ tenantId: A.id, groupBuyId: gbPta.id, customer: c });
    assert.ok(j.ok);
    assert.strictEqual(j.state.stepper.headline, "Step 2 of 2: Waiting for admin approval");
    const appr = await rowFor(gbPta.id, c, "approvals");
    assert.ok((await B.approve({ tenantId: A.id, membershipId: appr.id, admin: STAFF })).ok);
    assert.strictEqual((await access(gbPta.id, c.id)).canAccess, true);
  });

  await test("Pay then approve: the admin can confirm the payment and approve in one go", async () => {
    const c = await customer();
    await join(gbPta.id, c);
    await proof(gbPta.id, c);
    const row = await rowFor(gbPta.id, c, "payments");
    assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: OWNER, alsoApprove: true })).ok);
    assert.strictEqual((await access(gbPta.id, c.id)).canAccess, true);
  });

  await test("Approve then pay: can't pay before approval; approval opens payment; access only after paying", async () => {
    const c = await customer();
    const j = await join(gbAtp.id, c);
    assert.ok(j.ok && j.state.status === "approval_pending");
    const early = await proof(gbAtp.id, c);
    assert.ok(!early.ok);
    assert.match(early.message, /approved/i);
    const row = await rowFor(gbAtp.id, c, "approvals");
    assert.ok((await B.approve({ tenantId: A.id, membershipId: row.id, admin: OWNER })).ok);
    const afterApproval = await access(gbAtp.id, c.id);
    assert.strictEqual(afterApproval.status, "payment_pending");
    assert.strictEqual(afterApproval.canAccess, false, "approved is not access yet");
    assert.ok((await proof(gbAtp.id, c)).ok);
    const pay = await rowFor(gbAtp.id, c, "payments");
    assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: pay.payment!.id, admin: OWNER })).ok);
    assert.strictEqual((await access(gbAtp.id, c.id)).canAccess, true);
  });

  await test("Apply then approve: form (validated) → approval → in, free; answers reach the admin", async () => {
    const c = await customer();
    const j = await join(gbApply.id, c);
    assert.ok(j.ok && j.state.status === "form_pending");
    assert.strictEqual(j.state.stepper.action?.kind, "fill_form");
    assert.ok(j.state.formQuestions.length >= 1);
    const qid = j.state.formQuestions[0].id;
    const blank = await B.submitStep({ tenantId: A.id, groupBuyId: gbApply.id, customer: c, step: "form", data: {} });
    assert.ok(!blank.ok && blank.code === "invalid_input");
    const noPay = await proof(gbApply.id, c);
    assert.ok(!noPay.ok, "there is no payment step to submit");
    const ok = await B.submitStep({ tenantId: A.id, groupBuyId: gbApply.id, customer: c, step: "form", data: { [qid]: "I run a wellness clinic" } });
    assert.ok(ok.ok && ok.state.status === "approval_pending");
    const row = await rowFor(gbApply.id, c, "approvals");
    assert.strictEqual(row.formAnswers[0]?.answer, "I run a wellness clinic");
    assert.ok((await B.approve({ tenantId: A.id, membershipId: row.id, admin: OWNER })).ok);
    assert.strictEqual((await access(gbApply.id, c.id)).canAccess, true);
  });

  await test("one customer in two GBs with different presets: access is per GB", async () => {
    const c = await customer();
    await join(gbPay.id, c);
    await join(gbApply.id, c);
    assert.strictEqual((await access(gbOpen.id, c.id)).canAccess, true);
    assert.strictEqual((await access(gbPay.id, c.id)).status, "payment_pending");
    assert.strictEqual((await access(gbApply.id, c.id)).status, "form_pending");
  });

  console.log("\nSettings: validation, snapshots, audit");

  await test("an invalid step order is refused with a clear message (nothing saved)", async () => {
    const r = await B.updateSettings({ tenantId: A.id, groupBuyId: gbPta.id, admin: OWNER, input: { ...priced("pay_then_approve"), steps: ["payment", "form"] } });
    assert.ok(!r.ok);
    assert.ok(r.errors?.some((e) => e.path === "steps" && /first step/.test(e.message)));
    const s = await B.getSettings({ tenantId: A.id, groupBuyId: gbPta.id });
    assert.ok(s.ok);
    assert.deepStrictEqual(s.settings.steps, ["payment", "approval"]);
  });

  await test("changing a GB's flow and price never moves members already in it", async () => {
    const gb = await round("Snapshot round");
    await configure(gb.id, priced("pay_then_approve"));
    const early = await customer();
    await join(gb.id, early);
    await configure(gb.id, { ...priced("approve_then_pay"), payment: { ...priced("approve_then_pay").payment, amountCents: 99900 } });
    const late = await customer();
    const lj = await join(gb.id, late);
    assert.ok(lj.ok && lj.state.status === "approval_pending", "a new joiner gets the new flow");
    assert.strictEqual(lj.state.amountCents, 99900);
    const ej = await B.getJoinState({ tenantId: A.id, groupBuyId: gb.id, customer: early });
    assert.ok(ej.ok && ej.state.status === "payment_pending", "the early member keeps the old flow");
    assert.strictEqual(ej.state.amountCents, 50000, "…and the old price");
    assert.ok((await proof(gb.id, early)).ok);
    const pay = await rowFor(gb.id, early, "payments");
    assert.strictEqual(pay.payment!.amountCents, 50000);
    assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: pay.payment!.id, admin: OWNER })).ok);
    assert.strictEqual((await access(gb.id, early.id)).status, "approval_pending", "old flow: approval comes after payment");
  });

  await test("switching a GB to Open is only a settings change — pending members get in", async () => {
    const gb = await round("Opened later");
    await configure(gb.id, priced("pay_then_approve"));
    const c = await customer();
    await join(gb.id, c);
    assert.strictEqual((await access(gb.id, c.id)).canAccess, false);
    await configure(gb.id, presetSettings("open"));
    assert.strictEqual((await access(gb.id, c.id)).canAccess, true);
    assert.strictEqual((await access(gb.id, null)).canAccess, true);
  });

  await test("settings changes are in the audit log with who made them", async () => {
    const gb = await round("Audited");
    await configure(gb.id, priced("pay_then_approve"), A.id, STAFF);
    await configure(gb.id, priced("pay_to_join"), A.id, OWNER);
    const h = await B.history({ tenantId: A.id, groupBuyId: gb.id });
    assert.ok(h.ok);
    const settingsEvents = h.events.filter((e) => e.kind === "settings");
    assert.strictEqual(settingsEvents.length, 2);
    assert.strictEqual(settingsEvents[0].actorId, "staff:s1");
    assert.strictEqual(settingsEvents[1].actorId, "owner");
    assert.deepStrictEqual((settingsEvents[1].data as Json).after.steps, ["payment"]);
  });

  console.log("\nServer-side access");

  await test("access is denied for every not-yet-active status, and to anonymous visitors", async () => {
    const gb = await round("Denials");
    await configure(gb.id, priced("pay_then_approve", { capacity: { maxSlots: 1, waitlist: true } }));
    assert.strictEqual((await access(gb.id, null)).canAccess, false, "anonymous");
    const a = await customer();
    const w = await customer();
    await join(gb.id, a);
    await join(gb.id, w);
    assert.strictEqual((await access(gb.id, a.id)).status, "payment_pending");
    assert.strictEqual((await access(gb.id, w.id)).status, "waitlisted");
    for (const id of [a.id, w.id]) assert.strictEqual((await access(gb.id, id)).canAccess, false);
    await proof(gb.id, a);
    assert.strictEqual((await access(gb.id, a.id)).canAccess, false, "payment_review");
    const row = await rowFor(gb.id, a);
    assert.ok((await B.reject({ tenantId: A.id, membershipId: row.id, admin: OWNER, reason: "Wrong amount" })).ok);
    assert.strictEqual((await access(gb.id, a.id)).canAccess, false, "rejected");
  });

  await test("a store without the Paid Access feature is Open everywhere and refuses joins", async () => {
    const gb = await round("Off round", Off.id);
    const r = await B.updateSettings({ tenantId: Off.id, groupBuyId: gb.id, admin: { ...OWNER, email: "owner@off.test" }, input: priced("pay_then_approve") });
    assert.ok(!r.ok && r.code === "unavailable");
    const a = await B.getAccess({ tenantId: Off.id, groupBuyId: gb.id, customerId: null });
    assert.strictEqual(a.canAccess, true);
  });

  console.log("\nPayment safety");

  await test("double-clicking Join opens exactly one membership", async () => {
    const c = await customer();
    const results = await Promise.all(Array.from({ length: 5 }, () => join(gbPta.id, c)));
    assert.ok(results.every((r) => r.ok));
    assert.strictEqual(await db.paidAccessMembership.count({ where: { groupBuyId: gbPta.id, customerId: c.id } }), 1);
  });

  await test("double-clicking Pay records exactly one payment", async () => {
    const c = await customer();
    await join(gbPta.id, c);
    const [p1, p2] = await Promise.all([proof(gbPta.id, c, "GC-DOUBLE-1"), proof(gbPta.id, c, "GC-DOUBLE-1")]);
    assert.strictEqual([p1, p2].filter((r) => r.ok).length >= 1, true);
    const m = await db.paidAccessMembership.findFirst({ where: { groupBuyId: gbPta.id, customerId: c.id } });
    assert.strictEqual((await paymentsOf(m!.id)).length, 1);
    const again = await proof(gbPta.id, c, "GC-DOUBLE-2");
    assert.ok(!again.ok, "a second proof while one is being checked is refused");
  });

  await test("paying after the GB closes is refused (proof and online)", async () => {
    const gb = await round("Closes soon", A.id, new Date(Date.now() + 10 * MIN));
    await configure(gb.id, priced("pay_to_join"));
    const c = await customer();
    assert.ok((await join(gb.id, c)).ok);
    const later = new Date(Date.now() + 60 * MIN);
    const p = await proof(gb.id, c, "GC-LATE-1", later);
    assert.ok(!p.ok && p.code === "closed", JSON.stringify(p));
    const o = await B.submitStep({ tenantId: A.id, groupBuyId: gb.id, customer: c, step: "payment", data: { kind: "online" }, now: later });
    assert.ok(!o.ok && o.code === "closed");
    const j = await join(gb.id, await customer(), later);
    assert.ok(!j.ok && j.code === "closed");
  });

  await test("the client can't confirm its own payment: there is no such door, only the admin or a signed webhook", async () => {
    assert.ok(!("markPaid" in B));
    const c = await customer();
    await join(gbPay.id, c);
    const row = await rowFor(gbPay.id, c);
    const r = await B.approve({ tenantId: A.id, membershipId: row.id, admin: { kind: "customer", id: c.id, email: c.email } as never });
    assert.ok(!r.ok);
  });

  console.log("\nOnline payments (fake provider) and webhooks");

  const gbOnline = await round("Online round");
  await configure(gbOnline.id, priced("pay_then_approve", { payment: { amountMode: "full", amountCents: 50000, method: "either", windowMinutes: null }, refundOnReject: "auto" }));

  async function checkout(c: { id: string; name: string; email: string }, gb = gbOnline.id) {
    const r = await B.submitStep({ tenantId: A.id, groupBuyId: gb, customer: c, step: "payment", data: { kind: "online" } });
    assert.ok(r.ok && r.checkout, JSON.stringify(r));
    return r.checkout!.ref;
  }

  await test("online is accepted only once a provider is connected (the fake one, in tests)", async () => {
    const s = await B.getSettings({ tenantId: A.id, groupBuyId: gbOnline.id });
    assert.ok(s.ok && s.onlinePaymentsAvailable);
  });

  await test("an unsigned or tampered webhook is refused and changes nothing", async () => {
    const c = await customer();
    await join(gbOnline.id, c);
    const ref = await checkout(c);
    const bad = await webhook({ id: "evt_bad", type: "payment.paid", data: { checkoutId: ref, amountCents: 50000 } }, "deadbeef");
    assert.ok(!bad.ok && bad.status === 401);
    assert.strictEqual((await access(gbOnline.id, c.id)).status, "payment_pending");
  });

  await test("a signed webhook confirms the payment; a duplicate delivery does nothing", async () => {
    const c = await customer();
    await join(gbOnline.id, c);
    const ref = await checkout(c);
    const evt = { id: `evt_${ref}`, type: "payment.paid", data: { checkoutId: ref, amountCents: 50000 } };
    const first = await webhook(evt);
    assert.ok(first.ok && !first.duplicate, JSON.stringify(first));
    assert.strictEqual((await access(gbOnline.id, c.id)).status, "approval_pending");
    const m = await db.paidAccessMembership.findFirst({ where: { groupBuyId: gbOnline.id, customerId: c.id } });
    const eventsBefore = await db.paidAccessEvent.count({ where: { membershipId: m!.id } });
    const dup = await webhook(evt);
    assert.ok(dup.ok && dup.duplicate);
    const replay = await webhook({ ...evt, id: `${evt.id}_retry` });
    assert.ok(replay.ok);
    const payments = await paymentsOf(m!.id);
    assert.strictEqual(payments.filter((p) => p.status === "confirmed").length, 1);
    assert.strictEqual(await db.paidAccessEvent.count({ where: { membershipId: m!.id } }), eventsBefore, "no second count");
  });

  await test("a webhook for the wrong amount does not confirm anything", async () => {
    const c = await customer();
    await join(gbOnline.id, c);
    const ref = await checkout(c);
    const r = await webhook({ id: `evt_amt_${ref}`, type: "payment.paid", data: { checkoutId: ref, amountCents: 100 } });
    assert.ok(r.ok);
    assert.strictEqual((await access(gbOnline.id, c.id)).status, "payment_pending");
  });

  await test("auto refund: rejecting an online payer refunds through the provider, then the webhook settles it", async () => {
    const c = await customer();
    await join(gbOnline.id, c);
    const ref = await checkout(c);
    await webhook({ id: `evt_pay_${ref}`, type: "payment.paid", data: { checkoutId: ref, amountCents: 50000 } });
    const row = await rowFor(gbOnline.id, c, "approvals");
    assert.ok((await B.reject({ tenantId: A.id, membershipId: row.id, admin: OWNER, reason: "Not eligible" })).ok);
    assert.strictEqual((await rowFor(gbOnline.id, c)).refundStatus, "processing");
    await webhook({ id: `evt_ref_${ref}`, type: "refund.succeeded", data: { checkoutId: ref, refundId: `re_${ref}` } });
    const after = await rowFor(gbOnline.id, c);
    assert.strictEqual(after.refundStatus, "refunded");
    assert.strictEqual(after.refundReference, `re_${ref}`);
  });

  console.log("\nPayment window, capacity, waitlist");

  await test("an unpaid slot is released after the payment window", async () => {
    const gb = await round("Window round");
    await configure(gb.id, priced("pay_to_join", { payment: { amountMode: "full", amountCents: 50000, method: "manual", windowMinutes: 30 }, capacity: { maxSlots: 1, waitlist: false } }));
    const t0 = new Date();
    const a = await customer();
    assert.ok((await join(gb.id, a, t0)).ok);
    const full = await join(gb.id, await customer(), new Date(t0.getTime() + 10 * MIN));
    assert.ok(!full.ok && full.code === "full", "the slot is held");
    const t1 = new Date(t0.getTime() + 31 * MIN);
    assert.strictEqual((await access(gb.id, a.id, t1)).status, "expired", "the member sees it expired");
    const swept = await B.expireStale({ tenantId: A.id, groupBuyId: gb.id, now: t1 });
    assert.strictEqual(swept.expired, 1);
    const b = await customer();
    const jb = await join(gb.id, b, t1);
    assert.ok(jb.ok && jb.state.status === "payment_pending", "the slot is free again");
    const late = await proof(gb.id, a, "GC-AFTER-WINDOW", t1);
    assert.ok(!late.ok, "the expired member can't pay into a released slot");
  });

  await test("the slot limit holds under 12 concurrent joins (3 slots, waitlist off)", async () => {
    const gb = await round("Rush round");
    await configure(gb.id, priced("pay_then_approve", { capacity: { maxSlots: 3, waitlist: false } }));
    const people = await Promise.all(Array.from({ length: 12 }, () => customer()));
    const results = await Promise.all(people.map((c) => join(gb.id, c)));
    assert.strictEqual(results.filter((r) => r.ok).length, 3);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "full"));
    const flow = await db.paidAccessFlow.findFirst({ where: { groupBuyId: gb.id } });
    assert.strictEqual(flow!.slotsTaken, 3);
  });

  await test("waitlist on: joining a full GB lands on the waitlist; a freed slot promotes the first in line", async () => {
    const gb = await round("Waitlist round");
    await configure(gb.id, priced("pay_then_approve", { capacity: { maxSlots: 1, waitlist: true } }));
    const a = await customer();
    const w1 = await customer();
    const w2 = await customer();
    await join(gb.id, a);
    const j1 = await join(gb.id, w1);
    await join(gb.id, w2);
    assert.ok(j1.ok && j1.state.status === "waitlisted");
    assert.match(j1.state.stepper.headline, /waitlist/i);
    const row = await rowFor(gb.id, a);
    assert.ok((await B.reject({ tenantId: A.id, membershipId: row.id, admin: OWNER, reason: "Duplicate account" })).ok);
    assert.strictEqual((await access(gb.id, w1.id)).status, "payment_pending", "first in line promoted");
    assert.strictEqual((await access(gb.id, w2.id)).status, "waitlisted");
  });

  await test("raising the slot limit promotes waitlisters", async () => {
    const gb = await round("Grow round");
    await configure(gb.id, priced("pay_then_approve", { capacity: { maxSlots: 1, waitlist: true } }));
    const a = await customer();
    const w = await customer();
    await join(gb.id, a);
    await join(gb.id, w);
    await configure(gb.id, priced("pay_then_approve", { capacity: { maxSlots: 2, waitlist: true } }));
    assert.strictEqual((await access(gb.id, w.id)).status, "payment_pending");
  });

  console.log("\nRefund settings on reject");

  async function paidAndRejected(refundOnReject: "manual" | "none") {
    const gb = await round(`Refund ${refundOnReject}`);
    await configure(gb.id, priced("pay_then_approve", { refundOnReject }));
    const c = await customer();
    await join(gb.id, c);
    await proof(gb.id, c);
    const pay = await rowFor(gb.id, c, "payments");
    await B.confirmPayment({ tenantId: A.id, paymentId: pay.payment!.id, admin: OWNER });
    const row = await rowFor(gb.id, c, "approvals");
    assert.ok((await B.reject({ tenantId: A.id, membershipId: row.id, admin: OWNER, reason: "Not a fit" })).ok);
    return { gb, c, id: row.id };
  }

  await test("manual: the rejected payer waits in the refunds queue until the admin marks it refunded", async () => {
    const { gb, c, id } = await paidAndRejected("manual");
    assert.strictEqual((await rowFor(gb.id, c, "refunds")).refundStatus, "pending");
    const noRef = await B.markRefunded({ tenantId: A.id, membershipId: id, admin: OWNER, reference: "" });
    assert.ok(!noRef.ok);
    assert.ok((await B.markRefunded({ tenantId: A.id, membershipId: id, admin: OWNER, reference: "GC-REFUND-77" })).ok);
    assert.strictEqual((await rowFor(gb.id, c)).refundStatus, "refunded");
    assert.strictEqual((await queue(gb.id, "refunds")).length, 0);
    assert.ok((await join(gb.id, c)).ok, "refunded → may join again");
  });

  await test("none: a rejection owes nothing and frees the customer", async () => {
    const { gb, c } = await paidAndRejected("none");
    assert.strictEqual((await rowFor(gb.id, c)).refundStatus, "not_applicable");
    assert.strictEqual((await queue(gb.id, "refunds")).length, 0);
  });

  console.log("\nWhat pending members may see");

  await test("the visibility setting rides on the member's snapshot (nothing vs summary)", async () => {
    const gb = await round("Visibility");
    await configure(gb.id, priced("pay_then_approve", { pendingVisibility: "nothing" }));
    const hidden = await customer();
    await join(gb.id, hidden);
    await configure(gb.id, priced("pay_then_approve", { pendingVisibility: "summary" }));
    const shown = await customer();
    await join(gb.id, shown);
    assert.strictEqual((await access(gb.id, hidden.id)).visibility, "nothing");
    assert.strictEqual((await access(gb.id, shown.id)).visibility, "summary");
    assert.strictEqual((await access(gb.id, null)).visibility, "summary", "visitors follow the current setting");
  });

  console.log("\nDeposits");

  await test("a confirmed deposit is credited to one order, once, and never above the order total", async () => {
    const gb = await round("Deposit round");
    await configure(gb.id, priced("pay_to_join", { payment: { amountMode: "deposit", amountCents: 50000, method: "manual", windowMinutes: null } }));
    const { withTenant } = await import("../src/lib/db/tenant-client");
    const payDeposit = async () => {
      const c = await customer();
      await join(gb.id, c);
      await proof(gb.id, c);
      const row = await rowFor(gb.id, c, "payments");
      assert.strictEqual(row.payment!.kind, "deposit");
      assert.ok((await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: OWNER })).ok);
      return c;
    };
    const c = await payDeposit();
    const credit = (customerId: string, orderId: string, orderTotalCents: number) =>
      withTenant(A.id, (tx) => B.claimDepositCredit(tx, { groupBuyId: gb.id, customerId, orderId, orderTotalCents }));
    assert.strictEqual(await credit(c.id, "order_1", 120000), 50000);
    assert.strictEqual(await credit(c.id, "order_2", 120000), 0, "already credited");
    const small = await payDeposit();
    assert.strictEqual(await credit(small.id, "order_3", 30000), 30000, "capped at the order total");
  });

  console.log("\nWho may approve whom");

  await test("a customer can't approve, reject or confirm — not anyone, not themselves", async () => {
    const c = await customer();
    await join(gbPta.id, c);
    await proof(gbPta.id, c);
    const row = await rowFor(gbPta.id, c, "payments");
    const asCustomer = { kind: "customer", id: c.id, email: c.email } as never;
    assert.ok(!(await B.confirmPayment({ tenantId: A.id, paymentId: row.payment!.id, admin: asCustomer })).ok);
    assert.ok(!(await B.reject({ tenantId: A.id, membershipId: row.id, admin: asCustomer, reason: "x" })).ok);
    assert.strictEqual((await access(gbPta.id, c.id)).status, "payment_review");
  });

  await test("an admin who is also the member can't review their own membership", async () => {
    const c = await customer();
    await join(gbAtp.id, c);
    const row = await rowFor(gbAtp.id, c, "approvals");
    const self = await B.approve({ tenantId: A.id, membershipId: row.id, admin: { kind: "admin", id: "staff:s9", email: c.email.toUpperCase() } });
    assert.ok(!self.ok);
    assert.match(self.message, /your own/i);
  });

  await test("an admin account without an email can't review anyone (self-review can't be ruled out)", async () => {
    const c = await customer();
    await join(gbAtp.id, c);
    const row = await rowFor(gbAtp.id, c, "approvals");
    const r = await B.approve({ tenantId: A.id, membershipId: row.id, admin: { kind: "admin", id: "owner", email: "" } });
    assert.ok(!r.ok && r.code === "forbidden");
  });

  await test("another store's admin can't touch this store's members", async () => {
    const c = await customer();
    await join(gbAtp.id, c);
    const row = await rowFor(gbAtp.id, c, "approvals");
    const r = await B.approve({ tenantId: Other.id, membershipId: row.id, admin: { kind: "admin", id: "owner", email: "owner@other.test" } });
    assert.ok(!r.ok && r.code === "not_found");
  });

  await test("every decision is in the audit log: who, from → to, when", async () => {
    const h = await B.history({ tenantId: A.id, groupBuyId: gbPta.id });
    assert.ok(h.ok);
    const kinds = new Set(h.events.map((e) => `${e.kind}:${e.toStatus}`));
    for (const k of ["transition:payment_pending", "payment:payment_review", "payment:approval_pending", "transition:active"]) {
      assert.ok(kinds.has(k), `missing ${k} in ${[...kinds].join(", ")}`);
    }
    assert.ok(h.events.every((e) => e.actorKind && e.createdAt));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
