// Sales-analytics period engine — ONE set of date rules for the website's
// Sales Analytics (storefront/admin/AdminAnalytics.tsx, client-side) and the
// app's Insights tab (lib/mobile/insights.ts, server-side), so the two never
// disagree about what "this month" or "vs last week" means.
//
// Everything runs on the store's calendar (Asia/Manila, fixed UTC+8, no DST):
//   - a window is [start, end) in UTC ms, end exclusive, aligned to store days
//   - presets resolve to a window; "custom" takes inclusive YYYY-MM-DD dates
//   - the comparison window is the previous equal period, or the same dates
//     last year; a calendar period still running (today, this month…) compares
//     "so far" (same elapsed time), so a half-finished month is never measured
//     against a full one
//   - buckets are calendar hours / days / Monday-start weeks / months, clipped
//     to the window; each bucket also knows its comparison twin and the bucket
//     right before it (day-over-day, week-over-week, month-over-month)
//
// Pure and dependency-free: safe in the browser and on the server
// (npm run test:sales-period).

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const STORE_UTC_OFFSET_MS = 8 * HOUR_MS;

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "this_week",
  "this_month",
  "last_month",
  "90d",
  "this_year",
  "12m",
  "all",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const GRANULARITIES = ["hour", "day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const COMPARE_MODES = ["previous", "year", "none"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  "90d": "Last 90 days",
  this_year: "This year",
  "12m": "Last 12 months",
  all: "All time",
  custom: "Custom range",
};

export const GRANULARITY_LABELS: Record<Granularity, { adverb: string; unit: string }> = {
  hour: { adverb: "Hourly", unit: "hour" },
  day: { adverb: "Daily", unit: "day" },
  week: { adverb: "Weekly", unit: "week" },
  month: { adverb: "Monthly", unit: "month" },
};

export const COMPARE_LABELS: Record<CompareMode, string> = {
  previous: "Previous period",
  year: "Same period last year",
  none: "No comparison",
};

/** Longest custom range we accept (≈3 years); older history uses "All time". */
export const MAX_CUSTOM_DAYS = 1100;
/** Chart/table caps so one ancient order can't render hundreds of slivers. */
const MAX_BUCKETS: Record<Granularity, number> = { hour: 24, day: 186, week: 110, month: 60 };

