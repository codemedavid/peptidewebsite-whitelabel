/**
 * Saved replies (pure rules, src/lib/community/saved-replies.ts): the store
 * team's shared quick answers, kept in branding.config.communitySavedReplies.
 *
 *   npm run test:community-saved-replies
 */
import assert from "node:assert/strict";
import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_IMAGES_MAX,
  SAVED_REPLY_MAX,
  SAVED_REPLY_TITLE_MAX,
  addSavedReply,
  parseSavedReplyInput,
  removeSavedReply,
  savedReplies,
  updateSavedReply,
  type SavedReply,
} from "../src/lib/community/saved-replies";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`  ✗ ${name}\n    ${(e as Error).message}`);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const NOW = new Date("2026-10-08T06:00:00Z");
const by = { key: "owner", name: "Store owner" };
const meta = (id: string, who = by) => ({ id, by: who, now: NOW });
const reply = (id: string, title: string, body = `${title} body`): SavedReply => ({
  id,
  title,
  body,
  images: [],
  createdBy: "Store owner",
  updatedBy: "Store owner",
  createdByKey: "owner",
  updatedByKey: "owner",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

console.log("\nreading what's saved");
test("nothing saved reads as an empty list", () => {
  assert.deepEqual(savedReplies(undefined), []);
  assert.deepEqual(savedReplies({}), []);
  assert.deepEqual(savedReplies({ communitySavedReplies: "nope" }), []);
});
test("malformed rows are dropped and the rest come back sorted by title", () => {
  const list = savedReplies({
    communitySavedReplies: [reply("b", "shipping"), { id: "x" }, null, reply("a", "Hello"), { ...reply("c", ""), title: "" }],
  });
  assert.deepEqual(
    list.map((r) => r.title),
    ["Hello", "shipping"],
  );
});

console.log("\nvalidating input");
test("title and message are trimmed and both required", () => {
  assert.deepEqual(parseSavedReplyInput({ title: "  Payment ", body: " GCash 0917 \n" }), { ok: true, value: { title: "Payment", body: "GCash 0917", imageUrls: [] } });
  assert.equal(parseSavedReplyInput({ title: "", body: "x" }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "x", body: "   " }).ok, false);
  assert.equal(parseSavedReplyInput(null).ok, false);
  assert.equal(parseSavedReplyInput({ title: 3, body: "x" }).ok, false);
});
test("a leading slash on the shortcut is ignored", () => {
  const r = parseSavedReplyInput({ title: "/ship", body: "x" });
  assert.ok(r.ok);
  assert.equal(r.value.title, "ship");
});
test("long titles and long messages are refused", () => {
  assert.equal(parseSavedReplyInput({ title: "t".repeat(SAVED_REPLY_TITLE_MAX + 1), body: "x" }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "t", body: "b".repeat(SAVED_REPLY_BODY_MAX + 1) }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "t".repeat(SAVED_REPLY_TITLE_MAX), body: "b".repeat(SAVED_REPLY_BODY_MAX) }).ok, true);
});

