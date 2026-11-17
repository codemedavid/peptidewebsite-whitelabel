// Unit tests for features/tracker/lib/scope-key.ts: the phone's tracker keys
// never carry the account's email. Run: npm run test:tracker
import assert from "node:assert/strict";
import { legacyGroupOf, scopeKeyId } from "../src/features/tracker/lib/scope-key";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker scope key");

test("stable, short, hex — and the email never appears in it", () => {
  const scope = "alpha:customer:ann.smith@example.com";
  const id = scopeKeyId(scope);
  assert.ok(/^[0-9a-f]{16}$/.test(id), id);
  assert.equal(scopeKeyId(scope), id);
  assert.ok(!id.includes("ann") && !id.includes("@"));
});

test("different accounts, modes and stores get different ids", () => {
  const ids = new Set(["alpha:customer:ann@x.com", "alpha:customer:bob@x.com", "alpha:admin:ann@x.com", "beta:customer:ann@x.com", "alpha:customer:guest"].map(scopeKeyId));
  assert.equal(ids.size, 5);
});

test("a stored key splits into its account group and part (emails contain dots)", () => {
  assert.deepEqual(legacyGroupOf("pepworld.tracker.alpha:customer:a.b@x.co.uk.outbox", "pepworld.tracker."), { group: "alpha:customer:a.b@x.co.uk", part: "outbox" });
  assert.deepEqual(legacyGroupOf("pepworld.tracker.0123456789abcdef.doses", "pepworld.tracker."), { group: "0123456789abcdef", part: "doses" });
  assert.equal(legacyGroupOf("other.key", "pepworld.tracker."), null);
});

done();
