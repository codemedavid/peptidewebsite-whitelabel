/**
 * Self-contained test for the super-admin → tenant WhatsApp quick-contact
 * helpers. Pure core (no DB, no Next runtime, no browser): the operator types a
 * number in any format, we normalize it to a bare dial string, validate it, and
 * build a one-tap wa.me click-to-chat link with a prefilled greeting.
 *
 *   - lib/admin/whatsapp.ts
 *       toWaDigits(raw)        — strip everything but digits (drops +, spaces, dashes, parens).
 *       validateWhatsapp(raw)  — { digits } when dial-able, else { error }.
 *       buildWaLink(digits,t)  — https://wa.me/<digits>?text=<url-encoded greeting>.
 *
 *   npm run test:admin-whatsapp
 */

import assert from "node:assert";

import { toWaDigits, validateWhatsapp, buildWaLink } from "../src/lib/admin/whatsapp";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("\nSuper-admin tenant WhatsApp — pure core\n");

// ─────────────────────────────── toWaDigits ─────────────────────────────────
console.log("toWaDigits");

check("strips +, spaces and dashes from an international number", () => {
  assert.equal(toWaDigits("+63 917 123 4567"), "639171234567");
});

check("strips parentheses and dots", () => {
  assert.equal(toWaDigits("(63) 917.123.4567"), "639171234567");
});

check("leaves an already-clean dial string untouched", () => {
  assert.equal(toWaDigits("639171234567"), "639171234567");
});

check("returns empty string when there are no digits", () => {
  assert.equal(toWaDigits("call me!"), "");
});

// ───────────────────────────── validateWhatsapp ─────────────────────────────
console.log("validateWhatsapp");

check("accepts a well-formed international number → digits", () => {
  const r = validateWhatsapp("+63 917 123 4567");
  assert.deepEqual(r, { digits: "639171234567" });
});

check("rejects a letters-only string", () => {
  const r = validateWhatsapp("whatsapp me");
  assert.ok("error" in r, "expected an error result");
});

check("rejects a too-short number (under 8 digits)", () => {
  const r = validateWhatsapp("12345");
  assert.ok("error" in r, "expected an error result");
});

check("rejects an over-long number (over 15 digits, beyond E.164)", () => {
  const r = validateWhatsapp("1234567890123456");
  assert.ok("error" in r, "expected an error result");
});

check("accepts the E.164 boundary lengths (8 and 15 digits)", () => {
  assert.deepEqual(validateWhatsapp("12345678"), { digits: "12345678" });
  assert.deepEqual(validateWhatsapp("123456789012345"), { digits: "123456789012345" });
});

// ─────────────────────────────── buildWaLink ────────────────────────────────
console.log("buildWaLink");

check("builds a bare wa.me link with no text", () => {
  assert.equal(buildWaLink("639171234567"), "https://wa.me/639171234567");
});

check("url-encodes the prefilled greeting in the text param", () => {
  const url = buildWaLink("639171234567", "Hi Acme Labs, quick question");
  assert.equal(url, "https://wa.me/639171234567?text=Hi%20Acme%20Labs%2C%20quick%20question");
});

check("ignores empty/whitespace text (no dangling ?text=)", () => {
  assert.equal(buildWaLink("639171234567", "   "), "https://wa.me/639171234567");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