const ROLLING_DAYS: Partial<Record<PeriodPreset, number>> = { "7d": 7, "30d": 30, "90d": 90 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── store-calendar primitives ────────────────────────────────────────────────

type Parts = { y: number; m: number; d: number; wd: number; h: number };

/** Calendar parts of a UTC instant, read on the store's clock. */
export function storeParts(ms: number): Parts {
  const d = new Date(ms + STORE_UTC_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Store midnight of a calendar date (month/day may overflow, like Date.UTC). */
function midnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d) - STORE_UTC_OFFSET_MS;
}

/** Store midnight of the day containing `ms`. */
export function dayStart(ms: number): number {
  const p = storeParts(ms);
  return midnight(p.y, p.m, p.d);
}

function weekStart(ms: number): number {
  const p = storeParts(ms);
  const back = (p.wd + 6) % 7; // Monday = 0
  return midnight(p.y, p.m, p.d - back);
}

function monthStart(ms: number): number {
  const p = storeParts(ms);
  return midnight(p.y, p.m, 1);
}

/** Shift a store instant by whole calendar units, clamping the day (Mar 31 − 1 mo → Feb 28). */
function shiftCalendar(ms: number, by: { years?: number; months?: number; days?: number }): number {
  const p = storeParts(ms);
  const offset = ms - midnight(p.y, p.m, p.d); // keeps a time-of-day, if any
  const totalMonths = p.y * 12 + p.m + (by.years ?? 0) * 12 + (by.months ?? 0);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths - y * 12;
  const d = Math.min(p.d, daysInMonth(y, m)) + (by.days ?? 0);
  return midnight(y, m, d) + offset;
}

/** YYYY-MM-DD of the store day containing `ms`. */
export function dayKey(ms: number): string {
  const p = storeParts(ms);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Strict YYYY-MM-DD → store midnight, or null for anything malformed or impossible (2026-02-30). */
export function parseDayKey(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return null;
  return midnight(y, m, d);
}

// ── labels ───────────────────────────────────────────────────────────────────

function shortDay(p: Parts): string {
  return `${MONTHS[p.m]} ${p.d}`;
}

/** "Sat, Nov 15, 2026" · "Nov 1 – 15, 2026" · "Oct 3 – Nov 15, 2026" · "Dec 1, 2025 – Nov 15, 2026". */
export function formatDayRange(startMs: number, endExclusiveMs: number): string {
  const a = storeParts(startMs);
  const b = storeParts(Math.max(startMs, dayStart(endExclusiveMs - 1)));
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${WEEKDAYS[a.wd]}, ${shortDay(a)}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.d} – ${b.d}, ${a.y}`;
  if (a.y === b.y) return `${shortDay(a)} – ${shortDay(b)}, ${a.y}`;
  return `${shortDay(a)}, ${a.y} – ${shortDay(b)}, ${b.y}`;
}

function hourLabel(h: number, long: boolean): string {
  const suffix = h < 12 ? (long ? " AM" : "a") : long ? " PM" : "p";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

// ── validation ───────────────────────────────────────────────────────────────

export function parsePreset(value: unknown, fallback: PeriodPreset = "30d"): PeriodPreset {
  return PERIOD_PRESETS.includes(value as PeriodPreset) ? (value as PeriodPreset) : fallback;
}

export function parseGranularity(value: unknown): Granularity | null {
  return GRANULARITIES.includes(value as Granularity) ? (value as Granularity) : null;
}

export function parseCompare(value: unknown): CompareMode {
  return COMPARE_MODES.includes(value as CompareMode) ? (value as CompareMode) : "previous";
}

// ── period resolution ────────────────────────────────────────────────────────

export type PeriodQuery = {
  preset: PeriodPreset;
  /** Inclusive store dates, custom only. */
  from?: string | null;
  to?: string | null;
  granularity?: Granularity | null;
  compare?: CompareMode | null;
};

export type ComparePeriod = {
  /** KPI window (so-far when the current window includes today). */
  start: number;
  end: number;
  /** Chart window — the full twin of the current window, so the overlay isn't cut off mid-day. */
  chartEnd: number;
  label: string;
  /** Measured to the same elapsed time as the running current period. */
  soFar: boolean;
};

export type ResolvedPeriod = {
  preset: PeriodPreset;
  start: number;
  end: number;
  /** Inclusive store dates of the window. */
  from: string;
  to: string;
  title: string;
  label: string;
  days: number;
  granularity: Granularity;
  granularities: Granularity[];
  compare: CompareMode;
  prev: ComparePeriod | null;
  /** "vs yesterday, same time" · "vs Oct 1 – 15, 2026" · "" */
  compareLabel: string;
  /** The window runs into the future (today/this month…): figures are "so far". */
  toDate: boolean;
};

/** Which bucket sizes make sense for a window of `days` days. */
export function allowedGranularities(days: number): Granularity[] {
  const out: Granularity[] = [];
  if (days <= 1) out.push("hour");
  if (days >= 2 && days <= MAX_BUCKETS.day) out.push("day");
  if (days >= 8 && days <= MAX_BUCKETS.week * 7) out.push("week");
  if (days >= 28) out.push("month");
  return out;
}

function autoGranularity(days: number): Granularity {
  if (days <= 1) return "hour";
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

type Window = { start: number; end: number; preset: PeriodPreset };

function presetWindow(preset: PeriodPreset, now: number, earliest: number | null): Window {
  const today = dayStart(now);
  const tomorrow = today + DAY_MS;
  const rolling = ROLLING_DAYS[preset];
  if (rolling) return { preset, start: tomorrow - rolling * DAY_MS, end: tomorrow };
  switch (preset) {
    case "today":
      return { preset, start: today, end: tomorrow };
    case "yesterday":
      return { preset, start: today - DAY_MS, end: today };
    case "this_week":
      return { preset, start: weekStart(now), end: tomorrow };
    case "this_month":
      return { preset, start: monthStart(now), end: tomorrow };
    case "last_month": {
      const end = monthStart(now);
      return { preset, start: shiftCalendar(end, { months: -1 }), end };
    }
    case "this_year": {
      const p = storeParts(now);
      return { preset, start: midnight(p.y, 0, 1), end: tomorrow };
    }
    case "12m":
      return { preset, start: shiftCalendar(monthStart(now), { months: -11 }), end: tomorrow };
    case "all":
      return { preset, start: earliest !== null ? Math.min(dayStart(earliest), today) : today, end: tomorrow };
    default:
      return { preset: "30d", start: tomorrow - 30 * DAY_MS, end: tomorrow };
  }
}

function customWindow(from: unknown, to: unknown, now: number): Window | null {
  let a = parseDayKey(from);
  let b = parseDayKey(to);
  if (a === null || b === null) return null;
  if (a > b) [a, b] = [b, a];
  const today = dayStart(now);
  b = Math.min(b, today);
  a = Math.min(a, b);
  a = Math.max(a, b - (MAX_CUSTOM_DAYS - 1) * DAY_MS);
  return { preset: "custom", start: a, end: b + DAY_MS };
}

/** The calendar unit a preset steps by when compared with "the previous period". */
function calendarStep(preset: PeriodPreset): { years?: number; months?: number; days?: number } | null {
  switch (preset) {
    case "today":
    case "yesterday":
      return { days: -1 };
    case "this_week":
      return { days: -7 };
    case "this_month":
    case "last_month":
      return { months: -1 };
    case "this_year":
    case "12m":
      return { years: -1 };
    default:
      return null; // rolling + custom: the equal-length window right before
  }
}

function comparePeriod(w: Window, mode: CompareMode, now: number): ComparePeriod | null {
  if (mode === "none" || w.preset === "all") return null;
  const step = mode === "year" ? { years: -1 } : calendarStep(w.preset);
  const length = w.end - w.start;
  const start = step ? shiftCalendar(w.start, step) : w.start - length;
  const chartEnd = step ? shiftCalendar(w.end, step) : w.start;
  // Calendar periods still running (today, this week/month/year) compare the
  // same elapsed time ("so far"); rolling windows compare the full window
  // before — the long-standing web + app behaviour.
  const soFar = w.end > now && calendarStep(w.preset) !== null;
  const end = soFar ? Math.min(chartEnd, start + (now - w.start)) : chartEnd;
  return { start, end, chartEnd, label: formatDayRange(start, chartEnd), soFar };
}

function compareCopy(w: Window, mode: CompareMode, prev: ComparePeriod | null): string {
  if (!prev) return "";
  if (w.preset === "today") return mode === "year" ? "vs this day last year, same time" : "vs yesterday, same time";
  if (w.preset === "yesterday" && mode === "previous") return "vs the day before";
  return `vs ${prev.label}`;
}

/**
 * Resolve a period query (preset or custom dates) to concrete windows.
 * `earliest` = the store's first order time, used by "All time".
 */
export function resolvePeriod(query: PeriodQuery, now: Date | number, earliest: number | null = null): ResolvedPeriod {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const preset = parsePreset(query.preset);
  const w =
    (preset === "custom" ? customWindow(query.from, query.to, nowMs) : null) ??
    presetWindow(preset === "custom" ? "30d" : preset, nowMs, earliest);

  const days = Math.max(1, Math.round((w.end - w.start) / DAY_MS));
  const granularities = allowedGranularities(days);
  const asked = parseGranularity(query.granularity);
  const granularity = asked && granularities.includes(asked) ? asked : autoGranularity(days);
  const compare = w.preset === "all" ? "none" : parseCompare(query.compare);
  const prev = comparePeriod(w, compare, nowMs);

  return {
    preset: w.preset,
    start: w.start,
    end: w.end,
    from: dayKey(w.start),
    to: dayKey(w.end - 1),
    title: PRESET_LABELS[w.preset],
    label: formatDayRange(w.start, w.end),
    days,
    granularity,
    granularities,
    compare,
    prev,
    compareLabel: compareCopy(w, compare, prev),
    toDate: w.end > nowMs,
  };
}

// ── buckets ──────────────────────────────────────────────────────────────────

export type PeriodBucket = { key: string; start: number; end: number; label: string; longLabel: string };

function nextBoundary(ms: number, g: Granularity): number {
  if (g === "hour") return ms + HOUR_MS;
  if (g === "day") return dayStart(ms) + DAY_MS;
  if (g === "week") return weekStart(ms) + 7 * DAY_MS;
  return shiftCalendar(monthStart(ms), { months: 1 });
}

function bucketLabels(start: number, end: number, g: Granularity, spansYears: boolean, shortDays: boolean) {
  const p = storeParts(start);
  if (g === "hour") {
    return { label: hourLabel(p.h, false), longLabel: `${hourLabel(p.h, true)} – ${hourLabel((p.h + 1) % 24, true)}` };
  }
  if (g === "day") {
    return { label: shortDays ? WEEKDAYS[p.wd] : shortDay(p), longLabel: `${WEEKDAYS[p.wd]}, ${shortDay(p)}, ${p.y}` };
  }
  if (g === "week") {
    return { label: shortDay(p), longLabel: formatDayRange(start, end) };
  }
  const yy = String(p.y).slice(2);
  return { label: spansYears ? `${MONTHS[p.m]} ’${yy}` : MONTHS[p.m], longLabel: `${MONTHS_LONG[p.m]} ${p.y}` };
}

/** Calendar-aligned buckets covering [start, end), first/last clipped to the window. */
export function periodBuckets(start: number, end: number, g: Granularity): PeriodBucket[] {
  const out: PeriodBucket[] = [];
  const spansYears = storeParts(start).y !== storeParts(end - 1).y;
  const shortDays = end - start <= 7 * DAY_MS;
  for (let s = start; s < end && out.length < 2000; ) {
    const e = Math.min(nextBoundary(s, g), end);
    out.push({ key: `${g}:${s}`, start: s, end: e, ...bucketLabels(s, e, g, spansYears, shortDays) });
    s = e;
  }
  return out;
}

/** The whole calendar bucket immediately before `start` (yesterday, last week, last month). */
function leadBucket(start: number, g: Granularity): { start: number; end: number } {
  if (g === "hour") return { start: start - HOUR_MS, end: start };
  if (g === "day") return { start: start - DAY_MS, end: start };
  if (g === "week") return { start: weekStart(start - 1), end: start };
  return { start: monthStart(start - 1), end: start };
}

// ── series ───────────────────────────────────────────────────────────────────

/** One non-cancelled sale at an instant (already clamped — see clampToNow). */
export type SaleEvent = { t: number; revenue: number };

export type SeriesPoint = PeriodBucket & {
  revenue: number;
  orders: number;
  /** Same-position bucket of the comparison window (null when comparison is off or it has no twin). */
  prevRevenue: number | null;
  prevOrders: number | null;
  prevLongLabel: string | null;
  /** % vs the bucket right before this one (DoD / WoW / MoM); null without a baseline. */
  change: number | null;
  /** % vs the comparison twin; null without a baseline. */
  compareChange: number | null;
};

export type PeriodSeries = {
  points: SeriesPoint[];
  /** Older buckets were dropped to stay under the cap (long "All time"). */
  capped: boolean;
  /** Index of the best bucket by revenue, or null when nothing sold. */
  best: number | null;
};

/** % change rounded to one decimal; null when there is no baseline to compare with. */
export function pctChange(curr: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || !(prev > 0)) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/** A placed time in the future (client clock skew) counts as "now" instead of vanishing. */
export function clampToNow(t: number, now: number): number {
  return t > now ? now : t;
}

function indexOfBucket(buckets: ReadonlyArray<{ start: number; end: number }>, t: number): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < buckets[mid].start) hi = mid - 1;
    else if (t >= buckets[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function tally(buckets: ReadonlyArray<{ start: number; end: number }>, events: ReadonlyArray<SaleEvent>) {
  const revenue = buckets.map(() => 0);
  const orders = buckets.map(() => 0);
  for (const e of events) {
    const i = indexOfBucket(buckets, e.t);
    if (i < 0) continue;
    revenue[i] += e.revenue;
    orders[i] += 1;
  }
  return { revenue, orders };
}

/** Bucket the window's sales, pair each bucket with its comparison twin and its predecessor. */
export function buildPeriodSeries(period: ResolvedPeriod, events: ReadonlyArray<SaleEvent>): PeriodSeries {
  const g = period.granularity;
  let buckets = periodBuckets(period.start, period.end, g);
  const capped = buckets.length > MAX_BUCKETS[g];
  if (capped) buckets = buckets.slice(buckets.length - MAX_BUCKETS[g]);

  const lead = leadBucket(buckets[0]?.start ?? period.start, g);
  const cur = tally([lead, ...buckets], events);

  const prevBuckets = period.prev ? periodBuckets(period.prev.start, period.prev.chartEnd, g) : [];
  const prev = tally(prevBuckets, events);

  let best: number | null = null;
  const points = buckets.map((b, i): SeriesPoint => {
    const revenue = cur.revenue[i + 1];
    const twin = prevBuckets[i];
    const prevRevenue = twin ? prev.revenue[i] : null;
    if (revenue > 0 && (best === null || revenue > cur.revenue[best + 1])) best = i;
    return {
      ...b,
      revenue,
      orders: cur.orders[i + 1],
      prevRevenue,
      prevOrders: twin ? prev.orders[i] : null,
      prevLongLabel: twin ? twin.longLabel : null,
      change: pctChange(revenue, cur.revenue[i]),
      compareChange: pctChange(revenue, prevRevenue),
    };
  });
  return { points, capped, best };
}
