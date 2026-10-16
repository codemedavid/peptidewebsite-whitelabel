/**
 * Integration gate for the community safety bot: the REAL route handlers,
 * auth, withTenant() and the Jev client against in-process PGlite and a fake
 * OpenRouter Decisions endpoint (same harness as test-community-api.ts).
 *
 *   npm run test:community-moderation-api
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/pglite-only";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "pepweb.store";
process.env.TENANT_ADMIN_SECRET = "test-secret";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
delete process.env.EXPO_ACCESS_TOKEN;

import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password-hash";
import { ACCOUNT_BANNED_MESSAGE } from "../src/lib/mobile/contract";

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

// A fake OpenRouter: "poaching" is likely when the text recruits elsewhere,
// borderline when it hints at it; the rule question picks the first rule.
const POACH_RE = /sumali|join our|sali ka|other group/i;
const BORDERLINE_RE = /dm me for details/i;
const jevCalls: Json[] = [];
let jevDown = false;
let keyRejected = false;
const fakeJev = createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    rs.setHeader("Content-Type", "application/json");
    if (keyRejected) {
      rs.statusCode = 401;
      rs.end(JSON.stringify({ error: { message: "User not found.", code: 401 } }));
      return;
    }
    if (rq.url === "/api/v1/key") {
      rs.end(JSON.stringify({ data: { label: "test", limit: null, limit_remaining: null } }));
      return;
    }
    const body = JSON.parse(raw) as Json;
    jevCalls.push({ auth: rq.headers.authorization, body });
    if (jevDown) {
      rs.statusCode = 503;
      rs.end(JSON.stringify({ error: "overloaded" }));
      return;
    }
    const text = String(body.state?.message ?? "");
    const noul = POACH_RE.test(text) ? 0.96 : BORDERLINE_RE.test(text) ? 0.55 : 0.04;
    const answers: Json = { poaching: { type: "noul", noul } };
    if (body.questions?.rule) answers.rule = { type: "choice", choice: noul > 0.5 ? "r1" : "none", confidence: 0.8, probabilities: {} };
    rs.end(JSON.stringify({ id: "gen-dec-test", model: body.model, answers, usage: { input_tokens: 90, output_tokens: 1, cost: 0 } }));
  });
});

const supabaseUsers: Record<string, Json> = {
  "tok-mica": { id: "sb-mica", email: "mica@mama.test", email_confirmed_at: "2026-10-01T00:00:00Z", is_anonymous: false, user_metadata: { display_name: "Mica" } },
};
const fakeSupabase = createServer((rq, rs) => {
  const user = supabaseUsers[(rq.headers.authorization ?? "").replace(/^Bearer /, "")];
  rs.statusCode = rq.url === "/auth/v1/user" && user ? 200 : 401;
  rs.setHeader("Content-Type", "application/json");
  rs.end(JSON.stringify(user ?? { msg: "invalid JWT" }));
});

const listen = (s: ReturnType<typeof createServer>) =>
  new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

async function main() {
  process.env.JEV_ENDPOINT_OVERRIDE = `${await listen(fakeJev)}/api/alpha/decisions`;
  process.env.MOBILE_SUPABASE_URL_OVERRIDE = await listen(fakeSupabase);

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
  const exchangeRoute = await h("auth/exchange/route", "POST");
  const me = await h("me/route", "GET");
  const inbox = await h("community/inbox/route", "GET");
  const messagesGet = await h("community/threads/[type]/[id]/messages/route", "GET");
  const messagesPost = await h("community/threads/[type]/[id]/messages/route", "POST");
  const messagePatch = await h("community/messages/[id]/route", "PATCH");
  const messageDelete = await h("community/messages/[id]/route", "DELETE");
  const dms = await h("community/dms/route", "POST");
  const members = await h("community/members/route", "GET");
  const review = await h("community/members/[customerId]/review/route", "POST");
  const moderationGet = await h("community/moderation/route", "GET");
  const moderationPatch = await h("community/moderation/route", "PATCH");
  const flagPost = await h("community/moderation/flags/[id]/route", "POST");
  const rulesPut = await h("community/moderation/rules/route", "PUT");
  const examplePost = await h("community/moderation/examples/route", "POST");
  const exampleDelete = await h("community/moderation/examples/[id]/route", "DELETE");
  const testPost = await h("community/moderation/test/route", "POST");
  const sanction = await h("community/members/[customerId]/sanction/route", "POST");
  const flushAfter = (globalThis as unknown as { __flushAfter: () => Promise<void> }).__flushAfter;

  // ── seed ────────────────────────────────────────────────────────────────
  const fCommunity = await db.feature.create({ data: { key: "mobile.community" } });
  const plan = await db.plan.create({ data: { key: "growth", name: "Growth" } });
  const T = await db.tenant.create({
    data: {
      slug: "mamamica",
      name: "Mama Mica",
      status: "active",
      planId: plan.id,
      storeAdminEmail: "owner@mamamica.test",
      storeAdminPasswordHash: hashPassword("owner-pass"),
      featureOverrides: { create: [{ featureId: fCommunity.id, enabled: true }] },
    },
  });
  await db.branding.create({
    data: {
      tenantId: T.id,
      config: {
        name: "Mama Mica",
        communityModeration: { enabled: true, muteAfter: 2 },
        supabaseExchange: { url: "https://abcdefghijklmnopqrst.supabase.co", anonKey: "anon-key-public" },
      },
    },
  });
  const mkCustomer = (email: string, name: string, pw: string) =>
    db.storefrontCustomer.create({ data: { tenantId: T.id, email, name, passwordHash: hashPassword(pw) } });
  const ann = await mkCustomer("ann@buyer.test", "Ann Cruz", "ann-pass");
  const bob = await mkCustomer("bob@buyer.test", "Bob Reyes", "bob-pass");

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
  const signIn = (email: string, pw: string) => (useIp(), call(login, req("POST", "/auth/login", undefined, { email, password: pw })));
  const token = async (email: string, pw: string) => {
    const r = await signIn(email, pw);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.accessToken as string;
  };
  let seq = 0;
  const send = (tok: string, type: string, id: string, text: string) =>
    call(messagesPost, req("POST", `/community/threads/${type}/${id}/messages`, tok, { kind: "text", body: text, clientId: `c-${++seq}` }), { type, id });
  const list = (tok: string, type: string, id: string, qs = "") =>
    call(messagesGet, req("GET", `/community/threads/${type}/${id}/messages${qs}`, tok), { type, id });
  const queue = (tok: string, status = "pending") => call(moderationGet, req("GET", `/community/moderation?status=${status}`, tok));
  const flagsFor = (customerId: string) => db.communityFlag.findMany({ where: { senderKey: `c:${customerId}` }, orderBy: { createdAt: "asc" } });

  const ownerTok = await token("owner@mamamica.test", "owner-pass");
  let annTok = await token("ann@buyer.test", "ann-pass");
  const bobTok = await token("bob@buyer.test", "bob-pass");
  const boot = await call(inbox, req("GET", "/community/inbox", ownerTok));
  const general = boot.json.data.channels.find((c: Json) => c.postRole === "everyone").generalTopicId as string;
  await call(inbox, req("GET", "/community/inbox", annTok));
  await call(inbox, req("GET", "/community/inbox", bobTok));

  console.log("\nscanning channel posts");
  await test("a normal post goes through, after one Jev question with the store named", async () => {
    const r = await send(annTok, "topic", general, "Hello po! Anyone tried the BPC here?");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.moderated, false);
    assert.equal(r.json.data.body, "Hello po! Anyone tried the BPC here?");
    const call0 = jevCalls.at(-1)!;
    assert.equal(call0.auth, "Bearer test-openrouter-key");
    assert.equal(call0.body.model, "typesafe/jev-1.13");
    assert.equal(call0.body.state.message, "Hello po! Anyone tried the BPC here?");
    assert.equal(call0.body.state.community, "Mama Mica");
    assert.equal(call0.body.questions.poaching.type, "noul");
  });
  let firstFlagId = "";
  let poachId = "";
  await test("a poaching post is written hidden: the sender sees 'removed', nobody sees the text", async () => {
    const r = await send(annTok, "topic", general, "Sis sali ka sa gb namin, mas mura sa other group!");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.moderated, true);
    assert.equal(r.json.data.body, null);
    assert.ok(r.json.data.deletedAt);
    poachId = r.json.data.id;
    const bobView = (await list(bobTok, "topic", general)).json.data.messages.find((m: Json) => m.id === poachId);
    assert.equal(bobView.body, null);
    assert.equal(bobView.moderated, true);
    const flags = await flagsFor(ann.id);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].status, "pending");
    assert.equal(flags[0].threadType, "topic");
    assert.ok(flags[0].score >= 0.7);
    firstFlagId = flags[0].id;
  });
  await test("the poach text never leaks into the inbox", async () => {
    const r = await call(inbox, req("GET", "/community/inbox", bobTok));
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.json).includes("mas mura"));
  });
  await test("the store team is never scanned", async () => {
    const before = jevCalls.length;
    const r = await send(ownerTok, "topic", general, "Join our group buy round tomorrow — sumali kayo!");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.moderated, false);
    assert.equal(jevCalls.length, before);
  });

  console.log("\nthe moderators' queue");
  await test("moderators see the flagged text, the line before it and a 1st-offense tag", async () => {
    const r = await queue(ownerTok);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = r.json.data;
    assert.deepEqual(d.settings, { enabled: true, muteAfter: 2, sensitivity: "balanced", available: true, health: "ok" });
    assert.equal(d.counts.pending, 1);
    const f = d.flags[0];
    assert.equal(f.kind, "hidden");
    assert.equal(f.confidence, "High");
    assert.match(f.reason, /another group buy/, "the matched starter rule says why");
    assert.equal(d.policy.customized, false, "starter rules until the owner saves their own");
    assert.ok(d.policy.rules.some((r: Json) => r.kind === "allow"));
    assert.equal(f.message.text, "Sis sali ka sa gb namin, mas mura sa other group!");
    assert.equal(f.message.hidden, true);
    assert.equal(f.place.type, "topic");
    assert.equal(f.sender.name, "Ann Cruz");
    assert.equal(f.sender.tag, "first");
    assert.equal(f.sender.label, "1st offense");
    assert.equal(f.sender.muted, false);
    assert.equal(f.context.at(-1).flagged, true);
    assert.ok(f.context.length <= 3);
    assert.equal(f.context.at(-2).text, "Hello po! Anyone tried the BPC here?");
  });
  await test("members can't open the queue or change the bot", async () => {
    assert.equal((await queue(bobTok)).status, 403);
    assert.equal((await call(moderationPatch, req("PATCH", "/community/moderation", bobTok, { enabled: false }))).status, 403);
    assert.equal((await call(flagPost, req("POST", `/community/moderation/flags/${firstFlagId}`, bobTok, { action: "restore" }), { id: firstFlagId })).status, 403);
    assert.equal((await call(sanction, req("POST", `/community/members/${ann.id}/sanction`, bobTok, { action: "ban" }), { customerId: ann.id })).status, 403);
  });

  console.log("\nDMs + repeat offenders");
  let dmId = "";
  await test("a poaching DM is hidden too, and the 2nd offense auto-mutes the sender", async () => {
    const open = await call(dms, req("POST", "/community/dms", annTok, { peerKey: `c:${bob.id}` }));
    assert.equal(open.status, 200, JSON.stringify(open.json));
    dmId = open.json.data.conversationId;
    const r = await send(annTok, "dm", dmId, "hello baka po gusto mo sis sumali sa groupbuy namin mas mura");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.moderated, true);
    assert.equal(jevCalls.at(-1)!.body.state.where, "a private message inside the Mama Mica community app");
    const member = await db.communityMember.findFirstOrThrow({ where: { customerId: ann.id } });
    assert.ok(member.mutedAt, "muted");
    assert.equal(member.mutedBy, "bot");
    const q = await queue(ownerTok);
    const dmFlag = q.json.data.flags.find((f: Json) => f.place.type === "dm");
    assert.equal(dmFlag.sender.tag, "repeat");
    assert.equal(dmFlag.sender.label, "Repeat offender · 2 offenses");
    assert.equal(dmFlag.sender.mutedByBot, true);
    assert.match(dmFlag.place.name, /Private message to Bob/);
  });
  await test("a muted member reads but can't post anywhere", async () => {
    const r = await send(annTok, "topic", general, "Just saying hi again");
    assert.equal(r.status, 403);
    assert.match(r.json.error.message, /muted/);
    assert.equal((await send(annTok, "dm", dmId, "hi bob how are you")).status, 403);
    assert.equal((await list(annTok, "topic", general)).status, 200);
  });
  await test("a muted member can't edit old messages either, and no Jev call is spent", async () => {
    const own = await db.communityMessage.findFirstOrThrow({ where: { senderKey: `c:${ann.id}`, deletedAt: null } });
    const before = jevCalls.length;
    const r = await call(messagePatch, req("PATCH", `/community/messages/${own.id}`, annTok, { body: "join our other group" }), { id: own.id });
    assert.equal(r.status, 403);
    assert.match(r.json.error.message, /muted/);
    assert.equal(jevCalls.length, before);
  });
  await test("members list carries the offense count and mute", async () => {
    const r = await call(members, req("GET", "/community/members?status=approved", ownerTok));
    const row = r.json.data.members.find((m: Json) => m.customerId === ann.id);
    assert.equal(row.offenses, 2);
    assert.equal(row.muted, true);
    assert.equal(row.banned, false);
  });

  console.log("\nreview actions");
  await test("restore (false alarm) brings the message back to open chats and lifts the bot's mute", async () => {
    const poll = (await list(bobTok, "topic", general)).json.data.pollCursor as string;
    const r = await call(flagPost, req("POST", `/community/moderation/flags/${firstFlagId}`, ownerTok, { action: "restore" }), { id: firstFlagId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.status, "dismissed");
    const changed = (await list(bobTok, "topic", general, `?after=${encodeURIComponent(poll)}`)).json.data.changed as Json[];
    const back = changed.find((m) => m.id === poachId);
    assert.ok(back, "the poll picks the restore up");
    assert.equal(back!.moderated, false);
    assert.equal(back!.body, "Sis sali ka sa gb namin, mas mura sa other group!");
    const member = await db.communityMember.findFirstOrThrow({ where: { customerId: ann.id } });
    assert.equal(member.mutedAt, null, "back under the limit");
    assert.equal((await send(annTok, "topic", general, "Thanks for checking po")).status, 200);
  });
  await test("editing a message into an invite is caught like a send", async () => {
    const sent = await send(annTok, "topic", general, "What time is the drop today?");
    const id = sent.json.data.id as string;
    const r = await call(messagePatch, req("PATCH", `/community/messages/${id}`, annTok, { body: "pm me, join our Telegram group buy instead" }), { id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.moderated, true);
    assert.equal(await db.communityFlag.count({ where: { messageId: id } }), 1);
  });
  await test("confirm keeps it hidden", async () => {
    const [flag] = (await queue(ownerTok)).json.data.flags as Json[];
    const r = await call(flagPost, req("POST", `/community/moderation/flags/${flag.id}`, ownerTok, { action: "confirm" }), { id: flag.id });
    assert.equal(r.json.data.status, "confirmed");
    const row = await db.communityMessage.findFirstOrThrow({ where: { id: flag.message.id } });
    assert.ok(row.deletedAt);
  });
  await test("moderators can mute and unmute by hand", async () => {
    const mute = await call(sanction, req("POST", `/community/members/${bob.id}/sanction`, ownerTok, { action: "mute" }), { customerId: bob.id });
    assert.deepEqual(mute.json.data, { customerId: bob.id, muted: true, banned: false });
    assert.equal((await send(bobTok, "topic", general, "hello everyone here")).status, 403);
    await call(sanction, req("POST", `/community/members/${bob.id}/sanction`, ownerTok, { action: "unmute" }), { customerId: bob.id });
    assert.equal((await send(bobTok, "topic", general, "hello everyone here")).status, 200);
    assert.equal((await call(sanction, req("POST", `/community/members/${bob.id}/sanction`, ownerTok, { action: "nuke" }), { customerId: bob.id })).status, 400);
  });

  console.log("\nbans");
  await test("a ban ends every live session and the same login is refused", async () => {
    const r = await call(sanction, req("POST", `/community/members/${ann.id}/sanction`, ownerTok, { action: "ban" }), { customerId: ann.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.banned, true);
    assert.notEqual((await call(me, req("GET", "/me", annTok))).status, 200, "the old session is dead");
    assert.equal((await signIn("ann@buyer.test", "ann-pass")).status, 401);
    const member = await db.communityMember.findFirstOrThrow({ where: { customerId: ann.id } });
    assert.equal(member.status, "revoked");
    assert.ok(member.bannedAt);
    assert.equal((await db.storefrontCustomer.findFirstOrThrow({ where: { id: ann.id } })).status, "disabled");
  });
  await test("approving a banned member is refused — only unban gives the login back", async () => {
    const r = await call(review, req("POST", `/community/members/${ann.id}/review`, ownerTok, { approve: true }), { customerId: ann.id });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    const un = await call(sanction, req("POST", `/community/members/${ann.id}/sanction`, ownerTok, { action: "unban" }), { customerId: ann.id });
    assert.deepEqual(un.json.data, { customerId: ann.id, muted: false, banned: false });
    annTok = await token("ann@buyer.test", "ann-pass");
    assert.equal((await call(inbox, req("GET", "/community/inbox", annTok))).status, 200);
  });
  await test("editing someone else's message never reaches Jev", async () => {
    const theirs = await db.communityMessage.findFirstOrThrow({ where: { senderKey: `c:${bob.id}`, deletedAt: null } });
    const before = jevCalls.length;
    const r = await call(messagePatch, req("PATCH", `/community/messages/${theirs.id}`, annTok, { body: "sali ka sa gb namin" }), { id: theirs.id });
    assert.notEqual(r.status, 200);
    assert.equal(jevCalls.length, before);
  });
  await test("unban never re-enables an account the operator disabled for something else", async () => {
    const zed = await mkCustomer("zed@buyer.test", "Zed", "zed-pass");
    const zedTok = await token("zed@buyer.test", "zed-pass");
    await call(inbox, req("GET", "/community/inbox", zedTok));
    await db.storefrontCustomer.update({ where: { id: zed.id }, data: { status: "disabled" } }); // e.g. fraud
    await call(sanction, req("POST", `/community/members/${zed.id}/sanction`, ownerTok, { action: "ban" }), { customerId: zed.id });
    const again = await call(sanction, req("POST", `/community/members/${zed.id}/sanction`, ownerTok, { action: "ban" }), { customerId: zed.id });
    assert.equal(again.status, 400, "already banned");
    await call(sanction, req("POST", `/community/members/${zed.id}/sanction`, ownerTok, { action: "unban" }), { customerId: zed.id });
    assert.equal((await db.storefrontCustomer.findFirstOrThrow({ where: { id: zed.id } })).status, "disabled");
    const notBanned = await call(sanction, req("POST", `/community/members/${zed.id}/sanction`, ownerTok, { action: "unban" }), { customerId: zed.id });
    assert.equal(notBanned.status, 400);
  });
  await test("a banned Mamamica (Supabase) account is refused at the exchange with the ban message", async () => {
    useIp();
    const first = await call(exchangeRoute, req("POST", "/auth/exchange", undefined, { store: "mamamica", supabaseAccessToken: "tok-mica" }));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const mica = await db.storefrontCustomer.findFirstOrThrow({ where: { tenantId: T.id, email: "mica@mama.test" } });
    await call(inbox, req("GET", "/community/inbox", first.json.data.accessToken));
    await call(sanction, req("POST", `/community/members/${mica.id}/sanction`, ownerTok, { action: "ban" }), { customerId: mica.id });
    useIp();
    const again = await call(exchangeRoute, req("POST", "/auth/exchange", undefined, { store: "mamamica", supabaseAccessToken: "tok-mica" }));
    assert.equal(again.status, 403, JSON.stringify(again.json));
    assert.equal(again.json.error.message, ACCOUNT_BANNED_MESSAGE);
  });

  console.log("\nfailing open + switching off");
  await test("Jev down: the message goes through rather than being lost", async () => {
    jevDown = true;
    const r = await send(bobTok, "topic", general, "sali ka sa gb namin sis");
    jevDown = false;
    assert.equal(r.status, 200);
    assert.equal(r.json.data.moderated, false);
  });
  await test("settings validate, and switching the bot off stops every scan", async () => {
    assert.equal((await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { muteAfter: 0 }))).status, 400);
    const off = await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { enabled: false }));
    assert.deepEqual(off.json.data, { enabled: false, muteAfter: 2, sensitivity: "balanced", available: true, health: "ok" });
    const cfg = (await db.branding.findFirstOrThrow({ where: { tenantId: T.id } })).config as Json;
    assert.ok(cfg.supabaseExchange, "other branding keys are kept");
    const before = jevCalls.length;
    const r = await send(bobTok, "topic", general, "sali ka sa gb namin sis, mas mura");
    assert.equal(r.json.data.moderated, false);
    assert.equal(jevCalls.length, before);
  });

  console.log("\nrules, teaching and the test box");
  const carl = await mkCustomer("carl@buyer.test", "Carl Lim", "carl-pass");
  const carlTok = await token("carl@buyer.test", "carl-pass");
  await call(inbox, req("GET", "/community/inbox", carlTok));
  await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { enabled: true }));
  await test("the owner's own rules replace the starter rules and reach Jev on the next check", async () => {
    assert.equal((await call(rulesPut, req("PUT", "/community/moderation/rules", ownerTok, { rules: [{ kind: "allow", text: "Study links" }] }))).status, 400, "needs a not-allowed rule");
    const r = await call(rulesPut, req("PUT", "/community/moderation/rules", ownerTok, {
      rules: [
        { kind: "block", text: "Asking members to message them on Viber" },
        { kind: "block", text: "Inviting members to another group buy" },
        { kind: "allow", text: "Sharing a study link" },
      ],
    }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.customized, true);
    assert.deepEqual(r.json.data.rules.map((x: Json) => x.text), ["Asking members to message them on Viber", "Inviting members to another group buy", "Sharing a study link"]);
    await send(carlTok, "topic", general, "Good morning everyone, how is your week?");
    const crit = jevCalls.at(-1)!.body.questions.poaching.criteria;
    assert.deepEqual(crit.true.rules, ["Asking members to message them on Viber", "Inviting members to another group buy"]);
    assert.deepEqual(crit.false.rules, ["Sharing a study link"]);
    assert.deepEqual(Object.keys(jevCalls.at(-1)!.body.questions.rule.criteria), ["r1", "r2", "none"]);
  });
  let heldId = "";
  await test("a borderline message stays visible, waits in the queue, and isn't an offense yet", async () => {
    const r = await send(carlTok, "topic", general, "I have extra vials, DM me for details");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.moderated, false, "still visible");
    const q = await queue(ownerTok);
    const f = q.json.data.flags.find((x: Json) => x.sender.name === "Carl Lim");
    assert.equal(f.kind, "review");
    assert.equal(f.message.hidden, false);
    assert.equal(f.reason, "Asking members to message them on Viber");
    assert.equal(f.sender.offenses, 0, "held for review doesn't count");
    heldId = f.id;
  });
  await test("hiding a held message hides it now, counts it, and teaches Jev a not-allowed example", async () => {
    const r = await call(flagPost, req("POST", `/community/moderation/flags/${heldId}`, ownerTok, { action: "confirm" }), { id: heldId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.data.exampleId, "returns the example so the app can undo the lesson");
    const flag = await db.communityFlag.findFirstOrThrow({ where: { id: heldId } });
    const msg = await db.communityMessage.findFirstOrThrow({ where: { id: flag.messageId } });
    assert.ok(msg.deletedAt && msg.moderatedAt, "hidden by the review");
    assert.equal((await queue(ownerTok, "confirmed")).json.data.flags.find((x: Json) => x.id === heldId).sender.offenses, 1);
    await send(carlTok, "topic", general, "Anyone joining the Saturday meetup?");
    assert.equal(jevCalls.at(-1)!.body.questions.poaching.criteria.true.examples[0], "I have extra vials, DM me for details", "newest lesson first");
  });
  await test("a false alarm teaches an allowed example, unless the owner says not to", async () => {
    const r = await send(carlTok, "topic", general, "dm me for details about the study I read");
    const f = (await queue(ownerTok)).json.data.flags.find((x: Json) => x.message.id === r.json.data.id);
    const restore = await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "restore", teach: false }), { id: f.id });
    assert.equal(restore.json.data.exampleId, null);
    const again = await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "restore" }), { id: f.id });
    assert.ok(again.json.data.exampleId);
    const policy = (await queue(ownerTok)).json.data.policy;
    assert.ok(policy.examples.some((e: Json) => e.kind === "allow" && e.source === "review" && e.text === "dm me for details about the study I read"));
  });
  await test("undo puts an alert back exactly as the bot left it", async () => {
    const r = await send(carlTok, "topic", general, "extra vials, DM me for details po");
    const f = (await queue(ownerTok)).json.data.flags.find((x: Json) => x.message.id === r.json.data.id);
    assert.equal(f.kind, "review");
    await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "confirm", teach: false }), { id: f.id });
    const undo = await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "reopen" }), { id: f.id });
    assert.equal(undo.status, 200, JSON.stringify(undo.json));
    assert.equal(undo.json.data.status, "pending");
    assert.equal(undo.json.data.exampleId, null, "reopening never teaches");
    const back = (await queue(ownerTok)).json.data.flags.find((x: Json) => x.id === f.id);
    assert.equal(back.message.hidden, false, "a held message is visible again");
    assert.equal(back.reviewedAt, null);
  });
  await test("owners can add and remove examples by hand; members can't touch the policy", async () => {
    const add = await call(examplePost, req("POST", "/community/moderation/examples", ownerTok, { kind: "block", text: "  add mo ko sa viber 0917  " }));
    assert.equal(add.status, 200, JSON.stringify(add.json));
    const ex = add.json.data.examples.find((e: Json) => e.text === "add mo ko sa viber 0917");
    assert.equal(ex.source, "owner");
    const del = await call(exampleDelete, req("DELETE", `/community/moderation/examples/${ex.id}`, ownerTok), { id: ex.id });
    assert.equal(del.status, 200);
    assert.ok(!del.json.data.examples.some((e: Json) => e.id === ex.id));
    assert.equal((await call(exampleDelete, req("DELETE", `/community/moderation/examples/${ex.id}`, ownerTok), { id: ex.id })).status, 404);
    assert.equal((await call(examplePost, req("POST", "/community/moderation/examples", bobTok, { kind: "allow", text: "sneaky example" }))).status, 403);
    assert.equal((await call(rulesPut, req("PUT", "/community/moderation/rules", bobTok, { rules: [{ kind: "block", text: "Nothing" }] }))).status, 403);
  });
  await test("the test box says what Jev would do and why, without saving anything", async () => {
    const flagsBefore = await db.communityFlag.count();
    const hit = await call(testPost, req("POST", "/community/moderation/test", ownerTok, { text: "sali ka sa gb namin sis" }));
    assert.equal(hit.status, 200, JSON.stringify(hit.json));
    assert.deepEqual(hit.json.data, { verdict: "hide", score: 0.96, confidence: "High", reason: "Asking members to message them on Viber", health: "ok" });
    const fine = await call(testPost, req("POST", "/community/moderation/test", ownerTok, { text: "Good morning po sa lahat" }));
    assert.equal(fine.json.data.verdict, "allow");
    assert.equal(fine.json.data.reason, null);
    assert.equal(await db.communityFlag.count(), flagsBefore);
    assert.equal((await call(testPost, req("POST", "/community/moderation/test", ownerTok, { text: "hi" }))).status, 400);
    assert.equal((await call(testPost, req("POST", "/community/moderation/test", bobTok, { text: "sali ka sa gb namin" }))).status, 403);
  });
  await test("strict holds more for review; relaxed lets a borderline message through", async () => {
    await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { sensitivity: "strict" }));
    assert.equal((await call(testPost, req("POST", "/community/moderation/test", ownerTok, { text: "extra vials, DM me for details" }))).json.data.verdict, "hide");
    await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { sensitivity: "relaxed" }));
    assert.equal((await call(testPost, req("POST", "/community/moderation/test", ownerTok, { text: "extra vials, DM me for details" }))).json.data.verdict, "allow");
    assert.equal((await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { sensitivity: "max" }))).status, 400);
    await call(moderationPatch, req("PATCH", "/community/moderation", ownerTok, { sensitivity: "balanced" }));
  });
  await test("a revoked API key shows up on the dashboard instead of failing silently", async () => {
    keyRejected = true;
    const r = await send(carlTok, "topic", general, "sali ka sa gb namin, other group");
    assert.equal(r.json.data.moderated, false, "still fails open");
    const q = await queue(ownerTok);
    assert.equal(q.json.data.settings.health, "rejected");
    assert.equal(q.json.data.settings.available, false);
    keyRejected = false;
  });

  console.log("\nreview edge cases");
  const dan = await mkCustomer("dan@buyer.test", "Dan Uy", "dan-pass");
  const danTok = await token("dan@buyer.test", "dan-pass");
  await call(inbox, req("GET", "/community/inbox", danTok));
  await test("a message its sender deleted stays deleted, whatever moderators do with the flag later", async () => {
    const r = await send(danTok, "topic", general, "sali ka sa gb namin, mas mura dito");
    const f = (await queue(ownerTok)).json.data.flags.find((x: Json) => x.message.id === r.json.data.id);
    await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "restore", teach: false }), { id: f.id });
    const del = await call(messageDelete, req("DELETE", `/community/messages/${r.json.data.id}`, danTok), { id: r.json.data.id });
    assert.equal(del.status, 200, JSON.stringify(del.json));
    await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "reopen" }), { id: f.id });
    await call(flagPost, req("POST", `/community/moderation/flags/${f.id}`, ownerTok, { action: "restore", teach: false }), { id: f.id });
    const msg = await db.communityMessage.findFirstOrThrow({ where: { id: r.json.data.id } });
    assert.ok(msg.deletedAt, "still deleted");
    assert.equal(msg.moderatedAt, null, "a member's own delete isn't shown as the bot's");
  });
  await test("banning a member also hides their messages held for review", async () => {
    const r = await send(danTok, "topic", general, "have extras, DM me for details");
    assert.equal(r.json.data.moderated, false, "held, still visible");
    const ban = await call(sanction, req("POST", `/community/members/${dan.id}/sanction`, ownerTok, { action: "ban" }), { customerId: dan.id });
    assert.equal(ban.status, 200, JSON.stringify(ban.json));
    const msg = await db.communityMessage.findFirstOrThrow({ where: { id: r.json.data.id } });
    assert.ok(msg.deletedAt && msg.moderatedAt, "hidden with the ban");
  });
  await test("if the rules can't be read, messages still go through (fail open)", async () => {
    await pg.exec('ALTER TABLE "community_moderation_rules" RENAME TO "community_moderation_rules_gone"');
    try {
      const r = await send(carlTok, "topic", general, "sali ka sa gb namin sis");
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.data.moderated, false);
    } finally {
      await pg.exec('ALTER TABLE "community_moderation_rules_gone" RENAME TO "community_moderation_rules"');
    }
  });

  await flushAfter();
  console.log(`\n${passed} passed, ${failed} failed`);
  fakeJev.close();
  fakeSupabase.close();
  await pg.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
