/**
 * Self-contained test for the COA (Lab Reports) pure core — the module the
 * store-admin save action (server) depends on to sanitize the owner's lab
 * reports before they are written to `branding.config.coaReports`. This is the
 * DB-persistence fix for the "lab reports only live in one browser" bug: COA
 * reports previously lived only in localStorage (makeSetter), so edits never
 * reached other devices/customers and a fresh device always fell back to the
 * generic SEED_COA_REPORTS samples.
 *
 *   src/lib/storefront/coa.ts
 *     normalizeCoaReports(input) — coerce untrusted COA config into a closed,
 *                                  safe CoaReport[] (never throws); drops garbage
 *                                  entries and name-less rows, caps counts and
 *                                  string lengths, and keeps only http(s) URLs
 *                                  out of image/link (fail-closed against
 *                                  javascript:/data:).
 *     MAX_COA_REPORTS / field length caps
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:coa
 */

import assert from "node:assert";

import {
  MAX_COA_REPORTS,
  MAX_COA_NAME,
  MAX_COA_TEXT,
  normalizeCoaReports,
} from "../src/lib/storefront/coa";

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

console.log("\nStorefront COA — pure core (normalizeCoaReports)\n");

// ── malformed input never throws ─────────────────────────────────────────────
console.log("malformed input");

check("non-array input collapses to [] (never throws)", () => {
  assert.deepEqual(normalizeCoaReports(null), []);
  assert.deepEqual(normalizeCoaReports(undefined), []);
  assert.deepEqual(normalizeCoaReports("nope"), []);
  assert.deepEqual(normalizeCoaReports(42), []);
  assert.deepEqual(normalizeCoaReports({ r: 1 }), []);
});

check("garbage array entries are dropped, not thrown on", () => {
  const out = normalizeCoaReports([null, 3, "x", [], { name: "Real Report" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Real Report");
});

check("entries with a blank/absent name are dropped", () => {
  const out = normalizeCoaReports([
    { name: "" },
    { name: "   " },
    { lab: "Janoshik", purity: "99%" }, // no name
    { name: "Keeper" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Keeper");
});

// ── clean happy-path round-trip ──────────────────────────────────────────────
console.log("\nhappy path");

check("a full report round-trips its fields", () => {
  const out = normalizeCoaReports([
    {
      id: "coa-1",
      name: "Retatrutide 30mg",
      lab: "Janoshik Analytical",
      date: "2026-01-27",
      purity: "99.768%",
      image: "https://verify.janoshik.com/tests/img/abc.png",
      link: "https://verify.janoshik.com/tests/102847-90030_6W2ANUZLQKSW",
    },
  ]);
  assert.deepEqual(out, [
    {
      id: "coa-1",
      name: "Retatrutide 30mg",
      lab: "Janoshik Analytical",
      date: "2026-01-27",
      purity: "99.768%",
      image: "https://verify.janoshik.com/tests/img/abc.png",
      link: "https://verify.janoshik.com/tests/102847-90030_6W2ANUZLQKSW",
    },
  ]);
});

check("missing optional fields default to empty strings", () => {
  const out = normalizeCoaReports([{ name: "Lab Report" }]);
  assert.equal(out[0].name, "Lab Report");
  assert.equal(out[0].lab, "");
  assert.equal(out[0].date, "");
  assert.equal(out[0].purity, "");
  assert.equal(out[0].image, "");
  assert.equal(out[0].link, "");
  assert.ok(typeof out[0].id === "string" && out[0].id.length > 0);
});

check("a missing id is backfilled with a stable, unique id", () => {
  const out = normalizeCoaReports([{ name: "A" }, { name: "B" }]);
  assert.ok(out[0].id);
  assert.ok(out[1].id);
  assert.notEqual(out[0].id, out[1].id);
});

// ── fail-closed URL handling ─────────────────────────────────────────────────
console.log("\nURL safety (fail-closed)");

check("javascript: / data: / garbage URLs are stripped to empty", () => {
  const out = normalizeCoaReports([
    {
      name: "XSS attempt",
      image: "javascript:alert(1)",
      link: "data:text/html,<script>alert(1)</script>",
    },
  ]);
  assert.equal(out[0].image, "");
  assert.equal(out[0].link, "");
});

check("http and https URLs are preserved", () => {
  const out = normalizeCoaReports([
    { name: "R", image: "http://x.test/a.png", link: "https://y.test/b" },
  ]);
  assert.equal(out[0].image, "http://x.test/a.png");
  assert.equal(out[0].link, "https://y.test/b");
});

// ── caps ─────────────────────────────────────────────────────────────────────
console.log("\ncaps");

check("report count is capped at MAX_COA_REPORTS", () => {
  const many = Array.from({ length: MAX_COA_REPORTS + 25 }, (_, i) => ({
    name: `R${i}`,
  }));
  const out = normalizeCoaReports(many);
  assert.equal(out.length, MAX_COA_REPORTS);
});

check("name is capped at MAX_COA_NAME chars", () => {
  const out = normalizeCoaReports([{ name: "x".repeat(MAX_COA_NAME + 500) }]);
  assert.equal(out[0].name.length, MAX_COA_NAME);
});

check("lab / date / purity are capped at MAX_COA_TEXT chars", () => {
  const out = normalizeCoaReports([
    {
      name: "R",
      lab: "l".repeat(MAX_COA_TEXT + 500),
      date: "d".repeat(MAX_COA_TEXT + 500),
      purity: "p".repeat(MAX_COA_TEXT + 500),
    },
  ]);
  assert.equal(out[0].lab.length, MAX_COA_TEXT);
  assert.equal(out[0].date.length, MAX_COA_TEXT);
  assert.equal(out[0].purity.length, MAX_COA_TEXT);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
