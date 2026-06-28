/**
 * Self-contained test for the collapsible feature-module disclosure helpers
 * behind the admin Tenant → Features editor (FeaturesEditor.tsx). Runs the REAL
 * pure helpers (no DB, no React runtime) so the accordion behaviour is pinned:
 *
 *   - src/components/admin/feature-disclosure.ts
 *       isGroupOpen({ group, openGroups, filter })  — effective open/closed:
 *           default collapsed; a filter (on/off) forces every group open so
 *           matching rows are never hidden by a collapsed module.
 *       toggleGroupOpen(openGroups, group)          — immutable open-state toggle.
 *       groupBodyId(group)                          — stable, DOM-safe id used for
 *           the disclosure trigger's aria-controls and the body region.
 *
 *   npm run test:feature-disclosure
 */

import assert from "node:assert";

import { FEATURE_GROUPS } from "../src/lib/features/catalog";
import {
  isGroupOpen,
  toggleGroupOpen,
  groupBodyId,
} from "../src/components/admin/feature-disclosure";

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

console.log("\nFeature-module disclosure helpers — pure core\n");

// ─────────────────────────────────── isGroupOpen ────────────────────────────
console.log("isGroupOpen");

check("groups default to collapsed when nothing is toggled and filter is 'all'", () => {
  for (const group of FEATURE_GROUPS) {
    assert.equal(isGroupOpen({ group, openGroups: {}, filter: "all" }), false, `${group} should start closed`);
  }
});

check("a group the user opened reports open under the 'all' filter", () => {
  assert.equal(isGroupOpen({ group: "Group Buy", openGroups: { "Group Buy": true }, filter: "all" }), true);
});

check("a group the user explicitly closed reports closed under the 'all' filter", () => {
  assert.equal(isGroupOpen({ group: "Site", openGroups: { Site: false }, filter: "all" }), false);
});

check("the 'on' filter forces every group open even when none were toggled", () => {
  for (const group of FEATURE_GROUPS) {
    assert.equal(isGroupOpen({ group, openGroups: {}, filter: "on" }), true, `${group} should open under 'on' filter`);
  }
});

check("the 'off' filter forces a group open even if the user had collapsed it", () => {
  assert.equal(isGroupOpen({ group: "Catalog", openGroups: { Catalog: false }, filter: "off" }), true);
});

// ────────────────────────────────── toggleGroupOpen ─────────────────────────
console.log("toggleGroupOpen");

check("toggling an untouched group opens it", () => {
  assert.deepEqual(toggleGroupOpen({}, "Site"), { Site: true });
});

check("toggling an open group closes it", () => {
  assert.deepEqual(toggleGroupOpen({ Site: true }, "Site"), { Site: false });
});

check("toggling does not mutate the input (immutability)", () => {
  const before = { Site: true };
  const after = toggleGroupOpen(before, "Catalog");
  assert.deepEqual(before, { Site: true }, "input must be unchanged");
  assert.notEqual(after, before, "must return a new object");
  assert.deepEqual(after, { Site: true, Catalog: true });
});

check("toggling one group leaves the others' state intact", () => {
  const next = toggleGroupOpen({ Site: true, Catalog: false }, "Catalog");
  assert.equal(next.Site, true);
  assert.equal(next.Catalog, true);
});

// ─────────────────────────────────── groupBodyId ────────────────────────────
console.log("groupBodyId");

check("every catalog group yields a unique, DOM-safe id", () => {
  const ids = FEATURE_GROUPS.map(groupBodyId);
  for (const id of ids) {
    assert.ok(/^ftr-grp-[a-z0-9-]+$/.test(id), `id not DOM-safe: ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "ids must be unique across groups");
});

check("ids are stable for a given group name", () => {
  assert.equal(groupBodyId("Group Buy"), groupBodyId("Group Buy"));
  assert.equal(groupBodyId("Sales Analytics"), "ftr-grp-sales-analytics");
  assert.equal(groupBodyId("Growth & Automation"), "ftr-grp-growth-automation");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
