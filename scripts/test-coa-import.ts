/**
 * Self-contained test for the COA import core — the pure helpers that turn a
 * lab certificate file into a storefront CoaReport row and merge those rows
 * into a tenant's existing Lab Reports list.
 *
 * Lab reports live in the shared `branding.config.coaReports` JSON blob, the
 * same array the store admin edits, so a bulk import is a read-modify-write
 * that must not lose or duplicate a row. These are also published claims about
 * a product's purity, so the builder refuses anything it cannot render
 * faithfully: a nameless row (the server normalizer would silently DROP it), a
 * row with no certificate image, or a date the storefront cannot parse.
 *
 *   src/lib/storefront/coa-import.ts
 *       buildCoaReport()        — certificate metadata → a CoaReport row
 *       coaReportId()           — stable slug id derived from the report name
 *       mergeCoaReportsById()   — upsert incoming rows into an existing list
 *
 *   npm run test:coa-import
 */

import assert from "node:assert";

import {
  buildCoaReport,
  coaReportId,
  mergeCoaReportsById,
} from "../src/lib/storefront/coa-import";
import { normalizeCoaReports } from "../src/lib/storefront/coa";
import type { CoaReport } from "../src/storefront/types";

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

const IMG = "https://ik.imagekit.io/x/tenant/acme/coa-1.jpg";

function input(over: Partial<Parameters<typeof buildCoaReport>[0]> = {}) {
  return {
    name: "Tirzepatide 30mg",
    lab: "Janoshik Analytical",
    date: "2026-04-30",
    purity: "99.854%",
    image: IMG,
    ...over,
  };
}

console.log("\nCOA import core — pure helpers\n");

// ──────────────────────────── buildCoaReport ────────────────────────────────
console.log("buildCoaReport");

check("carries every certificate field onto the report row", () => {
  const r = buildCoaReport(input());
  assert.equal(r.name, "Tirzepatide 30mg");
  assert.equal(r.lab, "Janoshik Analytical");
  assert.equal(r.date, "2026-04-30");
  assert.equal(r.purity, "99.854%");
  assert.equal(r.image, IMG);
});

check("survives the server normalizer byte-for-byte", () => {
  // saveCoaReportsAction runs normalizeCoaReports at the trust boundary. If the
  // builder emits anything that normalizer rewrites or drops, what the owner
  // sees after their next admin Save would differ from what was imported.
  const r = buildCoaReport(input());
  assert.deepEqual(normalizeCoaReports([r]), [r]);
});

check("defaults link to empty so the card opens the certificate image", () => {
  const r = buildCoaReport(input());
  assert.equal(r.link, "");
});

check("keeps an explicit verification link when one is supplied", () => {
  const r = buildCoaReport(input({ link: "https://verify.example.com/abc" }));
  assert.equal(r.link, "https://verify.example.com/abc");
});

check("allows a blank purity for tests that report no purity figure", () => {
  const r = buildCoaReport(input({ name: "Tirzepatide — Sterility", purity: "" }));
  assert.equal(r.purity, "");
  assert.deepEqual(normalizeCoaReports([r]), [r]);
});

check("throws on a nameless report — the normalizer would silently drop it", () => {
  assert.throws(() => buildCoaReport(input({ name: "  " })), /name/i);
});

check("throws when the certificate image is missing", () => {
  assert.throws(() => buildCoaReport(input({ image: "" })), /image/i);
});

check("throws on a non-https image the normalizer would strip", () => {
  assert.throws(() => buildCoaReport(input({ image: "javascript:alert(1)" })), /image/i);
});

check("throws on a date the storefront cannot render", () => {
  // The COA card runs new Date(report.date).toLocaleDateString(); a loose
  // format like "3/6/26" renders differently per locale or as Invalid Date.
  assert.throws(() => buildCoaReport(input({ date: "3/6/26" })), /date/i);
  assert.throws(() => buildCoaReport(input({ date: "2026-13-45" })), /date/i);
});

check("accepts an empty date for an undated certificate", () => {
  const r = buildCoaReport(input({ date: "" }));
  assert.equal(r.date, "");
});

// ──────────────────────────── coaReportId ───────────────────────────────────
console.log("\ncoaReportId");

check("derives a url-safe slug id from the report name", () => {
  assert.equal(coaReportId("Tirzepatide 30mg — Heavy Metals"), "coa-tirzepatide-30mg-heavy-metals");
});

check("gives the same id for the same name, so a re-import refreshes the row", () => {
  assert.equal(coaReportId("GHK-Cu 100mg"), coaReportId("GHK-Cu 100mg"));
});

check("keeps different reports apart", () => {
  assert.notEqual(coaReportId("Tirzepatide 15mg"), coaReportId("Tirzepatide 30mg"));
});

// ──────────────────────────── mergeCoaReportsById ───────────────────────────
console.log("\nmergeCoaReportsById");

const existingRow: CoaReport = {
  id: "hand-typed-1",
  name: "Owner's own report",
  lab: "Janoshik",
  date: "2026-01-01",
  purity: "99%",
  image: IMG,
  link: "",
};

check("appends new reports after the existing ones, in input order", () => {
  const out = mergeCoaReportsById(
    [existingRow],
    [buildCoaReport(input({ name: "A" })), buildCoaReport(input({ name: "B" }))],
  );
  assert.deepEqual(out.map((r) => r.name), ["Owner's own report", "A", "B"]);
});

check("refreshes a report with the same id in place instead of duplicating", () => {
  const first = buildCoaReport(input({ name: "Tirzepatide 30mg", purity: "99.100%" }));
  const second = buildCoaReport(input({ name: "Tirzepatide 30mg", purity: "99.854%" }));
  const out = mergeCoaReportsById([existingRow, first], [second]);
  assert.equal(out.length, 2);
  assert.equal(out[1].purity, "99.854%");
});

check("never drops a report the import does not mention", () => {
  const out = mergeCoaReportsById([existingRow], [buildCoaReport(input({ name: "New" }))]);
  assert.ok(out.some((r) => r.id === "hand-typed-1"));
});

check("rejects a batch that contains two reports with the same id", () => {
  // Two certificates sharing a name would collapse into one row and silently
  // lose a lab result, so the import must fail loudly instead.
  assert.throws(
    () =>
      mergeCoaReportsById([], [
        buildCoaReport(input({ name: "Same name" })),
        buildCoaReport(input({ name: "same NAME" })),
      ]),
    /duplicate/i,
  );
});

check("does not mutate either input list", () => {
  const list = [existingRow];
  const snapshot = JSON.parse(JSON.stringify(list));
  mergeCoaReportsById(list, [buildCoaReport(input({ name: "X" }))]);
  assert.deepEqual(list, snapshot);
});

check("returns the existing list unchanged when there is nothing to import", () => {
  assert.deepEqual(mergeCoaReportsById([existingRow], []), [existingRow]);
});

// ──────────────────────────── result ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
