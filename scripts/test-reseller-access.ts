/**
 * The reseller portal's PASSWORD and its VISIBILITY rule — the two pieces that
 * decide who may see wholesale pricing.
 *
 * Both were previously wrong in ways this file pins shut:
 *   - the password was stored and compared in PLAINTEXT, and returned to the
 *     admin client verbatim;
 *   - the wholesale price list was serialized into the storefront for EVERY
 *     visitor, gated only by a `sessionStorage` boolean in the browser.
 *
 *   npx tsx scripts/test-reseller-access.ts
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  readResellerCredential,
  hasResellerCode,
  verifyResellerCode,
  nextCredential,
  normalizeCode,
  wholesaleVisibleTo,
} from "../src/lib/storefront/reseller-access";
import { resellerCapsFrom, RESELLER_CAPS_OFF } from "../src/lib/storefront/reseller-caps";
import { FEATURES } from "../src/lib/features/catalog";
import {
  readResellerPageCopy,
  readResellerPageCopyPatch,
  DEFAULT_RESELLER_GATE_TITLE,
} from "../src/lib/storefront/reseller-page-copy";

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

const caps = (keys: string[]) => resellerCapsFrom(new Set(keys));
const PARENT = FEATURES.STORE_RESELLER_PORTAL;
const WHOLESALE = FEATURES.STORE_WHOLESALE_PRICING;
const PAGE = FEATURES.STORE_RESELLER_PAGE;

console.log("\n── Credential storage ─────────────────────────────────────────");

check("a fresh tenant has no code and version 1", () => {
  const cred = readResellerCredential({});
  assert.equal(hasResellerCode(cred), false);
  assert.equal(cred.version, 1);
});

check("setting a password stores a scrypt hash, never the plaintext", () => {
  const patch = nextCredential("TEST123", readResellerCredential({}));
  assert.ok(patch.resellerAccessCodeHash?.startsWith("scrypt$"), "expected a scrypt hash");
  assert.ok(
    !JSON.stringify(patch).toLowerCase().includes("test123"),
    "the plaintext password must not survive anywhere in the stored patch",
  );
});

check("the stored hash verifies the password that made it", () => {
  const patch = nextCredential("TEST123", readResellerCredential({}));
  const cred = readResellerCredential(patch);
  assert.equal(verifyResellerCode("TEST123", cred), true);
  assert.equal(verifyResellerCode("WRONG", cred), false);
});

check("passwords stay case-insensitive across the hash upgrade", () => {
  // Live resellers were handed codes under the old case-insensitive compare, so
  // hashing must not quietly invalidate half of them.
  const cred = readResellerCredential(nextCredential("NovaLab", readResellerCredential({})));
  for (const attempt of ["novalab", "NOVALAB", "NovaLab", "  novalab  "]) {
    assert.equal(verifyResellerCode(attempt, cred), true, `expected ${attempt} to match`);
  }
});

check("a legacy plaintext code still authenticates (no owner is locked out)", () => {
  const cred = readResellerCredential({ resellerAccessCode: "PEPPIES10" });
  assert.equal(hasResellerCode(cred), true);
  assert.equal(verifyResellerCode("peppies10", cred), true);
  assert.equal(verifyResellerCode("nope", cred), false);
});

check("once hashed, the legacy plaintext is NOT a second working password", () => {
  // The back door this closes: a config carrying both shapes must authenticate
  // against the hash only, or changing the password would leave the old one live.
  const cred = readResellerCredential({
    resellerAccessCode: "OLDCODE",
    resellerAccessCodeHash: readResellerCredential(
      nextCredential("NEWCODE", readResellerCredential({})),
    ).hash,
  });
  assert.equal(verifyResellerCode("NEWCODE", cred), true);
  assert.equal(verifyResellerCode("OLDCODE", cred), false, "the legacy code must be dead");
});

check("saving always drops the legacy plaintext field", () => {
  const patch = nextCredential("NEWCODE", readResellerCredential({ resellerAccessCode: "OLD" }));
  assert.equal(patch.resellerAccessCode, undefined);
});

check("every save bumps the version, which revokes live sessions", () => {
  const first = readResellerCredential(nextCredential("A", readResellerCredential({})));
  assert.equal(first.version, 2);
  const second = readResellerCredential(nextCredential("B", first));
  assert.equal(second.version, 3);
});

check("clearing the password removes the hash and still bumps the version", () => {
  const set = readResellerCredential(nextCredential("TEST123", readResellerCredential({})));
  const cleared = nextCredential("", set);
  assert.equal(cleared.resellerAccessCodeHash, undefined);
  assert.equal(cleared.resellerCodeVersion, set.version + 1);
  assert.equal(hasResellerCode(readResellerCredential(cleared)), false);
});

check("an empty submission never authenticates", () => {
  const cred = readResellerCredential(nextCredential("TEST123", readResellerCredential({})));
  for (const attempt of ["", "   "]) {
    assert.equal(verifyResellerCode(attempt, cred), false);
  }
  assert.equal(normalizeCode("  A  "), "a");
});

check("a tenant with no code set rejects everything, including blank", () => {
  const cred = readResellerCredential({});
  assert.equal(verifyResellerCode("", cred), false);
  assert.equal(verifyResellerCode("anything", cred), false);
});

console.log("\n── Who may see wholesale prices ───────────────────────────────");

check("feature off → nobody, unlocked or not", () => {
  assert.equal(wholesaleVisibleTo(RESELLER_CAPS_OFF, false), false);
  assert.equal(wholesaleVisibleTo(RESELLER_CAPS_OFF, true), false);
});

check("parent alone exposes nothing (the shape that looks like a broken feature)", () => {
  assert.equal(wholesaleVisibleTo(caps([PARENT]), false), false);
  assert.equal(wholesaleVisibleTo(caps([PARENT]), true), false);
});

check("wholesale pricing on the regular store is public by design", () => {
  // Any shopper who reaches the MOQ pays these, so withholding them would break
  // the storefront the feature is for.
  assert.equal(wholesaleVisibleTo(caps([PARENT, WHOLESALE]), false), true);
});

check("a page-only tenant ships NO wholesale prices to a locked visitor", () => {
  // The leak this closes: the price list used to be in the page for everyone.
  assert.equal(wholesaleVisibleTo(caps([PARENT, PAGE]), false), false);
});

check("a page-only tenant ships them once the reseller unlocks", () => {
  assert.equal(wholesaleVisibleTo(caps([PARENT, PAGE]), true), true);
});

check("revoking the parent hides prices even with both children set", () => {
  assert.equal(wholesaleVisibleTo(caps([WHOLESALE, PAGE]), true), false);
});

console.log("\n── Owner-editable gate copy ───────────────────────────────────");

check("defaults fill in for a tenant that never set copy", () => {
  const copy = readResellerPageCopy({});
  assert.equal(copy.gateTitle, DEFAULT_RESELLER_GATE_TITLE);
  assert.ok(copy.gateSub.length > 0);
});

check("the owner's wording wins", () => {
  const copy = readResellerPageCopy({ merchantGateTitle: "Wholesale Login" });
  assert.equal(copy.gateTitle, "Wholesale Login");
});

check("a partial save never wipes copy it didn't send", () => {
  const patch = readResellerPageCopyPatch({}, { merchantGateTitle: "Keep me" });
  assert.equal(patch.merchantGateTitle, "Keep me");
});

// ── Wiring: the surfaces that must honour the gate ───────────────────────────
// Source-shape checks, in the style of test-reseller-gate.ts. These pin the
// call sites that make the pure rules above actually load-bearing — each one is
// a place the old implementation leaked.

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Source with comments removed — these checks are about CODE, and several of
 *  the files below describe the old broken design in prose deliberately. */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("\n── Wiring ─────────────────────────────────────────────────────");

