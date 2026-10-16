/**
 * SAVED CHECKOUT DETAILS — a returning shopper's contact + shipping fields,
 * remembered in a per-store cookie so they don't retype them every order.
 *
 * What this suite locks:
 *   1. ROUND TRIP  — what is saved comes back field-for-field.
 *   2. HYGIENE     — the cookie is user-writable, so reads drop unknown keys,
 *                    non-strings, control characters and over-long values.
 *   3. SCOPE       — host-only (no Domain=), so one tenant never sees another's;
 *                    Secure on https; name-exact read.
 *   4. MERGE       — prefill fills only EMPTY fields, never overwriting typing.
 *   5. WIRING      — the checkout recalls on mount, saves only after a
 *                    successful placement, honors the opt-out, offers Forget.
 *
 * Run:
 *   npm run test:saved-details
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CheckoutCustomer } from "../src/storefront/checkout";
import {
  SAVED_DETAILS_COOKIE,
  buildSavedDetailsCookie,
  buildForgetSavedDetailsCookie,
  readSavedDetailsCookie,
  sanitizeSavedDetails,
  mergeSavedDetails,
} from "../src/lib/storefront/saved-details";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name} — ${(err as Error).message}`);
  }
}

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** The `name=value` pair of a built cookie string, as `document.cookie` returns it. */
function asDocumentCookie(built: string): string {
  return built.split(";")[0];
}

const ANA: CheckoutCustomer = {
  name: "Ana Reyes",
  email: "ana@example.com",
  phone: "+63 917 555 0101",
  address: "12 Mabini St., Unit 4B",
  barangay: "Poblacion",
  city: "Makati",
  province: "Metro Manila",
  postal: "1210",
};

const EMPTY: CheckoutCustomer = {
  name: "", email: "", phone: "", address: "", barangay: "", city: "", province: "", postal: "",
};

// ─────────────────────────────── 1. round trip ──────────────────────────────
console.log("\n1. ROUND TRIP");

check("saved details read back unchanged", () => {
  const cookie = asDocumentCookie(buildSavedDetailsCookie(ANA));
  assert.deepEqual(readSavedDetailsCookie(cookie), ANA);
});

check("non-ASCII names survive (ñ, accents)", () => {
  const nino = { ...ANA, name: "Niño Peña", city: "Parañaque" };
  const cookie = asDocumentCookie(buildSavedDetailsCookie(nino));
  assert.deepEqual(readSavedDetailsCookie(cookie), nino);
});

check("reads the right cookie among others", () => {
  const cookie = `sf_last_order=HP-1; ${asDocumentCookie(buildSavedDetailsCookie(ANA))}; theme=dark`;
  assert.deepEqual(readSavedDetailsCookie(cookie), ANA);
});

check("all-empty details are not written", () => {
  assert.equal(buildSavedDetailsCookie(EMPTY), "");
});

// ───────────────────────────────── 2. hygiene ───────────────────────────────
console.log("\n2. HYGIENE");

check("unknown keys and non-strings are dropped", () => {
  const out = sanitizeSavedDetails({ ...ANA, isAdmin: true, phone: 12345 });
  assert.ok(out);
  assert.equal(out.phone, "");
  assert.equal("isAdmin" in out, false);
});

check("control characters are stripped, values trimmed", () => {
  const out = sanitizeSavedDetails({ ...ANA, name: "  Ana\u0000 Reyes\n " });
  assert.equal(out?.name, "Ana Reyes");
});

check("over-long values are capped", () => {
  const out = sanitizeSavedDetails({ ...ANA, address: "x".repeat(5000) });
  assert.ok(out && out.address.length <= 300);
});

check("garbage cookie values read as nothing", () => {
  assert.equal(readSavedDetailsCookie(`${SAVED_DETAILS_COOKIE}=%E0%A4%A`), null);
  assert.equal(readSavedDetailsCookie(`${SAVED_DETAILS_COOKIE}=not-json`), null);
  assert.equal(readSavedDetailsCookie(`${SAVED_DETAILS_COOKIE}=${encodeURIComponent("[1,2]")}`), null);
  assert.equal(readSavedDetailsCookie(""), null);
});

check("name match is exact (no substring hit)", () => {
  const other = `my_${asDocumentCookie(buildSavedDetailsCookie(ANA))}`;
  assert.equal(readSavedDetailsCookie(other), null);
});

check("the built cookie stays under the 4KB browser limit", () => {
  const huge = Object.fromEntries(Object.keys(ANA).map((k) => [k, "ñ".repeat(5000)])) as CheckoutCustomer;
  const built = buildSavedDetailsCookie(huge);
  assert.ok(built.length < 4000, `cookie is ${built.length} chars`);
});

// ────────────────────────────────── 3. scope ────────────────────────────────
console.log("\n3. SCOPE");

check("host-only: no Domain attribute, so tenants never share it", () => {
  assert.doesNotMatch(buildSavedDetailsCookie(ANA), /domain=/i);
});

check("Path=/, SameSite=Lax and a finite Max-Age", () => {
  const c = buildSavedDetailsCookie(ANA);
  assert.match(c, /Path=\//);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=\d+/);
});

check("Secure only when asked (https)", () => {
  assert.match(buildSavedDetailsCookie(ANA, { secure: true }), /; Secure/);
  assert.doesNotMatch(buildSavedDetailsCookie(ANA, { secure: false }), /Secure/);
});

check("forget expires the same cookie", () => {
  const f = buildForgetSavedDetailsCookie();
  assert.ok(f.startsWith(`${SAVED_DETAILS_COOKIE}=;`));
  assert.match(f, /Max-Age=0/);
});

// ────────────────────────────────── 4. merge ────────────────────────────────
console.log("\n4. MERGE");

check("fills empty fields only, never overwriting what was typed", () => {
  const typed = { ...EMPTY, name: "Typed Name" };
  const out = mergeSavedDetails(typed, ANA);
  assert.equal(out.name, "Typed Name");
  assert.equal(out.city, "Makati");
});

check("merge does not mutate its inputs", () => {
  const typed = { ...EMPTY };
  mergeSavedDetails(typed, ANA);
  assert.deepEqual(typed, EMPTY);
});

check("no saved details → current returned as-is", () => {
  const typed = { ...EMPTY, name: "x" };
  assert.deepEqual(mergeSavedDetails(typed, null), typed);
});

// ───────────────────────────────── 5. wiring ────────────────────────────────
console.log("\n5. WIRING");

const cart = src("src/storefront/components/CartCheckout.tsx");

check("checkout recalls saved details", () => {
  assert.match(cart, /recallSavedDetails\(\)/);
  assert.match(cart, /mergeSavedDetails\(/);
});

check("details are saved only after the order is stored", () => {
  const saveAt = cart.indexOf("rememberSavedDetails(");
  const placedAt = cart.indexOf("placeStorefrontOrderAction(draft)");
  assert.ok(saveAt > 0 && placedAt > 0, "both calls present");
  assert.ok(saveAt > placedAt, "save comes after placement");
});

check("the shopper can opt out and forget", () => {
  assert.match(cart, /Remember my details/);
  assert.match(cart, /forgetSavedDetails\(\)/);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
