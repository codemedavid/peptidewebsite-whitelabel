/**
 * Self-contained test for the protocol alphabetical-sort core — the pure module
 * the storefront Protocols page uses to order the protocol list:
 *
 *   - src/lib/storefront/protocol-sort.ts
 *       normalizeProtocolSort()   — coerces an untrusted sort value into a known
 *                                   ProtocolSort ("default" | "az" | "za")
 *       sortProtocolsByName()     — returns a new, alphabetically ordered copy of
 *                                   the protocol list (input is never mutated)
 *       PROTOCOL_SORT_OPTIONS     — the options the <select> renders
 *
 * Runs the REAL module (no DB, no Next runtime, no browser):
 *
 *   npm run test:protocol-sort
 */

import assert from "node:assert";

import {
  PROTOCOL_SORT_OPTIONS,
  normalizeProtocolSort,
  sortProtocolsByName,
} from "../src/lib/storefront/protocol-sort";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

const names = (list: { name: string }[]) => list.map((p) => p.name);

// ──────────────────────────── normalizeProtocolSort ─────────────────────────
console.log("normalizeProtocolSort");
check("keeps the three known values", () => {
  assert.equal(normalizeProtocolSort("default"), "default");
  assert.equal(normalizeProtocolSort("az"), "az");
  assert.equal(normalizeProtocolSort("za"), "za");
});
check("unknown / empty / non-string input → default", () => {
  assert.equal(normalizeProtocolSort("bogus"), "default");
  assert.equal(normalizeProtocolSort(""), "default");
  assert.equal(normalizeProtocolSort(null), "default");
  assert.equal(normalizeProtocolSort(undefined), "default");
  assert.equal(normalizeProtocolSort(42), "default");
});

// ──────────────────────────── sortProtocolsByName ────────────────────────────
console.log("sortProtocolsByName");
const sample = [
  { name: "TB-500", category: "Recovery" },
  { name: "aod-9604", category: "Metabolic" },
  { name: "BPC-157", category: "Recovery" },
];

check("default keeps the admin-defined order", () => {
  assert.deepEqual(names(sortProtocolsByName(sample, "default")), [
    "TB-500",
    "aod-9604",
    "BPC-157",
  ]);
});
check("az sorts A→Z case-insensitively", () => {
  assert.deepEqual(names(sortProtocolsByName(sample, "az")), [
    "aod-9604",
    "BPC-157",
    "TB-500",
  ]);
});
check("za is the exact reverse of az", () => {
  assert.deepEqual(names(sortProtocolsByName(sample, "za")), [
    "TB-500",
    "BPC-157",
    "aod-9604",
  ]);
});
check("never mutates the input list", () => {
  const input = [...sample];
  sortProtocolsByName(input, "az");
  sortProtocolsByName(input, "za");
  assert.deepEqual(names(input), ["TB-500", "aod-9604", "BPC-157"]);
});
check("always returns a new array (even for default)", () => {
  const input = [...sample];
  assert.notEqual(sortProtocolsByName(input, "default"), input);
  assert.notEqual(sortProtocolsByName(input, "az"), input);
});
check("empty list → empty list without throwing", () => {
  assert.deepEqual(sortProtocolsByName([], "az"), []);
});
check("numeric-aware: BPC-2 sorts before BPC-10", () => {
  const out = sortProtocolsByName(
    [{ name: "BPC-10" }, { name: "BPC-2" }],
    "az",
  );
  assert.deepEqual(names(out), ["BPC-2", "BPC-10"]);
});
check("equal names keep their relative input order (stable)", () => {
  const a = { name: "Ipamorelin", category: "GH" };
  const b = { name: "Ipamorelin", category: "Sleep" };
  const out = sortProtocolsByName([a, b], "az");
  assert.equal(out[0], a);
  assert.equal(out[1], b);
});
check("missing / non-string names are tolerated and sort first", () => {
  const out = sortProtocolsByName(
    [{ name: "BPC-157" }, { name: undefined as unknown as string }],
    "az",
  );
  assert.equal(out.length, 2);
  assert.equal(out[1].name, "BPC-157");
});

// ──────────────────────────── PROTOCOL_SORT_OPTIONS ─────────────────────────
console.log("PROTOCOL_SORT_OPTIONS");
check("offers exactly default, az, za — each with a label", () => {
  assert.deepEqual(
    PROTOCOL_SORT_OPTIONS.map((o) => o.value),
    ["default", "az", "za"],
  );
  for (const o of PROTOCOL_SORT_OPTIONS) {
    assert.ok(o.label.length > 0, `missing label for ${o.value}`);
  }
});

// ──────────────────────────── summary ────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
