/**
 * Record ids and calendar-day helpers. Days are local "YYYY-MM-DD" keys; day
 * arithmetic goes through UTC so a daylight-saving change never shifts a day.
 */

const DAY_MS = 86_400_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function randomHex(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** A random v4-style UUID, made on the phone (the record id the server keys sync on). */
export function newId(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof native === "function") {
    try {
      return native.call((globalThis as { crypto?: object }).crypto);
    } catch {
      // Fall through to the Math.random version.
    }
  }
  const variant = ((Math.floor(Math.random() * 4) + 8) as number).toString(16);
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${variant}${randomHex(3)}-${randomHex(12)}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local calendar day of `date`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && DAY_KEY.test(value);
}

/** Local midnight of a day key. */
export function parseDayKey(key: string): Date {
  const m = DAY_KEY.exec(key);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcDay(key: string): number {
  const m = DAY_KEY.exec(key);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(utcDay(to) - utcDay(from));
}

export function addDays(key: string, days: number): string {
  const d = new Date((utcDay(key) + days) * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 0 = Sunday. */
export function weekday(key: string): number {
  return ((Math.round(utcDay(key)) % 7) + 7 + 4) % 7;
}

/** The Sunday that starts `key`'s week. */
export function weekStart(key: string): string {
  return addDays(key, -weekday(key));
}

export function isTimeKey(value: unknown): value is string {
  return typeof value === "string" && TIME_KEY.test(value);
}

/** "HH:MM" → minutes after midnight (null when malformed). */
export function timeMinutes(time: string): number | null {
  const m = TIME_KEY.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function timeKey(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The local moment `time` on day `key`. */
export function atTime(key: string, time: string): Date {
  const d = parseDayKey(key);
  const minutes = timeMinutes(time) ?? 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/** "08:00" → "8:00 AM". */
export function formatTime(time: string): string {
  const minutes = timeMinutes(time);
  if (minutes === null) return time;
  const h = Math.floor(minutes / 60);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(minutes % 60)} ${suffix}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAY_SHORT = WEEKDAYS;
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Oct 28". */
export function formatDay(key: string): string {
  const d = parseDayKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Thu Oct 28". */
export function formatWeekdayDay(key: string): string {
  return `${WEEKDAYS[weekday(key)]} ${formatDay(key)}`;
}

/** "Thu 8:00 AM" — today/tomorrow named, otherwise the weekday (or a date beyond a week). */
export function formatWhen(at: Date, now: Date): string {
  const gap = daysBetween(dayKey(now), dayKey(at));
  const time = formatTime(timeKey(at));
  if (gap === 0) return `Today ${time}`;
  if (gap === 1) return `Tomorrow ${time}`;
  if (gap > 1 && gap < 7) return `${WEEKDAYS[at.getDay()]} ${time}`;
  return `${formatDay(dayKey(at))} ${time}`;
}
