/**
 * Pure gate for the sales-analytics period engine (src/lib/analytics/sales-period.ts),
 * shared by the website's Sales Analytics and the app's Insights tab.
 *
 *   npm run test:sales-period
 */
import assert from "node:assert";

import {
  buildPeriodSeries,
  dayKey,
  formatDayRange,
  parseDayKey,
  periodBuckets,
  pctChange,
  resolvePeriod,
} from "../src/lib/analytics/sales-period";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split("\n").slice(0, 3).join("\n    ")}`);
  }
}

// Sun 2026-11-15 12:00 Manila (UTC+8)
const NOW = Date.parse("2026-11-15T04:00:00.000Z");
const at = (iso: string) => Date.parse(iso);
const DAY = 86400000;

console.log("\nresolvePeriod");
test("this month = Nov 1 → today, compared so-far with Oct 1 → Oct 15 noon", () => {
  const p = resolvePeriod({ preset: "this_month" }, NOW);
  assert.equal(p.from, "2026-11-01");
  assert.equal(p.to, "2026-11-15");
  assert.equal(p.label, "Nov 1 – 15, 2026");
  assert.equal(p.granularity, "day");
  assert.equal(dayKey(p.prev!.start), "2026-10-01");
  assert.equal(p.prev!.end, at("2026-10-15T04:00:00.000Z"));
  assert.equal(dayKey(p.prev!.chartEnd - 1), "2026-10-15");
  assert.equal(p.compareLabel, "vs Oct 1 – 15, 2026");
  assert.ok(p.toDate);
});
test("last month compares with the whole month before", () => {
  const p = resolvePeriod({ preset: "last_month" }, NOW);
  assert.equal(p.from, "2026-10-01");
  assert.equal(p.to, "2026-10-31");
  assert.equal(dayKey(p.prev!.start), "2026-09-01");
  assert.equal(dayKey(p.prev!.end - 1), "2026-09-30");
  assert.equal(p.toDate, false);
});
test("7d keeps the old app window (6 full days + today vs the 7 before)", () => {
  const p = resolvePeriod({ preset: "7d" }, NOW);
  assert.equal(p.from, "2026-11-09");
  assert.equal(p.prev!.start, p.start - 7 * DAY);
  assert.equal(p.prev!.chartEnd, p.start);
});
test("today compares with yesterday up to the same time", () => {
  const p = resolvePeriod({ preset: "today" }, NOW);
  assert.equal(p.granularity, "hour");
  assert.equal(p.prev!.end, NOW - DAY);
  assert.equal(p.compareLabel, "vs yesterday, same time");
});
test("same period last year shifts the dates back one year", () => {
  const p = resolvePeriod({ preset: "this_month", compare: "year" }, NOW);
  assert.equal(dayKey(p.prev!.start), "2025-11-01");
});
test("custom range: swaps reversed dates, clamps the future to today", () => {
  const p = resolvePeriod({ preset: "custom", from: "2026-12-31", to: "2026-11-03" }, NOW);
  assert.equal(p.from, "2026-11-03");
  assert.equal(p.to, "2026-11-15");
  assert.equal(p.days, 13);
  assert.equal(p.prev!.chartEnd, p.start);
});
test("custom range with garbage falls back to 30 days", () => {
  const p = resolvePeriod({ preset: "custom", from: "nope", to: "2026-02-30" }, NOW);
  assert.equal(p.preset, "30d");
});
test("granularity: honoured when it fits, auto otherwise", () => {
  assert.equal(resolvePeriod({ preset: "90d", granularity: "month" }, NOW).granularity, "month");
  assert.equal(resolvePeriod({ preset: "7d", granularity: "month" }, NOW).granularity, "day");
  assert.deepEqual(resolvePeriod({ preset: "7d" }, NOW).granularities, ["day"]);
  assert.equal(resolvePeriod({ preset: "12m" }, NOW).granularity, "month");
});
test("all time starts at the first order and never compares", () => {
  const p = resolvePeriod({ preset: "all", compare: "previous" }, NOW, at("2025-03-04T10:00:00Z"));
  assert.equal(p.from, "2025-03-04");
  assert.equal(p.prev, null);
});

console.log("\nbuckets + series");
test("weeks are Monday-aligned and clipped to the window", () => {
  const p = resolvePeriod({ preset: "this_month", granularity: "week" }, NOW);
  const b = periodBuckets(p.start, p.end, "week");
  assert.equal(b.length, 3); // Sun Nov 1 | Nov 2–8 | Nov 9–15
  assert.equal(b[0].longLabel, "Sun, Nov 1, 2026");
  assert.equal(b[1].longLabel, "Nov 2 – 8, 2026");
});
test("months clip to the window and label the year when it spans two", () => {
  const p = resolvePeriod({ preset: "12m" }, NOW);
  const b = periodBuckets(p.start, p.end, "month");
  assert.equal(b.length, 12);
  assert.equal(b[0].label, "Dec ’25");
  assert.equal(b[11].longLabel, "November 2026");
});
test("series pairs each day with its twin and the day before", () => {
  const p = resolvePeriod({ preset: "this_month" }, NOW);
  const s = buildPeriodSeries(p, [
    { t: at("2026-10-31T04:00:00Z"), revenue: 100 }, // lead day (Oct 31)
    { t: at("2026-11-01T04:00:00Z"), revenue: 150 }, // Nov 1
    { t: at("2026-10-01T04:00:00Z"), revenue: 300 }, // Oct 1 = Nov 1's twin
  ]);
  assert.equal(s.points.length, 15);
  assert.equal(s.points[0].revenue, 150);
  assert.equal(s.points[0].change, 50); // vs Oct 31
  assert.equal(s.points[0].prevRevenue, 300);
  assert.equal(s.points[0].compareChange, -50);
  assert.equal(s.points[1].change, -100); // Nov 2 (0) vs Nov 1 (150)
  assert.equal(s.points[2].change, null); // Nov 3 vs an empty Nov 2
  assert.equal(s.best, 0);
});
test("no baseline = null; nothing sold = no best bucket", () => {
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(150, 100), 50);
  const p = resolvePeriod({ preset: "7d", compare: "none" }, NOW);
  const s = buildPeriodSeries(p, []);
  assert.equal(s.best, null);
  assert.equal(s.points[0].prevRevenue, null);
});

console.log("\nlabels + parsing");
test("parseDayKey rejects impossible dates", () => {
  assert.equal(parseDayKey("2026-02-30"), null);
  assert.equal(parseDayKey("26-1-1"), null);
  assert.equal(dayKey(parseDayKey("2026-02-28")!), "2026-02-28");
});
test("formatDayRange across years", () => {
  assert.equal(formatDayRange(parseDayKey("2025-12-01")!, parseDayKey("2026-01-02")!), "Dec 1, 2025 – Jan 1, 2026");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
