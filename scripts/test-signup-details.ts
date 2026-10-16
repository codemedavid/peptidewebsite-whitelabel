/**
 * Pure-core gate for the app's create-account details
 * (src/lib/mobile/sign-up-details.ts): first + last name, mobile number and
 * age are required; gender is optional.
 *
 *   npm run test:signup-details
 */
import assert from "node:assert";

import { parseSignUpDetails, SIGN_UP_AGE_MIN } from "../src/lib/mobile/sign-up-details";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const VALID = { firstName: "Nina", lastName: "Nuevo", phone: "0917 555 0101", age: 27, gender: "female" };

function errorOf(input: Record<string, unknown>): string {
  const res = parseSignUpDetails(input);
  assert.equal(res.ok, false, `expected a rejection for ${JSON.stringify(input)}`);
  return res.ok ? "" : res.error;
}

console.log("sign-up details");

test("complete details parse, and the full name joins first + last", () => {
  const res = parseSignUpDetails({ ...VALID, firstName: "  Nina  Maria ", lastName: " dela  Cruz " });
  assert.deepEqual(res, {
    ok: true,
    value: { firstName: "Nina Maria", lastName: "dela Cruz", name: "Nina Maria dela Cruz", phone: "0917 555 0101", age: 27, gender: "female" },
  });
});

test("a missing first or last name is refused, each with its own message", () => {
  assert.match(errorOf({ ...VALID, firstName: "   " }), /first name/);
  assert.match(errorOf({ ...VALID, lastName: "" }), /last name/);
  assert.match(errorOf({ ...VALID, lastName: undefined }), /last name/);
});

test("the mobile number is required and must look like one", () => {
  assert.match(errorOf({ ...VALID, phone: " " }), /mobile number/);
  assert.match(errorOf({ ...VALID, phone: "12345" }), /valid mobile number/);
  assert.match(errorOf({ ...VALID, phone: "call me maybe" }), /valid mobile number/);
  const plus = parseSignUpDetails({ ...VALID, phone: "+63 917-555-0101" });
  assert.ok(plus.ok && plus.value.phone === "+63 917-555-0101", "formatting is kept as typed");
});

test("age is required, a whole number, and within range", () => {
  assert.match(errorOf({ ...VALID, age: undefined }), /your age/);
  assert.match(errorOf({ ...VALID, age: "" }), /your age/);
  assert.match(errorOf({ ...VALID, age: "abc" }), /valid age/);
  assert.match(errorOf({ ...VALID, age: 27.5 }), /valid age/);
  assert.match(errorOf({ ...VALID, age: 130 }), /valid age/);
  assert.match(errorOf({ ...VALID, age: SIGN_UP_AGE_MIN - 1 }), new RegExp(`at least ${SIGN_UP_AGE_MIN}`));
  const typed = parseSignUpDetails({ ...VALID, age: " 34 " });
  assert.ok(typed.ok && typed.value.age === 34, "a typed string age is accepted");
  const min = parseSignUpDetails({ ...VALID, age: SIGN_UP_AGE_MIN });
  assert.ok(min.ok, "the minimum age itself is allowed");
});

test("gender is optional: blank or missing means not said", () => {
  for (const gender of [undefined, null, "", "  "]) {
    const res = parseSignUpDetails({ ...VALID, gender });
    assert.ok(res.ok && res.value.gender === null, `gender ${JSON.stringify(gender)} → null`);
  }
  for (const gender of ["female", "male", "other"]) {
    const res = parseSignUpDetails({ ...VALID, gender });
    assert.ok(res.ok && res.value.gender === gender);
  }
});

test("an unknown gender value is refused rather than stored", () => {
  assert.match(errorOf({ ...VALID, gender: "robot" }), /gender/);
});

test("non-object input is refused, never thrown", () => {
  assert.equal(parseSignUpDetails(null).ok, false);
  assert.equal(parseSignUpDetails("nope").ok, false);
});

console.log(`\n${passed} passed`);
