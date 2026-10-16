// Unit tests for the community app's pure helpers (mobile/src/features/community/lib).
// Run from the repo root:  npx tsx mobile/scripts/test-community-lib.ts
import assert from "node:assert/strict";
import type { CommunityMessage, MessagesResponse, Participant, ThreadInfo } from "../../src/lib/mobile/contract";
import { access } from "./community-test-access";
import { communityAccess } from "../src/features/community/lib/access";

import { attachmentLabel, bubbleImageSize, imageFileName, imageMimeFor, videoFileName, videoMimeFor } from "../src/features/community/lib/attachments";
import {
  WELCOME_MAX_MESSAGES,
  draftsFromWelcome,
  itemProblem,
  itemSummary,
  moveItem,
  removeItem,
  toWelcomeRequest,
  upsertItem,
  welcomeCardLine,
  welcomeProblem,
  type DraftItem,
} from "../src/features/community/lib/welcome";
import { hueFromString, mix, parseHex, withAlpha } from "../src/features/community/lib/color";
import { applySavedReply, formPhotosProblem, matchSavedReplies, photoLabel, saveAsReplyFrom, savedReplySummary, shortcutQuery, toSavedReplyRequest } from "../src/features/community/lib/savedReplies";
import { docMimeFor, fileTypeLabel, formatBytes } from "../src/features/community/lib/documents";
import { formatCountdown, formatRelative, initials, pluralize, splitCountdown } from "../src/features/community/lib/format";
import { buildThreadRows, RUN_WINDOW_MS } from "../src/features/community/lib/grouping";
import { buildChatRows, channelTarget, matchChatsByName, unreadIn } from "../src/features/community/lib/inbox";
import {
  addOptimistic,
  appendOlder,
  fromFirstPage,
  makeOptimistic,
  markDeleted,
  mergePoll,
  newClientId,
  newestConfirmed,
  patchOptimistic,
  removeOptimistic,
  replaceMessage,
  resolveOptimistic,
  restoreDraft,
} from "../src/features/community/lib/messages";
import { parseStoredView, startView, viewKey } from "../src/features/community/lib/viewMode";
import { pushTarget, resolvePushRoute, type PushAccess } from "../src/features/community/lib/pushTarget";
import {
  focusIndexFor,
  hitIdsKey,
  hitText,
  isSearchable,
  normalizeQuery,
  snippetAround,
  splitMatches,
  stepMatch,
} from "../src/features/community/lib/search";
import { chunk, extractLinks, monthSections, splitLinks } from "../src/features/community/lib/shared";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`✗ ${name}\n    ${e instanceof Error ? e.message.split("\n").join("\n    ") : String(e)}`);
  }
}

// ── fixtures ──
const ana: Participant = { key: "c:ana", name: "Ana Reyes", avatarHue: 20, imageUrl: null, isTeam: false };
const store: Participant = { key: "store", name: "HP Glow", avatarHue: 200, imageUrl: null, isTeam: true };
const thread: ThreadInfo = {
  type: "topic", id: "t1", title: "General", subtitle: "", emoji: "💬", imageUrl: null, peer: null,
  channelId: "ch1", canPost: true, postBlockedReason: null, canManage: false,
};
let seq = 0;
function msg(over: Partial<CommunityMessage> = {}): CommunityMessage {
  seq += 1;
  return {
    id: `m${seq}`, threadId: "t1", threadType: "topic", sender: ana, authorName: null, mine: false, clientId: null, kind: "text",
    body: `hello ${seq}`, product: null, protocol: null, image: null, video: null, file: null, drop: null, order: null, groupBuy: null, replyTo: null,
    createdAt: new Date(Date.UTC(2026, 8, 29, 10, 0, seq)).toISOString(), editedAt: null, deletedAt: null,
    canEdit: false, canDelete: false, ...over,
  };
}
const page = (messages: CommunityMessage[], over: Partial<MessagesResponse> = {}): MessagesResponse => ({
  thread, messages, olderCursor: null, pollCursor: "p1", changed: [], ...over,
});

