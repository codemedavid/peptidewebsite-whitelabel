/**
 * Self-contained test for the pure core behind the Track-Order Delivery Note —
 * the per-tenant informational card shown on the storefront's Track Order page,
 * directly under the "search your order number" box. Owner-editable in the store
 * admin; a single flag (enabled) gates it — no operator entitlement, any store
 * can use it.
 *
 *   src/lib/storefront/track-note.ts
 *     DEFAULT_TRACK_NOTE        — the off-by-default baseline (J&T Davao example).
 *     normalizeTrackNote(input) — coerce untrusted branding.config into a closed,
 *                                 safe shape (never throws); fills defaults,
 *                                 strict boolean, trims + caps text/rows.
 *     isTrackNoteVisible(cfg)   — the gate: enabled && has something to show.
 *
 *   npm run test:track-note
 */

import assert from "node:assert";

import {
  DEFAULT_TRACK_NOTE,
  TRACK_NOTE_EXAMPLE,
  normalizeTrackNote,
  isTrackNoteVisible,
  MAX_TRACK_NOTE_ROWS,
  type TrackNoteConfig,
} from "../src/lib/storefront/track-note";

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

console.log("\nTrack-Order Delivery Note — pure core\n");

// ── isTrackNoteVisible: the gate ────────────────────────────────────────────
console.log("isTrackNoteVisible (gate = enabled && has content)");

check("undefined config → hidden (never configured)", () => {
  assert.equal(isTrackNoteVisible(undefined), false);
});
check("null config → hidden", () => {
  assert.equal(isTrackNoteVisible(null), false);
});
check("disabled → hidden even with content", () => {
  assert.equal(isTrackNoteVisible({ ...DEFAULT_TRACK_NOTE, enabled: false }), false);
});
check("enabled with a title → visible", () => {
  assert.equal(isTrackNoteVisible({ ...DEFAULT_TRACK_NOTE, enabled: true, title: "ETAs" }), true);
});
check("enabled but no title and no rows → hidden (nothing to show)", () => {
  assert.equal(
    isTrackNoteVisible({ ...DEFAULT_TRACK_NOTE, enabled: true, title: "", rows: [] }),
    false,
  );
});
check("enabled with rows but no title → visible", () => {
  assert.equal(
    isTrackNoteVisible({
      ...DEFAULT_TRACK_NOTE,
      enabled: true,
      title: "",
      rows: [{ region: "Mindanao", estimate: "1–5 days" }],
    }),
    true,
  );
});

// ── DEFAULT_TRACK_NOTE: safe off-by-default baseline ────────────────────────
console.log("\nDEFAULT_TRACK_NOTE");

check("disabled + EMPTY by default (all-tenant baseline, no inherited copy)", () => {
  assert.equal(DEFAULT_TRACK_NOTE.enabled, false);
  assert.equal(DEFAULT_TRACK_NOTE.title, "");
  assert.deepEqual(DEFAULT_TRACK_NOTE.rows, []);
  assert.equal(DEFAULT_TRACK_NOTE.footnote, "");
});
check("TRACK_NOTE_EXAMPLE carries the J&T Davao starter content", () => {
  assert.ok(TRACK_NOTE_EXAMPLE.title.length > 0);
  assert.ok(TRACK_NOTE_EXAMPLE.rows.length >= 4);
  assert.ok(TRACK_NOTE_EXAMPLE.footnote.length > 0);
  assert.equal(TRACK_NOTE_EXAMPLE.rows[0].region, "Mindanao");
});

// ── normalizeTrackNote: coerce untrusted input ──────────────────────────────
console.log("\nnormalizeTrackNote");

