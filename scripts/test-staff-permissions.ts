/**
 * Self-contained test for the Staff Accounts feature's pure core. Runs the REAL
 * modules (no DB, no Next runtime, no cookies, no network):
 *
 *   - storefront/admin/staff-permissions.ts — the permission registry + the
 *     owner/staff access rules that gate BOTH the admin menu (client) and every
 *     store-admin server action. This is the single source of truth for "which
 *     module is this actor allowed to touch".
 *   - lib/auth/storefront-session-token.ts — the pure, injectable HMAC codec for
 *     the `sf_admin_session` cookie. It now carries a SUBJECT (owner | staff:<id>)
 *     so the server knows WHO is signed in, while staying backward-compatible with
 *     the legacy 2-part owner token already live in browsers.
 *
 *   npm run test:staff
 */

import assert from "node:assert";
import { createHmac } from "node:crypto";

import {
  STAFF_MODULES,
  STAFF_MODULE_KEYS,
  ALWAYS_ALLOWED_VIEWS,
  isValidModuleKey,
  quickActionToView,
  permissionViewFor,
  isViewAllowed,
  isModuleAllowed,
  sanitizePermissions,
  type StaffActor,
} from "../src/storefront/admin/staff-permissions";

import {
  encodeSessionToken,
  decodeSessionToken,
  type SessionSubject,
} from "../src/lib/auth/storefront-session-token";

import {
  FEATURES,
  OPERATOR_GRANTABLE,
  planFeatureSet,
} from "../src/lib/features/catalog";
import { isAdminViewVisible } from "../src/storefront/visibility";
import type { Brand } from "../src/storefront/types";

import {
  parseStaffCreate,
  parseStaffUpdate,
  isReservedUsername,
} from "../src/lib/storefront/staff-input";

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

const OWNER: StaffActor = { kind: "owner" };
const staff = (...permissions: string[]): StaffActor => ({ kind: "staff", id: "stf_1", permissions });

console.log("\nStaff Accounts — pure-core gate\n");

// ─────────────────────────── permission registry ────────────────────────────
console.log("permission registry");

// The 16 modules the spec enumerates by name → their canonical (View-id) keys.
const SPEC_KEYS = [
  "add-product", // Add Product
  "products", // Manage Products
  "categories", // Categories
  "hero", // Hero Section
  "orders", // Orders
  "inv", // Inventory
  "shipping", // Shipping
  "fee", // Checkout Fee
  "couriers", // Couriers
  "lab", // Lab Results
  "promo", // Promo Codes
  "pay", // Payments
  "faq", // FAQ
  "proto", // Protocols
  "reseller", // Reseller Portal
  // (Account Settings is always-allowed, not a grantable module — see below.)
];

check("covers every module the spec enumerates", () => {
  for (const k of SPEC_KEYS) {
    assert.ok(STAFF_MODULE_KEYS.includes(k), `missing spec module: ${k}`);
  }
});

check("ALSO covers the other gateable admin views (no silent security holes)", () => {
  // These exist in AdminPage's quickActions but aren't in the spec table. They
  // MUST still be gated for staff, or a staff member would see them ungated.
  for (const k of ["design", "analytics", "reviews", "access-code", "checkout", "groupbuys"]) {
    assert.ok(STAFF_MODULE_KEYS.includes(k), `ungated extra view: ${k}`);
  }
});

check("module keys are unique and each has a human label", () => {
  const seen = new Set<string>();
  for (const m of STAFF_MODULES) {
    assert.ok(m.key && typeof m.key === "string", "key present");
    assert.ok(m.label && typeof m.label === "string", `label for ${m.key}`);
    assert.ok(!seen.has(m.key), `duplicate key: ${m.key}`);
    seen.add(m.key);
  }
});

check("does NOT expose always-allowed views (dashboard/account) as grantable modules", () => {
  assert.ok(!STAFF_MODULE_KEYS.includes("dashboard"));
  assert.ok(!STAFF_MODULE_KEYS.includes("account"));
});

