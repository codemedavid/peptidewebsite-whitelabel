/**
 * Self-contained tests for "the store owner must not need the VISITOR access
 * code to reach the store-admin sign-in".
 *
 * The bug: the storefront is a hash-routed SPA, so `#admin` is invisible to the
 * server. When a tenant's visitor access-code gate is on, the layout returns the
 * access wall INSTEAD of the SPA — so the SPA (and with it the `#admin` email +
 * password form) never mounts. The gate's admin exemption
 * (gate-enforcement.ts → requireStorefrontAdmin) only helps someone who is
 * ALREADY signed in, and `sf_admin_session` is deleted on every document load
 * (admin-session-reset.ts), so a store owner arriving at `<slug>.<root>/#admin`
 * was forced to type the visitor code before they could type their credentials.
 *
 * The fix is client-side, because the hash is: while the wall is up, it reads
 * the URL hash and renders the store-admin login instead of the code form when
 * the visitor is on `#admin`. The store itself stays walled either way.
 *
 * Runs the REAL pure module (no DB, no Next runtime, no browser) plus wiring
 * assertions against the component/layout sources, since the render decision is
 * what actually fixes the bug:
 *
 *   npm run test:gate-admin-login
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveGateSurface } from "../src/lib/auth/gate-surface";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

console.log("visitor gate — store-admin sign-in reachability");

// ──────────────────────────── 1. the surface decision ───────────────────────

check("a visitor at #admin gets the store-admin login, not the code wall", () => {
  assert.equal(resolveGateSurface("#admin"), "admin-login");
});

check("every other visitor still gets the access-code wall", () => {
  for (const hash of ["", "#", "#catalog", "#track", "#groupbuy", "#faq"]) {
    assert.equal(resolveGateSurface(hash), "wall", `hash ${JSON.stringify(hash)}`);
  }
});

check("a missing hash (server render, no window) falls back to the wall", () => {
  assert.equal(resolveGateSurface(undefined), "wall");
  assert.equal(resolveGateSurface(null), "wall");
});

check("near-miss hashes do NOT open the admin surface", () => {
  // Exact-match only, mirroring the SPA router. A lenient match would show the
  // login form for a hash the SPA would then route to the home page.
  for (const hash of ["#adminx", "#admin/orders", "#Admin", "#ADMIN", "# admin", "#/admin"]) {
    assert.equal(resolveGateSurface(hash), "wall", `hash ${JSON.stringify(hash)}`);
  }
});

check("the wall's route table cannot drift from the SPA's", () => {
  // The SPA owns the real hash router (StorefrontApp.tsx). If "admin" ever stops
  // being one of its routes, or another route starts resolving to the login,
  // this fails instead of silently exposing/hiding the wrong surface.
  const app = read("src/storefront/StorefrontApp.tsx");
  const match = app.match(/const ROUTES = \[([^\]]*)\]/);
  assert.ok(match, "could not find the SPA ROUTES table");
  const routes = match![1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  assert.ok(routes.includes("admin"), "SPA no longer routes #admin");
  for (const route of routes) {
    const expected = route === "admin" ? "admin-login" : "wall";
    assert.equal(resolveGateSurface(`#${route}`), expected, `route #${route}`);
  }
});

// ──────────────────────────── 2. the wall is actually wired to it ───────────

check("the access wall renders the store-admin login on the admin surface", () => {
  const gate = read("src/storefront/components/AccessCodeGate.tsx");
  assert.match(gate, /resolveGateSurface/, "wall does not consult resolveGateSurface");
  assert.match(gate, /AdminLogin/, "wall never renders the store-admin login");
  assert.match(gate, /admin-login/, "wall has no admin-login branch");
});

check("the wall re-decides when the visitor navigates to #admin", () => {
  // Arriving at the wall and THEN typing #admin must swap the surface — the
  // storefront never reloads on a hash change, so without this listener the
  // owner would stare at the code form on the right URL.
  const gate = read("src/storefront/components/AccessCodeGate.tsx");
  assert.match(gate, /hashchange/, "wall does not listen for hashchange");
});

check("the admin login is styled by the storefront scope so it isn't unstyled", () => {
  // .admin-login rules all live under `.sf-root` in storefront.css; rendering
  // the form outside that scope would ship a naked form.
  const gate = read("src/storefront/components/AccessCodeGate.tsx");
  assert.match(gate, /sf-root/, "admin login is rendered outside the .sf-root scope");
  const css = read("src/storefront/storefront.css");
  assert.match(css, /\.sf-root \.admin-login\b/, "admin-login styles are not .sf-root scoped");
});

// ──────────────────────────── 3. the store stays walled ─────────────────────

check("the layout still returns the wall instead of the store when blocked", () => {
  // The fix must open the LOGIN, never the storefront. The blocked branch must
  // still early-return the wall rather than fall through to {children}.
  const layout = read("src/app/(tenant)/(storefront)/layout.tsx");
  const blocked = layout.slice(layout.indexOf('gateDecision.status === "blocked"'));
  const body = blocked.slice(0, blocked.indexOf("gateHeartbeat"));
  assert.match(body, /return \(/, "blocked branch no longer early-returns");
  assert.match(body, /<AccessCodeGate/, "blocked branch no longer renders the wall");
  assert.ok(!body.includes("{children}"), "blocked branch leaks the storefront to a walled visitor");
});

check("the server-side gate decision is unchanged by this fix", () => {
  // Nothing here may weaken evaluateVisitorGate: an anonymous visitor is still
  // blocked, and only a verified admin session is exempted server-side.
  const enforcement = read("src/lib/auth/gate-enforcement.ts");
  assert.match(enforcement, /requireStorefrontAdmin\(\)/, "admin exemption removed");
  assert.match(enforcement, /status: "blocked"/, "gate no longer blocks anyone");
  assert.ok(
    !enforcement.includes("gate-surface"),
    "the client hash must never influence the server gate decision",
  );
});

// ──────────────────────────── result ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
