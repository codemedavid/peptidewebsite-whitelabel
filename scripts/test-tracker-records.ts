/**
 * Peptide Tracker server core (docs/mobile-admin/TRACKER.md §5) — the PURE half:
 * per-kind validation, payload caps, last-write-wins, the sync cursor, the
 * push planner, the strength parser and the order-vial / store-guide mappers.
 *
 *   npm run test:tracker-records
 */

import assert from "node:assert";

import {
  MAX_LIVE_RECORDS,
  MAX_PUSH_RECORDS,
  MAX_SYNC_BODY_BYTES,
  MAX_TOTAL_RECORDS,
  TOMBSTONE_RETENTION_DAYS,
  tombstoneCutoff,
  MAX_RECORD_BYTES,
  decodeCursor,
  encodeCursor,
  mergeDecision,
  parseSyncRequest,
  planPush,
  validatePushRecord,
  type CleanRecord,
  type StoredRecord,
} from "../src/lib/tracker/records";
import { parseStrength } from "../src/lib/tracker/strength";
import { buildOrderVials, type OrderVialSource } from "../src/lib/tracker/order-vials";
import { toStoreGuides } from "../src/lib/tracker/store-guides";
import { trackerGate } from "../src/lib/tracker/gate";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const NOW = new Date("2026-11-16T10:00:00.000Z");
const T1 = "2026-11-16T08:00:00.000Z";
const T2 = "2026-11-16T09:00:00.000Z";

const synced = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: T1,
  updatedAt: T1,
  deletedAt: null,
  ...extra,
});

const PROTOCOL = synced("p1", {
  name: "BPC-157",
  catalogId: null,
  category: "Recovery",
  color: "#7C3AED",
  route: "injection",
  dose: { value: 250, unit: "mcg" },
  mix: { vialAmount: 5, vialUnit: "mg", waterMl: 2 },
  syringe: "u100_1ml",
  schedule: { kind: "daily" },
  cycle: null,
  times: ["08:00"],
  startDate: "2026-11-01",
  endDate: null,
  status: "active",
  reminders: true,
  rotateSites: true,
  checkDose: false,
});

const DOSE = synced("d1", {
  protocolId: "p1",
  name: "BPC-157",
  takenAt: T1,
  scheduledFor: "2026-11-16",
  dose: { value: 250, unit: "mcg" },
  volumeMl: 0.1,
  units: 10,
  route: "injection",
  site: "belly_ll",
  vialId: "v1",
  note: null,
});

const SKIP = synced("s1", { protocolId: "p1", scheduledFor: "2026-11-15", reason: "rest", note: null });

const VIAL = synced("v1", {
  protocolId: "p1",
  amount: 5,
  unit: "mg",
  waterMl: 2,
  mixedOn: "2026-11-01",
  lot: null,
  status: "active",
});

const CHECKIN = synced("c1", {
  date: "2026-11-16",
  energy: 4,
  mood: 3,
  appetite: null,
  sleep: 5,
  effects: ["Nausea"],
  note: "ok",
  weightKg: 70.5,
});

const SETTINGS = {
  weightUnit: "kg",
  defaultSyringe: "u100_1ml",
  doseReminders: true,
  refillReminders: true,
  checkinReminder: false,
  checkinTime: "20:00",
  showNamesInNotifications: true,
  suggestSites: true,
  updatedAt: T1,
};

const rec = (kind: string, id: string, data: unknown, extra: Record<string, unknown> = {}) => ({
  kind,
  id,
  data,
  updatedAt: T1,
  deletedAt: null,
  ...extra,
});

const ok = (raw: unknown) => {
  const r = validatePushRecord(raw, NOW);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.record;
};
const bad = (raw: unknown) => {
  const r = validatePushRecord(raw, NOW);
  if (r.ok) throw new Error("expected a rejection");
  return r;
};

