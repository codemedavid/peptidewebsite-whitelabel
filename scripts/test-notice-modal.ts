/**
 * Self-contained test for the pure core behind the Storefront Notice Modal — the
 * per-tenant disclaimer/notice that pops up on every storefront visit when the
 * operator has granted it AND the store owner has switched it on.
 *
 *   src/lib/storefront/notice-modal.ts
 *     DEFAULT_NOTICE_MODAL        — the safe, everything-off baseline (design copy).
 *     normalizeNoticeModal(input) — coerce untrusted branding.config into a closed,
 *                                   safe shape (never throws); fills defaults,
 *                                   strict booleans, trims + caps text/arrays.
 *     isNoticeModalVisible(cfg)   — the entitlement gate: operatorEnabled && enabled.
 *
 * The two-flag gate is deliberate: the super admin grants the feature per tenant
 * (operatorEnabled) and the store owner controls day-to-day on/off (enabled). The
 * modal is visible only when BOTH are true — no tenant gets it automatically.
 *
 *   npm run test:notice-modal
 */

import assert from "node:assert";

import {
  DEFAULT_NOTICE_MODAL,
  normalizeNoticeModal,
  isNoticeModalVisible,
  MAX_NOTICE_PARAGRAPHS,
  type NoticeModalConfig,
} from "../src/lib/storefront/notice-modal";

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

console.log("\nStorefront Notice Modal — pure core\n");

// ── isNoticeModalVisible: the entitlement gate ──────────────────────────────
console.log("isNoticeModalVisible (gate = operatorEnabled && enabled)");

check("undefined config → hidden (feature never configured)", () => {
  assert.equal(isNoticeModalVisible(undefined), false);
});
check("null config → hidden", () => {
  assert.equal(isNoticeModalVisible(null), false);
});
check("both flags off → hidden", () => {
  assert.equal(isNoticeModalVisible({ ...DEFAULT_NOTICE_MODAL, operatorEnabled: false, enabled: false }), false);
});
check("operator granted but owner off → hidden (no auto-on)", () => {
  assert.equal(isNoticeModalVisible({ ...DEFAULT_NOTICE_MODAL, operatorEnabled: true, enabled: false }), false);
});
check("owner on but operator not granted → hidden", () => {
  assert.equal(isNoticeModalVisible({ ...DEFAULT_NOTICE_MODAL, operatorEnabled: false, enabled: true }), false);
});
check("both flags on → visible", () => {
  assert.equal(isNoticeModalVisible({ ...DEFAULT_NOTICE_MODAL, operatorEnabled: true, enabled: true }), true);
});

// ── DEFAULT_NOTICE_MODAL: safe off-by-default baseline ──────────────────────
console.log("\nDEFAULT_NOTICE_MODAL");

check("both flags default to false (nothing auto-on)", () => {
  assert.equal(DEFAULT_NOTICE_MODAL.operatorEnabled, false);
  assert.equal(DEFAULT_NOTICE_MODAL.enabled, false);
});
check("ships sensible default copy (title + body + agree label)", () => {
  assert.ok(DEFAULT_NOTICE_MODAL.title.length > 0);
  assert.ok(DEFAULT_NOTICE_MODAL.bodyParagraphs.length > 0);
  assert.ok(DEFAULT_NOTICE_MODAL.agreeLabel.length > 0);
});

// ── normalizeNoticeModal: coerce untrusted input ────────────────────────────
console.log("\nnormalizeNoticeModal");

check("non-object input collapses to the safe default (never throws)", () => {
  assert.deepEqual(normalizeNoticeModal(null), DEFAULT_NOTICE_MODAL);
  assert.deepEqual(normalizeNoticeModal(undefined), DEFAULT_NOTICE_MODAL);
  assert.deepEqual(normalizeNoticeModal("nope"), DEFAULT_NOTICE_MODAL);
  assert.deepEqual(normalizeNoticeModal(42), DEFAULT_NOTICE_MODAL);
});
check("missing fields fall back to defaults", () => {
  const out = normalizeNoticeModal({ enabled: true });
  assert.equal(out.enabled, true);
  assert.equal(out.operatorEnabled, false);
  assert.equal(out.title, DEFAULT_NOTICE_MODAL.title);
  assert.deepEqual(out.bodyParagraphs, DEFAULT_NOTICE_MODAL.bodyParagraphs);
});
check("enabled / operatorEnabled coerce to STRICT booleans", () => {
  // truthy-but-not-true must not enable the feature
  const out = normalizeNoticeModal({ enabled: 1, operatorEnabled: "yes" });
  assert.equal(out.enabled, false);
  assert.equal(out.operatorEnabled, false);
});
check("owner-provided content is preserved (trimmed)", () => {
  const out = normalizeNoticeModal({ title: "  Read this first  ", agreeLabel: "OK" });
  assert.equal(out.title, "Read this first");
  assert.equal(out.agreeLabel, "OK");
});
check("blank paragraphs are dropped; whitespace trimmed", () => {
  const out = normalizeNoticeModal({ bodyParagraphs: ["  keep me ", "", "   ", "second"] });
  assert.deepEqual(out.bodyParagraphs, ["keep me", "second"]);
});
check("paragraph count is capped at MAX_NOTICE_PARAGRAPHS", () => {
  const many = Array.from({ length: MAX_NOTICE_PARAGRAPHS + 5 }, (_, i) => `p${i}`);
  const out = normalizeNoticeModal({ bodyParagraphs: many });
  assert.equal(out.bodyParagraphs.length, MAX_NOTICE_PARAGRAPHS);
});
check("over-long title is length-capped", () => {
  const out = normalizeNoticeModal({ title: "x".repeat(5000) });
  assert.ok(out.title.length > 0 && out.title.length <= 200);
});
check("delivery lines: blanks dropped, trimmed, preserved", () => {
  const out = normalizeNoticeModal({ deliveryLines: ["J&T: 3PM", "  ", "Same-day: 2PM"] });
  assert.deepEqual(out.deliveryLines, ["J&T: 3PM", "Same-day: 2PM"]);
});
check("normalize is idempotent", () => {
  const once = normalizeNoticeModal({
    operatorEnabled: true,
    enabled: true,
    title: "Notice",
    bodyParagraphs: ["a", "", "b"],
    deliveryLines: ["x"],
  });
  const twice = normalizeNoticeModal(once as unknown);
  assert.deepEqual(twice, once);
});
check("a fully normalized granted+enabled config is visible end-to-end", () => {
  const cfg: NoticeModalConfig = normalizeNoticeModal({ operatorEnabled: true, enabled: true });
  assert.equal(isNoticeModalVisible(cfg), true);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
