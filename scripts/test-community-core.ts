/**
 * Pure-core gate for the Pepweb app's community (src/lib/community/*, no DB):
 *
 *   - keys:        participant keys, DM pair ordering, stable avatar hues
 *   - rules:       who may post / manage / edit / delete / open a DM
 *   - validate:    channel, topic, message, profile, review and drop input
 *   - cursor:      message paging + polling cursors
 *   - text:        search normalisation, LIKE escaping, link extraction, previews
 *   - unread:      read-marker baselines, marker moves, the tab badge
 *   - upload-kind: sniffing uploads from their bytes, image dimensions
 *
 *   npm run test:community-core
 */
import assert from "node:assert";

import {
  STORE_KEY,
  customerKey,
  parseParticipantKey,
  dmPair,
  dmPeerOf,
  avatarHue,
  authorKeyFor,
} from "../src/lib/community/keys";
import {
  EDIT_WINDOW_MS,
  canPostInChannel,
  canManageChannel,
  canManageTopic,
  canDeleteTopic,
  canEditMessage,
  canDeleteMessage,
  isOwnMessage,
  dmBlockedReason,
  postBlockedReason,
  canSeeChannel,
  canPostInTopic,
  canAddTopic,
  topicPostBlockedReason,
  canListChannel,
  isChannelLocked,
  dmPostBlockedReason as dmPostBlocked,
  type RuleActor,
} from "../src/lib/community/rules";
import {
  channelPreviewAccess,
  parsePreviewPolicyUpdate,
  previewCanOrder,
  previewFor,
  previewOrderBlocked,
  previewPolicyOf,
} from "../src/lib/community/preview";
import { DEFAULT_PREVIEW_POLICY, PREVIEW_LOCKED_MESSAGE } from "../src/lib/mobile/contract";
import { HUB_TOPICS, hubComposerHint } from "../src/lib/community/hub";
import {
  parseChannelInput,
  parseTopicInput,
  parseMessageBody,
  parseEditBody,
  parseReviewInput,
  parseDisplayName,
  parseProfileUpdate,
  parseDropInput,
  parseEmoji,
  parseImageUrl,
  defaultDisplayName,
} from "../src/lib/community/validate";
import {
  encodeCursor,
  decodeCursor,
  encodePollCursor,
  decodePollCursor,
} from "../src/lib/community/cursor";
import {
  normaliseSearchQuery,
  likePattern,
  extractLinks,
  previewText,
  firstName,
} from "../src/lib/community/text";
import {
  readBaseline,
  nextReadMarker,
  countUnreadChats,
} from "../src/lib/community/unread";
import { buildTopicPush, parseMuteRequest, topicPushAudience } from "../src/lib/community/topic-push";
import {
  classifyUpload,
  imageSize,
  sanitizeFileName,
  IMAGE_MAX_BYTES,
  FILE_MAX_BYTES,
  INLINE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  checkDirectVideo,
} from "../src/lib/community/upload-kind";
import { communityJoinMode, isActiveAdmin, isJoinMode, membershipFor } from "../src/lib/community/membership";
import { WELCOME_MAX, WELCOME_MAX_MESSAGES, communityWelcome, finalizeWelcome, parseWelcomeInput, videoPosterUrl, welcomeRows } from "../src/lib/community/welcome";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const member: RuleActor = { key: "c:ann", isModerator: false, authorKey: null };
const other: RuleActor = { key: "c:bob", isModerator: false, authorKey: null };
const owner: RuleActor = { key: STORE_KEY, isModerator: true, authorKey: "owner" };
const staff: RuleActor = { key: STORE_KEY, isModerator: true, authorKey: "s:st1" };
const NOW = new Date("2026-09-29T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// ── keys ─────────────────────────────────────────────────────────────────────
console.log("\nkeys");
test("customer + store keys round-trip", () => {
  assert.equal(customerKey("abc123"), "c:abc123");
  assert.deepEqual(parseParticipantKey("c:abc123"), { kind: "customer", id: "abc123" });
  assert.deepEqual(parseParticipantKey("store"), { kind: "store" });
});
test("junk keys are refused", () => {
  for (const k of ["", "c:", "c:has space", "x:abc", "STORE", "c:" + "a".repeat(80), 42, null, "s:st1", "owner"]) {
    assert.equal(parseParticipantKey(k), null, String(k));
  }
});
test("DM pair is ordered and symmetric; self-DM refused", () => {
  assert.deepEqual(dmPair("store", "c:ann"), { lowKey: "c:ann", highKey: "store" });
  assert.deepEqual(dmPair("c:ann", "store"), { lowKey: "c:ann", highKey: "store" });
  assert.deepEqual(dmPair("c:bob", "c:ann"), dmPair("c:ann", "c:bob"));
  assert.equal(dmPair("c:ann", "c:ann"), null);
});
test("dmPeerOf returns the other side, null for outsiders", () => {
  const conv = { lowKey: "c:ann", highKey: "store" };
  assert.equal(dmPeerOf(conv, "store"), "c:ann");
  assert.equal(dmPeerOf(conv, "c:ann"), "store");
  assert.equal(dmPeerOf(conv, "c:bob"), null);
});
test("avatar hue is stable and in range", () => {
  const h = avatarHue("cust-1");
  assert.equal(h, avatarHue("cust-1"));
  for (const s of ["", "a", "store", "c:zzz", "x".repeat(500)]) {
    const v = avatarHue(s);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 360, `${s} → ${v}`);
  }
  assert.notEqual(avatarHue("cust-1"), avatarHue("cust-2"));
});
test("author keys name the person behind the store", () => {
  assert.equal(authorKeyFor({ kind: "owner" }), "owner");
  assert.equal(authorKeyFor({ kind: "staff", id: "st1", permissions: [] }), "s:st1");
});

// ── rules ────────────────────────────────────────────────────────────────────
console.log("\nrules");
test("community admins hold their powers only while approved and unmuted", () => {
  const admin = { isAdmin: true, status: "approved", mutedAt: null };
  assert.equal(isActiveAdmin(admin), true);
  assert.equal(isActiveAdmin({ ...admin, isAdmin: false }), false);
  assert.equal(isActiveAdmin({ ...admin, mutedAt: new Date() }), false);
  for (const status of ["pending", "rejected", "revoked", "junk"]) assert.equal(isActiveAdmin({ ...admin, status }), false, status);
});

