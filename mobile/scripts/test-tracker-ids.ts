// Unit tests for features/tracker/lib/ids.ts (new in PepWorld). Run: npm run test:tracker
import assert from "node:assert/strict";
import {
  addDays,
  atTime,
  dayKey,
  daysBetween,
  formatTime,
  formatWhen,
  isDayKey,
  isTimeKey,
  newId,
  parseDayKey,
  timeKey,
  timeMinutes,
  weekday,
  weekStart,
} from "../src/features/tracker/lib/ids";
import { makeTest, oct } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker ids");

test("newId makes distinct v4-shaped ids", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id), id);
});

test("day keys: local calendar day, validation and parse", () => {
  assert.equal(dayKey(oct(5, 23, 59)), "2026-10-05");
  assert.equal(dayKey(oct(6, 0, 0)), "2026-10-06");
  assert.ok(isDayKey("2026-10-05"));
  assert.ok(!isDayKey("2026-10-5"));
  assert.ok(!isDayKey(20261005));
  assert.equal(parseDayKey("2026-10-05").getDate(), 5);
  assert.ok(Number.isNaN(parseDayKey("nope").getTime()));
});

test("day arithmetic across months, years and leap days", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-10", "2026-10-01"), -9);
  assert.equal(daysBetween("2026-01-01", "2027-01-01"), 365);
});

test("weeks start on Sunday", () => {
  assert.equal(weekday("2026-10-11"), 0);
  assert.equal(weekStart("2026-10-14"), "2026-10-11");
  assert.equal(weekStart("2026-10-11"), "2026-10-11");
});

test("times: validation, minutes, formatting, local moment", () => {
  assert.ok(isTimeKey("08:05"));
  assert.ok(!isTimeKey("24:00"));
  assert.ok(!isTimeKey("8:05"));
  assert.equal(timeMinutes("13:30"), 810);
  assert.equal(timeMinutes("bad"), null);
  assert.equal(formatTime("00:15"), "12:15 AM");
  assert.equal(formatTime("12:00"), "12:00 PM");
  assert.equal(formatTime("20:05"), "8:05 PM");
  assert.equal(timeKey(oct(5, 7, 9)), "07:09");
  const at = atTime("2026-10-05", "20:30");
  assert.equal(at.getHours(), 20);
  assert.equal(at.getMinutes(), 30);
  assert.equal(dayKey(at), "2026-10-05");
});

test("formatWhen names today and tomorrow, then weekdays, then dates", () => {
  const now = oct(12, 9); // Monday
  assert.equal(formatWhen(oct(12, 20), now), "Today 8:00 PM");
  assert.equal(formatWhen(oct(13, 8), now), "Tomorrow 8:00 AM");
  assert.equal(formatWhen(oct(15, 8), now), "Thu 8:00 AM");
  assert.equal(formatWhen(oct(25, 8), now), "Oct 25 8:00 AM");
});

done();
