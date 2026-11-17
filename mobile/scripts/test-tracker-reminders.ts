// Unit tests for features/tracker/lib/reminders.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { fromStore, planReminders, type PlanInput } from "../src/features/tracker/lib/reminders";
import { DEFAULT_SETTINGS } from "../src/features/tracker/lib/types";
import { dose, makeTest, oct, protocol, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker reminders");

/** Names on the lock screen are opt-in; most tests below opt in to check the wording. */
const NAMED = { ...DEFAULT_SETTINGS, showNamesInNotifications: true };

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  protocols: [protocol()],
  doses: [],
  skips: [],
  vials: [],
  checkins: [],
  settings: NAMED,
  now: oct(12, 9),
  ...over,
});

test("14 days of exact-date dose reminders, future only", () => {
  const plan = planReminders(base());
  assert.equal(plan.length, 13);
  assert.equal(plan[0].at.getDate(), 13);
  assert.equal(plan[0].title, "BPC-157 · 250 mcg");
  // The tap target the app routes to /tracker/log?protocolId=..&slot=..
  assert.deepEqual(plan[0].data, { type: "tracker", kind: "dose", protocolId: "p1", slot: plan[0].at.toISOString() });
});

test("every other day and cycles are respected", () => {
  const p = protocol({ schedule: { kind: "interval", everyDays: 2 }, startDate: "2026-10-12" });
  assert.deepEqual(
    planReminders(base({ protocols: [p] })).map((r) => r.at.getDate()),
    [14, 16, 18, 20, 22, 24],
  );
});

test("at most 48, soonest first", () => {
  const p = protocol({ times: ["06:00", "12:00", "18:00"] });
  const q = protocol({ id: "p2", times: ["07:00", "13:00"] });
  const plan = planReminders(base({ protocols: [p, q] }));
  assert.equal(plan.length, 48);
  assert.ok(plan.every((r, i) => i === 0 || r.at >= plan[i - 1].at));
});

test("privacy by default: names hidden unless switched on (lock screen)", () => {
  assert.equal(DEFAULT_SETTINGS.showNamesInNotifications, false);
  const doses = Array.from({ length: 18 }, (_, i) => dose(new Date(2026, 8, 20 + i, 8), { vialId: "v1" }));
  const plan = planReminders(base({ settings: { ...DEFAULT_SETTINGS, checkinReminder: true }, vials: [vial()], doses }));
  const byKind = (k: string) => plan.find((r) => r.kind === k);
  assert.equal(byKind("dose")?.title, "Time for your scheduled dose");
  assert.equal(byKind("refill")?.title, "A vial is running low");
  assert.equal(byKind("checkin")?.title, "Daily check-in");
  for (const r of plan) assert.ok(!/BPC|mcg|dose[s]? left/.test(`${r.title} ${r.body}`), `${r.title} / ${r.body}`);
});

test("switches turn kinds off", () => {
  assert.equal(planReminders(base({ settings: { ...NAMED, doseReminders: false } })).length, 0);
  assert.equal(planReminders(base({ protocols: [protocol({ reminders: false })] })).length, 0);
});

test("a dose already taken early is not reminded", () => {
  const plan = planReminders(base({ doses: [dose(oct(13, 7))], now: oct(13, 7, 30) }));
  assert.ok(!plan.some((r) => r.at.getDate() === 13 && r.kind === "dose"));
});

test("refill alert at 9 AM tomorrow for a low vial", () => {
  const doses = Array.from({ length: 18 }, (_, i) => dose(new Date(2026, 8, 20 + i, 8), { vialId: "v1" }));
  const plan = planReminders(base({ vials: [vial()], doses }));
  const refill = plan.find((r) => r.kind === "refill");
  assert.equal(refill?.title, "BPC-157 vial: about 2 doses left.");
  assert.equal(refill?.at.getHours(), 9);
  assert.deepEqual(refill?.data, { type: "tracker", kind: "refill", protocolId: "p1" });
});

test("check-in reminder only when switched on", () => {
  assert.ok(!planReminders(base()).some((r) => r.kind === "checkin"));
  assert.ok(planReminders(base({ settings: { ...NAMED, checkinReminder: true } })).some((r) => r.kind === "checkin"));
});

test("never a syringe-unit or mL figure in a title, even with a mixed vial (App Store 1.4.2)", () => {
  const plan = planReminders(base({ vials: [vial({ amount: 10, waterMl: 2 })] }));
  assert.equal(plan[0].title, "BPC-157 · 250 mcg");
  for (const r of plan) assert.ok(!/\d\s*u\b|units|mL/.test(r.title), r.title);
});

test("the store's name is the title; the reminder's words move to the body", () => {
  const dose = { kind: "dose" as const, at: new Date(0), title: "Time for your scheduled dose", body: "Tap Taken when it's done.", data: {} };
  assert.deepEqual(fromStore(dose, "VR Jonina"), { ...dose, title: "VR Jonina", body: "Time for your scheduled dose. Tap Taken when it's done." });
  const refill = { ...dose, kind: "refill" as const, title: "BPC-157 vial: about 2 doses left.", body: "Open the tracker to start a new vial when you mix one." };
  assert.equal(fromStore(refill, "VR Jonina").body, "BPC-157 vial: about 2 doses left. Open the tracker to start a new vial when you mix one.");
  assert.deepEqual(fromStore(dose, "  "), dose);
  assert.deepEqual(fromStore(dose, null), dose);
});

done();