test("posting: everyone channels open to members, admin channels to moderators only", () => {
  assert.equal(canPostInChannel(member, "everyone"), true);
  assert.equal(canPostInChannel(member, "admins"), false);
  assert.equal(canPostInChannel(owner, "admins"), true);
  assert.equal(canPostInChannel(staff, "admins"), true);
  assert.equal(postBlockedReason(member, "admins"), "Only the store team posts here.");
  assert.equal(postBlockedReason(member, "everyone"), null);
});
test("managing channels and topics is moderator-only; General is never deleted", () => {
  assert.equal(canManageChannel(member), false);
  assert.equal(canManageChannel(owner), true);
  assert.equal(canManageTopic(member), false);
  assert.equal(canManageTopic(staff), true);
  assert.equal(canDeleteTopic(owner, { isGeneral: true }), false);
  assert.equal(canDeleteTopic(owner, { isGeneral: false }), true);
  assert.equal(canDeleteTopic(member, { isGeneral: false }), false);
});
const msg = (over: Partial<Parameters<typeof canEditMessage>[1]> = {}) => ({
  senderKey: "c:ann",
  authorKey: null as string | null,
  kind: "text" as const,
  createdAt: ago(60_000),
  deletedAt: null as Date | null,
  ...over,
});
test("own message: customers by key, the team by author", () => {
  assert.equal(isOwnMessage(member, msg()), true);
  assert.equal(isOwnMessage(other, msg()), false);
  const teamMsg = msg({ senderKey: STORE_KEY, authorKey: "owner" });
  assert.equal(isOwnMessage(owner, teamMsg), true);
  assert.equal(isOwnMessage(staff, teamMsg), false, "a staffer can't edit the owner's words");
});
test("edit: own text within 15 minutes", () => {
  assert.equal(canEditMessage(member, msg(), NOW), true);
  assert.equal(canEditMessage(member, msg({ createdAt: ago(EDIT_WINDOW_MS) }), NOW), true, "boundary inclusive");
  assert.equal(canEditMessage(member, msg({ createdAt: ago(EDIT_WINDOW_MS + 1) }), NOW), false);
  assert.equal(canEditMessage(other, msg(), NOW), false);
  assert.equal(canEditMessage(owner, msg(), NOW), false, "moderators can't rewrite members");
});
test("edit: captions yes; drops, cards, deleted and system lines never", () => {
  assert.equal(canEditMessage(member, msg({ kind: "image" }), NOW), true);
  assert.equal(canEditMessage(member, msg({ kind: "file" }), NOW), true);
  for (const kind of ["drop", "product", "protocol", "system"] as const) {
    assert.equal(canEditMessage(owner, msg({ kind, senderKey: STORE_KEY, authorKey: "owner" }), NOW), false, kind);
  }
  assert.equal(canEditMessage(member, msg({ deletedAt: ago(1) }), NOW), false);
});
test("delete: sender always; moderators in topics only", () => {
  assert.equal(canDeleteMessage(member, msg(), "topic"), true);
  assert.equal(canDeleteMessage(member, msg(), "dm"), true);
  assert.equal(canDeleteMessage(other, msg(), "topic"), false);
  assert.equal(canDeleteMessage(owner, msg(), "topic"), true);
  assert.equal(canDeleteMessage(owner, msg(), "dm"), false, "store can't delete a customer's DM");
  assert.equal(canDeleteMessage(member, msg({ deletedAt: ago(1) }), "topic"), false);
});
test("delete: the team shares the store's DM voice", () => {
  const teamMsg = msg({ senderKey: STORE_KEY, authorKey: "owner" });
  assert.equal(canDeleteMessage(staff, teamMsg, "dm"), true);
  assert.equal(canDeleteMessage(member, teamMsg, "dm"), false);
  assert.equal(canDeleteMessage(owner, msg({ kind: "drop", senderKey: STORE_KEY, authorKey: "owner" }), "topic"), true);
  assert.equal(canDeleteMessage(owner, msg({ kind: "system", senderKey: STORE_KEY }), "topic"), false);
});
test("delete: a community admin clears members' posts in topics, never the store's", () => {
  const admin = { key: "c:ada", isModerator: true, isTeam: false, authorKey: null };
  assert.equal(canDeleteMessage(admin, msg(), "topic"), true);
  assert.equal(canDeleteMessage(admin, msg(), "dm"), false);
  assert.equal(canDeleteMessage(admin, msg({ kind: "drop", senderKey: STORE_KEY, authorKey: "owner" }), "topic"), false, "would end a drop");
  assert.equal(canDeleteMessage(admin, msg({ senderKey: STORE_KEY, authorKey: "owner" }), "topic"), false);
});
test("DMs: customers reach the store and approved members; the store reaches approved members", () => {
  assert.equal(dmBlockedReason(member, { key: STORE_KEY, approved: true }), null);
  assert.equal(dmBlockedReason(member, { key: "c:bob", approved: true }), null);
  assert.ok(dmBlockedReason(member, { key: "c:bob", approved: false }));
  assert.ok(dmBlockedReason(member, { key: "c:ann", approved: true }), "no self-DM");
  assert.equal(dmBlockedReason(owner, { key: "c:bob", approved: true }), null);
  assert.ok(dmBlockedReason(owner, { key: "c:bob", approved: false }));
  assert.ok(dmBlockedReason(owner, { key: STORE_KEY, approved: true }), "store can't DM itself");
});

