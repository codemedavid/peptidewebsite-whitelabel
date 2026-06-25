/**
 * Self-contained test for the per-tenant access-code gate's security core. Runs
 * the REAL pure modules (no DB, no Next runtime needed):
 *   - lib/auth/password-hash.ts   — code hashing/verification (verify success/fail)
 *   - lib/auth/gate-token.ts      — Node signed-cookie codec
 *   - lib/auth/gate-token-edge.ts — Edge/Web-Crypto codec (middleware rolling)
 *
 * Covers: verify success/failure, cross-tenant rejection, code-rotation
 * invalidation, signature tampering, idle expiry, the absolute session cap, and
 * Node<->Edge interchangeability. The cookie/DB wrappers (storefront-gate.ts) and
 * the actions layer the `cookies()` jar + requireStorefrontAdmin guard on top of
 * these, mirroring the same checks proven here.
 *
 *   npm run test:gate
 */

import assert from "node:assert";
import { hashPassword, verifyPassword } from "../src/lib/auth/password-hash";
import { encodeGateToken, verifyGateToken } from "../src/lib/auth/gate-token";
import { signGateTokenEdge, verifyGateTokenEdge } from "../src/lib/auth/gate-token-edge";
import { GATE_MAX_SESSION_SECONDS } from "../src/lib/auth/gate-constants";

// Deterministic secret for the run (the lib reads TENANT_ADMIN_SECRET).
process.env.TENANT_ADMIN_SECRET = "test-secret-please-ignore-0123456789abcdef";

const SECRET = process.env.TENANT_ADMIN_SECRET;
const TENANT_A = "tenant_aaa";
const TENANT_B = "tenant_bbb";
const now = () => Math.floor(Date.now() / 1000);

/** Build a token with sensible defaults (fresh iat/exp) overridable per case. */
function mint(over: Partial<{ tenantId: string; codeVersion: number; iat: number; exp: number }>) {
  return encodeGateToken(
    { tenantId: TENANT_A, codeVersion: 1, iat: now(), exp: now() + 900, ...over },
    SECRET,
  );
}

/**
 * Mirror the authoritative server-side gate check (storefront-gate.ts
 * isGateUnlocked): a token unlocks a tenant only if it verifies, its tenantId and
 * codeVersion match the live tenant, AND it's within the absolute session cap.
 */
function unlocks(token: string, tenant: { id: string; codeVersion: number }): boolean {
  const p = verifyGateToken(token, SECRET);
  return (
    !!p &&
    p.tenantId === tenant.id &&
    p.codeVersion === tenant.codeVersion &&
    now() < p.iat + GATE_MAX_SESSION_SECONDS
  );
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("access-gate security core");

// 1. Code verification — success and failure.
check("correct code verifies; wrong code does not", () => {
  const hash = hashPassword("hunter2-secret");
  assert.equal(verifyPassword("hunter2-secret", hash), true);
  assert.equal(verifyPassword("wrong-code", hash), false);
  assert.equal(verifyPassword("", hash), false);
});

// 2. A valid cookie unlocks its own tenant at the current version.
check("valid cookie unlocks its own tenant", () => {
  assert.equal(unlocks(mint({ codeVersion: 1 }), { id: TENANT_A, codeVersion: 1 }), true);
});

// 3. Cross-tenant rejection — tenant A's cookie does NOT unlock tenant B.
check("tenant A cookie does NOT unlock tenant B", () => {
  assert.equal(unlocks(mint({ codeVersion: 1 }), { id: TENANT_B, codeVersion: 1 }), false);
});

// 4. Code rotation invalidation — bumping codeVersion logs out old cookies.
check("rotating the code (version bump) invalidates existing cookies", () => {
  assert.equal(unlocks(mint({ codeVersion: 1 }), { id: TENANT_A, codeVersion: 2 }), false);
  assert.equal(unlocks(mint({ codeVersion: 2 }), { id: TENANT_A, codeVersion: 2 }), true);
});

// 5. Signature tampering is rejected (can't forge a cookie without the secret).
check("tampered signature is rejected", () => {
  const token = mint({ codeVersion: 1 });
  const [body] = token.split(".");
  assert.equal(verifyGateToken(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, SECRET), null);
  assert.equal(verifyGateToken(token, "a-different-secret"), null);
});

// 6. Expired tokens are rejected (rolling idle-timeout enforcement).
check("expired (idle) cookie is rejected", () => {
  const expired = mint({ exp: now() - 1 });
  assert.equal(verifyGateToken(expired, SECRET), null);
  assert.equal(unlocks(expired, { id: TENANT_A, codeVersion: 1 }), false);
});

// 7. Absolute session cap — a still-"fresh" exp can't outlive iat + MAX. This is
//    what stops a cookie being rolled forever; the signature/exp are valid but the
//    session is too old, so the layout still gates it.
check("cookie past the absolute lifetime cap is rejected", () => {
  const old = mint({ iat: now() - GATE_MAX_SESSION_SECONDS - 10, exp: now() + 900 });
  assert.notEqual(verifyGateToken(old, SECRET), null); // signature/exp still valid…
  assert.equal(unlocks(old, { id: TENANT_A, codeVersion: 1 }), false); // …but capped out
});

// 8. Node <-> Edge cross-compatibility. The storefront layout verifies with the
//    Node codec; middleware re-signs (rolling) with the Edge/Web-Crypto codec.
//    They MUST produce + accept identical tokens or rolling would log everyone out.
async function main() {
  await checkAsync("Node and Edge codecs are byte-identical and interchangeable", async () => {
    const payload = { tenantId: TENANT_A, codeVersion: 3, iat: now(), exp: now() + 900 };
    const nodeToken = encodeGateToken(payload, SECRET);
    const edgeToken = await signGateTokenEdge(payload, SECRET);
    assert.equal(nodeToken, edgeToken, "signers must emit identical bytes");
    assert.deepEqual(await verifyGateTokenEdge(nodeToken, SECRET), payload, "Edge accepts Node token");
    assert.deepEqual(verifyGateToken(edgeToken, SECRET), payload, "Node accepts Edge token");
    assert.equal(await verifyGateTokenEdge(`${nodeToken}x`, SECRET), null);
    assert.equal(await verifyGateTokenEdge(nodeToken, "a-different-secret"), null);
    const expired = await signGateTokenEdge({ ...payload, exp: now() - 1 }, SECRET);
    assert.equal(await verifyGateTokenEdge(expired, SECRET), null);
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
