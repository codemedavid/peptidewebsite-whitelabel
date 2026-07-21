/**
 * Self-contained test for the image re-host URL rewriter (no DB, no network):
 *
 *   When a tenant's images physically live in a *foreign* storage host (e.g. an
 *   old Supabase project), we re-host the bytes and must rewrite every stored
 *   reference — inside `product.images` (a JSON array) and `branding.config` (a
 *   deep JSON object) — from the old URL to the new one. The rewrite must be:
 *     • deep (branding.config nests URLs arbitrarily),
 *     • exact (only URLs we actually re-hosted change; everything else is left
 *       byte-for-byte, so an unrelated ik.imagekit.io URL is never touched),
 *     • immutable (never mutate the row object we were handed), and
 *     • counted (so the migration can assert it replaced what it downloaded).
 *
 *   npm run test:rehost-urls
 */

import assert from "node:assert";

import {
  collectMatchingUrls,
  rewriteJsonUrls,
  isForeignHostUrl,
} from "../src/lib/migration/rehost-urls";

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

console.log("\nRe-host URL rewriter\n");

const OLD = "rtsnxmatvbabdylsnuuh.supabase.co";
const u1 = `https://${OLD}/storage/v1/object/public/menu-images/a.png`;
const u2 = `https://${OLD}/storage/v1/object/public/menu-images/b.png`;
const keep = "https://ik.imagekit.io/xyz/tenant/hpglow/c.png";

// ── isForeignHostUrl ─────────────────────────────────────────────────────────
check("isForeignHostUrl matches the old host", () => {
  assert.strictEqual(isForeignHostUrl(u1, OLD), true);
});
check("isForeignHostUrl ignores our own ImageKit host", () => {
  assert.strictEqual(isForeignHostUrl(keep, OLD), false);
});
check("isForeignHostUrl tolerates non-URL / empty strings", () => {
  assert.strictEqual(isForeignHostUrl("", OLD), false);
  assert.strictEqual(isForeignHostUrl("not a url", OLD), false);
});

// ── collectMatchingUrls ──────────────────────────────────────────────────────
check("collectMatchingUrls finds URLs in a flat array (product.images)", () => {
  const found = collectMatchingUrls([u1, keep, u2], (s) => isForeignHostUrl(s, OLD));
  assert.deepStrictEqual(found.sort(), [u1, u2].sort());
});

check("collectMatchingUrls finds URLs deep inside a nested object", () => {
  const config = {
    hero: { backgroundUrl: u1 },
    sections: [{ image: keep }, { image: u2 }],
    footer: { logo: null },
  };
  const found = collectMatchingUrls(config, (s) => isForeignHostUrl(s, OLD));
  assert.deepStrictEqual(found.sort(), [u1, u2].sort());
});

check("collectMatchingUrls de-duplicates repeated URLs", () => {
  const found = collectMatchingUrls([u1, u1, u1], (s) => isForeignHostUrl(s, OLD));
  assert.deepStrictEqual(found, [u1]);
});

// ── rewriteJsonUrls ──────────────────────────────────────────────────────────
const mapping = new Map<string, string>([
  [u1, "https://ik.imagekit.io/xyz/tenant/hpglow/A.png"],
  [u2, "https://ik.imagekit.io/xyz/tenant/hpglow/B.png"],
]);

check("rewriteJsonUrls replaces mapped URLs in a flat array", () => {
  const { value, replaced } = rewriteJsonUrls([u1, keep, u2], mapping);
  assert.deepStrictEqual(value, [mapping.get(u1), keep, mapping.get(u2)]);
  assert.strictEqual(replaced, 2);
});

check("rewriteJsonUrls replaces deep inside a nested object", () => {
  const config = {
    hero: { backgroundUrl: u1 },
    sections: [{ image: keep }, { image: u2 }],
    footer: { logo: null, note: "unchanged" },
  };
  const { value, replaced } = rewriteJsonUrls(config, mapping);
  assert.strictEqual(replaced, 2);
  assert.deepStrictEqual(value, {
    hero: { backgroundUrl: mapping.get(u1) },
    sections: [{ image: keep }, { image: mapping.get(u2) }],
    footer: { logo: null, note: "unchanged" },
  });
});

check("rewriteJsonUrls leaves unmapped strings byte-for-byte", () => {
  const { value, replaced } = rewriteJsonUrls([keep, "plain text", 42, true], mapping);
  assert.deepStrictEqual(value, [keep, "plain text", 42, true]);
  assert.strictEqual(replaced, 0);
});

check("rewriteJsonUrls does NOT mutate the input (immutability)", () => {
  const input = { images: [u1] };
  const snapshot = JSON.parse(JSON.stringify(input));
  rewriteJsonUrls(input, mapping);
  assert.deepStrictEqual(input, snapshot, "input was mutated");
});

check("rewriteJsonUrls handles null / undefined / primitives safely", () => {
  assert.deepStrictEqual(rewriteJsonUrls(null, mapping), { value: null, replaced: 0 });
  assert.deepStrictEqual(rewriteJsonUrls(7, mapping), { value: 7, replaced: 0 });
  assert.deepStrictEqual(rewriteJsonUrls("x", mapping), { value: "x", replaced: 0 });
});

check("rewriteJsonUrls counts every occurrence, even duplicates", () => {
  const { replaced } = rewriteJsonUrls([u1, u1, { a: u1 }], mapping);
  assert.strictEqual(replaced, 3);
});

// ──────────────────────────── summary ───────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