// ── validate ─────────────────────────────────────────────────────────────────
console.log("\nvalidate");
test("channel input: trimmed, bounded, defaults", () => {
  const r = parseChannelInput({ name: "  Deals  ", description: " hot ", emoji: "🔥", imageUrl: null, postRole: "admins" });
  assert.deepEqual(r, { ok: true, value: { name: "Deals", description: "hot", emoji: "🔥", imageUrl: null, postRole: "admins", audience: "everyone" } });
  const d = parseChannelInput({ name: "Chat" });
  assert.ok(d.ok && d.value.postRole === "everyone" && d.value.emoji === "💬" && d.value.description === null);
  assert.ok(d.ok && d.value.audience === "everyone", "a channel is for everyone unless told otherwise");
  const r2 = parseChannelInput({ name: "Resellers Hub", audience: "hub" });
  assert.ok(r2.ok && r2.value.audience === "hub");
  assert.equal(parseChannelInput({ name: "Resellers", audience: "vip" }).ok, false);
  assert.equal(parseChannelInput({ name: "Resellers", audience: "resellers" }).ok, false, "the old resellers-only audience is gone");
  const r3 = parseChannelInput({ name: "Resellers Hub", audience: "hub", postRole: "admins" });
  assert.ok(r3.ok && r3.value.postRole === "everyone", "a hub is always open for posting (its topics decide who posts)");
});
test("channel input: bad names, long descriptions, bad roles and URLs refused", () => {
  assert.equal(parseChannelInput({ name: "a" }).ok, false);
  assert.equal(parseChannelInput({ name: "a".repeat(61) }).ok, false);
  assert.equal(parseChannelInput({ name: "ab", description: "x".repeat(201) }).ok, false);
  assert.equal(parseChannelInput({ name: "ab", description: "x".repeat(200) }).ok, true);
  assert.equal(parseChannelInput({ name: "ab", postRole: "root" }).ok, false);
  assert.equal(parseChannelInput({ name: "ab", imageUrl: "javascript:alert(1)" }).ok, false);
  assert.equal(parseChannelInput({ name: "ab", imageUrl: "https://ik.imagekit.io/x.png" }).ok, true);
  assert.equal(parseChannelInput({ name: "ab", emoji: "x".repeat(20) }).ok, false);
  assert.equal(parseChannelInput(null).ok, false);
});
test("topic input", () => {
  assert.deepEqual(parseTopicInput({ name: " Stacks ", emoji: "", imageUrl: null }), {
    ok: true,
    value: { name: "Stacks", emoji: "💬", imageUrl: null },
  });
  assert.equal(parseTopicInput({ name: "x" }).ok, false);
  assert.equal(parseTopicInput({ name: "y".repeat(61) }).ok, false);
});
test("message body: text needs 1–2000 chars; attachments may be captionless", () => {
  assert.deepEqual(parseMessageBody("text", "  hi  "), { ok: true, value: "hi" });
  assert.equal(parseMessageBody("text", "   ").ok, false);
  assert.equal(parseMessageBody("text", undefined).ok, false);
  assert.equal(parseMessageBody("text", "x".repeat(2000)).ok, true);
  assert.equal(parseMessageBody("text", "x".repeat(2001)).ok, false);
  assert.deepEqual(parseMessageBody("image", undefined), { ok: true, value: null });
  assert.deepEqual(parseMessageBody("image", "  "), { ok: true, value: null });
  assert.equal(parseMessageBody("product", "x".repeat(2001)).ok, false);
});
test("edit body obeys the same text rule", () => {
  assert.equal(parseEditBody("").ok, false);
  assert.deepEqual(parseEditBody(" ok "), { ok: true, value: "ok" });
});
test("review: approve needs nothing, reject needs a 5–500 char reason", () => {
  assert.deepEqual(parseReviewInput({ approve: true }), { ok: true, value: { approve: true, reason: null } });
  assert.equal(parseReviewInput({ approve: false }).ok, false);
  assert.equal(parseReviewInput({ approve: false, reason: "nope" }).ok, false);
  assert.deepEqual(parseReviewInput({ approve: false, reason: " spam account " }), {
    ok: true,
    value: { approve: false, reason: "spam account" },
  });
  assert.equal(parseReviewInput({ approve: false, reason: "x".repeat(501) }).ok, false);
  assert.equal(parseReviewInput({ approve: "yes" }).ok, false);
});
test("display name 2–40, bio ≤ 160", () => {
  assert.equal(parseDisplayName("A").ok, false);
  assert.deepEqual(parseDisplayName("  Ann  "), { ok: true, value: "Ann" });
  assert.equal(parseDisplayName("x".repeat(41)).ok, false);
  assert.deepEqual(parseProfileUpdate({ displayName: "Ann", bio: " hi " }), { ok: true, value: { displayName: "Ann", bio: "hi" } });
  assert.equal(parseProfileUpdate({ displayName: "Ann", bio: "x".repeat(161) }).ok, false);
  assert.deepEqual(parseProfileUpdate({ displayName: "Ann" }), { ok: true, value: { displayName: "Ann", bio: "" } });
});
test("drop input: headline 2–80, duration bounded, ids required", () => {
  const base = { productId: "p1", variationId: null, headline: "Restock!", note: "", durationMinutes: 60, channelId: "ch1" };
  const r = parseDropInput(base);
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.note, null);
  assert.equal(parseDropInput({ ...base, headline: "x" }).ok, false);
  assert.equal(parseDropInput({ ...base, headline: "x".repeat(81) }).ok, false);
  assert.equal(parseDropInput({ ...base, durationMinutes: 0 }).ok, false);
  assert.equal(parseDropInput({ ...base, durationMinutes: 60 * 24 * 31 }).ok, false);
  assert.equal(parseDropInput({ ...base, durationMinutes: null }).ok, true);
  assert.equal(parseDropInput({ ...base, productId: "" }).ok, false);
  assert.equal(parseDropInput({ ...base, channelId: undefined }).ok, false);
  assert.equal(parseDropInput({ ...base, note: "x".repeat(501) }).ok, false);
});

test("emoji: one or two emoji-ish graphemes, never words", () => {
  assert.deepEqual(parseEmoji(""), { ok: true, value: "💬" });
  for (const e of ["🔥", "👍🏽", "🇵🇭", "❤️", "🔥🔥", "👨‍👩‍👧"]) assert.equal(parseEmoji(e).ok, true, e);
  for (const e of ["ab", "a", "1", "🔥a", "🔥🔥🔥", "x".repeat(20), "<b>", "😀😀😀😀😀"]) assert.equal(parseEmoji(e).ok, false, e);
});
test("picture URLs: hosted https or an inline image, nothing else (ownership is checked server-side)", () => {
  assert.deepEqual(parseImageUrl(null), { ok: true, value: null });
  assert.equal(parseImageUrl("https://ik.imagekit.io/a.png").ok, true);
  assert.equal(parseImageUrl("data:image/png;base64,AAAA").ok, true);
  for (const u of ["http://x.test/a.png", "javascript:alert(1)", "data:text/html;base64,AA", "ftp://x"]) {
    assert.equal(parseImageUrl(u).ok, false, u);
  }
});
test("default display name comes from the account name, never the email", () => {
  assert.equal(defaultDisplayName("  Ann   Cruz "), "Ann Cruz");
  assert.equal(defaultDisplayName("A"), "Member");
  assert.equal(defaultDisplayName(""), "Member");
  assert.equal(defaultDisplayName("x".repeat(41)), "Member");
});