console.log("\nvalidation — every kind accepts its real shape");
check("protocol", () => assert.equal(ok(rec("protocol", "p1", PROTOCOL)).localId, "p1"));
check("dose", () => assert.equal(ok(rec("dose", "d1", DOSE)).kind, "dose"));
check("skip", () => assert.equal(ok(rec("skip", "s1", SKIP)).kind, "skip"));
check("vial", () => assert.equal(ok(rec("vial", "v1", VIAL)).kind, "vial"));
check("checkin", () => assert.equal(ok(rec("checkin", "c1", CHECKIN)).kind, "checkin"));
check("settings (no id inside the data)", () => assert.equal(ok(rec("settings", "settings", SETTINGS)).kind, "settings"));
check("dates come back as Date objects", () => {
  const r = ok(rec("dose", "d1", DOSE, { updatedAt: T2, deletedAt: null }));
  assert.equal(r.updatedAt.toISOString(), T2);
  assert.equal(r.deletedAt, null);
});
check("unknown extra fields pass through untouched (newer app builds)", () => {
  const r = ok(rec("protocol", "p1", { ...PROTOCOL, futureField: { a: 1 }, history: [] }));
  assert.deepEqual((r.data as Record<string, unknown>).futureField, { a: 1 });
});
check("a protocol with weekdays + interval + cycle schedules", () => {
  ok(rec("protocol", "p1", { ...PROTOCOL, schedule: { kind: "weekdays", days: [1, 3, 5] }, cycle: { onDays: 5, offDays: 2 } }));
  ok(rec("protocol", "p1", { ...PROTOCOL, schedule: { kind: "interval", everyDays: 2 } }));
  ok(rec("protocol", "p1", { ...PROTOCOL, schedule: { kind: "asNeeded" }, times: [] }));
});

console.log("\nvalidation — refusals carry kind, id and a reason");
check("unknown kind", () => {
  const r = bad(rec("diary", "x1", {}));
  assert.equal(r.id, "x1");
  assert.match(r.reason, /kind/i);
});
check("missing / bad envelope id", () => {
  bad(rec("dose", "", DOSE));
  bad(rec("dose", "a".repeat(200), DOSE));
  bad(rec("dose", "has space", DOSE));
});
check("data.id must match the envelope id", () => assert.match(bad(rec("dose", "d2", DOSE)).reason, /id/i));
check("updatedAt must be ISO", () => {
  bad(rec("dose", "d1", DOSE, { updatedAt: "yesterday" }));
  bad(rec("dose", "d1", DOSE, { updatedAt: "2026-11-16" }));
  bad(rec("dose", "d1", DOSE, { updatedAt: 1731744000000 }));
});
check("updatedAt more than a day in the future is refused (it would win forever)", () => {
  assert.match(bad(rec("dose", "d1", DOSE, { updatedAt: "2026-11-18T10:00:00.000Z" })).reason, /future|clock/i);
});
check("deletedAt must be ISO or null", () => bad(rec("dose", "d1", DOSE, { deletedAt: "soon" })));
check("dose: required fields + types", () => {
  bad(rec("dose", "d1", { ...DOSE, takenAt: "nope" }));
  bad(rec("dose", "d1", { ...DOSE, dose: { value: -1, unit: "mg" } }));
  bad(rec("dose", "d1", { ...DOSE, dose: { value: 1, unit: "grams" } }));
  bad(rec("dose", "d1", { ...DOSE, name: "" }));
  bad(rec("dose", "d1", { ...DOSE, dose: { value: Number.NaN, unit: "mg" } }));
});
check("protocol: bad time, bad dates, bad schedule", () => {
  bad(rec("protocol", "p1", { ...PROTOCOL, times: ["25:00"] }));
  bad(rec("protocol", "p1", { ...PROTOCOL, startDate: "11/01/2026" }));
  bad(rec("protocol", "p1", { ...PROTOCOL, startDate: "2026-02-31" }));
  bad(rec("protocol", "p1", { ...PROTOCOL, schedule: { kind: "weekdays", days: [9] } }));
  bad(rec("protocol", "p1", { ...PROTOCOL, schedule: { kind: "hourly" } }));
  bad(rec("protocol", "p1", { ...PROTOCOL, status: "deleted" }));
});
check("checkin: scale is 1–5", () => {
  bad(rec("checkin", "c1", { ...CHECKIN, energy: 6 }));
  bad(rec("checkin", "c1", { ...CHECKIN, mood: 0 }));
  bad(rec("checkin", "c1", { ...CHECKIN, date: "2026-13-01" }));
});
check("vial: amount > 0, known unit", () => {
  bad(rec("vial", "v1", { ...VIAL, amount: 0 }));
  bad(rec("vial", "v1", { ...VIAL, unit: "ml" }));
});
check("settings: bad checkin time", () => bad(rec("settings", "settings", { ...SETTINGS, checkinTime: "8pm" })));
check("data must be an object", () => {
  bad(rec("dose", "d1", "a string"));
  bad(rec("dose", "d1", [DOSE]));
});
check(`data over ${MAX_RECORD_BYTES / 1024} KB is refused`, () => {
  const r = bad(rec("dose", "d1", { ...DOSE, note: "x".repeat(MAX_RECORD_BYTES) }));
  assert.match(r.reason, /large/i);
});
check("a non-object record is refused without throwing", () => {
  assert.equal(validatePushRecord(null, NOW).ok, false);
  assert.equal(validatePushRecord("x", NOW).ok, false);
});

