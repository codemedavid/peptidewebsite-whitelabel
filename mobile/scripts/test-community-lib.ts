// Unit tests for the community app's pure helpers (mobile/src/features/community/lib).
// Run from the repo root:  npx tsx mobile/scripts/test-community-lib.ts
import assert from "node:assert/strict";
import type { CommunityMessage, MessagesResponse, Participant, ThreadInfo } from "../../src/lib/mobile/contract";
import { access } from "./community-test-access";
import { communityAccess } from "../src/features/community/lib/access";

import { attachmentLabel, bubbleImageSize, imageFileName, imageMimeFor } from "../src/features/community/lib/attachments";
import { hueFromString, mix, parseHex, withAlpha } from "../src/features/community/lib/color";
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
    body: `hello ${seq}`, product: null, protocol: null, image: null, file: null, drop: null, order: null, replyTo: null,
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
    id, name: `Chan ${id}`, description: null, emoji: "💬", imageUrl: null, postRole, sortOrder: 0, topicCount: 1,
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

console.log(`community lib: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
