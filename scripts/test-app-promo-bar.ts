/**
 * "Get our app" bar on the store's website — the rules (src/lib/storefront/app-promo.ts).
 *   npm run test:app-promo-bar
 */
import assert from "node:assert/strict";
import { normalizeAppPromo, showAppPromo } from "../src/lib/storefront/app-promo";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

console.log("app promo bar");

check("off unless saved on; junk is off", () => {
  assert.deepEqual(normalizeAppPromo(undefined), { enabled: false });
  assert.deepEqual(normalizeAppPromo({ enabled: "true" }), { enabled: false });
  assert.deepEqual(normalizeAppPromo("on"), { enabled: false });
  assert.deepEqual(normalizeAppPromo({ enabled: true }), { enabled: true });
});

check("shows only when switched on AND the store's customer app is open", () => {
  assert.equal(showAppPromo({ enabled: true }, true, "/"), true);
  assert.equal(showAppPromo({ enabled: true }, false, "/"), false, "no app (no shop, no community) → never advertised");
  assert.equal(showAppPromo({ enabled: false }, true, "/"), false);
});

check("never on the download page itself", () => {
  assert.equal(showAppPromo({ enabled: true }, true, "/app"), false);
  assert.equal(showAppPromo({ enabled: true }, true, "/app?from=bio"), false);
  assert.equal(showAppPromo({ enabled: true }, true, "/app/anything"), false);
  assert.equal(showAppPromo({ enabled: true }, true, "/apparel"), true, "only /app, not every path starting with it");
  assert.equal(showAppPromo({ enabled: true }, true, "/p/bpc-157"), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
