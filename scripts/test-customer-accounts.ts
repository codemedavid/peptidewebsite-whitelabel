/**
 * Storefront customer accounts — the pure core behind sign-up, sign-in and
 * "My Account" on every tenant's storefront.
 *
 * A customer account is PER TENANT: signing up on store A creates nothing on
 * store B, and a session cookie minted on A must never open B's account page.
 * These are the properties the server actions lean on.
 *
 *   npm run test:customer-accounts
 */

import assert from "node:assert";

import { encodeCustomerToken, verifyCustomerToken } from "../src/lib/auth/customer-token";
import { encodeResellerToken } from "../src/lib/auth/reseller-token";
import { encodeGateToken } from "../src/lib/auth/gate-token";
import {
  normalizeCustomerEmail,
  parseCustomerSignUp,
  parseCustomerSignIn,
  parseCustomerProfile,
  parseCustomerPasswordChange,
  resolveCustomerSession,
  generateTempPassword,
  TEMP_PASSWORD_ALPHABET,
  CUSTOMER_PASSWORD_MIN,
} from "../src/lib/storefront/customer-account";
import { FEATURES, OPERATOR_GRANTABLE, PLAN_FEATURES } from "../src/lib/features/catalog";
import { isPageVisible, isAdminViewVisible, isLinkHidden } from "../src/storefront/visibility";
import { STAFF_MODULE_KEYS } from "../src/storefront/admin/staff-permissions";
import { ADMIN_NAV } from "../src/storefront/admin/admin-nav";
import { toTrackedOrder } from "../src/lib/orders/tracked-order";
import type { Brand, Order } from "../src/storefront/types";

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
const now = () => Math.floor(Date.now() / 1000);
const fresh = (
  over: Partial<{ tenantId: string; customerId: string; sessionVersion: number; iat: number; exp: number }> = {},
) => ({
  tenantId: "tenant-a",
  customerId: "cust-1",
  sessionVersion: 1,
  iat: now(),
  exp: now() + 3600,
  ...over,
});

console.log("\nCustomer session token");

check("round-trips a valid token", () => {
  const t = encodeCustomerToken(fresh(), SECRET);
  const p = verifyCustomerToken(t, SECRET);
  assert.ok(p);
  assert.equal(p.tenantId, "tenant-a");
  assert.equal(p.customerId, "cust-1");
  assert.equal(p.sessionVersion, 1);
});

check("rejects a tampered payload", () => {
  const t = encodeCustomerToken(fresh(), SECRET);
  const [, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...fresh({ customerId: "cust-2" }), scope: "customer.v1" })).toString("base64url");
  assert.equal(verifyCustomerToken(`${forged}.${sig}`, SECRET), null);
});

check("rejects a token signed with another secret", () => {
  const t = encodeCustomerToken(fresh(), "other-secret");
  assert.equal(verifyCustomerToken(t, SECRET), null);
});

check("rejects an expired token", () => {
  const t = encodeCustomerToken(fresh({ iat: now() - 100, exp: now() - 10 }), SECRET);
  assert.equal(verifyCustomerToken(t, SECRET), null);
});

check("rejects a reseller-portal token (domain separation)", () => {
  const t = encodeResellerToken({ tenantId: "tenant-a", codeVersion: 1, iat: now(), exp: now() + 3600 }, SECRET);
  assert.equal(verifyCustomerToken(t, SECRET), null);
});

check("rejects a visitor access-gate token (domain separation)", () => {
  const t = encodeGateToken({ tenantId: "tenant-a", codeVersion: 1, iat: now(), exp: now() + 3600 }, SECRET);
  assert.equal(verifyCustomerToken(t, SECRET), null);
});

check("rejects garbage", () => {
  assert.equal(verifyCustomerToken("", SECRET), null);
  assert.equal(verifyCustomerToken("no-dot", SECRET), null);
  assert.equal(verifyCustomerToken("a.b", SECRET), null);
});

console.log("\nSession resolution (token × DB row × request tenant)");

const row = { id: "cust-1", tenantId: "tenant-a", status: "active", sessionVersion: 1 };

