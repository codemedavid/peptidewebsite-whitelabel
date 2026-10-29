/**
 * Self-contained test for the connector's group-buy-orders + staff core
 * (src/lib/mcp/orders-staff-core.ts).
 *
 *   npm run test:mcp-orders-staff
 */

import assert from "node:assert";

import {
  buildStaffPayload,
  resolveStaffPermissions,
  summarizeFolders,
} from "../src/lib/mcp/orders-staff-core";
import type { OrderFolder } from "../src/lib/storefront/order-folders";

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

console.log("\nMCP group-buy orders + staff core\n");

check("permissions resolve from keys, labels and plurals", () => {
  const r = resolveStaffPermissions(["orders", "Group Buys", "Customer", "ORDERS"]);
  assert.ok(r.ok);
  if (r.ok) assert.deepStrictEqual(r.value, ["orders", "groupbuys", "customers"]);
});

check('"all" grants every module', () => {
  const r = resolveStaffPermissions("all");
  assert.ok(r.ok && r.value.includes("orders") && r.value.includes("groupbuys"));
});

check("an unknown permission refuses the whole list, naming it", () => {
  const r = resolveStaffPermissions(["orders", "payroll"]);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.error, /payroll/);
});

check("a new account needs at least one permission", () => {
  const r = buildStaffPayload({ email: "a@x.com", permissions: [] }, null, "secret1");
  assert.ok(!r.ok);
});

check("create: username defaults to the email's local part, password confirmed", () => {
  const r = buildStaffPayload({ email: "Ana@x.com", fullName: "Ana", permissions: ["orders"] }, null, "secret1");
  assert.ok(r.ok);
  if (r.ok) {
    assert.strictEqual(r.value.username, "Ana");
    assert.strictEqual(r.value.confirmPassword, "secret1");
    assert.strictEqual(r.value.status, "active");
  }
});

check("update keeps unsent fields and the current status; blank password keeps theirs", () => {
  const current = { fullName: "Ana", email: "ana@x.com", username: "ana", status: "suspended", permissions: ["orders"] };
  const r = buildStaffPayload({ fullName: "Ana Cruz" }, current, "");
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepStrictEqual(
      { ...r.value },
      { fullName: "Ana Cruz", email: "ana@x.com", username: "ana", status: "suspended", permissions: ["orders"], password: "", confirmPassword: "" },
    );
  }
});

check("update: sent permissions REPLACE the old list", () => {
  const current = { fullName: "Ana", email: "ana@x.com", username: "ana", status: "active", permissions: ["orders", "products"] };
  const r = buildStaffPayload({ permissions: ["customers"] }, current, "");
  assert.ok(r.ok && r.value.permissions.join() === "customers");
});

check("folder summaries drop row ids and keep the numbers", () => {
  const f = { id: "g1", name: "TR30", orderIds: ["o1"], totalOrders: 1 } as unknown as OrderFolder;
  const s = summarizeFolders({ live: [f], upcoming: [], recent: [], archived: [] });
  assert.ok(!("orderIds" in s.live[0]));
  assert.strictEqual(s.live[0].totalOrders, 1);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
