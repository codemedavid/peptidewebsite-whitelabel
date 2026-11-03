/**
 * Members-only store: sign in or create an account before the shop renders.
 * Asked for by mnm-pepsabuy ("log in like create acc muna before directing to
 * the shop"), built SaaS-wide as an owner switch in store admin → Customers.
 *
 *   npm run test:account-gate
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideAccountGate,
  normalizeAccountGate,
  type AccountGateInput,
} from "../src/lib/storefront/account-gate";

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

const ON: AccountGateInput = {
  demo: false,
  accountsOn: true,
  config: { enabled: true },
  isAdmin: false,
  hasCustomer: false,
};

console.log("\naccount gate — config");

check("missing or malformed config is OFF", () => {
  for (const raw of [undefined, null, "yes", 1, {}, { enabled: "true" }, { enabled: 1 }]) {
    assert.deepEqual(normalizeAccountGate(raw), { enabled: false }, JSON.stringify(raw));
  }
});

check("only enabled: true turns it on", () => {
  assert.deepEqual(normalizeAccountGate({ enabled: true, extra: "x" }), { enabled: true });
});

console.log("\naccount gate — decision");

check("a signed-out visitor sees the wall", () => {
  assert.equal(decideAccountGate(ON), "blocked");
});

check("a signed-in customer gets the shop", () => {
  assert.equal(decideAccountGate({ ...ON, hasCustomer: true }), "open");
});

check("the store admin is never walled", () => {
  assert.equal(decideAccountGate({ ...ON, isAdmin: true }), "open");
});

check("switched off → no wall", () => {
  assert.equal(decideAccountGate({ ...ON, config: { enabled: false } }), "off");
});

check("accounts revoked → no wall (a sign-in form with no accounts locks everyone out)", () => {
  assert.equal(decideAccountGate({ ...ON, accountsOn: false }), "off");
});

check("demo mode → no wall", () => {
  assert.equal(decideAccountGate({ ...ON, demo: true }), "off");
});

console.log("\naccount gate — wiring");

check("layout renders the wall after the access-code gate", () => {
  const src = read("src/app/(tenant)/(storefront)/layout.tsx");
  const code = src.indexOf("evaluateVisitorGate(tenantId)");
  const account = src.indexOf("evaluateAccountGate(tenantId");
  assert.ok(code > 0 && account > code, "account gate must run after the code gate");
  assert.match(src, /=== "blocked"\) \{[\s\S]*?<AccountGate/);
});

check("the wall offers the store-admin sign-in on #admin", () => {
  const src = read("src/storefront/components/AccountGate.tsx");
  assert.match(src, /resolveGateSurface\(window\.location\.hash\)/);
  assert.match(src, /<AdminLogin/);
  assert.match(src, /router\.refresh\(\)/);
  assert.doesNotMatch(src, /location\.reload\(/, "a hard reload of #admin ends the admin session");
});

check("signing out re-runs the layout so the wall comes back", () => {
  const src = read("src/storefront/pages/AccountPage.tsx");
  assert.match(src, /if \(!a\) \{\s*router\.refresh\(\);/);
});

check("the owner switch checks the Customers grant and the accounts entitlement", () => {
  const src = read("src/actions/account-gate.ts");
  assert.match(src, /requireStaffPermission\("customers"\)/);
  assert.match(src, /FEATURES\.STORE_CUSTOMER_ACCOUNTS/);
  assert.match(src, /revalidateTenant\(/);
});

check("Customers admin shows the switch", () => {
  assert.match(read("src/storefront/admin/AdminCustomers.tsx"), /<AdminMemberSignIn \/>/);
});

check("the storefront page sends NOTHING to a walled-out visitor (no catalog in the gate's payload)", () => {
  const home = read("src/app/(tenant)/(storefront)/storefront-home.tsx");
  const guard = home.indexOf("isStorefrontBlocked(tenantId)) return null");
  const load = home.indexOf("loadStorefrontBrand({");
  assert.ok(guard > 0, "storefront-home checks isStorefrontBlocked");
  assert.ok(guard < load, "the check runs before the catalog is loaded");
  const blocked = read("src/lib/auth/storefront-blocked.ts");
  assert.match(blocked, /evaluateVisitorGate/);
  assert.match(blocked, /evaluateAccountGate/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