check("dashboard + account are always-allowed (every signed-in admin reaches them)", () => {
  assert.ok(ALWAYS_ALLOWED_VIEWS.has("dashboard"));
  assert.ok(ALWAYS_ALLOWED_VIEWS.has("account"));
});

// ─────────────────────────── isValidModuleKey ───────────────────────────────
console.log("\nisValidModuleKey (server-action guard input)");

check("accepts canonical module keys", () => {
  for (const k of STAFF_MODULE_KEYS) assert.equal(isValidModuleKey(k), true, k);
});

check("rejects unknown / empty / reserved keys", () => {
  for (const k of ["", "owner", "dashboard", "bogus", "ORDERS", "logout"]) {
    assert.equal(isValidModuleKey(k), false, k);
  }
});

// ─────────────────────── quickAction → view mapping ─────────────────────────
console.log("\nquickActionToView (menu id → canonical view id)");

check("maps the four mismatched menu ids to their view id", () => {
  assert.equal(quickActionToView("add"), "add-product");
  assert.equal(quickActionToView("manage"), "products");
  assert.equal(quickActionToView("cats"), "categories");
  assert.equal(quickActionToView("ship"), "shipping");
});

check("passes matching ids through unchanged", () => {
  for (const id of ["orders", "inv", "lab", "promo", "pay", "faq", "proto", "hero", "account"]) {
    assert.equal(quickActionToView(id), id, id);
  }
});

// ─────────────────────── permissionViewFor normalization ────────────────────
console.log("\npermissionViewFor (sub-view → gating module)");

check("order-detail is gated under the orders permission", () => {
  assert.equal(permissionViewFor("order-detail"), "orders");
});

check("other views map to themselves", () => {
  assert.equal(permissionViewFor("pay"), "pay");
  assert.equal(permissionViewFor("orders"), "orders");
});

// ───────────────────────────── owner access ─────────────────────────────────
console.log("\nisViewAllowed / isModuleAllowed — OWNER has everything");

check("owner can reach any view, including unknown ones", () => {
  for (const v of ["orders", "pay", "design", "groupbuys", "anything-new"]) {
    assert.equal(isViewAllowed(OWNER, v), true, v);
  }
});

check("owner passes every module guard", () => {
  for (const k of STAFF_MODULE_KEYS) assert.equal(isModuleAllowed(OWNER, k), true, k);
});

// ───────────────────────────── staff access ─────────────────────────────────
console.log("\nisViewAllowed — STAFF sees only granted modules + always-allowed");

const opsStaff = staff("orders", "inv", "lab"); // the spec's example staff

check("granted views are visible", () => {
  assert.equal(isViewAllowed(opsStaff, "orders"), true);
  assert.equal(isViewAllowed(opsStaff, "inv"), true);
  assert.equal(isViewAllowed(opsStaff, "lab"), true);
});

check("ungranted views are hidden", () => {
  for (const v of ["pay", "products", "faq", "promo", "hero", "shipping", "design"]) {
    assert.equal(isViewAllowed(opsStaff, v), false, v);
  }
});

check("dashboard + account stay visible even with zero grants", () => {
  const none = staff();
  assert.equal(isViewAllowed(none, "dashboard"), true);
  assert.equal(isViewAllowed(none, "account"), true);
});

check("order-detail follows the orders grant", () => {
  assert.equal(isViewAllowed(opsStaff, "order-detail"), true);
  assert.equal(isViewAllowed(staff("inv"), "order-detail"), false);
});

check("Manage Products grant lets a staffer open the editor (add-product view)", () => {
  // Editing an existing product reuses the add-product view, so a 'products'
  // (manage) grant must be able to reach it — otherwise Edit is dead.
  assert.equal(isViewAllowed(staff("products"), "add-product"), true);
});

check("Add Product grant alone does NOT unlock the manage list", () => {
  assert.equal(isViewAllowed(staff("add-product"), "add-product"), true);
  assert.equal(isViewAllowed(staff("add-product"), "products"), false);
});

