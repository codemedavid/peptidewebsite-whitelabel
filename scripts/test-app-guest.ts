// npm run test:app-guest — the pure rules behind "Continue as guest" (src/lib/mobile/app-guest.ts).
import assert from "node:assert/strict";
import {
  APP_GUEST_PASSWORD_HASH,
  appGuestEmail,
  guestShoppingAllowed,
  isAppGuestEmail,
  isAppGuestHash,
  visibleCustomerEmail,
} from "../src/lib/mobile/app-guest";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("app guest");

test("guest email is on the reserved .invalid TLD and recognised", () => {
  const email = appGuestEmail("a1b2c3d4e5f6");
  assert.equal(email, "guest-a1b2c3d4e5f6@app-guest.invalid");
  assert.ok(isAppGuestEmail(email));
  assert.ok(isAppGuestEmail(email.toUpperCase()));
});

test("a bad token never builds an email", () => {
  assert.throws(() => appGuestEmail("short"));
  assert.throws(() => appGuestEmail("has space here"));
  assert.throws(() => appGuestEmail("x@evil.com.aaaaaaa"));
});

test("real emails are not guests and stay visible", () => {
  assert.equal(isAppGuestEmail("juan@gmail.com"), false);
  assert.equal(isAppGuestEmail("guest@app-guest.invalid.com"), false);
  assert.equal(visibleCustomerEmail("juan@gmail.com"), "juan@gmail.com");
  assert.equal(visibleCustomerEmail(appGuestEmail("deadbeefcafe")), "");
});

test("only the app-guest sentinel marks a guest row", () => {
  assert.ok(isAppGuestHash(APP_GUEST_PASSWORD_HASH));
  // The group-buy email guest ("guest") is a different thing.
  assert.equal(isAppGuestHash("guest"), false);
  assert.equal(isAppGuestHash("scrypt$abc$def"), false);
  assert.equal(isAppGuestHash(null), false);
});

test("guest shopping needs an open app store with no visitor wall", () => {
  assert.equal(guestShoppingAllowed({ shopOpen: true, isPrivate: false, membersOnly: false }), true);
  assert.equal(guestShoppingAllowed({ shopOpen: false, isPrivate: false, membersOnly: false }), false);
  assert.equal(guestShoppingAllowed({ shopOpen: true, isPrivate: true, membersOnly: false }), false);
  assert.equal(guestShoppingAllowed({ shopOpen: true, isPrivate: false, membersOnly: true }), false);
});

console.log(`\n${passed} passed`);
