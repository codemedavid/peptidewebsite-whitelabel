/**
 * UI wording for the tracker (pure). Numbers and dates come from lib/ids and
 * lib/dose-math; this file only phrases them for screens and screen readers.
 */
import { formatDose } from "../lib/dose-math";
import { daysBetween, dayKey, formatDay, formatTime, MONTH_LONG, timeKey, WEEKDAY_SHORT } from "../lib/ids";
import type { SiteState } from "../lib/sites";
import type { Dose } from "../lib/types";
import type { StatusKey } from "./theme";

const MINUTE_MS = 60_000;
const LATE_GRACE_MIN = 5;
const HOURS_IN_DAY = 24;

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The first word of a display name ("Ana Cruz" → "Ana"); null when empty. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Mon, 17 November". */
export function longDate(now: Date): string {
  return `${WEEKDAY_SHORT[now.getDay()]}, ${now.getDate()} ${MONTH_LONG[now.getMonth()]}`;
}

export type Countdown = {
  /** The big number: "3h 12m", "45 min", "Now". */
  value: string;
  /** Above it: "Next dose in", "Due", "Late by". */
  lead: string;
  /** Spoken in full: "Next dose in 3 hours 12 minutes". */
  spoken: string;
  state: "upcoming" | "due" | "late";
};

/** The hero countdown to `at` (whole minutes; refreshed by useNow). */
export function countdown(at: Date, now: Date): Countdown {
  const diffMin = Math.round((at.getTime() - now.getTime()) / MINUTE_MS);
  if (diffMin < -LATE_GRACE_MIN) {
    const late = -diffMin;
    const v = durationText(late);
    return { value: v.short, lead: "Late by", spoken: `Late by ${v.long}`, state: "late" };
  }
  if (diffMin <= LATE_GRACE_MIN) return { value: "Now", lead: "Due", spoken: "Due now", state: "due" };
  const v = durationText(diffMin);
  return { value: v.short, lead: "Next dose in", spoken: `Next dose in ${v.long}`, state: "upcoming" };
}

/** 192 → { short: "3h 12m", long: "3 hours 12 minutes" }; days for 24 h+. */
export function durationText(minutes: number): { short: string; long: string } {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return { short: `${m} min`, long: `${m} minute${m === 1 ? "" : "s"}` };
  const hours = Math.floor(m / 60);
  if (hours >= HOURS_IN_DAY) {
    const days = Math.floor(hours / HOURS_IN_DAY);
    const rest = hours % HOURS_IN_DAY;
    return {
      short: rest ? `${days}d ${rest}h` : `${days}d`,
      long: `${days} day${days === 1 ? "" : "s"}${rest ? ` ${rest} hour${rest === 1 ? "" : "s"}` : ""}`,
    };
  }
  const mins = m % 60;
  return {
    short: mins ? `${hours}h ${mins}m` : `${hours}h`,
    long: `${hours} hour${hours === 1 ? "" : "s"}${mins ? ` ${mins} minute${mins === 1 ? "" : "s"}` : ""}`,
  };
}

/** "8:05 PM" for a Date. */
export function clock(at: Date): string {
  return formatTime(timeKey(at));
}

/** relativeDay for the middle of a sentence: "runs out today", not "runs out Today". */
export function relativeDayInline(at: Date, now: Date): string {
  const word = relativeDay(at, now);
  return word === "Today" || word === "Yesterday" || word === "Tomorrow" ? word.toLowerCase() : word;
}

/** "Today", "Yesterday", "Tomorrow", a weekday this week, else "Nov 3". */
export function relativeDay(at: Date, now: Date): string {
  const gap = daysBetween(dayKey(now), dayKey(at));
  if (gap === 0) return "Today";
  if (gap === -1) return "Yesterday";
  if (gap === 1) return "Tomorrow";
  if (gap > 1 && gap < 7) return WEEKDAY_SHORT[at.getDay()];
  return formatDay(dayKey(at));
}

/**
 * "250 mcg" — the dose exactly as the user entered it. v1 never shows a
 * computed syringe-unit or mL draw (App Store 1.4.2; the converter is a later
 * feature behind `mobile.tracker.converter`).
 */
export function doseParts(dose: Dose): { main: string } {
  return { main: formatDose(dose) };
}

/** Site recency → the theme status it is drawn in, plus its word. */
export const SITE_LOOK: Record<SiteState, { status: StatusKey; word: string }> = {
  rested: { status: "ready", word: "Ready" },
  healing: { status: "recovering", word: "Recovering" },
  recent: { status: "recent", word: "Used recently" },
};

/** "1 dose" / "3 doses". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
