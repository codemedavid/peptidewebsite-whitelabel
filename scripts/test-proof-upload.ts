/**
 * Self-contained test for the guard that decides whether a customer's
 * proof-of-payment file is accepted at checkout (no DB, no Next, no network).
 *
 * The bug this pins down:
 *
 *   Both the client handler (src/storefront/components/CartCheckout.tsx) and
 *   the server action (uploadPaymentProofAction in src/actions/orders.ts) used
 *   to gate on `file.type.startsWith("image/")` alone. `File.type` is a hint
 *   from the OS/browser, not a fact about the bytes: Android's Files/Documents
 *   picker, several in-app webviews (Messenger, Instagram), and some Samsung
 *   builds hand back a perfectly good JPEG with `type === ""` or
 *   `"application/octet-stream"`. Those customers got "Please pick an image
 *   file." on a real screenshot and had no way to finish checkout — the upload
 *   was refused before a single byte reached ImageKit, so nothing was logged
 *   and the failure was invisible to the operator.
 *
 *   The mirror-image problem: a customer who picks a PDF bank receipt (GCash,
 *   GoTyme and BPI all email PDFs) got "Unsupported type: application/pdf." —
 *   technically true, and useless. It never tells them to screenshot it.
 *
 *   src/lib/upload/image-file.ts
 *       classifyProofFile(name, type) — the single source of truth, shared by
 *       the client handler and the server action so they can never disagree
 *       about what is uploadable.
 *
 *   npm run test:proof-upload
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyProofFile } from "../src/lib/upload/image-file";

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

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

console.log("\nProof-of-payment upload — what counts as an uploadable receipt\n");

// ─────────── the regression: a real image the browser won't name ───────────
console.log("files the browser reports with no usable MIME type");

check("an Android JPEG arriving with an empty type is accepted on its extension", () => {
  const r = classifyProofFile("IMG_20260823_104512.jpg", "");
  assert.ok(r.ok, `expected a real .jpg to be accepted, got: ${!r.ok && r.reason}`);
});

check("a screenshot sent as application/octet-stream is accepted", () => {
  const r = classifyProofFile("Screenshot_20260823.png", "application/octet-stream");
  assert.ok(r.ok, `expected a real .png to be accepted, got: ${!r.ok && r.reason}`);
});

check("an iPhone HEIC photo with no reported type is accepted", () => {
  const r = classifyProofFile("IMG_5211.HEIC", "");
  assert.ok(r.ok, `expected .HEIC to be accepted, got: ${!r.ok && r.reason}`);
});

check("extension matching is case-insensitive", () => {
  assert.ok(classifyProofFile("RECEIPT.JPEG", "").ok);
  assert.ok(classifyProofFile("receipt.WebP", "").ok);
});

// ───────────────────── files that really are images ─────────────────────
console.log("\nfiles that declare an image type");

check("a normal image/jpeg is accepted", () => {
  assert.ok(classifyProofFile("receipt.jpg", "image/jpeg").ok);
});

check("image/heic is accepted", () => {
  assert.ok(classifyProofFile("IMG_0001.heic", "image/heic").ok);
});

check("a declared image type wins even when the name has no extension", () => {
  assert.ok(classifyProofFile("image", "image/png").ok);
});

// ─────────────── files that are genuinely not uploadable ───────────────
console.log("\nfiles that must be refused — with a message the customer can act on");

check("a PDF bank receipt is refused and told to send a screenshot instead", () => {
  const r = classifyProofFile("GoTyme-receipt.pdf", "application/pdf");
  assert.ok(!r.ok, "a PDF must not be uploaded as proof");
  assert.match(
    r.reason,
    /screenshot/i,
    `the refusal must tell the customer what to do instead, got: ${r.reason}`,
  );
});

check("a PDF with no reported type is refused on its extension too", () => {
  const r = classifyProofFile("receipt.pdf", "");
  assert.ok(!r.ok, "a .pdf must be refused even when the browser reports no type");
  assert.match(r.reason, /screenshot/i);
});

check("a video is refused", () => {
  const r = classifyProofFile("clip.mp4", "video/mp4");
  assert.ok(!r.ok, "a video must not be accepted as proof");
});

check("an unknown extension with no type is refused", () => {
  const r = classifyProofFile("notes.txt", "");
  assert.ok(!r.ok, "an unrecognised file must be refused");
});

check("a refusal never returns a blank reason", () => {
  for (const [n, t] of [["a.txt", ""], ["b.pdf", "application/pdf"], ["c.mp4", "video/mp4"]] as const) {
    const r = classifyProofFile(n, t);
    assert.ok(!r.ok && r.reason.trim().length > 0, `${n} produced a blank reason`);
  }
});

// ─────────────── both call sites must share the one guard ───────────────
console.log("\nthe client handler and the server action share one guard");

check("uploadPaymentProofAction gates on classifyProofFile, not startsWith(\"image/\")", () => {
  const src = read("src/actions/orders.ts");
  assert.match(src, /classifyProofFile/, "the server action must use the shared guard");
  assert.doesNotMatch(
    src,
    /file\.type\.startsWith\("image\/"\)/,
    "the raw MIME check is the bug — it must be gone from the proof upload action",
  );
});

check("CartCheckout gates on classifyProofFile, not startsWith(\"image/\")", () => {
  const src = read("src/storefront/components/CartCheckout.tsx");
  assert.match(src, /classifyProofFile/, "the checkout handler must use the shared guard");
  assert.doesNotMatch(
    src,
    /file\.type\.startsWith\("image\/"\)/,
    "the raw MIME check is the bug — it must be gone from the checkout handler",
  );
});

check("a failed proof upload surfaces the real reason, not a canned message", () => {
  const src = read("src/storefront/components/CartCheckout.tsx");
  assert.match(
    src,
    /settleUpload|uploadErrorMessage/,
    "handleProof must route throws through the shared upload-error translation " +
      "so a body-limit rejection reads as 'File too large' instead of a generic retry prompt",
  );
});

// ────────────────────────────── summary ──────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
