/**
 * Self-contained test for the FAQ pure core — the module the store-admin save
 * action (server) depends on to sanitize the owner's FAQ groups before they are
 * written to `branding.config.faqGroups`. This is the DB-persistence fix for the
 * "FAQ can't be saved" bug: FAQ previously lived only in localStorage, so edits
 * never reached other devices/customers.
 *
 *   src/lib/storefront/faq.ts
 *     normalizeFaqGroups(input) — coerce untrusted FAQ config into a closed,
 *                                 safe FaqGroup[] (never throws); drops garbage
 *                                 entries, whitelists icons, caps counts and
 *                                 string lengths, but PRESERVES blank Q/A rows
 *                                 (the editor adds empty rows mid-edit and they
 *                                 must survive a save → reload round-trip).
 *     FAQ_ICONS / MAX_FAQ_GROUPS / MAX_FAQ_ITEMS
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:faq
 */

import assert from "node:assert";

import {
  FAQ_ICONS,
  MAX_FAQ_GROUPS,
  MAX_FAQ_ITEMS,
  MAX_FAQ_LABEL,
  MAX_FAQ_QUESTION,
  MAX_FAQ_ANSWER,
  normalizeFaqGroups,
} from "../src/lib/storefront/faq";

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

console.log("\nStorefront FAQ — pure core (normalizeFaqGroups)\n");

// ── malformed input never throws ─────────────────────────────────────────────
console.log("malformed input");

check("non-array input collapses to [] (never throws)", () => {
  assert.deepEqual(normalizeFaqGroups(null), []);
  assert.deepEqual(normalizeFaqGroups(undefined), []);
  assert.deepEqual(normalizeFaqGroups("nope"), []);
  assert.deepEqual(normalizeFaqGroups(42), []);
  assert.deepEqual(normalizeFaqGroups({ g: 1 }), []);
});

check("garbage entries inside the array are dropped", () => {
  const out = normalizeFaqGroups([
    null,
    5,
    "x",
    { id: "g1", label: "Shipping", icon: "shipping", items: [] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Shipping");
});

// ── well-formed groups round-trip ────────────────────────────────────────────
console.log("\nwell-formed groups");

check("a valid group is preserved verbatim", () => {
  const g = {
    id: "g123",
    label: "Payments",
    icon: "payment",
    items: [{ q: "GCash?", a: "Yes, we accept GCash." }],
  };
  assert.deepEqual(normalizeFaqGroups([g]), [g]);
});

check("normalize is idempotent (save → load → save is stable)", () => {
  const once = normalizeFaqGroups([
    { id: "", label: "  Shipping  ", icon: "bogus", items: [{ q: " Q ", a: " A " }, null] },
  ]);
  const twice = normalizeFaqGroups(once as unknown);
  assert.deepEqual(twice, once);
});

// ── field coercion ───────────────────────────────────────────────────────────
console.log("\nfield coercion");

check("label is coerced to a trimmed, length-capped string", () => {
  const out = normalizeFaqGroups([
    { id: "g1", label: `  ${"x".repeat(MAX_FAQ_LABEL + 50)}  `, icon: "default", items: [] },
  ]);
  assert.equal(out[0].label.length, MAX_FAQ_LABEL);
  const out2 = normalizeFaqGroups([{ id: "g1", label: 42, icon: "default", items: [] }]);
  assert.equal(out2[0].label, "42");
});

check("missing/blank id falls back to a deterministic per-index id", () => {
  const out = normalizeFaqGroups([
    { label: "A", icon: "default", items: [] },
    { id: "  ", label: "B", icon: "default", items: [] },
    { id: "keep-me", label: "C", icon: "default", items: [] },
  ]);
  assert.equal(out[0].id, "g0");
  assert.equal(out[1].id, "g1");
  assert.equal(out[2].id, "keep-me");
});

check("unknown icon falls back to 'default'; known icons pass through", () => {
  for (const icon of FAQ_ICONS) {
    assert.equal(normalizeFaqGroups([{ id: "g", label: "L", icon, items: [] }])[0].icon, icon);
  }
  assert.equal(
    normalizeFaqGroups([{ id: "g", label: "L", icon: "javascript:evil", items: [] }])[0].icon,
    "default",
  );
  assert.equal(normalizeFaqGroups([{ id: "g", label: "L", items: [] }])[0].icon, "default");
});

// ── items ────────────────────────────────────────────────────────────────────
console.log("\nitems");

check("non-array items falls back to []", () => {
  assert.deepEqual(normalizeFaqGroups([{ id: "g", label: "L", icon: "default", items: "no" }])[0].items, []);
  assert.deepEqual(normalizeFaqGroups([{ id: "g", label: "L", icon: "default" }])[0].items, []);
});

check("garbage item entries are dropped; q/a coerce to trimmed strings", () => {
  const out = normalizeFaqGroups([
    {
      id: "g",
      label: "L",
      icon: "default",
      items: [null, 7, "x", { q: "  How long?  ", a: "  3 days  " }, { q: 1, a: undefined }],
    },
  ]);
  assert.deepEqual(out[0].items, [
    { q: "How long?", a: "3 days" },
    { q: "1", a: "" },
  ]);
});

check("BLANK rows are preserved (mid-edit rows must survive save → reload)", () => {
  const out = normalizeFaqGroups([
    { id: "g", label: "L", icon: "default", items: [{ q: "", a: "" }] },
  ]);
  assert.deepEqual(out[0].items, [{ q: "", a: "" }]);
});

check("over-long question/answer are length-capped", () => {
  const out = normalizeFaqGroups([
    {
      id: "g",
      label: "L",
      icon: "default",
      items: [{ q: "q".repeat(MAX_FAQ_QUESTION + 99), a: "a".repeat(MAX_FAQ_ANSWER + 99) }],
    },
  ]);
  assert.equal(out[0].items[0].q.length, MAX_FAQ_QUESTION);
  assert.equal(out[0].items[0].a.length, MAX_FAQ_ANSWER);
});

// ── caps ─────────────────────────────────────────────────────────────────────
console.log("\ncaps");

check("group count is capped at MAX_FAQ_GROUPS", () => {
  const many = Array.from({ length: MAX_FAQ_GROUPS + 5 }, (_, i) => ({
    id: `g${i}`,
    label: `Group ${i}`,
    icon: "default",
    items: [],
  }));
  assert.equal(normalizeFaqGroups(many).length, MAX_FAQ_GROUPS);
});

check("per-group item count is capped at MAX_FAQ_ITEMS", () => {
  const items = Array.from({ length: MAX_FAQ_ITEMS + 5 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
  const out = normalizeFaqGroups([{ id: "g", label: "L", icon: "default", items }]);
  assert.equal(out[0].items.length, MAX_FAQ_ITEMS);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