// ── grouping ──
test("grouping: consecutive messages from one sender form a run", () => {
  const t0 = Date.UTC(2026, 8, 29, 10, 0, 0);
  const older = msg({ createdAt: new Date(t0).toISOString() });
  const newer = msg({ createdAt: new Date(t0 + 60_000).toISOString() });
  const rows = buildThreadRows([newer, older]);
  assert.equal(rows.length, 3); // two messages + one day pill
  assert.deepEqual(rows.map((r) => r.type), ["message", "message", "day"]);
  const [n, o] = rows as Extract<(typeof rows)[number], { type: "message" }>[];
  assert.equal(n.startsGroup, false);
  assert.equal(n.endsGroup, true);
  assert.equal(o.startsGroup, true);
  assert.equal(o.endsGroup, false);
});
test("grouping: a new sender, a gap past the window, or a drop breaks the run", () => {
  const t0 = Date.UTC(2026, 8, 29, 10, 0, 0);
  const a = msg({ createdAt: new Date(t0).toISOString() });
  const b = msg({ createdAt: new Date(t0 + RUN_WINDOW_MS + 1).toISOString() });
  const c = msg({ sender: store, createdAt: new Date(t0 + RUN_WINDOW_MS + 2).toISOString() });
  const rows = buildThreadRows([c, b, a]).filter((r) => r.type === "message");
  assert.ok(rows.every((r) => r.type === "message" && r.startsGroup && r.endsGroup));
  const drop = msg({ kind: "drop", createdAt: new Date(t0 + 1000).toISOString() });
  const dropRows = buildThreadRows([drop, a]).filter((r) => r.type === "message");
  assert.ok(dropRows.every((r) => r.type === "message" && r.startsGroup && r.endsGroup));
});
test("grouping: a day pill sits after the oldest message of each day", () => {
  const d1 = msg({ createdAt: "2026-09-27T10:00:00+08:00" });
  const d2 = msg({ createdAt: "2026-09-28T12:00:00+08:00" });
  const rows = buildThreadRows([d2, d1]);
  assert.deepEqual(rows.map((r) => r.type), ["message", "day", "message", "day"]);
});

// ── search ──
test("search: splitMatches marks every case-insensitive hit and escapes regex", () => {
  assert.deepEqual(splitMatches("Tirz and tirz", "TIRZ"), [
    { text: "Tirz", match: true }, { text: " and ", match: false }, { text: "tirz", match: true },
  ]);
  assert.deepEqual(splitMatches("a.b", "."), [{ text: "a", match: false }, { text: ".", match: true }, { text: "b", match: false }]);
  assert.deepEqual(splitMatches("x", ""), [{ text: "x", match: false }]);
});
test("search: snippetAround trims around the match with ellipses", () => {
  const long = `${"a ".repeat(60)}NEEDLE${" b".repeat(60)}`;
  const s = snippetAround(long, "needle", 10);
  assert.ok(s.startsWith("…") && s.endsWith("…") && s.includes("NEEDLE"));
  assert.equal(snippetAround("short  text", "x"), "short text");
});
test("search: stepMatch clamps and handles empty", () => {
  assert.equal(stepMatch(0, 0, "older"), -1);
  assert.equal(stepMatch(0, 3, "older"), 1);
  assert.equal(stepMatch(2, 3, "older"), 2);
  assert.equal(stepMatch(0, 3, "newer"), 0);
});
test("search: query normalisation and hit text", () => {
  assert.equal(normalizeQuery("  bpc   157 "), "bpc 157");
  assert.equal(isSearchable(" a "), false);
  assert.equal(isSearchable("ab"), true);
  assert.equal(hitText({ body: null, file: { url: "", name: "Guide.pdf", size: 1, mime: "application/pdf" } }, "guide"), "📄 Guide.pdf");
  assert.equal(hitText({ body: "the guide", file: null }, "guide"), "the guide");
});

// ── links / month sections ──
test("links: splitLinks finds http and www links, trims trailing punctuation", () => {
  const segs = splitLinks("See www.example.com/a, and https://x.io.");
  assert.deepEqual(segs, [
    { text: "See " }, { text: "www.example.com/a", url: "https://www.example.com/a" },
    { text: ", and " }, { text: "https://x.io", url: "https://x.io" }, { text: "." },
  ]);
  assert.deepEqual(splitLinks("no links"), [{ text: "no links" }]);
});
test("links: extractLinks dedupes and reads the host", () => {
  assert.deepEqual(extractLinks("https://www.Shop.com/x https://www.Shop.com/x http://b.io"), [
    { url: "https://www.Shop.com/x", host: "shop.com" }, { url: "http://b.io", host: "b.io" },
  ]);
  assert.deepEqual(extractLinks(null), []);
});
test("monthSections: this month, then month names, then with year", () => {
  const now = Date.UTC(2026, 8, 20);
  const items = [
    { createdAt: "2026-09-10T00:00:00Z" }, { createdAt: "2026-09-02T00:00:00Z" },
    { createdAt: "2026-08-15T00:00:00Z" }, { createdAt: "2025-12-01T12:00:00Z" },
  ];
  const s = monthSections(items, now);
  assert.deepEqual(s.map((x) => [x.title, x.data.length]), [["This month", 2], ["August", 1], ["December 2025", 1]]);
  assert.deepEqual(chunk([1, 2, 3, 4], 3), [[1, 2, 3], [4]]);
});

