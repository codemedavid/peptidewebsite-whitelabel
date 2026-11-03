/**
 * Store admin signs out on a refresh of the ADMIN PAGE — and only then.
 *
 * The bug (mnm-pepsabuy, 2026-10-30): middleware deleted `sf_admin_session` on
 * every document load of the storefront, so opening the shop in another tab
 * (or the pop-up editor's "show on store") silently ended the admin session.
 * The next save then found no session and AdminPage sent the owner to the
 * storefront, with no visible way back to the dashboard.
 *
 * Covers the pure decision (lib/auth/admin-refresh-logout.ts) plus the wiring
 * that actually fixes it:
 *
 *   npm run test:admin-refresh-logout
 */

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAdminPageReload, readNavigationType } from "../src/lib/auth/admin-refresh-logout";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("\nadmin refresh logout — decision");

check("reloading #admin signs the admin out", () => {
  assert.equal(isAdminPageReload("reload", "#admin"), true);
});

check("opening the shop in a new tab does not", () => {
  assert.equal(isAdminPageReload("navigate", ""), false);
  assert.equal(isAdminPageReload("navigate", "#groupbuy"), false);
});

check("pasting the admin link into a new tab keeps the session", () => {
  assert.equal(isAdminPageReload("navigate", "#admin"), false);
});

check("reloading a shop page (not the admin) keeps the session", () => {
  assert.equal(isAdminPageReload("reload", ""), false);
  assert.equal(isAdminPageReload("reload", "#account"), false);
});

check("back/forward into #admin keeps the session", () => {
  assert.equal(isAdminPageReload("back_forward", "#admin"), false);
});

check("hash match is exact, like the SPA router", () => {
  assert.equal(isAdminPageReload("reload", "#admin/"), false);
  assert.equal(isAdminPageReload("reload", "#administrator"), false);
});

check("unknown navigation type never signs out", () => {
  assert.equal(isAdminPageReload(null, "#admin"), false);
});

console.log("\nadmin refresh logout — reading the browser");

check("reads the Navigation Timing entry", () => {
  assert.equal(readNavigationType({ getEntriesByType: () => [{ type: "reload" }] }), "reload");
});

check("falls back to the legacy performance.navigation codes", () => {
  assert.equal(readNavigationType({ getEntriesByType: () => [], navigation: { type: 1 } }), "reload");
  assert.equal(readNavigationType({ navigation: { type: 0 } }), "navigate");
});

check("no performance API → null", () => {
  assert.equal(readNavigationType(undefined), null);
  assert.equal(readNavigationType({}), null);
  assert.equal(readNavigationType({ navigation: { type: 9 } }), null);
});

console.log("\nadmin refresh logout — wiring");

check("middleware no longer ends the admin session on document loads", () => {
  const src = read("src/middleware.ts");
  assert.doesNotMatch(src, /clearStoreAdminSessionOnDocumentLoad\s*\(/);
  assert.equal(existsSync(join(process.cwd(), "src/lib/auth/admin-session-reset.ts")), false);
});

check("StorefrontApp signs out on an admin-page reload, verifies otherwise", () => {
  const src = read("src/storefront/StorefrontApp.tsx");
  assert.match(src, /isAdminPageReload\(readNavigationType\(window\.performance\), window\.location\.hash\)/);
  assert.match(src, /signOutStorefrontAdminAction\(\)/);
});

check("a lost session shows the admin sign-in, not the shop", () => {
  const page = read("src/storefront/admin/AdminPage.tsx");
  assert.match(page, /info\.kind === "none"\) \{\s*onSessionLost\(\);/);
  const app = read("src/storefront/StorefrontApp.tsx");
  assert.match(app, /onSessionLost=\{adminSessionLost\}/);
  assert.match(app, /useCallback\(\(\) => setAdminAuth\("out"\), \[\]\)/, "stable, or AdminPage re-checks on every render");
});

check("View website and the pop-up preview open the shop in a new tab", () => {
  const app = read("src/storefront/StorefrontApp.tsx");
  assert.match(app, /onExitToSite=\{viewSiteFromAdmin\}/);
  assert.match(app, /window\.open\("\/", "_blank", "noopener"\)/);
  const popup = read("src/storefront/admin/AdminAnnouncementPopup.tsx");
  assert.doesNotMatch(popup, /window\.location\.href = "\/"/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
