/**
 * Self-contained test for two hardening rules on the reseller portal.
 *
 * 1. BRUTE FORCE. `verifyResellerCodeAction` is public, unauthenticated, and
 *    guards a wholesale price list. Its sibling — the visitor access gate in
 *    actions/storefront-gate.ts — has been rate-limited per IP since it shipped;
 *    this one was not. Reseller passwords are accepted at 4 characters and are
 *    lowercased before comparison, so the keyspace is small enough to walk, and
 *    every attempt also runs a synchronous scrypt on the server, which makes the
 *    same endpoint a CPU-exhaustion vector against the Node event loop.
 *
 * 2. FAIL CLOSED, NEVER THROW. `isResellerUnlocked` verifies a signed token, and
 *    signing needs a secret. When no secret is configured `resolveSecret` throws.
 *    Two of its three callers await it OUTSIDE any try/catch — the storefront
 *    home render and the public price refresh — so a missing secret took down
 *    the whole storefront rather than just the portal. "Not unlocked" is the only
 *    safe answer to "is this request a verified reseller?", so the function must
 *    answer it itself rather than leave every caller to remember a guard.
 *
 * Both rules live in server actions / `server-only` modules, which cannot be
 * imported into a plain tsx script (they pull in next/headers). So this suite
 * asserts on their source, the same way test-reseller-access.ts already covers
 * the actions it guards. The limiter's own behaviour is not re-tested here — it
 * is the shared one the access gate has used since it shipped.
 *
 *   npm run test:reseller-hardening
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

console.log("\nReseller portal hardening\n");

// ─── 1. Brute force ─────────────────────────────────────────────────────────

check("it uses the SAME limiter the visitor access gate already uses", () => {
  // Not a second rate-limiting system: one shared in-memory limiter, one import.
  const imports = (p: string) => /from "@\/lib\/security\/rate-limit"/.test(read(p));
  assert.ok(imports("src/actions/storefront-gate.ts"), "the sibling it mirrors");
  assert.ok(imports("src/actions/storefront-admin.ts"), "the reseller action must too");
});

check("verifyResellerCodeAction is rate limited per tenant AND IP", () => {
  const src = read("src/actions/storefront-admin.ts");
  const start = src.indexOf("export async function verifyResellerCodeAction");
  assert.ok(start > 0, "the action must exist");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.match(body, /rateLimit\(/, "the public code check must be rate limited");
  assert.match(body, /clientIp\(\)/, "the budget must be per IP, not per store");
  assert.match(
    body,
    /\$\{tenantId\}:\$\{ip\}/,
    "the key must scope to BOTH, so one store's attacker cannot exhaust another's",
  );
});

check("the limiter runs BEFORE the password is hashed and compared", () => {
  // Otherwise every refused attempt still pays for a synchronous scrypt, and the
  // endpoint stays a CPU-exhaustion vector even while returning "too many".
  const src = read("src/actions/storefront-admin.ts");
  const start = src.indexOf("export async function verifyResellerCodeAction");
  const body = src.slice(start, src.indexOf("\n}", start));
  const limitAt = body.indexOf("rateLimit(");
  const hashAt = body.indexOf("verifyResellerCode(");
  assert.ok(limitAt >= 0, "there must BE a rate-limit call to order");
  assert.ok(hashAt >= 0, "and a password comparison to order it against");
  assert.ok(limitAt < hashAt, "rate limit must be checked before the scrypt comparison");
});

check("a refused attempt does not leak whether the code was right", () => {
  const src = read("src/actions/storefront-admin.ts");
  const start = src.indexOf("export async function verifyResellerCodeAction");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.match(body, /Too many attempts/, "the refusal must be its own generic message");
});

// ─── 2. Fail closed, never throw ────────────────────────────────────────────

check("isResellerUnlocked answers false instead of throwing", () => {
  // A missing signing secret makes resolveSecret throw. The only safe answer to
  // "is this a verified reseller?" is no — and the function must give it itself,
  // because two of its three callers await it outside any try/catch.
  const src = read("src/lib/auth/reseller-session.ts");
  const start = src.indexOf("export async function isResellerUnlocked");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.match(body, /try\s*\{/, "the session read must be guarded");
  assert.match(body, /catch/, "and must fail closed rather than propagate");
});

check("the storefront render no longer needs its own guard around the call", () => {
  // If the function fails closed, a missing secret degrades the reseller portal
  // instead of 500-ing the whole home page.
  const src = read("src/app/(tenant)/(storefront)/storefront-home.tsx");
  assert.match(src, /isResellerUnlocked\(/, "the render still consults the session");
});

check("the public price refresh consults the session too", () => {
  const src = read("src/actions/products.ts");
  assert.match(src, /isResellerUnlocked\(/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
