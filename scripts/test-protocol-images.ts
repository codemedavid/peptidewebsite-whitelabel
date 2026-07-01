/**
 * Self-contained test for the multi-image protocol resolver. Runs the REAL pure
 * helper (no DB, no Next runtime, no browser) so that:
 *
 *   - protocols saved with the NEW `images: string[]` field render every image;
 *   - protocols saved with the LEGACY single `image` string still render;
 *   - empty/garbage input never throws and yields an empty list;
 *   - the per-protocol image count is capped at MAX_PROTOCOL_IMAGES.
 *
 *   src/lib/storefront/protocol-images.ts
 *       resolveProtocolImages(p)  — canonical [images | legacy image | []] list,
 *                                   trimmed of blanks and capped.
 *
 *   npm run test:protocol-images
 */

import assert from "node:assert";

import {
  resolveProtocolImages,
  MAX_PROTOCOL_IMAGES,
} from "../src/lib/storefront/protocol-images";
import type { Protocol } from "../src/storefront/types";

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

// ──────────────────────────── protocol factory ──────────────────────────────
function protocol(over: Partial<Protocol> = {}): Protocol {
  return {
    category: "General",
    name: "BPC-157",
    dosage: "",
    frequency: "",
    duration: "",
    notes: [],
    storage: "",
    mode: "image",
    ...over,
  };
}

console.log("\nProtocol multi-image resolver — pure core\n");

console.log("resolveProtocolImages");

check("returns the new images array as-is when present", () => {
  const p = protocol({ images: ["a.jpg", "b.jpg", "c.jpg"] });
  assert.deepEqual(resolveProtocolImages(p), ["a.jpg", "b.jpg", "c.jpg"]);
});

check("falls back to the legacy single image when images is absent", () => {
  const p = protocol({ image: "legacy.jpg" });
  assert.deepEqual(resolveProtocolImages(p), ["legacy.jpg"]);
});

check("prefers the images array over a stale legacy image", () => {
  const p = protocol({ images: ["new.jpg"], image: "old.jpg" });
  assert.deepEqual(resolveProtocolImages(p), ["new.jpg"]);
});

check("returns an empty list when neither field is set", () => {
  const p = protocol({});
  assert.deepEqual(resolveProtocolImages(p), []);
});

check("returns an empty list for an empty images array (no legacy leak)", () => {
  const p = protocol({ images: [], image: "" });
  assert.deepEqual(resolveProtocolImages(p), []);
});

check("drops blank/whitespace entries from the images array", () => {
  const p = protocol({ images: ["a.jpg", "", "  ", "b.jpg"] });
  assert.deepEqual(resolveProtocolImages(p), ["a.jpg", "b.jpg"]);
});

check("ignores a blank legacy image (returns empty, not [''])", () => {
  const p = protocol({ image: "   " });
  assert.deepEqual(resolveProtocolImages(p), []);
});

check("caps the list at MAX_PROTOCOL_IMAGES", () => {
  const many = Array.from({ length: MAX_PROTOCOL_IMAGES + 5 }, (_, i) => `img-${i}.jpg`);
  const p = protocol({ images: many });
  const out = resolveProtocolImages(p);
  assert.equal(out.length, MAX_PROTOCOL_IMAGES);
  assert.equal(out[0], "img-0.jpg");
});

check("tolerates non-array garbage in images without throwing", () => {
  // Simulates malformed persisted JSON reaching the reader.
  const p = protocol({ images: "notanarray" as unknown as string[] });
  assert.deepEqual(resolveProtocolImages(p), []);
});

check("MAX_PROTOCOL_IMAGES is a sane positive cap", () => {
  assert.ok(MAX_PROTOCOL_IMAGES >= 2 && MAX_PROTOCOL_IMAGES <= 50);
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
