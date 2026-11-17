// Unit tests for features/tracker/lib/schedule.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { addDays, daysBetween, weekday } from "../src/features/tracker/lib/ids";
import { biweeklyCycle, describeSchedule, isOnDay, nextOccurrences, occurrences, withScheduleHistory } from "../src/features/tracker/lib/schedule";
import { makeTest, oct, protocol } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker schedule");

const days = (p: ReturnType<typeof protocol>, from: string, to: string) => [...new Set(occurrences(p, from, to).map((o) => o.day))];

test("day keys: weekday and arithmetic", () => {
  assert.equal(weekday("2026-10-12"), 1); // Monday
  assert.equal(weekday("1970-01-01"), 4);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(daysBetween("2026-10-01", "2026-11-01"), 31);
});

test("daily, from the start date, at every time", () => {
  const p = protocol({ startDate: "2026-10-05", times: ["20:00", "08:00"] });
  const occ = occurrences(p, "2026-10-04", "2026-10-06");
  assert.deepEqual(
    occ.map((o) => `${o.day} ${o.time}`),
    ["2026-10-05 08:00", "2026-10-05 20:00", "2026-10-06 08:00", "2026-10-06 20:00"],
  );
});

test("specific days", () => {
  const p = protocol({ schedule: { kind: "weekdays", days: [1, 4] } });
  assert.deepEqual(days(p, "2026-10-11", "2026-10-17"), ["2026-10-12", "2026-10-15"]);
});

test("every 2 and every 3 days count from the start date", () => {
  const two = protocol({ schedule: { kind: "interval", everyDays: 2 }, startDate: "2026-10-01" });
  assert.deepEqual(days(two, "2026-10-01", "2026-10-06"), ["2026-10-01", "2026-10-03", "2026-10-05"]);
  const three = protocol({ schedule: { kind: "interval", everyDays: 3 }, startDate: "2026-10-02" });
  assert.deepEqual(days(three, "2026-10-01", "2026-10-09"), ["2026-10-02", "2026-10-05", "2026-10-08"]);
});