// ── cursor ───────────────────────────────────────────────────────────────────
console.log("\ncursor");
test("page cursor round-trips", () => {
  const c = { createdAt: new Date("2026-09-01T00:00:00.123Z"), id: "msg_1" };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c);
});
test("poll cursor carries the time it was issued", () => {
  const c = { createdAt: new Date("2026-09-01T00:00:00Z"), id: "m", at: new Date("2026-09-01T00:05:00Z") };
  assert.deepEqual(decodePollCursor(encodePollCursor(c)), c);
});
test("junk cursors decode to null", () => {
  for (const raw of [null, "", "!!!", Buffer.from("nope").toString("base64url"), "x".repeat(400)]) {
    assert.equal(decodeCursor(raw), null, String(raw));
    assert.equal(decodePollCursor(raw), null, String(raw));
  }
});

// ── text ─────────────────────────────────────────────────────────────────────
console.log("\ntext");
test("search query: trimmed, collapsed, min 2, max 80", () => {
  assert.equal(normaliseSearchQuery("  bpc   157 "), "bpc 157");
  assert.equal(normaliseSearchQuery("a"), null);
  assert.equal(normaliseSearchQuery("   "), null);
  assert.equal(normaliseSearchQuery(null), null);
  assert.equal(normaliseSearchQuery("x".repeat(200))!.length, 80);
});
test("LIKE pattern escapes wildcards", () => {
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});
test("links: http(s) only, trailing punctuation trimmed, deduped", () => {
  assert.deepEqual(
    extractLinks("see https://a.test/x, and (http://b.test/y). again https://a.test/x! ftp://no javascript:alert(1)"),
    ["https://a.test/x", "http://b.test/y"],
  );
  assert.deepEqual(extractLinks(null), []);
  assert.deepEqual(extractLinks("no links"), []);
});
test("previews describe attachments without leaking file contents", () => {
  assert.equal(previewText({ kind: "text", body: "hello\nworld", deleted: false }), "hello world");
  assert.equal(previewText({ kind: "image", body: null, deleted: false }), "📷 Photo");
  assert.equal(previewText({ kind: "image", body: "look", deleted: false }), "📷 look");
  assert.equal(previewText({ kind: "video", body: null, deleted: false }), "🎬 Video");
  assert.equal(previewText({ kind: "video", body: "how to dose", deleted: false }), "🎬 how to dose");
  assert.equal(previewText({ kind: "file", body: null, fileName: "coa.pdf", deleted: false }), "📎 coa.pdf");
  assert.equal(previewText({ kind: "product", body: null, productName: "BPC-157", deleted: false }), "🛍 BPC-157");
  assert.equal(previewText({ kind: "drop", body: "Restock!", deleted: false }), "🔥 Restock!");
  assert.equal(previewText({ kind: "text", body: "gone", deleted: true }), "Message deleted");
  assert.ok(previewText({ kind: "text", body: "x".repeat(500), deleted: false }).length <= 120);
});
test("first name", () => {
  assert.equal(firstName("Ann Marie Cruz"), "Ann");
  assert.equal(firstName("  "), "Member");
});

// ── unread ───────────────────────────────────────────────────────────────────
console.log("\nunread");
test("baseline: the read marker, else the join time, else the beginning", () => {
  const read = new Date("2026-09-02");
  const joined = new Date("2026-09-01");
  assert.equal(readBaseline(read, joined), read);
  assert.equal(readBaseline(null, joined), joined);
  assert.equal(readBaseline(null, null).getTime(), 0);
  assert.equal(readBaseline(new Date("2026-08-01"), joined), joined, "never before joining");
});
test("read marker never moves backwards or into the future", () => {
  const cur = new Date("2026-09-29T09:00:00Z");
  assert.equal(nextReadMarker(cur, new Date("2026-09-29T08:00:00Z"), NOW), cur);
  assert.equal(nextReadMarker(cur, new Date("2026-09-29T09:30:00Z"), NOW)!.toISOString(), "2026-09-29T09:30:00.000Z");
  assert.equal(nextReadMarker(null, new Date("2030-01-01"), NOW), NOW);
  assert.equal(nextReadMarker(null, new Date("x"), NOW), null);
});
test("tab badge counts threads, not messages", () => {
  assert.equal(countUnreadChats([{ unread: 3 }, { unread: 0 }], [{ unread: 1 }]), 2);
  assert.equal(countUnreadChats([], []), 0);
});

// ── membership ───────────────────────────────────────────────────────────────
console.log("\nmembership");
test("membership resolves from role + member row", () => {
  assert.equal(membershipFor({ enabled: false, isModerator: true, status: null }), "none");
  assert.equal(membershipFor({ enabled: true, isModerator: true, status: null }), "moderator");
  assert.equal(membershipFor({ enabled: true, isModerator: false, status: "approved" }), "approved");
  assert.equal(membershipFor({ enabled: true, isModerator: false, status: "revoked" }), "revoked");
  assert.equal(membershipFor({ enabled: true, isModerator: false, status: null }), "pending");
  assert.equal(membershipFor({ enabled: true, isModerator: false, status: "weird" }), "pending");
});