// ── attachments / files ──
test("bubbleImageSize keeps the ratio, caps tall photos, falls back", () => {
  assert.deepEqual(bubbleImageSize(1000, 500, 240), { width: 240, height: 120 });
  assert.deepEqual(bubbleImageSize(500, 2000, 240), { width: 240, height: 320 });
  assert.deepEqual(bubbleImageSize(null, null, 240), { width: 240, height: 180 });
});
test("file labels, sizes and mime detection", () => {
  assert.equal(fileTypeLabel("application/pdf", "x"), "PDF");
  assert.equal(fileTypeLabel(null, "report.XLSX"), "XLSX");
  assert.equal(fileTypeLabel(null, "noext"), "FILE");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatBytes(null), "");
  assert.equal(docMimeFor(null, "a.csv"), "text/csv");
  assert.equal(docMimeFor("application/zip", "a.zip"), null);
  assert.equal(imageMimeFor(null, "IMG.HEIC"), "image/heic");
  assert.equal(imageFileName("image/png", null, 5), "photo-5.png");
  assert.equal(attachmentLabel("text"), null);
  assert.equal(attachmentLabel("file"), "📄 Document");
  assert.equal(attachmentLabel("video"), "🎬 Video");
});

// ── optimistic merge reducer ──
function optimistic(clientId: string, body: string | null, extra: Partial<Parameters<typeof makeOptimistic>[0]> = {}) {
  return makeOptimistic({
    clientId, threadType: "topic", threadId: "t1", sender: ana, body, replyTo: null,
    now: new Date(Date.UTC(2026, 8, 29, 11)).toISOString(), ...extra,
  });
}
test("reducer: first page sorts newest first; older pages append without duplicates", () => {
  const a = msg(); const b = msg(); const c = msg();
  const s = fromFirstPage(page([b, c], { olderCursor: "o1" }));
  assert.deepEqual(s.messages.map((m) => m.id), [c.id, b.id]);
  const s2 = appendOlder(s, page([b, a], { olderCursor: null }));
  assert.deepEqual(s2.messages.map((m) => m.id), [c.id, b.id, a.id]);
  assert.equal(s2.olderCursor, null);
  assert.equal(s.messages.length, 2, "input state is not mutated");
});
test("reducer: poll merges new messages and applies changed ones", () => {
  const a = msg(); const b = msg();
  const s = fromFirstPage(page([a, b]));
  const edited = { ...a, body: "edited", editedAt: new Date().toISOString() };
  const fresh = msg();
  const ghost = msg(); // changed but never loaded here → ignored
  const s2 = mergePoll(s, page([fresh], { changed: [edited, ghost], pollCursor: "p2" }));
  assert.equal(s2.pollCursor, "p2");
  assert.equal(s2.messages[0].id, fresh.id);
  assert.equal(s2.messages.find((m) => m.id === a.id)?.body, "edited");
  assert.equal(s2.messages.some((m) => m.id === ghost.id), false);
  assert.equal(s2.messages.length, 3);
});
test("reducer: pending sends stay on top, and a poll echo replaces them (heuristic)", () => {
  const a = msg();
  let s = fromFirstPage(page([a]));
  s = addOptimistic(s, optimistic("c1", "hi there"));
  assert.equal(s.messages[0].pending, true);
  const echo = msg({ mine: true, body: "hi there" });
  s = mergePoll(s, page([echo]));
  assert.equal(s.messages.filter((m) => m.pending).length, 0);
  assert.equal(s.messages.filter((m) => m.body === "hi there").length, 1);
  assert.equal(s.messages[0].clientId, "c1", "keeps the clientId on the confirmed row");
});
test("reducer: a poll echo with an explicit clientId only replaces that send", () => {
  let s = fromFirstPage(page([]));
  s = addOptimistic(s, optimistic("c1", "same"));
  s = addOptimistic(s, optimistic("c2", "same"));
  const echo = { ...msg({ mine: true, body: "same" }), clientId: "c2" } as CommunityMessage;
  s = mergePoll(s, page([echo]));
  assert.deepEqual(s.messages.filter((m) => m.pending).map((m) => m.clientId), ["c1"]);
});
test("reducer: someone else's identical text never swallows my pending send", () => {
  let s = fromFirstPage(page([]));
  s = addOptimistic(s, optimistic("c1", "ok"));
  s = mergePoll(s, page([msg({ mine: false, body: "ok" })]));
  assert.equal(s.messages.filter((m) => m.pending).length, 1);
  assert.equal(s.messages.length, 2);
});
test("reducer: resolveOptimistic swaps in the server row, or dedupes after a poll won", () => {
  let s = fromFirstPage(page([]));
  s = addOptimistic(s, optimistic("c1", "yo"));
  const server = msg({ mine: true, body: "yo" });
  const resolved = resolveOptimistic(s, "c1", server);
  assert.deepEqual(resolved.messages.map((m) => [m.id, !!m.pending]), [[server.id, false]]);
  const polled = mergePoll(s, page([server]));
  const again = resolveOptimistic(polled, "c1", server);
  assert.equal(again.messages.length, 1);
});
test("reducer: patch, remove, delete and newestConfirmed", () => {
  const a = msg();
  let s = fromFirstPage(page([a]));
  s = addOptimistic(s, optimistic("c9", null, { image: { uri: "file:///x.jpg", width: 10, height: 20 } }));
  assert.equal(s.messages[0].kind, "image");
  assert.equal(s.messages[0].localUri, "file:///x.jpg");
  s = patchOptimistic(s, "c9", { body: "caption" });
  assert.equal(s.messages[0].body, "caption");
  assert.equal(newestConfirmed(s.messages)?.id, a.id);
  s = removeOptimistic(s, "c9");
  assert.equal(s.messages.length, 1);
  s = markDeleted(s, a.id, "2026-09-29T12:00:00Z");
  assert.equal(s.messages[0].deletedAt, "2026-09-29T12:00:00Z");
  assert.equal(s.messages[0].body, null);
  assert.notEqual(newClientId(1, () => 0.5), newClientId(2, () => 0.5));
});