test("5 on / 2 off cycle", () => {
  const p = protocol({ startDate: "2026-10-01", cycle: { onDays: 5, offDays: 2 } });
  assert.deepEqual(days(p, "2026-10-01", "2026-10-09"), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-08", "2026-10-09"]);
});

test("8 weeks on / 4 off", () => {
  const p = protocol({ startDate: "2026-01-01", cycle: { onDays: 56, offDays: 28 } });
  assert.equal(isOnDay(p, addDays("2026-01-01", 55)), true);
  assert.equal(isOnDay(p, addDays("2026-01-01", 56)), false);
  assert.equal(isOnDay(p, addDays("2026-01-01", 83)), false);
  assert.equal(isOnDay(p, addDays("2026-01-01", 84)), true);
});

test("old biweekly = weekdays + 7 on / 7 off from the week it was made", () => {
  const p = protocol({ schedule: { kind: "weekdays", days: [1] }, cycle: biweeklyCycle(), startDate: "2026-10-04" });
  assert.deepEqual(days(p, "2026-10-04", "2026-10-31"), ["2026-10-05", "2026-10-19"]);
});

test("end date and pausing stop doses", () => {
  const ended = protocol({ startDate: "2026-10-01", endDate: "2026-10-03" });
  assert.deepEqual(days(ended, "2026-10-01", "2026-10-05"), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(occurrences(protocol({ status: "paused" }), "2026-10-01", "2026-10-05").length, 0);
  assert.equal(occurrences(protocol({ schedule: { kind: "asNeeded" } }), "2026-10-01", "2026-10-05").length, 0);
});

test("a daylight-saving change keeps the clock time", () => {
  const p = protocol({ startDate: "2026-10-25" });
  for (const o of occurrences(p, "2026-10-30", "2026-11-03")) assert.equal(o.at.getHours(), 8);
  assert.equal(occurrences(p, "2026-10-30", "2026-11-03").length, 5);
});

test("next doses from now", () => {
  const p = protocol({ schedule: { kind: "interval", everyDays: 2 }, startDate: "2026-10-12" });
  const next = nextOccurrences(p, oct(12, 9), 3);
  assert.deepEqual(
    next.map((o) => o.day),
    ["2026-10-14", "2026-10-16", "2026-10-18"],
  );
});

test("readable schedules", () => {
  assert.equal(describeSchedule(protocol({ schedule: { kind: "interval", everyDays: 2 } })), "Every other day · 8:00 AM");
  assert.equal(describeSchedule(protocol({ schedule: { kind: "weekdays", days: [4, 1] }, times: ["21:00", "08:00"] })), "Mon, Thu · 8:00 AM & 9:00 PM");
  assert.equal(describeSchedule(protocol({ cycle: { onDays: 56, offDays: 28 } })), "Daily · 8:00 AM · 8 wk on / 4 off");
  assert.equal(describeSchedule(protocol({ schedule: { kind: "asNeeded" } })), "As needed");
  assert.equal(describeSchedule(protocol({ schedule: { kind: "weekdays", days: [1] }, times: ["20:00"] })), "Every Monday · 8:00 PM");
});

test("pausing keeps the days before the pause", () => {
  const before = protocol({ startDate: "2026-10-01" });
  const paused = withScheduleHistory(before, { ...before, status: "paused" }, "2026-10-10");
  assert.equal(paused.pausedFrom, "2026-10-10");
  assert.equal(isOnDay(paused, "2026-10-09"), true);
  assert.equal(isOnDay(paused, "2026-10-10"), false);
  assert.equal(isOnDay(paused, "2026-10-20"), false);
});

test("resuming leaves the paused days empty and schedules from today", () => {
  const before = protocol({ startDate: "2026-10-01" });
  const paused = withScheduleHistory(before, { ...before, status: "paused" }, "2026-10-10");
  const resumed = withScheduleHistory(paused, { ...paused, status: "active" }, "2026-10-15");
  assert.equal(resumed.pausedFrom, null);
  assert.deepEqual(days(resumed, "2026-10-08", "2026-10-16"), ["2026-10-08", "2026-10-09", "2026-10-15", "2026-10-16"]);
});

test("old paused data without pausedFrom keeps the days before its last change", () => {
  const p = protocol({ startDate: "2026-10-01", status: "paused", updatedAt: new Date(2026, 9, 10, 12).toISOString() });
  assert.equal(isOnDay(p, "2026-10-09"), true);
  assert.equal(isOnDay(p, "2026-10-11"), false);
});

test("a schedule edit applies from today; past days keep the old rule and times", () => {
  const daily = protocol({ startDate: "2026-10-01", times: ["08:00"] });
  const edited = withScheduleHistory(daily, { ...daily, schedule: { kind: "weekdays", days: [1] }, times: ["20:00"] }, "2026-10-12");
  assert.deepEqual(
    occurrences(edited, "2026-10-07", "2026-10-07").map((o) => o.time),
    ["08:00"],
  );
  assert.deepEqual(
    occurrences(edited, "2026-10-13", "2026-10-19").map((o) => `${o.day} ${o.time}`),
    ["2026-10-19 20:00"],
  );
  // Saving again without a schedule change adds nothing.
  assert.equal(withScheduleHistory(edited, { ...edited, name: "Renamed" }, "2026-10-14").history?.length, 1);
});

test("an edit while paused keeps the pause", () => {
  const p = protocol({ startDate: "2026-10-01" });
  const paused = withScheduleHistory(p, { ...p, status: "paused" }, "2026-10-05");
  const edited = withScheduleHistory(paused, { ...paused, schedule: { kind: "interval", everyDays: 2 } }, "2026-10-08");
  assert.equal(edited.pausedFrom, "2026-10-05");
  assert.equal(isOnDay(edited, "2026-10-04"), true);
  assert.equal(isOnDay(edited, "2026-10-06"), false);
  assert.equal(isOnDay(edited, "2026-10-09"), false);
});

test("ending a paused protocol keeps the pause; restarting an ended one leaves the gap empty", () => {
  const p = protocol({ startDate: "2026-10-01" });
  const paused = withScheduleHistory(p, { ...p, status: "paused" }, "2026-10-05");
  const ended = withScheduleHistory(paused, { ...paused, status: "archived", endDate: "2026-10-08" }, "2026-10-08");
  assert.deepEqual(days(ended, "2026-10-01", "2026-10-09"), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  const restarted = withScheduleHistory(ended, { ...ended, status: "active", endDate: null }, "2026-10-12");
  assert.deepEqual(days(restarted, "2026-10-03", "2026-10-13"), ["2026-10-03", "2026-10-04", "2026-10-12", "2026-10-13"]);

  const plain = withScheduleHistory(p, { ...p, status: "archived", endDate: "2026-10-05" }, "2026-10-05");
  const again = withScheduleHistory(plain, { ...plain, status: "active", endDate: null }, "2026-10-09");
  assert.deepEqual(days(again, "2026-10-04", "2026-10-10"), ["2026-10-04", "2026-10-05", "2026-10-09", "2026-10-10"]);
});

done();