// ── upload-kind ──────────────────────────────────────────────────────────────
console.log("\nupload-kind");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x2c, 0, 0, 0, 0xc8]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 0x64, 0, 0x96, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const TEXT = new TextEncoder().encode("name,qty\nbpc,2\n");
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0]);
test("images are recognised from their bytes, whatever the phone claims", () => {
  const r = classifyUpload({ name: "IMG_1.bin", declaredMime: "application/octet-stream", head: PNG, size: 1000 });
  assert.deepEqual(r, { ok: true, kind: "image", mime: "image/png", ext: "png" });
  const j = classifyUpload({ name: "", declaredMime: "", head: JPEG, size: 1000 });
  assert.ok(j.ok && j.kind === "image" && j.mime === "image/jpeg");
});
test("documents need a matching extension and matching bytes", () => {
  assert.deepEqual(classifyUpload({ name: "coa.PDF", declaredMime: "", head: PDF, size: 10 }), {
    ok: true,
    kind: "file",
    mime: "application/pdf",
    ext: "pdf",
  });
  assert.ok(classifyUpload({ name: "sheet.xlsx", declaredMime: "", head: ZIP, size: 10 }).ok);
  assert.ok(classifyUpload({ name: "old.doc", declaredMime: "", head: OLE, size: 10 }).ok);
  assert.ok(classifyUpload({ name: "list.csv", declaredMime: "text/csv", head: TEXT, size: 10 }).ok);
  assert.equal(classifyUpload({ name: "fake.pdf", declaredMime: "application/pdf", head: EXE, size: 10 }).ok, false);
  assert.equal(classifyUpload({ name: "virus.exe", declaredMime: "", head: EXE, size: 10 }).ok, false);
  assert.equal(classifyUpload({ name: "a.txt", declaredMime: "", head: EXE, size: 10 }).ok, false, "binary .txt");
  assert.equal(classifyUpload({ name: "page.html", declaredMime: "text/html", head: TEXT, size: 10 }).ok, false);
});
test("size limits: images 10 MB, documents 25 MB, empty refused", () => {
  assert.equal(classifyUpload({ name: "a.png", declaredMime: "", head: PNG, size: IMAGE_MAX_BYTES + 1 }).ok, false);
  assert.equal(classifyUpload({ name: "a.pdf", declaredMime: "", head: PDF, size: FILE_MAX_BYTES }).ok, true);
  assert.equal(classifyUpload({ name: "a.pdf", declaredMime: "", head: PDF, size: FILE_MAX_BYTES + 1 }).ok, false);
  assert.equal(classifyUpload({ name: "a.pdf", declaredMime: "", head: PDF, size: 0 }).ok, false);
});
test("image dimensions from PNG and JPEG headers", () => {
  assert.deepEqual(imageSize(PNG), { width: 300, height: 200 });
  assert.deepEqual(imageSize(JPEG), { width: 150, height: 100 });
  assert.equal(imageSize(PDF), null);
});

console.log("\nfile names");
test("file names lose control and bidi characters, keep real letters", () => {
  assert.equal(sanitizeFileName("rep\u202Efdp.exe", "pdf"), "repfdp.pdf");
  assert.equal(sanitizeFileName("a\u0000b\nc.pdf", "pdf"), "abc.pdf");
  assert.equal(sanitizeFileName("Résumé ñ.docx", "docx"), "Résumé ñ.docx");
  assert.equal(sanitizeFileName("../../etc/passwd", "txt"), "etcpasswd.txt");
  assert.equal(sanitizeFileName("\u200F\u2066", "png"), "file.png");
  assert.ok(sanitizeFileName("x".repeat(500), "pdf").length <= 124);
});
test("inline (no ImageKit) uploads are capped at 2 MB", () => {
  assert.equal(INLINE_MAX_BYTES, 2 * 1024 * 1024);
});

console.log("\njoin mode");
test("a community is open unless the store asks to review members", () => {
  assert.equal(communityJoinMode(undefined), "open");
  assert.equal(communityJoinMode({}), "open");
  assert.equal(communityJoinMode([]), "open");
  assert.equal(communityJoinMode({ communityJoin: "open" }), "open");
  assert.equal(communityJoinMode({ communityJoin: "APPROVAL" }), "open");
  assert.equal(communityJoinMode({ communityJoin: "approval" }), "approval");
  assert.equal(isJoinMode("approval"), true);
  assert.equal(isJoinMode("anyone"), false);
});

// ── resellers hub + welcome message ──────────────────────────────────────
console.log("\nresellers hub + welcome");
test("a hub is seen by every member; unknown or retired audiences fail closed", () => {
  const team: RuleActor = { key: STORE_KEY, isModerator: true, authorKey: "owner" };
  const plain: RuleActor = { key: "c:ann", isModerator: false, authorKey: null };
  const reseller: RuleActor = { ...plain, key: "c:rita", isVerifiedReseller: true };
  assert.equal(canSeeChannel(team, { audience: "hub" }), true);
  assert.equal(canSeeChannel(reseller, { audience: "hub" }), true);
  assert.equal(canSeeChannel(plain, { audience: "hub" }), true);
  assert.equal(canSeeChannel(plain, { audience: "everyone" }), true);
  assert.equal(canSeeChannel(plain, { audience: "resellers" }), false, "a leftover resellers-only channel stays hidden");
  assert.equal(canSeeChannel(reseller, { audience: "resellers" }), false);
  assert.equal(canSeeChannel(team, { audience: "resellers" }), true, "the team can still find and convert it");
  assert.equal(canSeeChannel(plain, { audience: "something-new" }), false, "an unknown audience fails closed");
});
test("hub: verified resellers post On hand, every member posts Looking for", () => {
  const team: RuleActor = { key: STORE_KEY, isModerator: true, isTeam: true, authorKey: "owner" };
  const admin: RuleActor = { key: "c:ada", isModerator: true, authorKey: null };
  const plain: RuleActor = { key: "c:ann", isModerator: false, authorKey: null };
  const reseller: RuleActor = { ...plain, key: "c:rita", isVerifiedReseller: true };
  const mutedReseller: RuleActor = { ...reseller, isMuted: true };
  const hub = { postRole: "everyone", audience: "hub" };
  const onHand = { isGeneral: true };
  const lookingFor = { isGeneral: false };
  assert.equal(canPostInTopic(reseller, hub, onHand), true);
  assert.equal(canPostInTopic(team, hub, onHand), true);
  assert.equal(canPostInTopic(admin, hub, onHand), true);
  assert.equal(canPostInTopic(plain, hub, onHand), false);
  assert.match(topicPostBlockedReason(plain, hub, onHand) ?? "", /verified resellers/i);
  assert.equal(canPostInTopic(plain, hub, lookingFor), true);
  assert.equal(canPostInTopic(reseller, hub, lookingFor), true);
  assert.equal(topicPostBlockedReason(plain, hub, lookingFor), null);
  assert.equal(canPostInTopic(mutedReseller, hub, onHand), false, "muted posts nothing, hub or not");
  assert.equal(canPostInTopic({ ...plain, isMuted: true }, hub, lookingFor), false);
  // Other channels keep the channel-wide rule.
  assert.equal(canPostInTopic(plain, { postRole: "admins", audience: "everyone" }, onHand), false);
  assert.equal(canPostInTopic(plain, { postRole: "everyone", audience: "everyone" }, onHand), true);
});
test("hub: only moderators add topics", () => {
  const team: RuleActor = { key: STORE_KEY, isModerator: true, isTeam: true, authorKey: "owner" };
  const plain: RuleActor = { key: "c:ann", isModerator: false, authorKey: null };
  const reseller: RuleActor = { ...plain, key: "c:rita", isVerifiedReseller: true };
  assert.equal(canAddTopic(team, { postRole: "everyone", audience: "hub" }), true);
  assert.equal(canAddTopic(reseller, { postRole: "everyone", audience: "hub" }), false);
  assert.equal(canAddTopic(plain, { postRole: "everyone", audience: "hub" }), false);
  assert.equal(canAddTopic(plain, { postRole: "everyone", audience: "everyone" }), true);
  assert.equal(canAddTopic(plain, { postRole: "admins", audience: "everyone" }), false);
});
test("hub: the two starter topics and their composer hints", () => {
  assert.equal(HUB_TOPICS.onHand.name, "On hand");
  assert.equal(HUB_TOPICS.lookingFor.name, "Looking for");
  assert.match(hubComposerHint({ audience: "hub" }, { isGeneral: true }) ?? "", /on hand/i);
  assert.match(hubComposerHint({ audience: "hub" }, { isGeneral: false }) ?? "", /looking for/i);
  assert.equal(hubComposerHint({ audience: "everyone" }, { isGeneral: true }), null);
});
const PHOTO = { kind: "image" as const, url: "https://ik.imagekit.io/x/tenant/a/p.jpg", name: "p.jpg", size: 900, mime: "image/jpeg", width: 800, height: 600, posterUrl: null };
const CLIP = { kind: "video" as const, url: "https://ik.imagekit.io/x/tenant/a/v.mp4", name: "v.mp4", size: 5000, mime: "video/mp4", width: 720, height: 1280, posterUrl: "https://ik.imagekit.io/x/tenant/a/v.mp4/ik-thumbnail.jpg" };

