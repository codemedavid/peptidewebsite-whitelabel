/**
 * Self-contained test for the protocol import core — the pure helpers that turn
 * an owner-supplied guide (a PDF rendered to page images, or a single flyer
 * image) into a storefront Protocol row, and merge those rows into a tenant's
 * existing protocol list without losing or duplicating anything.
 *
 * Runs the REAL helpers (no DB, no ImageKit, no Next runtime) so the risky part
 * of a bulk import — clobbering a tenant's hand-curated protocol page — is
 * proven safe before any script touches `branding.config`.
 *
 *   src/lib/storefront/protocol-import.ts
 *       buildImageProtocol()      — guide images → an image-mode Protocol
 *       protocolKey()             — the name-matching key used for de-duping
 *       mergeProtocolsByName()    — upsert incoming rows into an existing list
 *
 *   npm run test:protocol-import
 */

import assert from "node:assert";

import {
  buildImageProtocol,
  protocolKey,
  mergeProtocolsByName,
} from "../src/lib/storefront/protocol-import";
import { MAX_PROTOCOL_IMAGES } from "../src/lib/storefront/protocol-images";
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

/** A details-mode row shaped like one the store admin already saved. */
function existing(name: string, category = "General"): Protocol {
  return {
    category,
    name,
    dosage: "1mg weekly",
    frequency: "Once weekly",
    duration: "8 weeks",
    notes: ["hand-typed by the owner"],
    storage: "Refrigerate",
    mode: "details",
  };
}

console.log("\nProtocol import core — pure helpers\n");

// ──────────────────────────── buildImageProtocol ────────────────────────────
console.log("buildImageProtocol");

check("produces an image-mode protocol carrying every page image in order", () => {
  const p = buildImageProtocol({
    name: "GHK-Cu",
    category: "Beauty & Regeneration",
    images: ["p1.jpg", "p2.jpg"],
  });
  assert.equal(p.mode, "image");
  assert.equal(p.name, "GHK-Cu");
  assert.equal(p.category, "Beauty & Regeneration");
  assert.deepEqual(p.images, ["p1.jpg", "p2.jpg"]);
});

check("mirrors the first image into the legacy `image` field", () => {
  const p = buildImageProtocol({ name: "GLOW", category: "Beauty", images: ["a.jpg", "b.jpg"] });
  assert.equal(p.image, "a.jpg");
});

check("fills the written fields with empty values so the row is admin-editable", () => {
  const p = buildImageProtocol({ name: "VIP", category: "Immune Support", images: ["a.jpg"] });
  assert.equal(p.dosage, "");
  assert.equal(p.frequency, "");
  assert.equal(p.duration, "");
  assert.equal(p.storage, "");
  assert.deepEqual(p.notes, []);
});

check("drops blank and whitespace-only image urls", () => {
  const p = buildImageProtocol({
    name: "Semax",
    category: "Cognitive Enhancement",
    images: ["a.jpg", "", "   ", "b.jpg"],
  });
  assert.deepEqual(p.images, ["a.jpg", "b.jpg"]);
});

check("caps the gallery at MAX_PROTOCOL_IMAGES", () => {
  const many = Array.from({ length: MAX_PROTOCOL_IMAGES + 5 }, (_, i) => `p${i}.jpg`);
  const p = buildImageProtocol({ name: "Long guide", category: "General", images: many });
  assert.equal(p.images!.length, MAX_PROTOCOL_IMAGES);
});

check("throws when no usable image survives — never writes an empty image row", () => {
  assert.throws(
    () => buildImageProtocol({ name: "Broken", category: "General", images: ["", "  "] }),
    /image/i,
  );
});

check("throws when the protocol has no name", () => {
  assert.throws(
    () => buildImageProtocol({ name: "  ", category: "General", images: ["a.jpg"] }),
    /name/i,
  );
});

// ──────────────────────────── protocolKey ───────────────────────────────────
console.log("\nprotocolKey");

check("ignores case, spacing and punctuation when matching names", () => {
  assert.equal(
    protocolKey("MicaBlend 2.0 tirzepatide 30mg + cagrilintide 5mg"),
    protocolKey("  micablend 2.0  Tirzepatide 30mg + Cagrilintide 5mg  "),
  );
});

check("keeps genuinely different protocols apart", () => {
  assert.notEqual(protocolKey("GHK-Cu 50mg"), protocolKey("GHK-Cu 100mg"));
});

// ──────────────────────────── mergeProtocolsByName ──────────────────────────
console.log("\nmergeProtocolsByName");

check("appends brand-new protocols after the existing ones, in input order", () => {
  const list = [existing("Alpha"), existing("Beta")];
  const incoming = [
    buildImageProtocol({ name: "Gamma", category: "New", images: ["g.jpg"] }),
    buildImageProtocol({ name: "Delta", category: "New", images: ["d.jpg"] }),
  ];
  const out = mergeProtocolsByName(list, incoming);
  assert.deepEqual(out.map((p) => p.name), ["Alpha", "Beta", "Gamma", "Delta"]);
});

check("replaces a same-named protocol in place instead of duplicating it", () => {
  const list = [existing("Alpha"), existing("Beta"), existing("Gamma")];
  const incoming = [buildImageProtocol({ name: "beta", category: "New", images: ["b.jpg"] })];
  const out = mergeProtocolsByName(list, incoming);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.name), ["Alpha", "beta", "Gamma"]);
  assert.equal(out[1].mode, "image");
  assert.deepEqual(out[1].images, ["b.jpg"]);
});

check("never drops an existing protocol the import does not mention", () => {
  const list = [existing("Keep me"), existing("And me")];
  const out = mergeProtocolsByName(list, [
    buildImageProtocol({ name: "New", category: "New", images: ["n.jpg"] }),
  ]);
  assert.ok(out.some((p) => p.name === "Keep me"));
  assert.ok(out.some((p) => p.name === "And me"));
});

check("collapses duplicate names inside the incoming batch, last one wins", () => {
  const out = mergeProtocolsByName([], [
    buildImageProtocol({ name: "Dupe", category: "A", images: ["first.jpg"] }),
    buildImageProtocol({ name: "DUPE", category: "B", images: ["second.jpg"] }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, "B");
  assert.deepEqual(out[0].images, ["second.jpg"]);
});

check("does not mutate either input list", () => {
  const list = [existing("Alpha")];
  const snapshot = JSON.parse(JSON.stringify(list));
  const incoming = [buildImageProtocol({ name: "Alpha", category: "New", images: ["a.jpg"] })];
  const incomingSnapshot = JSON.parse(JSON.stringify(incoming));
  mergeProtocolsByName(list, incoming);
  assert.deepEqual(list, snapshot);
  assert.deepEqual(incoming, incomingSnapshot);
});

check("returns the existing list unchanged when there is nothing to import", () => {
  const list = [existing("Alpha"), existing("Beta")];
  const out = mergeProtocolsByName(list, []);
  assert.deepEqual(out.map((p) => p.name), ["Alpha", "Beta"]);
});

// ──────────────────────────── result ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
