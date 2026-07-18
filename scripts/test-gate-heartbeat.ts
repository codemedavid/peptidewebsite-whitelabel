/**
 * Tests for the visitor-gate heartbeat decision core — src/lib/auth/gate-heartbeat.ts.
 *
 * The storefront is a hash-routed client app: after the first server render the
 * visitor never triggers another middleware/layout gate check, so a rotated
 * access code wouldn't boot an idle visitor until they hard-refresh. The
 * heartbeat closes that gap by polling a JSON endpoint on activity.
 *
 * The invariant that matters — and the one the original port got wrong — is the
 * SPA-fallback guard: a misrouted request or an auth redirect returns a 2xx HTML
 * *shell*, and that must NEVER be read as "authenticated". Only an explicit
 * `{ authenticated: <bool> }` JSON body from our own endpoint is a signal;
 * everything else is inconclusive (leave the visitor where they are, try again
 * next tick — no false logouts). A confirmed `false` is the only thing that boots.
 *
 *   npm run test:gate-heartbeat
 */

import assert from "node:assert";

import {
  interpretHeartbeat,
  shouldReloadForGate,
  type HeartbeatProbe,
} from "../src/lib/auth/gate-heartbeat";

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

const json = (status: number, body: unknown): HeartbeatProbe => ({
  status,
  contentType: "application/json; charset=utf-8",
  bodyText: JSON.stringify(body),
});

async function main() {
  console.log("\nGate heartbeat decision core\n");

  await check("explicit {authenticated:true} JSON → authed", () => {
    assert.equal(interpretHeartbeat(json(200, { authenticated: true })), "authed");
  });

  await check("explicit {authenticated:false} JSON → invalidated (boot)", () => {
    assert.equal(interpretHeartbeat(json(200, { authenticated: false })), "invalidated");
    // A 401 carrying the same JSON is still a confirmed invalidation.
    assert.equal(interpretHeartbeat(json(401, { authenticated: false })), "invalidated");
  });

  await check("SPA-fallback: a 2xx HTML shell is NOT authed → inconclusive", () => {
    const shell: HeartbeatProbe = {
      status: 200,
      contentType: "text/html; charset=utf-8",
      bodyText: "<!doctype html><html><body>store</body></html>",
    };
    assert.equal(interpretHeartbeat(shell), "inconclusive");
  });

  await check("SPA-fallback: HTML shell that merely CONTAINS the literal is not authed", () => {
    // Guards against a naive substring/regex match on the body. An HTML page can
    // contain the text `"authenticated":true` (inlined state, a comment) — it is
    // still text/html and must never pass the gate.
    const trap: HeartbeatProbe = {
      status: 200,
      contentType: "text/html",
      bodyText: '<script>window.__d={"authenticated":true}</script>',
    };
    assert.equal(interpretHeartbeat(trap), "inconclusive");
  });

  await check("network error (null probe) → inconclusive (no false logout)", () => {
    assert.equal(interpretHeartbeat(null), "inconclusive");
  });

  await check("JSON content-type but unparseable body → inconclusive", () => {
    const truncated: HeartbeatProbe = {
      status: 200,
      contentType: "application/json",
      bodyText: '{"authenticated":tr', // truncated stream
    };
    assert.equal(interpretHeartbeat(truncated), "inconclusive");
  });

  await check("JSON object missing the authenticated field → inconclusive", () => {
    assert.equal(interpretHeartbeat(json(200, { ok: true })), "inconclusive");
  });

  await check("non-boolean authenticated (truthy string) → inconclusive, never authed", () => {
    assert.equal(interpretHeartbeat(json(200, { authenticated: "true" })), "inconclusive");
    assert.equal(interpretHeartbeat(json(200, { authenticated: 1 })), "inconclusive");
  });

  await check("5xx with a JSON error body → inconclusive", () => {
    assert.equal(interpretHeartbeat(json(500, { error: "server_error" })), "inconclusive");
  });

  await check("shouldReloadForGate boots ONLY on a confirmed invalidation", () => {
    assert.equal(shouldReloadForGate("invalidated"), true);
    assert.equal(shouldReloadForGate("authed"), false);
    assert.equal(shouldReloadForGate("inconclusive"), false);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