console.log("\ntombstones");
check("a tombstone skips the per-kind check (only the envelope + size)", () => {
  const r = ok(rec("dose", "d1", { id: "d1" }, { updatedAt: T2, deletedAt: T2 }));
  assert.equal(r.deletedAt?.toISOString(), T2);
});
check("a tombstone with null data is stored as { id }", () => {
  const r = ok(rec("vial", "v9", null, { deletedAt: T1 }));
  assert.deepEqual(r.data, { id: "v9" });
});
check("a tombstone carrying the full last copy is stored trimmed to { id } (no health data kept for deletes)", () => {
  const r = ok(rec("dose", "d1", DOSE, { updatedAt: T2, deletedAt: T2 }));
  assert.deepEqual(r.data, { id: "d1" });
});

console.log("\nsync request shape");
check("cursor null + empty push is fine", () => {
  const r = parseSyncRequest({ cursor: null, push: [] });
  assert.ok(r.ok);
});
check("missing push reads as []", () => {
  const r = parseSyncRequest({ cursor: null });
  assert.ok(r.ok && r.push.length === 0);
});
check(`more than ${MAX_PUSH_RECORDS} records in one push is a 400`, () => {
  const r = parseSyncRequest({ cursor: null, push: Array.from({ length: MAX_PUSH_RECORDS + 1 }, () => ({})) });
  assert.equal(r.ok, false);
});
check("push must be an array; cursor a string or null", () => {
  assert.equal(parseSyncRequest({ cursor: null, push: {} }).ok, false);
  assert.equal(parseSyncRequest({ cursor: 5, push: [] }).ok, false);
  assert.equal(parseSyncRequest(null).ok, false);
});

console.log("\nmergeDecision — last write wins on updatedAt");
const at = (iso: string, del: string | null = null) => ({ updatedAt: new Date(iso), deletedAt: del ? new Date(del) : null });
check("nothing stored → insert", () => assert.equal(mergeDecision(null, at(T1)), "insert"));
check("newer incoming → update", () => assert.equal(mergeDecision(at(T1), at(T2)), "update"));
check("older incoming → skip", () => assert.equal(mergeDecision(at(T2), at(T1)), "skip"));
check("tie → keep existing", () => assert.equal(mergeDecision(at(T1), at(T1)), "skip"));
check("tie with a tombstone → still keep existing", () => assert.equal(mergeDecision(at(T1), at(T1, T1)), "skip"));
check("a newer tombstone wins over a live row", () => assert.equal(mergeDecision(at(T1), at(T2, T2)), "update"));
check("an older live edit never resurrects a newer tombstone", () => assert.equal(mergeDecision(at(T2, T2), at(T1)), "skip"));
check("a newer live edit after a tombstone revives it", () => assert.equal(mergeDecision(at(T1, T1), at(T2)), "update"));