// ── inbox / access / push ──
test("inbox: folders, DM hiding, name search, unread count, channel target", () => {
  const ch = (id: string, postRole: "everyone" | "admins", unread: number, last: string) => ({
    id, name: `Chan ${id}`, description: null, emoji: "💬", imageUrl: null, postRole, audience: "everyone" as const, sortOrder: 0, topicCount: 1,
    generalTopicId: `g-${id}`, lastMessageAt: last, preview: null, previewTopic: null, unread, canPost: true, canManage: false,
  });
  const dm = (id: string, count: number, unread: number, last: string) => ({
    id, peer: { ...ana, name: `Peer ${id}` }, lastMessageAt: last, messageCount: count, preview: null, unread,
  });
  const inbox = {
    channels: [ch("a", "everyone", 0, "2026-09-01T00:00:00Z"), ch("b", "admins", 2, "2026-09-03T00:00:00Z")],
    conversations: [dm("x", 3, 1, "2026-09-02T00:00:00Z"), dm("empty", 0, 0, "2026-09-04T00:00:00Z")],
  };
  const ids = (rows: ReturnType<typeof buildChatRows>) => rows.map((r) => (r.kind === "channel" ? r.channel.id : r.conversation.id));
  assert.deepEqual(ids(buildChatRows(inbox, "all")), ["b", "x", "a"]);
  assert.deepEqual(ids(buildChatRows(inbox, "unread")), ["b", "x"]);
  assert.deepEqual(ids(buildChatRows(inbox, "direct")), ["x"]);
  assert.deepEqual(ids(buildChatRows(inbox, "groups")), ["a"]);
  assert.deepEqual(ids(buildChatRows(inbox, "announcements")), ["b"]);
  assert.deepEqual(ids(matchChatsByName(inbox, "peer")), ["empty", "x"]);
  assert.equal(unreadIn(inbox), 2);
  assert.deepEqual(channelTarget({ id: "c", topicCount: 1, generalTopicId: "g" }), { screen: "topic", id: "g" });
  assert.deepEqual(channelTarget({ id: "c", topicCount: 3, generalTopicId: "g" }), { screen: "channel", id: "c" });
});
test("access: tabs and membership cards per mode", access);
test("push: routes orders, DMs and drops; rejects junk", () => {
  assert.deepEqual(pushTarget({ type: "order", orderId: "o_1" }), { screen: "order", id: "o_1" });
  assert.deepEqual(pushTarget({ type: "dm", threadId: "d1" }), { screen: "dm", id: "d1" });
  assert.deepEqual(pushTarget({ type: "drop", threadId: "t1" }), { screen: "topic", id: "t1" });
  assert.equal(pushTarget({ type: "dm", threadId: "../x" }), null);
  assert.equal(pushTarget({ type: "other", threadId: "t1" }), null);
  assert.equal(pushTarget(null), null);
});
test("push: a safety-bot alert opens the review queue for moderators only", () => {
  assert.deepEqual(pushTarget({ type: "safety" }), { screen: "safety" });
  const mod: PushAccess = { mode: "admin", canOrders: false, inCommunity: true };
  const member: PushAccess = { mode: "customer", canOrders: false, inCommunity: true };
  assert.deepEqual(resolvePushRoute({ screen: "safety" }, mod), { pathname: "/community/safety", method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "safety" }, member), { pathname: "/community", method: "navigate" });
});