console.log("\nisModuleAllowed — STRICT per-key check (server enforcement)");

check("staff module guard is exact: no implies, no always-allowed leakage", () => {
  assert.equal(isModuleAllowed(opsStaff, "orders"), true);
  assert.equal(isModuleAllowed(opsStaff, "pay"), false);
  // 'products' does NOT auto-grant the 'add-product' CREATE capability server-side.
  assert.equal(isModuleAllowed(staff("products"), "add-product"), false);
  assert.equal(isModuleAllowed(staff("add-product"), "add-product"), true);
});

// ───────────────────────── sanitizePermissions ──────────────────────────────
console.log("\nsanitizePermissions (coerce untrusted form input)");

check("keeps only valid module keys, de-duplicated", () => {
  const out = sanitizePermissions(["orders", "orders", "pay", "bogus", "", "owner"]);
  assert.deepEqual([...out].sort(), ["orders", "pay"]);
});

check("non-array input collapses to an empty grant set", () => {
  assert.deepEqual(sanitizePermissions(null), []);
  assert.deepEqual(sanitizePermissions("orders"), []);
  assert.deepEqual(sanitizePermissions(undefined), []);
});

// ─────────────────────── session token codec ────────────────────────────────
console.log("\nstorefront-session-token — owner/staff subject + back-compat");

const SECRET = "test-secret-key-please-ignore-0123456789";
const NOW = 1_700_000_000_000; // fixed clock
const TTL = 60 * 60 * 24 * 7;

check("owner token round-trips", () => {
  const owner: SessionSubject = { kind: "owner" };
  const token = encodeSessionToken(SECRET, "tnt_abc", owner, TTL, NOW);
  const out = decodeSessionToken(SECRET, token, NOW);
  assert.ok(out, "decodes");
  assert.equal(out!.tenantId, "tnt_abc");
  assert.deepEqual(out!.subject, { kind: "owner" });
});

check("staff token round-trips with its id", () => {
  const subj: SessionSubject = { kind: "staff", id: "stf_xyz" };
  const token = encodeSessionToken(SECRET, "tnt_abc", subj, TTL, NOW);
  const out = decodeSessionToken(SECRET, token, NOW);
  assert.ok(out, "decodes");
  assert.equal(out!.tenantId, "tnt_abc");
  assert.deepEqual(out!.subject, { kind: "staff", id: "stf_xyz" });
});

check("a legacy 2-part owner token (no subject) still decodes as owner", () => {
  // Mint the OLD format exactly as the live storefront-admin.ts does today:
  //   payload = `${tenantId}.${expiresAt}`  ;  token = `${payload}.${sig}`
  const expiresAt = Math.floor(NOW / 1000) + TTL;
  const payload = `tnt_legacy.${expiresAt}`;
  const sig = createHmac("sha256", Buffer.from(SECRET, "utf8")).update(payload).digest("base64url");
  const legacy = `${payload}.${sig}`;
  const out = decodeSessionToken(SECRET, legacy, NOW);
  assert.ok(out, "legacy decodes");
  assert.equal(out!.tenantId, "tnt_legacy");
  assert.deepEqual(out!.subject, { kind: "owner" });
});

check("an expired token is rejected", () => {
  const token = encodeSessionToken(SECRET, "tnt_abc", { kind: "owner" }, TTL, NOW);
  const later = NOW + (TTL + 1) * 1000;
  assert.equal(decodeSessionToken(SECRET, token, later), null);
});

check("a tampered signature is rejected", () => {
  const token = encodeSessionToken(SECRET, "tnt_abc", { kind: "owner" }, TTL, NOW);
  const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
  assert.equal(decodeSessionToken(SECRET, tampered, NOW), null);
});

check("a token signed with a different secret is rejected", () => {
  const token = encodeSessionToken(SECRET, "tnt_abc", { kind: "owner" }, TTL, NOW);
  assert.equal(decodeSessionToken("a-totally-different-secret", token, NOW), null);
});