test("welcome config: off unless enabled with at least one message", () => {
  assert.deepEqual(communityWelcome(undefined), { enabled: false, messages: [], message: "" });
  assert.deepEqual(communityWelcome({ communityWelcome: { enabled: true, messages: [] } }), { enabled: false, messages: [], message: "" });
  const w = communityWelcome({ communityWelcome: { enabled: true, messages: [{ id: "a", text: " Hi! ", media: null }, { id: "b", text: "", media: PHOTO }] } });
  assert.equal(w.enabled, true);
  assert.deepEqual(w.messages, [{ id: "a", text: "Hi!", media: null }, { id: "b", text: "", media: PHOTO }]);
  assert.equal(w.message, "Hi!", "older app builds read the first text");
  assert.equal(communityWelcome({ communityWelcome: { enabled: "yes", messages: [{ id: "a", text: "Hi" }] } }).enabled, false);
});
test("welcome config: a store saved before lists reads as one text message", () => {
  assert.deepEqual(communityWelcome({ communityWelcome: { enabled: true, message: "  Hi!  " } }), {
    enabled: true,
    messages: [{ id: "w1", text: "Hi!", media: null }],
    message: "Hi!",
  });
  assert.deepEqual(communityWelcome({ communityWelcome: { enabled: true, message: "   " } }), { enabled: false, messages: [], message: "" });
});
test("welcome config: broken entries are dropped, never sent", () => {
  const w = communityWelcome({
    communityWelcome: {
      enabled: true,
      messages: [null, { text: "" }, { text: "", media: { kind: "audio", url: "x" } }, { id: "bad id!", text: "ok", media: { kind: "video", url: CLIP.url } }],
    },
  });
  assert.equal(w.messages.length, 1);
  assert.equal(w.messages[0].id, "w4", "an unusable id is replaced");
  assert.equal(w.messages[0].media?.kind, "video");
});
test("welcome input: list form — order kept, each needs text or media, bounded", () => {
  const r = parseWelcomeInput({ enabled: true, messages: [{ id: "a", text: " one ", media: null }, { text: "", media: { kind: "video", url: CLIP.url } }] });
  assert.deepEqual(r, { ok: true, value: { enabled: true, messages: [{ id: "a", text: "one", media: null }, { id: null, text: "", media: { kind: "video", url: CLIP.url } }] } });
  assert.equal(parseWelcomeInput({ enabled: true, messages: [] }).ok, false, "on with nothing to send");
  assert.equal(parseWelcomeInput({ enabled: false, messages: [] }).ok, true);
  assert.equal(parseWelcomeInput({ enabled: true, messages: [{ text: "  ", media: null }] }).ok, false);
  assert.equal(parseWelcomeInput({ enabled: true, messages: [{ text: "x".repeat(WELCOME_MAX + 1) }] }).ok, false);
  assert.equal(parseWelcomeInput({ enabled: true, messages: [{ text: "hi", media: { kind: "audio", url: "u" } }] }).ok, false);
  assert.equal(parseWelcomeInput({ enabled: true, messages: Array.from({ length: WELCOME_MAX_MESSAGES + 1 }, () => ({ text: "hi" })) }).ok, false);
  assert.equal(parseWelcomeInput({ enabled: "true", messages: [] }).ok, false);
  assert.equal(parseWelcomeInput(null).ok, false);
});
test("welcome input: an older build's { enabled, message } edits only the first message", () => {
  const current = communityWelcome({ communityWelcome: { enabled: true, messages: [{ id: "a", text: "old", media: PHOTO }, { id: "b", text: "second", media: null }] } });
  const r = parseWelcomeInput({ enabled: true, message: "new caption" }, current);
  assert.ok(r.ok);
  assert.deepEqual(r.value.messages, [
    { id: "a", text: "new caption", media: { kind: "image", url: PHOTO.url } },
    { id: "b", text: "second", media: null },
  ]);
  assert.deepEqual(parseWelcomeInput({ enabled: true, message: " Welcome 💜 " }), { ok: true, value: { enabled: true, messages: [{ id: null, text: "Welcome 💜", media: null }] } });
  assert.equal(parseWelcomeInput({ enabled: true, message: "  " }).ok, false);
});
test("welcome save: ids are made unique", () => {
  let n = 0;
  const saved = finalizeWelcome(true, [{ id: "a", text: "1", media: null }, { id: "a", text: "2", media: null }, { id: null, text: "3", media: null }], () => `n${++n}`);
  assert.deepEqual(saved.messages.map((m) => m.id), ["a", "n1", "n2"]);
  assert.equal(finalizeWelcome(true, [], () => "x").enabled, false);
});
test("welcome rows: one chat row per message, in order, with photo/video fields", () => {
  const w = communityWelcome({ communityWelcome: { enabled: true, messages: [{ id: "a", text: "Hi", media: null }, { id: "b", text: "Our shop", media: PHOTO }, { id: "c", text: "", media: CLIP }] } });
  const rows = welcomeRows(w, "cus1");
  assert.deepEqual(rows.map((r) => [r.kind, r.body, r.clientId]), [
    ["text", "Hi", "welcome:cus1"],
    ["image", "Our shop", "welcome:cus1:2"],
    ["video", null, "welcome:cus1:3"],
  ]);
  assert.equal(rows[1].imageUrl, PHOTO.url);
  assert.equal(rows[1].fileUrl, null);
  assert.deepEqual([rows[2].fileUrl, rows[2].fileMime, rows[2].imageWidth, rows[2].imageUrl], [CLIP.url, "video/mp4", 720, null]);
  assert.deepEqual(welcomeRows({ ...w, enabled: false }, "cus1"), []);
});
test("video poster: ImageKit makes a still frame, anything else has none", () => {
  assert.equal(videoPosterUrl("https://ik.imagekit.io/x/tenant/a/v.mp4"), "https://ik.imagekit.io/x/tenant/a/v.mp4/ik-thumbnail.jpg");
  assert.equal(videoPosterUrl("https://ik.imagekit.io/x/v.mp4?updatedAt=1"), "https://ik.imagekit.io/x/v.mp4/ik-thumbnail.jpg?updatedAt=1");
  assert.equal(videoPosterUrl("data:video/mp4;base64,AAAA"), null);
  assert.equal(videoPosterUrl("https://evil.example/ik.imagekit.io/v.mp4"), null);
  assert.equal(videoPosterUrl("http://ik.imagekit.io/x/v.mp4"), null);
});