test("reducer: the server's clientId wins over the local one", () => {
  let s = fromFirstPage(page([]));
  s = addOptimistic(s, optimistic("c1", "hey"));
  const echo = { ...msg({ mine: true, body: "hey" }), clientId: "c1" } as CommunityMessage;
  s = mergePoll(s, page([echo]));
  assert.equal(s.messages[0].clientId, "c1");
  // A later poll re-sends the row with a different echo: the server value is kept.
  const again = { ...echo, clientId: "server-c" } as CommunityMessage;
  s = mergePoll(s, page([again]));
  assert.equal(s.messages[0].clientId, "server-c");
  // Server row without an echo keeps what we had.
  s = replaceMessage(s, { ...echo, clientId: null, body: "edited" });
  assert.equal(s.messages[0].clientId, "server-c");
  assert.equal(s.messages[0].body, "edited");
  // resolveOptimistic prefers the server's echo too.
  let t = addOptimistic(fromFirstPage(page([])), optimistic("c7", "x"));
  t = resolveOptimistic(t, "c7", { ...msg({ mine: true, body: "x" }), clientId: "c7-srv" } as CommunityMessage);
  assert.equal(t.messages[0].clientId, "c7-srv");
});
test("restoreDraft: puts failed text back unless something new was typed", () => {
  assert.equal(restoreDraft("", "lost message"), "lost message");
  assert.equal(restoreDraft("   ", "lost message"), "lost message");
  assert.equal(restoreDraft("newer", "lost message"), "newer");
});
test("search focus: resets only when hit ids change; lands on the wanted hit", () => {
  assert.equal(hitIdsKey(["a", "b"]), hitIdsKey(["a", "b"]));
  assert.notEqual(hitIdsKey(["a", "b"]), hitIdsKey(["b", "a"]));
  assert.equal(focusIndexFor(["a", "b", "c"], "c"), 2);
  assert.equal(focusIndexFor(["a", "b"], "zz"), 0);
  assert.equal(focusIndexFor([], null), 0);
});
test("push routes respect mode and access, falling back to the mode's home", () => {
  const admin: PushAccess = { mode: "admin", canOrders: true, inCommunity: true };
  const staffNoOrders: PushAccess = { mode: "admin", canOrders: false, inCommunity: false };
  const member: PushAccess = { mode: "customer", canOrders: false, inCommunity: true };
  const pending: PushAccess = { mode: "customer", canOrders: false, inCommunity: false };
  assert.deepEqual(resolvePushRoute({ screen: "order", id: "o1" }, admin), { pathname: "/order/[id]", params: { id: "o1" }, method: "push" });
  assert.deepEqual(resolvePushRoute({ screen: "order", id: "o1" }, staffNoOrders), { pathname: "/", method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "order", id: "o1" }, member), { pathname: "/community", method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "dm", id: "d1" }, member), { pathname: "/community/dm/[id]", params: { id: "d1" }, method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "topic", id: "t1" }, admin), { pathname: "/community/topic/[id]", params: { id: "t1" }, method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "dm", id: "d1" }, pending), { pathname: "/me", method: "navigate" });
  assert.deepEqual(resolvePushRoute({ screen: "dm", id: "d1" }, staffNoOrders), { pathname: "/", method: "navigate" });
  assert.equal(resolvePushRoute(null, admin), null);
});