check("the public products action gates on the reseller session, not just the caps", () => {
  // This action needs NO admin session by design (it is the storefront's own
  // price refresh), so gating it on the entitlement alone made it a way around
  // the password entirely: any anonymous caller got the whole wholesale list.
  const src = read("src/actions/products.ts");
  assert.match(src, /isResellerUnlocked\(/, "must consult the session cookie");
  assert.match(src, /resolveWholesaleAccess\(resellerCaps, resellerUnlocked\)/);
});

check("the reseller page no longer gates on browser storage", () => {
  const src = readCode("src/storefront/pages/MerchantPage.tsx");
  assert.ok(
    !/sessionStorage|localStorage/.test(src),
    "the unlock must not live in the browser — that was the original leak",
  );
});

check("unlocking re-fetches the catalog, so the prices come from the server", () => {
  // Without this the reseller unlocks into an empty price list: the client store
  // seeds `products` once via useState, and the pre-unlock catalog it seeded
  // from deliberately carried no wholesale legs.
  const src = read("src/storefront/pages/MerchantPage.tsx");
  const onUnlock = src.slice(src.indexOf("onUnlock={"), src.indexOf("onUnlock={") + 500);
  assert.match(onUnlock, /refreshProducts\(\)/, "unlock must call refreshProducts");
});

check("the admin settings action never returns the password", () => {
  const src = read("src/actions/storefront-admin.ts");
  const fn = src.slice(
    src.indexOf("export async function getResellerSettingsAction"),
    src.indexOf("export async function saveResellerSettingsAction"),
  );
  assert.match(fn, /hasCode:/, "should report only whether a password is set");
  assert.ok(
    !/code:\s*typeof config\.resellerAccessCode/.test(fn),
    "must not read the plaintext code back out to the client",
  );
});

check("verify gates on the reseller PAGE child and mints a session", () => {
  const src = read("src/actions/storefront-admin.ts");
  const fn = src.slice(
    src.indexOf("export async function verifyResellerCodeAction"),
    src.indexOf("export async function resellerSignOutAction"),
  );
  assert.match(fn, /caps\.resellerPage/, "must gate on the page child, not the parent");
  assert.match(fn, /saveResellerSession\(tenantId, cred\.version\)/);
});

check("orders stamp the reseller flag server-side, never from the client", () => {
  const src = read("src/actions/orders.ts");
  // The stamp is now a PURE decision (resellerOrderType) fed the already-resolved
  // session, rather than a predicate that also mutated the order in place — the
  // caller assigns p.orderType, so the write is visible at the call site.
  assert.match(src, /function resellerOrderType/);
  assert.match(src, /isResellerUnlocked\(/, "the session is still read server-side");
  // Both placement paths (demo + DB) must stamp AND enforce the MOQ.
  assert.equal((src.match(/resellerOrderType\(/g) ?? []).length, 3, "declaration + both paths");
  assert.equal((src.match(/resellerMoqViolation\(/g) ?? []).length, 2, "both placement paths");
  // The normalizer parses untrusted checkout payloads, so it must not carry it.
  // Scope to the normalizer's own body: the DbOrderRow type that follows it
  // legitimately declares the column.
  const normStart = src.indexOf("function normalizeOrderInput");
  const norm = src.slice(normStart, src.indexOf("/** Map a storefront_orders DB row", normStart));
  assert.ok(!/orderType/.test(norm), "orderType must never be accepted from the client");
});

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
