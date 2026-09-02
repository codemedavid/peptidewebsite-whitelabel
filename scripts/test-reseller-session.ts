/**
 * The reseller session cookie: a stateless signed token that decides whether a
 * request may see wholesale pricing.
 *
 * The unlock used to be a `sessionStorage` boolean, so there was nothing to test
 * and nothing to trust. These are the properties the cookie has to hold for the
 * server-side gate to mean anything.
 *
 *   npx tsx scripts/test-reseller-session.ts
 */

import assert from "node:assert";

import { encodeResellerToken, verifyResellerToken } from "../src/lib/auth/reseller-token";
import { encodeGateToken } from "../src/lib/auth/gate-token";

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

const SECRET = "test-secret-do-not-use-in-production";
const OTHER_SECRET = "a-different-deployment-secret";
const now = () => Math.floor(Date.now() / 1000);
const fresh = (over: Partial<{ tenantId: string; codeVersion: number; iat: number; exp: number }> = {}) => ({
  tenantId: "tenant-a",
  codeVersion: 1,
  iat: now(),
  exp: now() + 3600,
  ...over,
});

console.log("\n── Round trip ─────────────────────────────────────────────────");

check("a freshly minted token verifies and carries its claims", () => {
  const token = encodeResellerToken(fresh(), SECRET);
  const payload = verifyResellerToken(token, SECRET);
  assert.ok(payload, "expected the token to verify");
  assert.equal(payload.tenantId, "tenant-a");
  assert.equal(payload.codeVersion, 1);
});

check("the password is never inside the token", () => {
  const token = encodeResellerToken(fresh(), SECRET);
  const decoded = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
  assert.ok(!/pass|code[^V]|secret/i.test(decoded.replace(/codeVersion/g, "")), decoded);
});

console.log("\n── Forgery + tampering ────────────────────────────────────────");

check("a token signed with another secret is rejected", () => {
  const token = encodeResellerToken(fresh(), OTHER_SECRET);
  assert.equal(verifyResellerToken(token, SECRET), null);
});

check("editing the payload invalidates the signature", () => {
  const token = encodeResellerToken(fresh(), SECRET);
  const [body, sig] = token.split(".");
  const tampered = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  tampered.tenantId = "tenant-b"; // try to cross into another store
  const forged = `${Buffer.from(JSON.stringify(tampered), "utf8").toString("base64url")}.${sig}`;
  assert.equal(verifyResellerToken(forged, SECRET), null);
});

check("garbage and empty values are rejected, not crashed on", () => {
  for (const junk of ["", ".", "abc", "a.b", "....", "null.null"]) {
    assert.equal(verifyResellerToken(junk, SECRET), null, `expected ${JSON.stringify(junk)} rejected`);
  }
});

console.log("\n── Cross-gate replay (domain separation) ──────────────────────");

check("a VISITOR access-gate cookie cannot unlock reseller pricing", () => {
  // Both gates HMAC with the same deployment secret and carry the same payload
  // shape. Without domain separation, a visitor who legitimately unlocked a
  // store's front-door access code could paste their `tenant.sid` value into
  // `sf.reseller` and read the wholesale price list without ever seeing the
  // reseller password. The reseller token signs a scoped body, so it can't.
  const visitorToken = encodeGateToken(
    { tenantId: "tenant-a", codeVersion: 1, iat: now(), exp: now() + 3600 },
    SECRET,
  );
  assert.equal(verifyResellerToken(visitorToken, SECRET), null);
});

check("a reseller token is likewise not a valid visitor-gate token", () => {
  const { verifyGateToken } = require("../src/lib/auth/gate-token") as typeof import("../src/lib/auth/gate-token");
  const resellerToken = encodeResellerToken(fresh(), SECRET);
  assert.equal(verifyGateToken(resellerToken, SECRET), null);
});

console.log("\n── Expiry + revocation ────────────────────────────────────────");

check("an expired token is rejected", () => {
  const token = encodeResellerToken(fresh({ iat: now() - 7200, exp: now() - 60 }), SECRET);
  assert.equal(verifyResellerToken(token, SECRET), null);
});

check("the tenant is carried so a cookie can't cross stores", () => {
  // The codec doesn't know the caller's tenant — isResellerUnlocked compares it.
  // What matters here is that the value is present and authenticated.
  const token = encodeResellerToken(fresh({ tenantId: "tenant-b" }), SECRET);
  assert.equal(verifyResellerToken(token, SECRET)?.tenantId, "tenant-b");
});

check("the code version is carried so a password change can revoke it", () => {
  const token = encodeResellerToken(fresh({ codeVersion: 4 }), SECRET);
  assert.equal(verifyResellerToken(token, SECRET)?.codeVersion, 4);
});

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
