// Unit tests for features/tracker/lib/today.ts (matching + the Today plan; ported from MamaMicaGlow). Run: npm run test:tracker
import assert from "node:assert/strict";
import { buildToday, matchSlots, relativeLabel } from "../src/features/tracker/lib/today";
import { dose, makeTest, oct, protocol, skip } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker today");

test("no protocols and no logs → empty", () => {
  assert.equal(buildToday([], [], [], oct(12, 9)).mode, "empty");
});

test("upcoming, then due 30 min before, then late but still open", () => {
  const p = protocol();
  assert.equal(buildToday([p], [], [], oct(12, 6)).mode, "upcoming");
  assert.equal(relativeLabel(buildToday([p], [], [], oct(12, 6))), "in 2 h");
  assert.equal(buildToday([p], [], [], oct(12, 7, 35)).mode, "due");
  const late = buildToday([p], [], [], oct(12, 8, 45));
  assert.equal(late.mode, "due");
  assert.equal(relativeLabel(late), "45 min late");
});

test("rest day on an every-other-day protocol, with the next dose", () => {
  const p = protocol({ schedule: { kind: "interval", everyDays: 2 }, startDate: "2026-10-11" });
  const plan = buildToday([p], [], [], oct(12, 9));
  assert.equal(plan.mode, "rest");
  assert.equal(plan.after?.at.getDate(), 13);
});

test("done once every dose today is taken or skipped", () => {
  const p = protocol({ times: ["08:00", "20:00"] });
  const plan = buildToday([p], [dose(oct(12, 8, 10))], [skip(oct(12, 20))], oct(12, 21));
  assert.equal(plan.mode, "done");
  assert.equal(plan.taken, 1);
  assert.equal(plan.total, 1);
});

test("doses at the same time group together; next holds both", () => {
  const a = protocol({ id: "a", name: "A" });
  const b = protocol({ id: "b", name: "B" });
  const c = protocol({ id: "c", name: "C", times: ["21:00"] });
  const plan = buildToday([a, b, c], [], [], oct(12, 7));
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.groups[0].label, "MORNING");
  assert.deepEqual(
    plan.next.map((s) => s.protocolId),
    ["a", "b"],
  );
});

test("a late dose still counts; taken early counts too", () => {
  const p = protocol();
  const late = matchSlots([p], [dose(oct(12, 14))], [], "2026-10-12", "2026-10-12", oct(12, 15));
  assert.equal(late.slots[0].state, "taken");
  assert.equal(late.slots[0].timing, "late");
  const early = matchSlots([p], [dose(oct(12, 2))], [], "2026-10-12", "2026-10-12", oct(12, 3));
  assert.equal(early.slots[0].state, "taken");
  assert.equal(early.slots[0].timing, "early");
});

test("a slot is missed only after its window closes (next dose / end of next day)", () => {
  const p = protocol();
  assert.equal(matchSlots([p], [], [], "2026-10-11", "2026-10-11", oct(12, 7)).slots[0].state, "open");
  assert.equal(matchSlots([p], [], [], "2026-10-11", "2026-10-11", oct(12, 8)).slots[0].state, "missed");
});

test("a skip is matched to its dose and is neutral", () => {
  const p = protocol();
  const r = matchSlots([p], [], [skip(oct(12, 8))], "2026-10-12", "2026-10-12", oct(13, 12));
  assert.equal(r.slots[0].state, "skipped");
});

test("one-off and unmatched logs come back as extras", () => {
  const p = protocol({ schedule: { kind: "asNeeded" } });
  const plan = buildToday([p], [dose(oct(12, 10)), dose(oct(12, 11), { protocolId: null, name: "Vitamin" })], [], oct(12, 12));
  assert.equal(plan.extras.length, 2);
  assert.equal(plan.mode, "rest");
});

test("scheduledFor pins a dose to its slot even when back-dated far away", () => {
  const p = protocol();
  const d = dose(oct(14, 9), { scheduledFor: oct(12, 8).toISOString() });
  const r = matchSlots([p], [d], [], "2026-10-12", "2026-10-12", oct(14, 10));
  assert.equal(r.slots[0].state, "taken");
});

done();
