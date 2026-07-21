/**
 * Self-contained test for the pure icon-fallback proxy (no DOM, no React).
 * Guards the root-cause fix for the admin "Element type is invalid" crash: the
 * icon registry `Ic` is keyed by string, so `Ic.Clock` / `Ic.Box` / any typo or
 * dynamic `Ic[name]` type-checks but returns `undefined`, and rendering an
 * undefined component throws at runtime. withIconFallback wraps the registry so
 * every missing key resolves to a safe fallback instead.
 *
 *   - src/components/admin/shell/icon-fallback.ts
 *       withIconFallback(registry, fallback) — Proxy that never yields undefined
 *       for a string key.
 *
 *   npm run test:icon-fallback
 */

import assert from "node:assert";

import { withIconFallback } from "../src/components/admin/shell/icon-fallback";

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

// Stand-ins for Lucide components — plain sentinels are enough to prove routing.
const Known = () => "known-icon";
const Fallback = () => "fallback-icon";

console.log("\nIcon fallback proxy — pure core\n");

check("a known key returns its own mapped value", () => {
  const Ic = withIconFallback({ Home: Known }, Fallback);
  assert.strictEqual(Ic.Home, Known);
});

check("a missing key returns the fallback, never undefined", () => {
  const Ic = withIconFallback({ Home: Known }, Fallback);
  assert.strictEqual(Ic.Clock, Fallback);
  assert.notStrictEqual(Ic.Clock, undefined);
});

check("the real-world offenders (Clock, Box) all resolve to a component", () => {
  const Ic = withIconFallback({ Home: Known }, Fallback);
  for (const key of ["Clock", "Box", "Timer", "Whatever"]) {
    assert.strictEqual(typeof Ic[key], "function", `${key} must be a renderable component`);
  }
});

check("dynamic string access (Ic[name]) is safe for an unknown name", () => {
  const Ic = withIconFallback({ Activity: Known }, Fallback);
  const name = "DefinitelyNotAnIcon";
  assert.strictEqual(Ic[name], Fallback);
});

check("does not mutate the underlying registry", () => {
  const registry = { Home: Known };
  const Ic = withIconFallback(registry, Fallback);
  void Ic.Missing; // touch a missing key
  assert.deepStrictEqual(Object.keys(registry), ["Home"]);
  assert.strictEqual(registry.Home, Known);
});

check("symbol access passes through (does not return the fallback)", () => {
  const Ic = withIconFallback({ Home: Known }, Fallback);
  // e.g. Symbol.iterator must not be shadowed by the fallback
  assert.strictEqual((Ic as Record<symbol, unknown>)[Symbol.iterator], undefined);
});

// ──────────────────────────────────── summary ───────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