console.log("\ncursor");
check("round-trips syncedAt + id", () => {
  const c = encodeCursor({ syncedAt: new Date(T2), id: "clx123" });
  assert.equal(typeof c, "string");
  const d = decodeCursor(c);
  assert.ok(d);
  assert.equal(d!.syncedAt.toISOString(), T2);
  assert.equal(d!.id, "clx123");
});
check("is opaque (no raw ISO in it)", () => assert.ok(!encodeCursor({ syncedAt: new Date(T2), id: "x" }).includes("2026")));
check("null / garbage / tampered → null (a full re-pull, never a crash)", () => {
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor("!!!not-base64"), null);
  assert.equal(decodeCursor(Buffer.from('{"t":"nope","i":"x"}').toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("[1,2]").toString("base64url")), null);
  assert.equal(decodeCursor("x".repeat(5000)), null);
});

console.log("\nplanPush — dedupe, LWW, live cap");
const clean = (kind: CleanRecord["kind"], id: string, updated: string, deleted: string | null = null): CleanRecord => ({
  kind,
  localId: id,
  data: { id },
  updatedAt: new Date(updated),
  deletedAt: deleted ? new Date(deleted) : null,
});
const stored = (kind: CleanRecord["kind"], id: string, updated: string, deleted: string | null = null): StoredRecord => ({
  rowId: `row-${kind}-${id}`,
  createdAt: new Date(T1),
  ...clean(kind, id, updated, deleted),
});
const keyed = (rows: StoredRecord[]) => new Map(rows.map((r) => [`${r.kind}:${r.localId}`, r]));

check("new records insert; newer replace; older lose (server copy returned)", () => {
  const plan = planPush(
    [clean("dose", "a", T1), clean("dose", "b", T2), clean("dose", "c", T1)],
    keyed([stored("dose", "b", T1), stored("dose", "c", T2)]),
    2,
    MAX_LIVE_RECORDS,
  );
  assert.deepEqual(plan.inserts.map((r) => r.localId), ["a"]);
  assert.deepEqual(plan.replaces.map((r) => [r.localId, r.rowId]), [["b", "row-dose-b"]]);
  assert.deepEqual(plan.losers.map((r) => r.localId), ["c"]);
  assert.deepEqual(plan.rejected, []);
});
check("a retry (same updatedAt) is a quiet no-op: no write, no echo", () => {
  const plan = planPush([clean("dose", "a", T1)], keyed([stored("dose", "a", T1)]), 1, MAX_LIVE_RECORDS);
  assert.equal(plan.inserts.length + plan.replaces.length + plan.losers.length, 0);
});
check("the same record twice in one push → the newest copy only", () => {
  const plan = planPush([clean("dose", "a", T1), clean("dose", "a", T2)], new Map(), 0, MAX_LIVE_RECORDS);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].updatedAt.toISOString(), T2);
});
check("same id under two kinds are two records", () => {
  const plan = planPush([clean("dose", "a", T1), clean("vial", "a", T1)], new Map(), 0, MAX_LIVE_RECORDS);
  assert.equal(plan.inserts.length, 2);
});
check("live cap: new live records beyond the cap are rejected with a reason", () => {
  const plan = planPush([clean("dose", "a", T1), clean("dose", "b", T1), clean("dose", "c", T1)], new Map(), 9, 10);
  assert.equal(plan.inserts.length, 1);
  assert.deepEqual(plan.rejected.map((r) => r.id), ["b", "c"]);
  assert.match(plan.rejected[0].reason, /limit/i);
});
check("live cap: tombstones and edits always go through, and a delete frees a slot", () => {
  const plan = planPush(
    [clean("dose", "x", T2, T2), clean("dose", "n", T1), clean("dose", "e", T2)],
    keyed([stored("dose", "x", T1), stored("dose", "e", T1)]),
    10,
    10,
  );
  assert.deepEqual(plan.rejected, []);
  assert.deepEqual(plan.inserts.map((r) => r.localId), ["n"]);
  assert.equal(plan.replaces.length, 2);
});
check("live cap: a new TOMBSTONE never counts", () => {
  const plan = planPush([clean("dose", "t", T1, T1)], new Map(), 10, 10);
  assert.equal(plan.inserts.length, 1);
});