console.log("\nadding, editing, deleting");
test("adding stamps who saved it and when, without touching the old list", () => {
  const before = [reply("a", "Hello")];
  const r = addSavedReply(before, { title: "Payment", body: "GCash", images: [] }, meta("p1", { key: "s:42", name: "Mo Mod" }));
  assert.ok(r.ok);
  assert.equal(before.length, 1);
  const added = r.value.find((x) => x.id === "p1")!;
  assert.equal(added.createdBy, "Mo Mod");
  assert.equal(added.createdByKey, "s:42");
  assert.equal(added.updatedBy, "Mo Mod");
  assert.equal(added.createdAt, NOW.toISOString());
});
test("a second reply with the same title (any case) is refused", () => {
  const r = addSavedReply([reply("a", "Payment")], { title: "payment", body: "x", images: [] }, meta("p2"));
  assert.equal(r.ok, false);
});
test("the list is capped", () => {
  const full = Array.from({ length: SAVED_REPLY_MAX }, (_, i) => reply(`r${i}`, `t${i}`));
  assert.equal(addSavedReply(full, { title: "one more", body: "x", images: [] }, meta("z")).ok, false);
});
test("editing keeps the creator and records the editor", () => {
  const list = [reply("a", "Hello"), reply("b", "Payment")];
  const later = new Date("2026-10-09T00:00:00Z");
  const r = updateSavedReply(list, "b", { title: "Payment", body: "Maya too", images: [] }, { by: { key: "s:42", name: "Mo Mod" }, now: later });
  assert.ok(r.ok);
  const b = r.value.find((x) => x.id === "b")!;
  assert.equal(b.body, "Maya too");
  assert.equal(b.createdBy, "Store owner");
  assert.equal(b.updatedBy, "Mo Mod");
  assert.equal(b.updatedAt, later.toISOString());
  assert.equal(list[1].body, "Payment body", "the old list is unchanged");
});
test("editing can't steal another reply's title, and a missing id is reported", () => {
  const list = [reply("a", "Hello"), reply("b", "Payment")];
  const clash = updateSavedReply(list, "b", { title: "HELLO", body: "x", images: [] }, { by, now: NOW });
  assert.equal(clash.ok, false);
  const missing = updateSavedReply(list, "nope", { title: "x", body: "x", images: [] }, { by, now: NOW });
  assert.equal(missing.ok, false);
  assert.ok(!missing.ok && missing.notFound);
});
test("deleting removes only that reply; an unknown id is reported", () => {
  const list = [reply("a", "Hello"), reply("b", "Payment")];
  const r = removeSavedReply(list, "a");
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.map((x) => x.id),
    ["b"],
  );
  assert.equal(list.length, 2);
  assert.equal(removeSavedReply(list, "zz").ok, false);
});

console.log("\nphotos");
const photo = (n: number) => ({ url: `https://ik.imagekit.io/pep/community/p${n}.jpg`, width: 800, height: 600 });
test("a reply can carry photos; the urls come back deduped and in order", () => {
  const r = parseSavedReplyInput({ title: "Price list", body: "Here po 👇", images: [{ url: photo(2).url }, { url: photo(1).url }, { url: photo(2).url }] });
  assert.ok(r.ok);
  assert.deepEqual(r.value.imageUrls, [photo(2).url, photo(1).url]);
});
test("photos alone are a reply; nothing at all is not", () => {
  const only = parseSavedReplyInput({ title: "Menu", body: "", images: [{ url: photo(1).url }] });
  assert.ok(only.ok);
  assert.equal(only.value.body, "");
  assert.equal(parseSavedReplyInput({ title: "Menu", body: " ", images: [] }).ok, false);
});
test("bad photo entries and a runaway photo count are refused", () => {
  assert.equal(parseSavedReplyInput({ title: "t", body: "x", images: "nope" }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "t", body: "x", images: [{ url: 5 }] }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "t", body: "x", images: [{ url: "" }] }).ok, false);
  const many = Array.from({ length: SAVED_REPLY_IMAGES_MAX + 1 }, (_, i) => ({ url: photo(i).url }));
  assert.equal(parseSavedReplyInput({ title: "t", body: "x", images: many }).ok, false);
  assert.equal(parseSavedReplyInput({ title: "t", body: "x", images: many.slice(1) }).ok, true);
});
test("saved photos are stored and read back; malformed photo rows are dropped", () => {
  const added = addSavedReply([], { title: "Price list", body: "", images: [photo(1), photo(2)] }, meta("p"));
  assert.ok(added.ok);
  const stored = { communitySavedReplies: [{ ...added.value[0], images: [photo(1), { url: 3 }, null, { url: photo(2).url, width: "x" }] }] };
  const back = savedReplies(stored)[0];
  assert.deepEqual(back.images, [photo(1), { url: photo(2).url, width: null, height: null }]);
  assert.equal(back.body, "", "a photo-only reply survives the read");
});
test("old replies saved before photos read back with no photos", () => {
  const { images: _drop, ...old } = reply("a", "Hello");
  assert.deepEqual(savedReplies({ communitySavedReplies: [old] })[0].images, []);
});
test("editing replaces the photo list", () => {
  const list = [{ ...reply("a", "Price list"), images: [photo(1), photo(2)] }];
  const r = updateSavedReply(list, "a", { title: "Price list", body: "", images: [photo(3)] }, { by, now: NOW });
  assert.ok(r.ok);
  assert.deepEqual(r.value[0].images, [photo(3)]);
});

console.log(`\nsaved replies: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
