/**
 * Self-contained test for the pure guard behind the store-admin Order Detail
 * "Payment Proof" viewer (src/storefront/admin/AdminOrderDetail.tsx).
 *
 * The thumbnail crops the receipt (240×200, object-fit: cover), so the admin
 * can only see part of the uploaded image. The proof is now clickable to open
 * a full-screen, uncropped lightbox. `hasPaymentProof` is the single source of
 * truth the component uses to decide:
 *
 *   - whether to render the clickable <button> thumbnail vs the empty state;
 *   - whether the lightbox is allowed to open at all.
 *
 * This closes the edge the old `o.paymentProof ?` truthy check missed: a blank
 * or whitespace-only string would render a broken <img> and an openable
 * lightbox with nothing in it.
 *
 *   src/storefront/admin/order-detail.ts
 *       hasPaymentProof(proof)  — true only for a real, non-blank proof URL.
 *
 *   npm run test:payment-proof-viewer
 */

import assert from "node:assert";

import { hasPaymentProof } from "../src/storefront/admin/order-detail";

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

console.log("\nPayment Proof viewer — pure guard\n");

console.log("hasPaymentProof");

check("true for a real proof URL", () => {
  assert.strictEqual(hasPaymentProof("https://ik.imagekit.io/x/proof.jpg"), true);
});

check("true for a URL with surrounding whitespace (trimmed, still present)", () => {
  assert.strictEqual(hasPaymentProof("  https://ik.imagekit.io/x/proof.jpg  "), true);
});

check("false for null (no proof uploaded)", () => {
  assert.strictEqual(hasPaymentProof(null), false);
});

check("false for undefined", () => {
  assert.strictEqual(hasPaymentProof(undefined), false);
});

check("false for an empty string", () => {
  assert.strictEqual(hasPaymentProof(""), false);
});

check("false for a whitespace-only string (no broken <img>, no empty lightbox)", () => {
  assert.strictEqual(hasPaymentProof("   "), false);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
