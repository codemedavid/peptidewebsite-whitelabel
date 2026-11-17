// Unit tests for features/tracker/lib/consistency.ts (ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { consistency, cyclePosition, dayStates, milestones, weekStrip } from "../src/features/tracker/lib/consistency";
import { dose, makeTest, oct, protocol, skip, vial } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker consistency");

const everyOther = protocol({ schedule: { kind: "interval", everyDays: 2 }, startDate: "2026-10-01" });

test("rest days do not break the run", () => {
  const doses = [1, 3, 5, 7, 9, 11].map((d) => dose(oct(d, 8, 5)));
  const c = consistency([everyOther], doses, [], oct(12, 9));
  assert.equal(c.run, 6);
  assert.equal(c.pct, 100);
});

test("a miss breaks the run and lowers the %", () => {
  const doses = [1, 3, 7, 9, 11].map((d) => dose(oct(d, 8, 5)));
  const c = consistency([everyOther], doses, [], oct(12, 9));
  assert.equal(c.run, 3);
  assert.equal(c.pct, 83);
});

test("a skip is neutral: no break, not in the %", () => {
  const doses = [1, 3, 7, 9, 11].map((d) => dose(oct(d, 8, 5)));
  const c = consistency([everyOther], doses, [skip(oct(5, 8))], oct(12, 9));
  assert.equal(c.run, 5);
  assert.equal(c.pct, 100);
  assert.equal(c.skipped30, 1);
});

test("the % waits for a few doses", () => {
  const p = protocol({ startDate: "2026-10-11" });
  assert.equal(consistency([p], [dose(oct(11, 8))], [], oct(12, 9)).pct, null);
});

test("day states: kept, partial, missed, rest, planned", () => {
  const p = protocol({ times: ["08:00", "20:00"], startDate: "2026-10-05", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5, 6] } });
  const doses = [dose(oct(5, 8)), dose(oct(5, 20)), dose(oct(6, 8))];
  const days = dayStates([p], doses, [], "2026-10-04", "2026-10-13", oct(12, 9));
  const s = Object.fromEntries(days.map((d) => [d.day, d.state]));
  assert.equal(s["2026-10-04"], "rest");
  assert.equal(s["2026-10-05"], "kept");
  assert.equal(s["2026-10-06"], "partial");
  assert.equal(s["2026-10-07"], "missed");
  assert.equal(s["2026-10-11"], "rest");
  assert.equal(s["2026-10-13"], "planned");
});

test("week strip has seven days from Sunday", () => {
  const week = weekStrip([protocol()], [], [], oct(14, 9));
  assert.equal(week.length, 7);
  assert.equal(week[0].day, "2026-10-11");
});

test("cycle position in weeks and days", () => {
  const weeks = protocol({ startDate: "2026-09-10", cycle: { onDays: 56, offDays: 28 } });
  assert.equal(cyclePosition(weeks, oct(12))?.label, "Week 5 of 8 · off from Nov 5");
  const days = protocol({ startDate: "2026-10-10", cycle: { onDays: 5, offDays: 2 } });
  assert.equal(cyclePosition(days, oct(12))?.label, "Day 3 of 5 · off from Oct 15");
  assert.equal(cyclePosition(days, oct(15))?.phase, "off");
});

test("only the rare milestones", () => {
  const p = protocol({ startDate: "2026-09-01" });
  const doses = Array.from({ length: 26 }, (_, i) => dose(new Date(2026, 8, 1 + i, 8, 5)));
  const m = milestones([p], doses, [], [vial({ status: "finished", updatedAt: "2026-09-20T10:00:00.000Z" })], oct(12, 9)).map((x) => x.key);
  assert.ok(m.includes("first-dose"));
  assert.ok(m.includes("full-week"));
  assert.ok(m.includes("doses-25"));
  assert.ok(m.includes("run-10"));
  assert.ok(m.includes("first-vial"));
  assert.ok(!m.includes("doses-50"));
  assert.ok(!m.some((k) => k === "doses-5" || k === "doses-10"));
});

done();