const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x20, ...Array.from("ftyp" + brand, (c) => c.charCodeAt(0)), 0, 0, 0, 0]);
test("uploads: videos are sniffed from the bytes, and only the store team may send them", () => {
  assert.deepEqual(classifyUpload({ name: "clip.bin", declaredMime: "", head: ftyp("isom"), size: 1000, allowVideo: true }), { ok: true, kind: "video", mime: "video/mp4", ext: "mp4" });
  assert.deepEqual(classifyUpload({ name: "IMG_1.MOV", declaredMime: "", head: ftyp("qt  "), size: 1000, allowVideo: true }), { ok: true, kind: "video", mime: "video/quicktime", ext: "mov" });
  assert.equal(classifyUpload({ name: "x.webm", declaredMime: "", head: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), size: 10, allowVideo: true }).ok, true);
  assert.equal(classifyUpload({ name: "clip.mp4", declaredMime: "video/mp4", head: ftyp("isom"), size: 1000 }).ok, false, "members can't upload video");
  assert.equal(classifyUpload({ name: "big.mp4", declaredMime: "", head: ftyp("mp42"), size: VIDEO_MAX_BYTES + 1, allowVideo: true }).ok, false);
  const heic = classifyUpload({ name: "a.heic", declaredMime: "", head: ftyp("heic"), size: 1000, allowVideo: true });
  assert.ok(heic.ok && heic.kind === "image", "HEIC stays a photo");
  assert.equal(classifyUpload({ name: "song.m4a", declaredMime: "", head: ftyp("M4A "), size: 1000, allowVideo: true }).ok, false, "audio is not video");
});
test("direct video uploads: must be ours, in size, and really a video", () => {
  const ok = checkDirectVideo({ filePath: "/tenant/acme/community-v_x.mp4", folder: "/tenant/acme", size: 1000, head: ftyp("isom") });
  assert.deepEqual(ok, { ok: true, mime: "video/mp4", ext: "mp4" });
  const other = checkDirectVideo({ filePath: "/tenant/acme-2/v.mp4", folder: "/tenant/acme", size: 1000, head: ftyp("isom") });
  assert.deepEqual([other.ok, !other.ok && other.inFolder], [false, false], "another store's file is refused and never deleted");
  assert.equal(checkDirectVideo({ filePath: "/tenant/acme/../b/v.mp4", folder: "/tenant/acme", size: 1000, head: ftyp("isom") }).ok, false);
  const fake = checkDirectVideo({ filePath: "/tenant/acme/v.mp4", folder: "/tenant/acme", size: 1000, head: new Uint8Array([0x4d, 0x5a]) });
  assert.deepEqual([fake.ok, !fake.ok && fake.inFolder], [false, true], "ours but not a video → deleted");
  assert.equal(checkDirectVideo({ filePath: "/tenant/acme/v.mp4", folder: "/tenant/acme", size: VIDEO_MAX_BYTES + 1, head: ftyp("isom") }).ok, false);
});

// ── channel (topic) pushes + per-member channel mutes ──
const announcements = { name: "Announcements", emoji: "📣" };
test("topic push: names the channel and the sender, never the message", () => {
  const general = buildTopicPush({ storeName: "Mama Mica", channel: announcements, topic: { id: "t1", name: "General", isGeneral: true }, senderName: "Ana Reyes", fromStore: false });
  assert.deepEqual(general, { title: "📣 Announcements", body: "New message from Ana", data: { type: "topic", threadId: "t1" } });
  const sub = buildTopicPush({ storeName: "Mama Mica", channel: announcements, topic: { id: "t2", name: "Restocks", isGeneral: false }, senderName: "", fromStore: true });
  assert.equal(sub.body, "Mama Mica posted in Restocks", "the team posts as the store");
  assert.equal(sub.data.threadId, "t2");
  const bare = buildTopicPush({ storeName: "S", channel: { name: "Chat", emoji: "" }, topic: { id: "t3", name: "General", isGeneral: true }, senderName: "  ", fromStore: false });
  assert.equal(bare.title, "Chat");
  assert.equal(bare.body, "New message from Member");
});
test("topic push audience: everyone who can see it, minus the sender and anyone who muted the channel", () => {
  const ids = ["a", "b", "c", "d", "b"];
  assert.deepEqual(topicPushAudience(ids, { senderKey: "c:a", mutedKeys: new Set(["c:c"]) }), ["b", "d"]);
  assert.deepEqual(topicPushAudience(ids, { senderKey: "store", mutedKeys: new Set() }), ["a", "b", "c", "d"], "a store post reaches every member once");
  assert.deepEqual(topicPushAudience([], { senderKey: "store", mutedKeys: new Set() }), []);
});
test("mute request: only an explicit boolean is accepted", () => {
  assert.equal(parseMuteRequest({ muted: true }), true);
  assert.equal(parseMuteRequest({ muted: false }), false);
  assert.equal(parseMuteRequest({ muted: "true" }), null);
  assert.equal(parseMuteRequest({}), null);
  assert.equal(parseMuteRequest(null), null);
});

