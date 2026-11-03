// Super-admin → store-admin push: input rules + one push per phone.
// Run: npm run test:admin-broadcast
import assert from "node:assert";
import { parseBroadcastInput, dedupeRecipients, BROADCAST_LIMITS } from "../src/lib/mobile/admin-broadcast-input";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

check("title and message are required", () => {
  assert.ok("error" in parseBroadcastInput({ title: "", body: "x" }));
  assert.ok("error" in parseBroadcastInput({ title: "x", body: "  " }));
  assert.ok("error" in parseBroadcastInput(null));
});
check("whitespace and control characters collapse", () => {
  const r = parseBroadcastInput({ title: "  New\nversion ", body: "Update\t now" });
  assert.deepEqual(r, { title: "New version", body: "Update now", tenantIds: [] });
});
check("over-long text is refused, not truncated", () => {
  assert.ok("error" in parseBroadcastInput({ title: "x".repeat(BROADCAST_LIMITS.title + 1), body: "b" }));
  assert.ok("error" in parseBroadcastInput({ title: "t", body: "x".repeat(BROADCAST_LIMITS.body + 1) }));
});
check("tenant filter keeps unique non-blank ids; absent = everyone", () => {
  const r = parseBroadcastInput({ title: "t", body: "b", tenantIds: ["a", " a ", "", 3, "b"] });
  assert.ok(!("error" in r) && r.tenantIds.join() === "a,b");
});
check("an admin of two stores gets one push per phone", () => {
  const out = dedupeRecipients([
    { id: "1", token: "T1", platform: "ios" },
    { id: "2", token: "T1", platform: "ios" },
    { id: "3", token: "T2", platform: "android" },
  ]);
  assert.deepEqual(out.map((r) => r.id), ["1", "3"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