test("order-bot push: buyers in the community land in the store chat, others on their order", () => {
  const admin: PushAccess = { mode: "admin", canOrders: true, inCommunity: true };
  const member: PushAccess = { mode: "customer", canOrders: false, inCommunity: true };
  const pending: PushAccess = { mode: "customer", canOrders: false, inCommunity: false };
  const t = pushTarget({ type: "order_update", threadId: "d1", orderNumber: "PW-1042" });
  assert.deepEqual(t, { screen: "order_update", threadId: "d1", orderNumber: "PW-1042" });
  assert.deepEqual(resolvePushRoute(t, member), { pathname: "/community/dm/[id]", params: { id: "d1" }, method: "navigate" });
  assert.deepEqual(resolvePushRoute(t, pending), { pathname: "/my-order/[number]", params: { number: "PW-1042" }, method: "push" });
  assert.deepEqual(resolvePushRoute(t, admin), { pathname: "/", method: "navigate" });
  // A malformed order number is dropped, never routed.
  const bad = pushTarget({ type: "order_update", threadId: "d1", orderNumber: "../../x" });
  assert.deepEqual(resolvePushRoute(bad, pending), { pathname: "/me", method: "navigate" });
});
test("grouping: an order-bot update stands alone, like a drop", () => {
  const rows = buildThreadRows([msg({ sender: store }), msg({ sender: store, kind: "order" }), msg({ sender: store })]);
  const flags = rows.filter((r) => r.type === "message").map((r) => (r.type === "message" ? [r.startsGroup, r.endsGroup] : []));
  assert.deepEqual(flags[1], [true, true]);
});

// ── format / colour ──
test("format: relative times, countdowns, initials, plural", () => {
  const now = Date.UTC(2026, 8, 29, 12);
  assert.equal(formatRelative(new Date(now - 30_000).toISOString(), now), "now");
  assert.equal(formatRelative(new Date(now - 5 * 60_000).toISOString(), now), "5m");
  assert.equal(formatRelative(new Date(now - 3 * 3_600_000).toISOString(), now), "3h");
  assert.equal(formatRelative(new Date(now - 30 * 3_600_000).toISOString(), now), "Yesterday");
  assert.equal(formatRelative(null, now), "");
  assert.equal(formatCountdown(new Date(now + 26 * 3_600_000).toISOString(), now), "1d 2h");
  assert.equal(formatCountdown(new Date(now - 1).toISOString(), now), null);
  assert.deepEqual(splitCountdown(new Date(now + 3_725_000).toISOString(), now), { days: 0, hours: "01", minutes: "02", seconds: "05" });
  assert.equal(initials("Ana Maria Reyes"), "AR");
  assert.equal(initials(""), "?");
  assert.equal(pluralize(1, "topic"), "1 topic");
});
test("colour: hex parsing, mixing and alpha", () => {
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.equal(parseHex("nope"), null);
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
  assert.equal(mix("#2E5C46", "#FFFFFF", 0), "#2E5C46");
  assert.equal(withAlpha("#FF0000", 0.5), "rgba(255,0,0,0.5)");
  assert.equal(hueFromString("abc"), hueFromString("abc"));
});

test("access: a /me from an older server (no community) means community off, never a crash", () => {
  for (const mode of ["admin", "customer"] as const) {
    const a = communityAccess({ mode });
    assert.equal(a.inCommunity, false);
    assert.equal(a.adminChatsTab, false);
    assert.equal(a.customerChatsTab, false);
  }
  assert.equal(communityAccess({ mode: "customer", community: null }).membershipCard, "none");
});

test("view mode: only a moderating admin may open in the community view", () => {
  const cm = (over: Partial<Parameters<typeof communityAccess>[0]["community"] & object> = {}) => ({
    enabled: true, membership: "moderator" as const, rejectionReason: null, isModerator: true, myKey: null, profile: null, pendingApplications: 0, joinMode: "open" as const, ...over,
  });
  const mod = communityAccess({ mode: "admin", community: cm() });
  assert.equal(startView("community", mod), "community");
  assert.equal(startView("business", mod), "business");
  assert.equal(startView(null, mod), "business");
  // The community was switched off, or this staff lost the module: back to business.
  assert.equal(startView("community", communityAccess({ mode: "admin", community: cm({ enabled: false }) })), "business");
  assert.equal(startView("community", communityAccess({ mode: "admin", community: cm({ isModerator: false, membership: "none" }) })), "business");
  // Customers never have a business view to switch from.
  assert.equal(startView("community", communityAccess({ mode: "customer", community: cm({ membership: "approved", isModerator: false }) })), "business");
});
test("view mode: stored values are parsed defensively and keyed per signed-in scope", () => {
  assert.equal(parseStoredView("community"), "community");
  assert.equal(parseStoredView("business"), "business");
  assert.equal(parseStoredView("admin"), null);
  assert.equal(parseStoredView(null), null);
  assert.notEqual(viewKey("a:admin:x@y.z"), viewKey("b:admin:x@y.z"));
});

test("videos: type from the picker or the name, MP4 when unsure", () => {
  assert.equal(videoMimeFor("video/quicktime", "IMG_1.MOV"), "video/quicktime");
  assert.equal(videoMimeFor(null, "clip.webm"), "video/webm");
  assert.equal(videoMimeFor("", ""), "video/mp4");
  assert.equal(videoFileName("video/quicktime", null, 7), "video-7.mov");
  assert.equal(videoFileName("video/mp4", " shop tour.mp4 "), "shop tour.mp4");
});