// ── preview access (not approved yet, the store's preview on) ──
console.log("\npreview access");
const POLICY = { ...DEFAULT_PREVIEW_POLICY, enabled: true };
const viewer: RuleActor = { key: "c:new", isModerator: false, authorKey: null, preview: POLICY };
const fullMember: RuleActor = { key: "c:ann", isModerator: false, authorKey: null };
const ch = (previewAccess: string | null, extra: Record<string, string> = {}) => ({ audience: "everyone", postRole: "everyone", previewAccess, ...extra });
test("preview: the policy reads leniently and defaults to browse only, off", () => {
  assert.deepEqual(previewPolicyOf(null), DEFAULT_PREVIEW_POLICY);
  assert.equal(DEFAULT_PREVIEW_POLICY.enabled, false, "other stores are unchanged until they switch it on");
  assert.deepEqual(previewPolicyOf({ previewAccess: { enabled: true, placeOrders: "yes" } }), { ...DEFAULT_PREVIEW_POLICY, enabled: true });
  assert.equal(channelPreviewAccess(undefined), "locked");
  assert.equal(channelPreviewAccess("chat"), "chat");
  assert.equal(channelPreviewAccess("everything"), "locked", "an unknown setting fails closed");
});
test("preview: updates merge booleans only, and refuse unknown settings", () => {
  const r = parsePreviewPolicyUpdate({ placeOrders: true }, POLICY);
  assert.equal(r.ok && r.value.placeOrders, true);
  assert.equal(r.ok && r.value.enabled, true, "untouched settings stay");
  assert.equal(parsePreviewPolicyUpdate({ placeOrders: "true" }, POLICY).ok, false);
  assert.equal(parsePreviewPolicyUpdate({ isAdmin: true }, POLICY).ok, false);
  assert.equal(parsePreviewPolicyUpdate(null, POLICY).ok, false);
});
test("preview: only non-approved customers of a store with preview on are in it", () => {
  assert.equal(previewFor(POLICY, "pending"), POLICY);
  assert.equal(previewFor(POLICY, "rejected"), POLICY);
  assert.equal(previewFor(POLICY, "approved"), null);
  assert.equal(previewFor(DEFAULT_PREVIEW_POLICY, "pending"), null, "preview off: as before");
});
test("preview: channels are hidden, locked (listed only), read or chat", () => {
  assert.equal(canListChannel(viewer, ch("hidden")), false);
  assert.equal(canSeeChannel(viewer, ch("hidden")), false);
  assert.equal(canListChannel(viewer, ch("locked")), true);
  assert.equal(canSeeChannel(viewer, ch("locked")), false, "locked never opens");
  assert.equal(isChannelLocked(viewer, ch("locked")), true);
  assert.equal(canSeeChannel(viewer, ch(null)), false, "unset = locked");
  assert.equal(canSeeChannel(viewer, ch("read")), true);
  assert.equal(canSeeChannel(viewer, ch("chat")), true);
  assert.equal(canSeeChannel(viewer, { audience: "resellers", previewAccess: "chat" }), false, "an unknown audience still fails closed");
  assert.equal(canListChannel(viewer, { audience: "resellers", previewAccess: "locked" }), false);
  assert.equal(canSeeChannel(fullMember, ch("hidden")), true, "members ignore the preview setting");
  assert.equal(isChannelLocked(fullMember, ch("locked")), false);
});
test("preview: post only in chat channels, never start topics, channel rules still apply", () => {
  assert.equal(topicPostBlockedReason(viewer, ch("read"), { isGeneral: true }), PREVIEW_LOCKED_MESSAGE);
  assert.equal(topicPostBlockedReason(viewer, ch("chat"), { isGeneral: true }), null);
  assert.equal(canPostInTopic(viewer, ch("chat", { postRole: "admins" }), { isGeneral: true }), false, "an announcements channel stays team-only");
  assert.equal(canPostInTopic(viewer, ch("chat", { audience: "hub" }), { isGeneral: true }), false, "hub On hand stays resellers-only");
  assert.equal(canPostInTopic({ ...viewer, isMuted: true }, ch("chat"), { isGeneral: true }), false);
  assert.equal(canAddTopic(viewer, ch("chat")), false);
});
test("preview: DMs reach the store only, and only when the store allows it", () => {
  assert.equal(dmBlockedReason(viewer, { key: STORE_KEY, approved: true }), PREVIEW_LOCKED_MESSAGE);
  const canDm: RuleActor = { ...viewer, preview: { ...POLICY, messageStore: true } };
  assert.equal(dmBlockedReason(canDm, { key: STORE_KEY, approved: true }), null);
  assert.equal(dmBlockedReason(canDm, { key: "c:ann", approved: true }), PREVIEW_LOCKED_MESSAGE, "never other members");
  assert.equal(dmPostBlocked(viewer, { key: STORE_KEY, open: true }), PREVIEW_LOCKED_MESSAGE);
  assert.equal(dmPostBlocked(canDm, { key: STORE_KEY, open: true }), null);
  assert.equal(dmPostBlocked(canDm, { key: "c:ann", open: true }), PREVIEW_LOCKED_MESSAGE);
});
test("preview: orders need the switch for each kind of line", () => {
  assert.equal(previewOrderBlocked(POLICY, false, true), true, "browse only: no on-hand order");
  assert.equal(previewOrderBlocked(POLICY, true, false), true, "browse only: no group buy");
  const gbOnly = { ...POLICY, joinGroupBuys: true };
  assert.equal(previewOrderBlocked(gbOnly, true, false), false);
  assert.equal(previewOrderBlocked(gbOnly, true, true), true, "a mixed cart needs both");
  assert.equal(previewOrderBlocked({ ...POLICY, placeOrders: true }, false, true), false);
  assert.equal(previewCanOrder(POLICY), false);
  assert.equal(previewCanOrder(gbOnly), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
