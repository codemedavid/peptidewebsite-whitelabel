/**
 * Self-contained tests for the store-admin login core — the pure modules behind
 * the tenant storefront `#admin` sign-in:
 *
 *   src/lib/auth/store-admin-login.ts
 *     normalizeLoginEmail(raw)
 *     resolveStoreAdminLogin(email, password, owner, staff)
 *
 *   src/lib/auth/store-admin-credential.ts
 *     validateStoreAdminCredentialInput({ email, password, hasExistingPassword })
 *
 * The rule this locks in: EVERY sign-in to `#admin` needs an email AND a
 * password. There is no password-only path, no reserved "owner" username, and
 * no built-in default password — a tenant whose credential was never set
 * cannot be signed into at all (fail closed).
 *
 * Both principals verify against a scrypt hash:
 *   - the store OWNER, whose email + hash the super admin sets in tenant settings
 *   - STAFF rows, who sign in with their own email + hash
 *
 * (These cases used to live in test-staff-permissions.ts, against the retired
 * username form. They moved here when the login became email-only.)
 *
 * Runs the REAL modules (no DB, no Next runtime, no browser):
 *
 *   npm run test:store-admin-login
 */

import assert from "node:assert";

import { hashPassword } from "../src/lib/auth/password-hash";
import {
  normalizeLoginEmail,
  resolveStoreAdminLogin,
  type OwnerCredential,
  type StaffCredential,
} from "../src/lib/auth/store-admin-login";
import { validateStoreAdminCredentialInput } from "../src/lib/auth/store-admin-credential";

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

// ──────────────────────────── fixtures ──────────────────────────────────────
const OWNER: OwnerCredential = {
  email: "owner@gmail.com",
  passwordHash: hashPassword("ownerpass123"),
};

function staffRow(over: Partial<StaffCredential> = {}): StaffCredential {
  return {
    id: "stf_1",
    email: "staff@gmail.com",
    passwordHash: hashPassword("staffpass123"),
    status: "active",
    ...over,
  };
}

// ──────────────────────────── normalizeLoginEmail ───────────────────────────
console.log("\nnormalizeLoginEmail\n");

check("trims surrounding whitespace", () => {
  assert.equal(normalizeLoginEmail("  owner@gmail.com  "), "owner@gmail.com");
});

check("lowercases so casing never blocks a real owner", () => {
  assert.equal(normalizeLoginEmail("Owner@Gmail.COM"), "owner@gmail.com");
});

check("non-string input collapses to empty (never throws)", () => {
  assert.equal(normalizeLoginEmail(undefined), "");
  assert.equal(normalizeLoginEmail(null), "");
  assert.equal(normalizeLoginEmail(42), "");
});

// ──────────────────────────── both fields required ──────────────────────────
console.log("\nresolveStoreAdminLogin — email AND password are both required\n");

check("blank email → invalid, even with the correct password", () => {
  assert.deepEqual(resolveStoreAdminLogin("", "ownerpass123", OWNER, []), { kind: "invalid" });
  assert.deepEqual(resolveStoreAdminLogin("   ", "ownerpass123", OWNER, []), { kind: "invalid" });
});

check("blank password → invalid, even with the correct email", () => {
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "", OWNER, []), { kind: "invalid" });
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "   ", OWNER, []), { kind: "invalid" });
});

// ──────────────────────────── owner sign-in ─────────────────────────────────
console.log("\nresolveStoreAdminLogin — store owner\n");

check("correct email + password → owner", () => {
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "ownerpass123", OWNER, []), {
    kind: "owner",
  });
});

check("email match is case- and whitespace-insensitive", () => {
  assert.deepEqual(resolveStoreAdminLogin("  OWNER@Gmail.com ", "ownerpass123", OWNER, []), {
    kind: "owner",
  });
});

check("wrong password → invalid", () => {
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "wrong", OWNER, []), {
    kind: "invalid",
  });
});

check("unknown email → invalid", () => {
  assert.deepEqual(resolveStoreAdminLogin("nobody@gmail.com", "ownerpass123", OWNER, []), {
    kind: "invalid",
  });
});

// ──────────────────────────── fail closed ───────────────────────────────────
console.log("\nresolveStoreAdminLogin — unconfigured tenant fails closed\n");

check("no owner credential and no staff → unconfigured, never a way in", () => {
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "admin", null, []), {
    kind: "unconfigured",
  });
});

check("the retired default password 'admin' opens nothing", () => {
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "admin", OWNER, []), {
    kind: "invalid",
  });
  assert.deepEqual(resolveStoreAdminLogin("admin", "admin", null, []), { kind: "unconfigured" });
});

check("an unconfigured owner cannot be bypassed via a staff-shaped email", () => {
  assert.deepEqual(resolveStoreAdminLogin("staff@gmail.com", "staffpass123", null, []), {
    kind: "unconfigured",
  });
});

// ──────────────────────────── staff sign-in ─────────────────────────────────
console.log("\nresolveStoreAdminLogin — staff\n");