check("a matching session resolves to the customer", () => {
  assert.equal(resolveCustomerSession(fresh(), row, "tenant-a"), "cust-1");
});

check("a cookie from store A never opens store B", () => {
  assert.equal(resolveCustomerSession(fresh(), row, "tenant-b"), null);
  assert.equal(resolveCustomerSession(fresh({ tenantId: "tenant-b" }), row, "tenant-b"), null);
});

check("a bumped sessionVersion (password change / sign out everywhere) revokes it", () => {
  assert.equal(resolveCustomerSession(fresh(), { ...row, sessionVersion: 2 }, "tenant-a"), null);
});

check("a disabled account is signed out on its next request", () => {
  assert.equal(resolveCustomerSession(fresh(), { ...row, status: "disabled" }, "tenant-a"), null);
});

check("a deleted account (no row) resolves to nobody", () => {
  assert.equal(resolveCustomerSession(fresh(), null, "tenant-a"), null);
});

check("the token's customerId must be the row's id", () => {
  assert.equal(resolveCustomerSession(fresh({ customerId: "cust-9" }), row, "tenant-a"), null);
});

check("no token → nobody", () => {
  assert.equal(resolveCustomerSession(null, row, "tenant-a"), null);
});

console.log("\nInput validation");

check("emails are trimmed and lower-cased so one person is one account", () => {
  assert.equal(normalizeCustomerEmail("  Ana.Cruz@Example.COM "), "ana.cruz@example.com");
});

check("sign-up accepts a well-formed form", () => {
  const r = parseCustomerSignUp({ name: " Ana Cruz ", email: "ANA@x.com", phone: " 0917 000 0000 ", password: "correct horse" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, { name: "Ana Cruz", email: "ana@x.com", phone: "0917 000 0000", password: "correct horse" });
  }
});

check("sign-up keeps the password exactly as typed (no trimming)", () => {
  const r = parseCustomerSignUp({ name: "A", email: "a@x.com", password: "  spaced pw  " });
  assert.ok(r.ok && r.value.password === "  spaced pw  ");
});

check("sign-up rejects a bad email", () => {
  for (const email of ["", "nope", "a@b", "a b@c.com", "@x.com"]) {
    const r = parseCustomerSignUp({ name: "A", email, password: "longenough" });
    assert.ok(!r.ok, `accepted ${JSON.stringify(email)}`);
  }
});

check(`sign-up rejects a password under ${CUSTOMER_PASSWORD_MIN} characters`, () => {
  const r = parseCustomerSignUp({ name: "A", email: "a@x.com", password: "short" });
  assert.ok(!r.ok);
});

check("sign-up rejects an absurdly long password (scrypt DoS guard)", () => {
  const r = parseCustomerSignUp({ name: "A", email: "a@x.com", password: "x".repeat(1000) });
  assert.ok(!r.ok);
});

check("sign-up requires a name", () => {
  const r = parseCustomerSignUp({ name: "   ", email: "a@x.com", password: "longenough" });
  assert.ok(!r.ok);
});

check("sign-up survives non-object / non-string input", () => {
  assert.ok(!parseCustomerSignUp(null).ok);
  assert.ok(!parseCustomerSignUp({ name: 1, email: {}, password: [] }).ok);
});

check("phone is optional and capped", () => {
  const r = parseCustomerSignUp({ name: "A", email: "a@x.com", password: "longenough", phone: "9".repeat(200) });
  assert.ok(r.ok && r.value.phone.length <= 40);
});

check("sign-in normalizes the email and does not validate password length", () => {
  // An old, short password must still reach verifyPassword — sign-in never
  // tells a user their password is "too short", which would leak policy/state.
  const r = parseCustomerSignIn({ email: " A@X.com", password: "abc" });
  assert.ok(r.ok && r.value.email === "a@x.com" && r.value.password === "abc");
});

check("sign-in rejects an empty password", () => {
  assert.ok(!parseCustomerSignIn({ email: "a@x.com", password: "" }).ok);
});