check("total cap: rows (live + tombstones) beyond it are refused as storage_full", () => {
  const total = { count: MAX_TOTAL_RECORDS - 1, cap: MAX_TOTAL_RECORDS };
  const plan = planPush([clean("dose", "t1", T1, T1), clean("dose", "t2", T1, T1), clean("dose", "n", T1)], new Map(), 0, MAX_LIVE_RECORDS, total);
  assert.deepEqual(plan.inserts.map((r) => r.localId), ["t1"]);
  assert.deepEqual(plan.rejected.map((r) => [r.id, r.reason]), [["t2", "storage_full"], ["n", "storage_full"]]);
});
check("total cap: edits and deletes of stored rows add no row and always go through", () => {
  const plan = planPush([clean("dose", "x", T2, T2), clean("dose", "e", T2)], keyed([stored("dose", "x", T1), stored("dose", "e", T1)]), 2, MAX_LIVE_RECORDS, {
    count: MAX_TOTAL_RECORDS,
    cap: MAX_TOTAL_RECORDS,
  });
  assert.deepEqual(plan.rejected, []);
  assert.equal(plan.replaces.length, 2);
});
check("storage limits: 25,000 rows, 2 MB request bodies, tombstones kept 90 days", () => {
  assert.equal(MAX_TOTAL_RECORDS, 25_000);
  assert.ok(MAX_TOTAL_RECORDS >= MAX_LIVE_RECORDS);
  assert.equal(MAX_SYNC_BODY_BYTES, 2 * 1024 * 1024);
  assert.equal(TOMBSTONE_RETENTION_DAYS, 90);
  assert.equal(tombstoneCutoff(NOW).toISOString(), "2026-08-18T10:00:00.000Z");
});

console.log("\nstrength parser");
const S = (value: number, unit: "mg" | "mcg" | "iu") => ({ value, unit });
check('"10mg"', () => assert.deepEqual(parseStrength("10mg"), S(10, "mg")));
check('"5 mg"', () => assert.deepEqual(parseStrength("5 mg"), S(5, "mg")));
check('"500mcg"', () => assert.deepEqual(parseStrength("500mcg"), S(500, "mcg")));
check('"10 IU"', () => assert.deepEqual(parseStrength("10 IU"), S(10, "iu")));
check('"BPC-157 10MG" (the 157 is not a strength)', () => assert.deepEqual(parseStrength("BPC-157 10MG"), S(10, "mg")));
check('"2.5mg" and "2,5 mg"', () => {
  assert.deepEqual(parseStrength("2.5mg"), S(2.5, "mg"));
  assert.deepEqual(parseStrength("2,5 mg"), S(2.5, "mg"));
});
check('"1,000mcg" (thousands separator)', () => assert.deepEqual(parseStrength("1,000mcg"), S(1000, "mcg")));
check('"250 µg" / "250ug" → mcg', () => {
  assert.deepEqual(parseStrength("250 µg"), S(250, "mcg"));
  assert.deepEqual(parseStrength("250ug"), S(250, "mcg"));
});
check('"Tirzepatide 30mg x 10 vials"', () => assert.deepEqual(parseStrength("Tirzepatide 30mg x 10 vials"), S(30, "mg")));
check("first text that states one wins (variation before name)", () =>
  assert.deepEqual(parseStrength("5mg", "Retatrutide 10mg"), S(5, "mg")));
check("falls through null / empty to the name", () => assert.deepEqual(parseStrength(null, "", "GHK-Cu 50mg"), S(50, "mg")));
check("no strength → null", () => {
  assert.equal(parseStrength("Bacteriostatic water"), null);
  assert.equal(parseStrength("Kit", null, undefined), null);
  assert.equal(parseStrength("10mgs of fun"), null);
  assert.equal(parseStrength("0mg"), null);
  assert.equal(parseStrength("10 ml"), null);
});

