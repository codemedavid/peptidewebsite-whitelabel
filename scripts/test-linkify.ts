/**
 * Self-contained test for owner-note links (src/lib/storefront/linkify.ts): the
 * Protocols page note turns typed web addresses into links without ever
 * treating the owner's text as HTML.
 *
 *   npm run test:linkify
 */

import assert from "node:assert";

import { linkifySegments, normalizeOwnerNote, OWNER_NOTE_MAX, safeLinkHref } from "../src/lib/storefront/linkify";

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

console.log("\nOwner-note links (linkify)\n");

check("MNM's note: www.feelsbonita.com becomes a link, the full stop stays text", () => {
  const segs = linkifySegments("To access more protocols, please visit our Peptide Library at www.feelsbonita.com.");
  assert.deepEqual(segs, [
    { kind: "text", text: "To access more protocols, please visit our Peptide Library at " },
    { kind: "link", text: "www.feelsbonita.com", href: "https://www.feelsbonita.com/" },
    { kind: "text", text: "." },
  ]);
});

check("http(s) addresses keep their path and query", () => {
  const segs = linkifySegments("See https://shop.example.com/library?tab=peptides, thanks");
  assert.equal(segs[1].kind, "link");
  assert.equal(segs[1].kind === "link" && segs[1].href, "https://shop.example.com/library?tab=peptides");
  assert.deepEqual(segs[2], { kind: "text", text: ", thanks" });
});

check("several addresses in one note all become links", () => {
  const links = linkifySegments("www.a.com or http://b.org").filter((s) => s.kind === "link");
  assert.equal(links.length, 2);
});

check("text with no address is one plain segment; empty is nothing", () => {
  assert.deepEqual(linkifySegments("No link here"), [{ kind: "text", text: "No link here" }]);
  assert.deepEqual(linkifySegments(""), []);
  assert.deepEqual(linkifySegments(undefined as unknown as string), []);
});

check("javascript:, data: and markup are never links", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "<a href=x>hi</a>"]) {
    assert.ok(linkifySegments(bad).every((s) => s.kind === "text"), bad);
  }
  assert.equal(safeLinkHref("javascript:alert(1)"), null);
  assert.equal(safeLinkHref("www.nodot"), null, "needs a real domain");
});

check("the stored note is trimmed and capped", () => {
  assert.equal(normalizeOwnerNote("  hello  "), "hello");
  assert.equal(normalizeOwnerNote("x".repeat(OWNER_NOTE_MAX + 50)).length, OWNER_NOTE_MAX);
  assert.equal(normalizeOwnerNote(42), "");
  assert.equal(normalizeOwnerNote(null), "");
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
