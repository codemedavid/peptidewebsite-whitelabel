/**
 * Pure-core gate for personal account profiles (src/lib/mobile/account-profile.ts):
 * every app account — owner, staff, customer — can set a name, a nickname and
 * a profile photo.
 *
 *   npm run test:account-profile
 */
import assert from "node:assert";

import {
  NAME_MAX,
  NICKNAME_MAX,
  profileSubject,
  parseAccountProfileUpdate,
  shownName,
  viewProfile,
} from "../src/lib/mobile/account-profile";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("account-profile");

test("subject keys one profile per account kind", () => {
  assert.equal(profileSubject({ kind: "owner" }), "owner");
  assert.equal(profileSubject({ kind: "staff", id: "s1" }), "staff:s1");
  assert.equal(profileSubject({ kind: "customer", id: "c1" }), "customer:c1");
});

test("parse trims name and nickname and collapses inner whitespace", () => {
  const res = parseAccountProfileUpdate({ name: "  Ana   Reyes ", nickname: "  Ana  " });
  assert.deepEqual(res, { ok: true, value: { name: "Ana Reyes", nickname: "Ana" } });
});

test("a blank nickname clears it", () => {
  const res = parseAccountProfileUpdate({ name: "Ana", nickname: "   " });
  assert.deepEqual(res, { ok: true, value: { name: "Ana", nickname: null } });
});

test("name must be at least 2 characters", () => {
  const res = parseAccountProfileUpdate({ name: " a ", nickname: "" });
  assert.equal(res.ok, false);
});

test("over-long name and nickname are rejected, not truncated", () => {
  assert.equal(parseAccountProfileUpdate({ name: "x".repeat(NAME_MAX + 1) }).ok, false);
  assert.equal(parseAccountProfileUpdate({ name: "Ana", nickname: "x".repeat(NICKNAME_MAX + 1) }).ok, false);
});

test("non-object or non-string input is rejected", () => {
  assert.equal(parseAccountProfileUpdate(null).ok, false);
  assert.equal(parseAccountProfileUpdate({ name: 42 }).ok, false);
  assert.equal(parseAccountProfileUpdate({ name: "Ana", nickname: 7 }).ok, false);
});

test("control characters are stripped", () => {
  const res = parseAccountProfileUpdate({ name: "Ana\u0000\u0007 Reyes" });
  assert.deepEqual(res, { ok: true, value: { name: "Ana Reyes", nickname: null } });
});

test("bio is optional and passed through trimmed (customers only use it)", () => {
  const res = parseAccountProfileUpdate({ name: "Ana", bio: "  hello  " });
  assert.deepEqual(res, { ok: true, value: { name: "Ana", nickname: null, bio: "hello" } });
});

test("shown name prefers the nickname, then the name, then the fallback", () => {
  assert.equal(shownName({ name: "Ana Reyes", nickname: "Ana" }, "Store owner"), "Ana");
  assert.equal(shownName({ name: "Ana Reyes", nickname: null }, "Store owner"), "Ana Reyes");
  assert.equal(shownName(null, "Store owner"), "Store owner");
  assert.equal(shownName({ name: "", nickname: "" }, "Store owner"), "Store owner");
});

test("view fills the name from the fallback when no row exists", () => {
  assert.deepEqual(viewProfile(null, "Maria"), {
    name: "Maria",
    nickname: null,
    avatarUrl: null,
    displayName: "Maria",
  });
  assert.deepEqual(viewProfile({ name: "Maria Cruz", nickname: "Mars", avatarUrl: "https://x/y.jpg" }, "Maria"), {
    name: "Maria Cruz",
    nickname: "Mars",
    avatarUrl: "https://x/y.jpg",
    displayName: "Mars",
  });
});

console.log(`\n${passed} passed`);