console.log("\norder vials");
const ORDERS: OrderVialSource[] = [
  {
    id: "o2",
    orderNumber: "A-1002",
    status: "delivered",
    statusHistory: [
      { status: "new", at: "2026-11-01T00:00:00.000Z" },
      { status: "delivered", at: "2026-11-05T00:00:00.000Z" },
    ],
    items: [
      { productId: "bpc", name: "BPC-157 (10mg)", qty: 2, price: 1, variation: "10mg" },
      { productId: "water", name: "Bac water", qty: 1, price: 1 },
      { productId: "gone", name: "Ligwak'd", qty: 2, price: 1, cancelledQty: 2 },
    ],
  },
  {
    id: "o1",
    orderNumber: "A-1001",
    status: "shipped",
    statusHistory: [],
    items: [{ name: "Legacy line 5mg", qty: 1, price: 1 }],
  },
];
const IMAGES = new Map([
  ["bpc", { image: "https://ik.imagekit.io/pep/bpc.jpg", variations: [{ name: "10mg", image: "https://ik.imagekit.io/pep/bpc-10.jpg" }] }],
  ["water", { image: "https://example.com/water.jpg", variations: [] }],
]);
check("one row per line, key = orderId:lineIndex, strength parsed", () => {
  const rows = buildOrderVials(ORDERS, IMAGES);
  assert.deepEqual(rows.map((r) => r.key), ["o2:0", "o2:1", "o1:0"]);
  assert.deepEqual(rows[0].strength, S(10, "mg"));
  assert.equal(rows[0].variation, "10mg");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].deliveredAt, "2026-11-05T00:00:00.000Z");
  assert.equal(rows[1].strength, null);
  assert.equal(rows[2].deliveredAt, null);
  assert.equal(rows[2].productId, "");
  assert.deepEqual(rows[2].strength, S(5, "mg"));
});
check("a fully cancelled line is left out (nothing arrived)", () =>
  assert.ok(!buildOrderVials(ORDERS, IMAGES).some((r) => r.key === "o2:2")));
check("images go through imageUrl(): ImageKit sized, variation photo first, others untouched", () => {
  const rows = buildOrderVials(ORDERS, IMAGES);
  assert.match(rows[0].imageUrl ?? "", /^https:\/\/ik\.imagekit\.io\/pep\/bpc-10\.jpg\?tr=/);
  assert.equal(rows[1].imageUrl, "https://example.com/water.jpg");
  assert.equal(rows[2].imageUrl, null);
});
check("capped at 100 rows", () => {
  const many: OrderVialSource[] = Array.from({ length: 60 }, (_, i) => ({
    id: `o${i}`,
    orderNumber: `N${i}`,
    status: "delivered",
    statusHistory: [],
    items: [
      { productId: "p", name: "X 5mg", qty: 1, price: 1 },
      { productId: "p", name: "Y 5mg", qty: 1, price: 1 },
    ],
  }));
  assert.equal(buildOrderVials(many, new Map()).length, 100);
});

console.log("\nstore guides");
check("details-mode protocols with a name; image-mode and nameless left out", () => {
  const guides = toStoreGuides({
    protocols: [
      { name: "BPC-157", category: "Recovery", dosage: "250mcg", frequency: "Daily", duration: "4 weeks", storage: "Fridge", notes: ["a", 3, "b"] },
      { name: "Chart", mode: "image", images: ["x"] },
      { name: "  ", category: "x" },
      { name: "Legacy", mode: "details" },
      "junk",
    ],
  });
  assert.deepEqual(guides.map((g) => g.name), ["BPC-157", "Legacy"]);
  assert.deepEqual(guides[0].notes, ["a", "b"]);
  assert.equal(guides[1].dosage, "");
  assert.deepEqual(guides[1].notes, []);
});
check("no config / no protocols → []", () => {
  assert.deepEqual(toStoreGuides(null), []);
  assert.deepEqual(toStoreGuides({ protocols: "nope" }), []);
});

console.log("\ngate");
const access = (enabled: boolean, guideImport = false) => ({ enabled, guideImport });
check("signed-in account + enabled → through (customers, owner and staff each use their own)", () => assert.equal(trackerGate(access(true)), null));
check("flag off → 404 not_found", () => assert.equal(trackerGate(access(false))?.code, "not_found"));
check("store guides need guide import too", () => {
  assert.equal(trackerGate(access(true, false), { guideImport: true })?.code, "not_found");
  assert.equal(trackerGate(access(true, true), { guideImport: true }), null);
});
check("app guest → 403 (needs a real account; data would have no owner)", () => {
  assert.equal(trackerGate(access(true), { guest: true })?.code, "forbidden");
  assert.equal(trackerGate(access(true), { guest: false }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