check("profile update requires a name, caps phone", () => {
  assert.ok(!parseCustomerProfile({ name: "" }).ok);
  const r = parseCustomerProfile({ name: " Ana ", phone: " 123 " });
  assert.ok(r.ok && r.value.name === "Ana" && r.value.phone === "123");
});

check("password change enforces the new-password rule", () => {
  assert.ok(!parseCustomerPasswordChange({ current: "old", next: "short" }).ok);
  assert.ok(!parseCustomerPasswordChange({ current: "", next: "long enough" }).ok);
  assert.ok(parseCustomerPasswordChange({ current: "old", next: "long enough" }).ok);
});

console.log("\nFeature gating (default OFF, operator-grantable)");

check("the feature is operator-grantable and in NO plan ceiling", () => {
  assert.ok(OPERATOR_GRANTABLE.has(FEATURES.STORE_CUSTOMER_ACCOUNTS));
  for (const [plan, keys] of Object.entries(PLAN_FEATURES)) {
    assert.ok(!(keys as readonly string[]).includes(FEATURES.STORE_CUSTOMER_ACCOUNTS), `in ${plan} ceiling`);
  }
});

check("#account and the Customers view are hidden until granted", () => {
  const off = {} as Brand;
  assert.equal(isPageVisible(off, "account"), false);
  assert.equal(isLinkHidden(off, "#account"), true);
  assert.equal(isAdminViewVisible(off, "customers"), false);
  const on = { customerAccountsEnabled: true } as Brand;
  assert.equal(isPageVisible(on, "account"), true);
  assert.equal(isAdminViewVisible(on, "customers"), true);
});

check("Customers is a staff-grantable module and in the admin nav", () => {
  assert.ok(STAFF_MODULE_KEYS.includes("customers"));
  assert.ok(ADMIN_NAV.some((i) => i.view === "customers"));
});

console.log("\nCustomer-facing order view");

check("the tracked view carries no customer PII or proof", () => {
  const order = {
    id: "o1", orderNumber: "HP-1", status: "shipped", date: "2026-09-01T00:00:00.000Z",
    customer: { name: "Ana", email: "ana@x.com", phone: "0917" },
    shipping: { address: "1 Secret St", fee: 100 }, items: [{ name: "BPC", qty: 2, price: 500 }],
    paymentProof: "https://ik/proof.png", courier: "LBC", trackingNumber: "T1", shippingNote: "",
  } as unknown as Order;
  const json = JSON.stringify(toTrackedOrder(order));
  for (const secret of ["ana@x.com", "0917", "Secret St", "proof.png"]) {
    assert.ok(!json.includes(secret), `leaked ${secret}`);
  }
  assert.equal(toTrackedOrder(order).shippingFee, 100);
});

console.log("\nOwner password reset");

check("a temp password clears the sign-up minimum and reads aloud cleanly", () => {
  for (let i = 0; i < 200; i++) {
    const pw = generateTempPassword();
    assert.ok(pw.length >= CUSTOMER_PASSWORD_MIN, `too short: ${pw}`);
    assert.ok([...pw].every((ch) => TEMP_PASSWORD_ALPHABET.includes(ch)), `off-alphabet char in ${pw}`);
  }
  for (const ambiguous of ["0", "O", "o", "1", "l", "I", "i"]) {
    assert.ok(!TEMP_PASSWORD_ALPHABET.includes(ambiguous), `ambiguous ${ambiguous}`);
  }
});

check("temp passwords don't repeat", () => {
  const seen = new Set(Array.from({ length: 500 }, () => generateTempPassword()));
  assert.equal(seen.size, 500);
});

check("the reset action rotates the session and is staff-gated", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("src/actions/customer-accounts.ts", "utf8");
  const body = src.slice(src.indexOf("export async function resetStoreCustomerPasswordAction"));
  assert.ok(body.length > 0, "resetStoreCustomerPasswordAction missing");
  const fn = body.slice(0, body.indexOf("\n}\n"));
  assert.ok(fn.includes("adminTenant()"), "not behind the customers permission");
  assert.ok(fn.includes("sessionVersion: { increment: 1 }"), "reset must sign out every device");
  assert.ok(fn.includes("tenantId"), "write must be scoped to the tenant");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