check("correct staff email + password → staff with its id", () => {
  assert.deepEqual(resolveStoreAdminLogin("staff@gmail.com", "staffpass123", OWNER, [staffRow()]), {
    kind: "staff",
    id: "stf_1",
  });
});

check("staff email match is case-insensitive", () => {
  assert.deepEqual(resolveStoreAdminLogin("STAFF@GMAIL.COM", "staffpass123", OWNER, [staffRow()]), {
    kind: "staff",
    id: "stf_1",
  });
});

check("staff wrong password → invalid", () => {
  assert.deepEqual(resolveStoreAdminLogin("staff@gmail.com", "nope", OWNER, [staffRow()]), {
    kind: "invalid",
  });
});

check("suspended staff → suspended, reported distinctly from a bad password", () => {
  assert.deepEqual(
    resolveStoreAdminLogin("staff@gmail.com", "staffpass123", OWNER, [
      staffRow({ status: "suspended" }),
    ]),
    { kind: "suspended" },
  );
});

check("a suspended staffer is suspended regardless of the password typed", () => {
  assert.deepEqual(
    resolveStoreAdminLogin("staff@gmail.com", "nope", OWNER, [staffRow({ status: "suspended" })]),
    { kind: "suspended" },
  );
});

check("unknown staff email → invalid (not unconfigured — the owner IS set)", () => {
  assert.deepEqual(resolveStoreAdminLogin("ghost@gmail.com", "whatever", OWNER, [staffRow()]), {
    kind: "invalid",
  });
});

// ──────────────────────────── owner precedence ──────────────────────────────
console.log("\nresolveStoreAdminLogin — owner precedence over staff\n");

check("a staff row sharing the owner's email can never shadow the owner", () => {
  const impostor = staffRow({
    id: "stf_evil",
    email: "owner@gmail.com",
    passwordHash: hashPassword("impostor"),
  });
  // The owner's own credential still works…
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "ownerpass123", OWNER, [impostor]), {
    kind: "owner",
  });
  // …and the impostor's password does NOT sign anyone in.
  assert.deepEqual(resolveStoreAdminLogin("owner@gmail.com", "impostor", OWNER, [impostor]), {
    kind: "invalid",
  });
});

check("staff still resolve normally when the owner email differs", () => {
  assert.deepEqual(
    resolveStoreAdminLogin("staff@gmail.com", "staffpass123", OWNER, [
      staffRow({ id: "stf_a", email: "other@gmail.com" }),
      staffRow({ id: "stf_b" }),
    ]),
    { kind: "staff", id: "stf_b" },
  );
});

// ─────────────────── validateStoreAdminCredentialInput ──────────────────────
// The super admin sets the owner's credential in tenant settings. This guards
// that form (and the server action behind it) so a tenant can never be left
// half-configured — an email with no password locks the owner out completely.
console.log("\nvalidateStoreAdminCredentialInput\n");

check("a fresh tenant needs BOTH an email and a password", () => {
  const res = validateStoreAdminCredentialInput({
    email: "owner@gmail.com",
    password: "",
    hasExistingPassword: false,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /password/i);
});

check("email + password on a fresh tenant is accepted and normalized", () => {
  assert.deepEqual(
    validateStoreAdminCredentialInput({
      email: "  Owner@Gmail.COM ",
      password: " secret123 ",
      hasExistingPassword: false,
    }),
    { ok: true, email: "owner@gmail.com", password: "secret123" },
  );
});

check("a blank password KEEPS the existing one, so the email can be edited alone", () => {
  assert.deepEqual(
    validateStoreAdminCredentialInput({
      email: "new@gmail.com",
      password: "",
      hasExistingPassword: true,
    }),
    { ok: true, email: "new@gmail.com", password: null },
  );
});

check("a blank email is rejected — it would lock the owner out", () => {
  const res = validateStoreAdminCredentialInput({
    email: "   ",
    password: "secret123",
    hasExistingPassword: true,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /email/i);
});

check("a malformed email is rejected", () => {
  for (const bad of ["owner", "owner@", "@gmail.com", "owner gmail.com"]) {
    const res = validateStoreAdminCredentialInput({
      email: bad,
      password: "secret123",
      hasExistingPassword: false,
    });
    assert.equal(res.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

check("a too-short password is rejected rather than silently ignored", () => {
  const res = validateStoreAdminCredentialInput({
    email: "owner@gmail.com",
    password: "abc12",
    hasExistingPassword: true,
  });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /6/);
});

check("exactly the minimum length is accepted", () => {
  assert.deepEqual(
    validateStoreAdminCredentialInput({
      email: "owner@gmail.com",
      password: "abc123",
      hasExistingPassword: false,
    }),
    { ok: true, email: "owner@gmail.com", password: "abc123" },
  );
});

check("a whitespace-only password counts as blank, not as a 6-character one", () => {
  assert.deepEqual(
    validateStoreAdminCredentialInput({
      email: "owner@gmail.com",
      password: "        ",
      hasExistingPassword: true,
    }),
    { ok: true, email: "owner@gmail.com", password: null },
  );
});

// ──────────────────────────── result ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