check("a tampered subject (without re-signing) is rejected", () => {
  const token = encodeSessionToken(SECRET, "tnt_abc", { kind: "staff", id: "stf_1" }, TTL, NOW);
  // Swap the subject text but keep the original signature → must fail.
  const forged = token.replace("staff:stf_1", "owner");
  assert.notEqual(forged, token);
  assert.equal(decodeSessionToken(SECRET, forged, NOW), null);
});

check("garbage / malformed tokens return null, never throw", () => {
  for (const t of ["", "x", "a.b", "....", "no-dots-at-all"]) {
    assert.equal(decodeSessionToken(SECRET, t, NOW), null, t);
  }
});

check("an unknown subject tag is rejected", () => {
  // Forge a well-signed token whose subject is neither owner nor staff:* .
  const expiresAt = Math.floor(NOW / 1000) + TTL;
  const payload = `tnt_abc.robot.${expiresAt}`;
  const sig = createHmac("sha256", Buffer.from(SECRET, "utf8")).update(payload).digest("base64url");
  assert.equal(decodeSessionToken(SECRET, `${payload}.${sig}`, NOW), null);
});

// ─────────────────── store-admin login (email + password) ───────────────────
// resolveStoreAdminLogin now takes an EMAIL, verifies the owner against a scrypt
// hash, and fails closed when a tenant has no credential set. Its cases live in
// their own file so this one stays focused on permissions + the session token:
//
//   npm run test:store-admin-login   (scripts/test-store-admin-login.ts)

// ───────────────────── staff create/update input validation ──────────────────
console.log("\nparseStaffCreate (owner adds a staff member)");

const validCreate = {
  fullName: "  Maria Santos ",
  email: "Maria@Example.com",
  username: "  Maria ",
  password: "secret123",
  confirmPassword: "secret123",
  status: "active",
  permissions: ["orders", "inv", "bogus", "orders"],
};

check("accepts a valid payload and normalizes it", () => {
  const r = parseStaffCreate(validCreate);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.value.fullName, "Maria Santos");
  assert.equal(r.value.email, "maria@example.com"); // lowercased + trimmed
  assert.equal(r.value.username, "maria"); // lowercased + trimmed
  assert.equal(r.value.password, "secret123");
  assert.equal(r.value.status, "active");
  assert.deepEqual([...r.value.permissions].sort(), ["inv", "orders"]); // sanitized + deduped
});

check("status defaults to active when omitted", () => {
  const r = parseStaffCreate({ ...validCreate, status: undefined });
  assert.ok(r.ok && r.value.status === "active");
});

check("rejects a missing full name", () => {
  const r = parseStaffCreate({ ...validCreate, fullName: "   " });
  assert.equal(r.ok, false);
});

check("rejects an invalid email", () => {
  const r = parseStaffCreate({ ...validCreate, email: "not-an-email" });
  assert.equal(r.ok, false);
});

check("rejects a username with spaces or too short", () => {
  assert.equal(parseStaffCreate({ ...validCreate, username: "ma ria" }).ok, false);
  assert.equal(parseStaffCreate({ ...validCreate, username: "ab" }).ok, false);
});

check("rejects a password shorter than 6", () => {
  const r = parseStaffCreate({ ...validCreate, password: "x1", confirmPassword: "x1" });
  assert.equal(r.ok, false);
});

check("rejects mismatched password confirmation", () => {
  const r = parseStaffCreate({ ...validCreate, confirmPassword: "different" });
  assert.equal(r.ok, false);
});

check("rejects an unknown status value", () => {
  const r = parseStaffCreate({ ...validCreate, status: "deleted" });
  assert.equal(r.ok, false);
});

console.log("\nparseStaffUpdate (owner edits a staff member)");