check("non-object input collapses to the safe default (never throws)", () => {
  assert.deepEqual(normalizeTrackNote(null), DEFAULT_TRACK_NOTE);
  assert.deepEqual(normalizeTrackNote(undefined), DEFAULT_TRACK_NOTE);
  assert.deepEqual(normalizeTrackNote("nope"), DEFAULT_TRACK_NOTE);
  assert.deepEqual(normalizeTrackNote(42), DEFAULT_TRACK_NOTE);
});
check("missing fields fall back to defaults", () => {
  const out = normalizeTrackNote({ enabled: true });
  assert.equal(out.enabled, true);
  assert.equal(out.title, DEFAULT_TRACK_NOTE.title);
  assert.deepEqual(out.rows, DEFAULT_TRACK_NOTE.rows);
});
check("enabled coerces to a STRICT boolean", () => {
  assert.equal(normalizeTrackNote({ enabled: 1 }).enabled, false);
  assert.equal(normalizeTrackNote({ enabled: "yes" }).enabled, false);
  assert.equal(normalizeTrackNote({ enabled: true }).enabled, true);
});
check("owner-provided content is preserved (trimmed)", () => {
  const out = normalizeTrackNote({ title: "  Shipping ETAs  ", subtitle: " from Cebu " });
  assert.equal(out.title, "Shipping ETAs");
  assert.equal(out.subtitle, "from Cebu");
});
check("rows: coerced, trimmed, blank rows dropped", () => {
  const out = normalizeTrackNote({
    rows: [
      { region: "  Luzon ", estimate: " 3–7 days " },
      { region: "", estimate: "" },
      { region: "   ", estimate: "  " },
      { region: "Visayas", estimate: "3–7 days" },
    ],
  });
  assert.deepEqual(out.rows, [
    { region: "Luzon", estimate: "3–7 days" },
    { region: "Visayas", estimate: "3–7 days" },
  ]);
});
check("a row with only one cell filled is kept (partial rows allowed)", () => {
  const out = normalizeTrackNote({ rows: [{ region: "Palawan", estimate: "" }] });
  assert.deepEqual(out.rows, [{ region: "Palawan", estimate: "" }]);
});
check("non-array rows fall back to defaults; garbage entries are dropped", () => {
  assert.deepEqual(normalizeTrackNote({ rows: "nope" }).rows, DEFAULT_TRACK_NOTE.rows);
  const out = normalizeTrackNote({ rows: [null, 5, "x", { region: "Ok", estimate: "1 day" }] });
  assert.deepEqual(out.rows, [{ region: "Ok", estimate: "1 day" }]);
});
check("row count is capped at MAX_TRACK_NOTE_ROWS", () => {
  const many = Array.from({ length: MAX_TRACK_NOTE_ROWS + 5 }, (_, i) => ({
    region: `R${i}`,
    estimate: `${i} days`,
  }));
  assert.equal(normalizeTrackNote({ rows: many }).rows.length, MAX_TRACK_NOTE_ROWS);
});
check("over-long title + footnote are length-capped", () => {
  const out = normalizeTrackNote({ title: "x".repeat(5000), footnote: "y".repeat(5000) });
  assert.ok(out.title.length > 0 && out.title.length <= 120);
  assert.ok(out.footnote.length > 0 && out.footnote.length <= 400);
});
check("normalize is idempotent", () => {
  const once = normalizeTrackNote({
    enabled: true,
    title: "ETAs",
    rows: [{ region: "A", estimate: "1 day" }, { region: "", estimate: "" }],
  });
  const twice = normalizeTrackNote(once as unknown);
  assert.deepEqual(twice, once);
});
check("enabled but empty (never edited) → NOT visible (no auto-show)", () => {
  const cfg: TrackNoteConfig = normalizeTrackNote({ enabled: true });
  assert.equal(isTrackNoteVisible(cfg), false);
});
check("a fully normalized enabled config with content is visible end-to-end", () => {
  const cfg: TrackNoteConfig = normalizeTrackNote(TRACK_NOTE_EXAMPLE as unknown);
  assert.equal(isTrackNoteVisible(cfg), true);
});

// ──────────────────────────────── summary ───────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
