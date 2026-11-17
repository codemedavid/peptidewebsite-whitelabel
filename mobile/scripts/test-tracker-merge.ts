// Unit tests for features/tracker/lib/merge.ts (sync LWW, new in PepWorld). Run: npm run test:tracker
import assert from "node:assert/strict";
import { applyPulled, mergeRecords, parseRemote, remoteWins, settingsRecord, toSyncRecord, tombstoneRecord } from "../src/features/tracker/lib/merge";
import { DEFAULT_SETTINGS, EMPTY_DATA } from "../src/features/tracker/lib/types";
import { dose, makeTest, oct, protocol, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker sync merge");

const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-02T00:00:00.000Z";

test("newer updatedAt wins; a tie goes to the tombstone", () => {
  const a = protocol({ updatedAt: T1 });
  assert.equal(remoteWins(a, { ...a, updatedAt: T2 }), true);
  assert.equal(remoteWins({ ...a, updatedAt: T2 }, a), false);
  assert.equal(remoteWins(a, { ...a, deletedAt: T1 }), true);
  assert.equal(remoteWins({ ...a, deletedAt: T1 }, a), false);
});

test("merge: replace when newer, keep pending, add new, ignore unseen tombstones", () => {
  const local = [protocol({ id: "a", name: "Old", updatedAt: T1 }), protocol({ id: "b", name: "Mine", updatedAt: T1 })];
  const remote = [
    protocol({ id: "a", name: "New", updatedAt: T2 }),
    protocol({ id: "b", name: "Theirs", updatedAt: T2 }),
    protocol({ id: "c", name: "Added", updatedAt: T2 }),
    protocol({ id: "d", updatedAt: T2, deletedAt: T2 }),
  ];
  const out = mergeRecords(local, remote, new Set(["b"]));
  assert.deepEqual(
    out.map((p) => `${p.id}:${p.name}`),
    ["a:New", "b:Mine", "c:Added"],
  );
});

test("a newer remote tombstone deletes; an older one doesn't", () => {
  const local = [dose(oct(5), { id: "x", updatedAt: T1 })];
  assert.equal(mergeRecords(local, [{ ...local[0], updatedAt: T2, deletedAt: T2 }], new Set())[0].deletedAt, T2);
  const newer = [dose(oct(5), { id: "y", updatedAt: T2 })];
  assert.equal(mergeRecords(newer, [{ ...newer[0], updatedAt: T1, deletedAt: T1 }], new Set())[0].deletedAt, null);
});

test("envelopes: records, tombstones and settings", () => {
  const p = protocol({ updatedAt: T2 });
  assert.deepEqual(toSyncRecord("protocol", p), { kind: "protocol", id: "p1", data: p, updatedAt: T2, deletedAt: null });
  assert.deepEqual(tombstoneRecord("dose", "d9", T2), { kind: "dose", id: "d9", data: { id: "d9" }, updatedAt: T2, deletedAt: T2 });
  assert.equal(settingsRecord(DEFAULT_SETTINGS).id, "settings");
});

test("parseRemote checks the shape and lets the envelope's id and stamps win", () => {
  const p = protocol({ updatedAt: T1 });
  const parsed = parseRemote({ kind: "protocol", id: "p1", data: { ...p, id: "evil", updatedAt: "x" }, updatedAt: T2, deletedAt: null });
  assert.ok(parsed && parsed.kind === "protocol" && parsed.record.id === "p1" && parsed.record.updatedAt === T2);
  assert.equal(parseRemote({ kind: "protocol", id: "p1", data: { name: 5 }, updatedAt: T2, deletedAt: null }), null);
  assert.equal(parseRemote({ kind: "nope", id: "p1", data: p, updatedAt: T2, deletedAt: null }), null);
  assert.equal(parseRemote({ kind: "dose", id: "p1", data: {}, updatedAt: "bad", deletedAt: null }), null);
  // A tombstone needs only its envelope.
  const tomb = parseRemote({ kind: "vial", id: "v1", data: null, updatedAt: T2, deletedAt: T2 });
  assert.ok(tomb && tomb.kind === "vial" && tomb.record.deletedAt === T2);
});

test("applyPulled merges each kind, settings by time, pending keys by kind:id", () => {
  const data = { ...EMPTY_DATA, vials: [vial({ updatedAt: T1 })], settings: { ...DEFAULT_SETTINGS, updatedAt: T1 } };
  const pulled = [
    { kind: "vial", id: "v1", data: vial({ amount: 10 }), updatedAt: T2, deletedAt: null },
    { kind: "protocol", id: "p1", data: protocol(), updatedAt: T2, deletedAt: null },
    { kind: "settings", id: "settings", data: { ...DEFAULT_SETTINGS, weightUnit: "kg" }, updatedAt: T2, deletedAt: null },
    { kind: "dose", id: "bad", data: { nope: true }, updatedAt: T2, deletedAt: null },
  ];
  const { data: out, skipped } = applyPulled(data, pulled, new Set());
  assert.equal(skipped, 1);
  assert.equal(out.vials[0].amount, 10);
  assert.equal(out.protocols.length, 1);
  assert.equal(out.settings.weightUnit, "kg");
  const kept = applyPulled(data, pulled, new Set(["vial:v1", "settings:settings"])).data;
  assert.equal(kept.vials[0].amount, 5);
  assert.equal(kept.settings.updatedAt, T1);
});

done();