check("blank password means keep-existing (no password in the result)", () => {
  const r = parseStaffUpdate({ ...validCreate, password: "", confirmPassword: "" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal("password" in r.value, false);
  assert.equal(r.value.username, "maria");
});

check("a provided new password still must be ≥6 and confirmed", () => {
  assert.equal(parseStaffUpdate({ ...validCreate, password: "x1", confirmPassword: "x1" }).ok, false);
  assert.equal(parseStaffUpdate({ ...validCreate, password: "newpass1", confirmPassword: "nope" }).ok, false);
  const r = parseStaffUpdate({ ...validCreate, password: "newpass1", confirmPassword: "newpass1" });
  assert.ok(r.ok && r.value.password === "newpass1");
});

console.log("\nisReservedUsername (can't shadow the owner)");

check("the literal 'owner' is always reserved", () => {
  assert.equal(isReservedUsername("owner", "shopkeeper"), true);
  assert.equal(isReservedUsername("OWNER", "shopkeeper"), true);
});

check("the configured owner username is reserved (case-insensitive)", () => {
  assert.equal(isReservedUsername("ShopKeeper", "shopkeeper"), true);
  assert.equal(isReservedUsername("  shopkeeper ", "shopkeeper"), true);
});

check("any other username is allowed", () => {
  assert.equal(isReservedUsername("maria", "shopkeeper"), false);
});

// ─────────────────── Staff Accounts feature gate (catalog) ───────────────────
console.log("\nStaff Accounts feature gate (plan ceilings + operator-grantable)");

const staffKey = FEATURES.STORE_STAFF_ACCOUNTS;

check("only Automated (enterprise) includes Staff Accounts by default (Business narrowing)", () => {
  // Since the pepstack-davao Business narrowing, Staff Accounts lives only in
  // the Automated ceiling; Business gets it per tenant via OPERATOR_GRANTABLE.
  assert.equal(planFeatureSet("pro").has(staffKey), false, "pro ceiling should NOT have staff");
  assert.ok(planFeatureSet("enterprise").has(staffKey), "enterprise ceiling missing staff");
});

check("Starter does NOT include Staff Accounts in its ceiling", () => {
  assert.equal(planFeatureSet("starter").has(staffKey), false);
});

check("legacy catalog plan aliases resolve the same (ecommerce→pro, growth→enterprise)", () => {
  // catalog.ts aliases are basic→starter, ecommerce→pro, growth→enterprise.
  // The Business/Automated display names map to pro/enterprise in plans.ts; the
  // real plan keys reaching planFeatureSet are starter | pro | enterprise.
  assert.deepStrictEqual(
    planFeatureSet("ecommerce"),
    planFeatureSet("pro"),
    "ecommerce alias = pro",
  );
  assert.ok(planFeatureSet("growth").has(staffKey), "growth alias = enterprise");
  assert.equal(planFeatureSet("basic").has(staffKey), false, "basic alias = starter");
});

check("Staff Accounts is operator-grantable (so Starter can be switched on per tenant)", () => {
  assert.ok(OPERATOR_GRANTABLE.has(staffKey));
});

// ─────────────────── Staff Accounts view visibility (storefront) ─────────────
console.log("\nStaff Accounts view visibility (brand.showAdminStaff)");

const brandWith = (v: boolean | undefined): Brand => ({ showAdminStaff: v }) as unknown as Brand;

check("staff + staff-form views are hidden when showAdminStaff is unset (default OFF)", () => {
  assert.equal(isAdminViewVisible(brandWith(undefined), "staff"), false);
  assert.equal(isAdminViewVisible(brandWith(undefined), "staff-form"), false);
});

check("staff + staff-form views are hidden when showAdminStaff is false", () => {
  assert.equal(isAdminViewVisible(brandWith(false), "staff"), false);
  assert.equal(isAdminViewVisible(brandWith(false), "staff-form"), false);
});

check("staff + staff-form views are visible only when showAdminStaff is true", () => {
  assert.equal(isAdminViewVisible(brandWith(true), "staff"), true);
  assert.equal(isAdminViewVisible(brandWith(true), "staff-form"), true);
});

// ────────────────────────────────── summary ─────────────────────────────────
console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
