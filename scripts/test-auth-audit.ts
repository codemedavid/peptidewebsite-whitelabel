/**
 * Tests for the auth audit writer — src/lib/auth/audit.ts.
 *
 * The invariant that matters: writing an audit row must NEVER break the auth flow
 * it records. A failed INSERT while logging admin_login_failed must not itself
 * throw and turn a clean 401 into a 500. So recordAuthAudit is fail-safe by
 * design, and the writer is injected so this is testable without a DB.
 *
 *   npm run test:auth-audit
 */

import assert from "node:assert";

import {
  recordAuthAudit,
  AUTH_AUDIT_EVENTS,
  type AuthAuditRow,
  type AuthAuditWriter,
} from "../src/lib/auth/audit";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

async function main() {
  console.log("\nAuth audit writer\n");

  await check("writes a normalized row (ip defaults to null)", async () => {
    const seen: AuthAuditRow[] = [];
    const write: AuthAuditWriter = async (row) => {
      seen.push(row);
    };
    await recordAuthAudit(write, { tenantId: "t1", event: "admin_login" });
    assert.deepEqual(seen[0], { tenantId: "t1", event: "admin_login", ip: null });
  });

  await check("passes the ip through when provided", async () => {
    const seen: AuthAuditRow[] = [];
    const write: AuthAuditWriter = async (row) => {
      seen.push(row);
    };
    await recordAuthAudit(write, { tenantId: "t1", event: "code_rotated", ip: "203.0.113.7" });
    assert.equal(seen[0]?.ip, "203.0.113.7");
  });

  await check("is FAIL-SAFE: a throwing writer never breaks the caller", async () => {
    const write: AuthAuditWriter = async () => {
      throw new Error("db down");
    };
    // Must resolve, not reject — logging failure cannot break login/rotation.
    await recordAuthAudit(write, { tenantId: "t1", event: "admin_login_failed" });
    assert.ok(true, "recordAuthAudit resolved despite the writer throwing");
  });

  await check("event allowlist is exactly the three auth events", () => {
    assert.deepEqual([...AUTH_AUDIT_EVENTS].sort(), ["admin_login", "admin_login_failed", "code_rotated"]);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