const saved = {
  enabled: true,
  message: "Hi!",
  messages: [
    { id: "a", text: "Hi!", media: null },
    { id: "b", text: "", media: { kind: "image" as const, url: "https://ik.imagekit.io/x/p.jpg", name: "p.jpg", size: 9, mime: "image/jpeg", width: 4, height: 3, posterUrl: null } },
    { id: "c", text: "How to order", media: { kind: "video" as const, url: "https://ik.imagekit.io/x/v.mp4", name: "v.mp4", size: 99, mime: "video/mp4", width: null, height: null, posterUrl: "https://ik.imagekit.io/x/v.mp4/ik-thumbnail.jpg" } },
  ],
};
const textItem = (key: string, text: string): DraftItem => ({ key, id: null, text, media: null });

test("welcome editor: saved messages become drafts and round-trip to the request", () => {
  const drafts = draftsFromWelcome(saved);
  assert.deepEqual(drafts.map((d) => [d.key, d.media?.status ?? null]), [["a", null], ["b", "ready"], ["c", "ready"]]);
  assert.equal(drafts[2].media?.posterUrl, "https://ik.imagekit.io/x/v.mp4/ik-thumbnail.jpg");
  assert.deepEqual(toWelcomeRequest(true, [...drafts, textItem("local-1", "  new  ")]), {
    enabled: true,
    messages: [
      { id: "a", text: "Hi!", media: null },
      { id: "b", text: "", media: { kind: "image", url: "https://ik.imagekit.io/x/p.jpg" } },
      { id: "c", text: "How to order", media: { kind: "video", url: "https://ik.imagekit.io/x/v.mp4" } },
      { text: "new", media: null },
    ],
  });
});
test("welcome editor: move, insert, replace and delete never mutate the list", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveItem(list, 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(list, 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(list, 0, -1), ["a", "b", "c"], "the first can't go up");
  assert.deepEqual(moveItem(list, 2, 1), ["a", "b", "c"], "the last can't go down");
  assert.deepEqual(removeItem(list, 1), ["a", "c"]);
  assert.deepEqual(list, ["a", "b", "c"]);
  const items = [textItem("1", "one"), textItem("2", "two")];
  assert.deepEqual(upsertItem(items, null, textItem("3", "three")).map((i) => i.key), ["1", "2", "3"]);
  assert.deepEqual(upsertItem(items, 0, textItem("1", "uno")).map((i) => i.text), ["uno", "two"]);
  assert.equal(items[0].text, "one");
});
test("welcome editor: a message needs text or a finished upload", () => {
  assert.equal(itemProblem({ text: "hi", media: null }), null);
  assert.ok(itemProblem({ text: "  ", media: null }));
  const uploading = { kind: "video" as const, previewUri: "file:///v.mov", url: null, posterUrl: null, width: null, height: null, size: 0, status: "uploading" as const, error: null };
  assert.ok(/upload/.test(itemProblem({ text: "", media: uploading }) ?? ""));
  assert.ok(/failed/.test(itemProblem({ text: "", media: { ...uploading, status: "failed", error: "x" } }) ?? ""));
  assert.equal(itemProblem({ text: "", media: { ...uploading, url: "https://u", status: "ready" } }), null, "a video alone is fine");
});
test("welcome editor: whole-list rules and summaries", () => {
  assert.ok(welcomeProblem(true, []), "on with nothing to send");
  assert.equal(welcomeProblem(false, []), null);
  assert.ok(/^Message 2:/.test(welcomeProblem(true, [textItem("1", "ok"), textItem("2", "")]) ?? ""));
  assert.ok(welcomeProblem(true, Array.from({ length: WELCOME_MAX_MESSAGES + 1 }, (_, i) => textItem(String(i), "x"))));
  assert.equal(itemSummary({ text: "  Hi\nthere ", media: null }), "Hi there");
  assert.equal(itemSummary({ text: "", media: { kind: "video" } }), "Video");
  assert.equal(welcomeCardLine(saved), "3 messages · Hi!");
  assert.equal(welcomeCardLine({ ...saved, messages: [saved.messages[1]] }), "Photo");
  assert.equal(welcomeCardLine({ ...saved, enabled: false }), "Off · new members get no message");
});

const savedReply = (title: string, body: string) => ({
  id: title,
  title,
  body,
  images: [] as { url: string; width: number | null; height: number | null }[],
  createdBy: "Store owner",
  updatedBy: "Store owner",
  createdByKey: "owner",
  updatedByKey: "owner",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
});
test("saved replies: a leading / in the composer is a shortcut search", () => {
  assert.equal(shortcutQuery("/"), "");
  assert.equal(shortcutQuery("/pay"), "pay");
  assert.equal(shortcutQuery("/Payment info"), "Payment info");
  assert.equal(shortcutQuery("hello /pay"), null, "only at the start");
  assert.equal(shortcutQuery(""), null);
  assert.equal(shortcutQuery("/pay\nmore"), null, "a second line means a real message");
  assert.equal(shortcutQuery("/" + "x".repeat(80)), null, "longer than any title");
});
test("saved replies: title starts beat title contains beat message contains", () => {
  const list = [savedReply("Hours", "Open 9 to 6"), savedReply("Payment", "GCash only"), savedReply("Shipping", "We ship via LBC, payment first"), savedReply("Repay", "x")];
  assert.deepEqual(
    matchSavedReplies(list, "pay").map((r) => r.title),
    ["Payment", "Repay", "Shipping"],
  );
  assert.deepEqual(
    matchSavedReplies(list, "PAY", 1).map((r) => r.title),
    ["Payment"],
  );
  assert.deepEqual(
    matchSavedReplies(list, "").map((r) => r.title),
    ["Hours", "Payment", "Shipping", "Repay"],
    "no query keeps the saved order",
  );
  assert.deepEqual(matchSavedReplies(list, "zzz"), []);
});
test("saved replies: picking one replaces a /shortcut or empty draft, else goes on a new line", () => {
  assert.equal(applySavedReply("", "GCash only"), "GCash only");
  assert.equal(applySavedReply("/pay", "GCash only"), "GCash only");
  assert.equal(applySavedReply("   ", "GCash only"), "GCash only");
  assert.equal(applySavedReply("Hi Ann!", "GCash only"), "Hi Ann!\nGCash only");
  assert.equal(applySavedReply("Hi Ann!\n", "GCash only"), "Hi Ann!\nGCash only");
  assert.equal(applySavedReply("/menu", ""), "", "a photo-only reply clears the shortcut");
  assert.equal(applySavedReply("Hi Ann!", " "), "Hi Ann!", "and leaves a real draft alone");
});
const PIC = { url: "https://ik.imagekit.io/pep/p1.jpg", width: 800, height: 600 };
test("saved replies: photo counts and the one-line summary", () => {
  assert.equal(photoLabel(1), "1 photo");
  assert.equal(photoLabel(12), "12 photos");
  assert.equal(savedReplySummary({ ...savedReply("Menu", ""), images: [PIC, PIC] }), "2 photos");
  assert.equal(savedReplySummary({ ...savedReply("Price", "Here po"), images: [PIC] }), "Here po");
  assert.equal(savedReplySummary(savedReply("Hours", "Open\n9 to 6")), "Open 9 to 6");
});
test("saved replies: the form can't save while a photo is uploading or failed", () => {
  const ready = { key: "a", previewUri: "file:///a.jpg", url: PIC.url, width: 1, height: 1, status: "ready" as const };
  assert.equal(formPhotosProblem([ready]), null);
  assert.ok(/uploading/i.test(formPhotosProblem([ready, { ...ready, key: "b", url: null, status: "uploading" }]) ?? ""));
  assert.ok(/failed/i.test(formPhotosProblem([{ ...ready, url: null, status: "failed" }]) ?? ""));
  assert.deepEqual(toSavedReplyRequest("Menu", " hi ", [ready]), { title: "Menu", body: " hi ", images: [{ url: PIC.url }] });
});
test("saved replies: Save as reply keeps the team's own photo, never a member's", () => {
  const base = { body: "Price list", image: PIC, sender: { key: "store", name: "Shop", avatarHue: 0, imageUrl: null, isTeam: true } };
  assert.deepEqual(saveAsReplyFrom(base as never), { body: "Price list", images: [PIC] });
  assert.deepEqual(saveAsReplyFrom({ ...base, sender: { ...base.sender, key: "c:1", isTeam: false } } as never), { body: "Price list", images: [] });
  assert.deepEqual(saveAsReplyFrom({ ...base, body: null } as never), { body: "", images: [PIC] });
  assert.equal(saveAsReplyFrom({ ...base, body: null, image: null } as never), null, "nothing to save");
  assert.equal(saveAsReplyFrom({ ...base, body: null, sender: { ...base.sender, isTeam: false } } as never), null);
});

console.log(`community lib: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
