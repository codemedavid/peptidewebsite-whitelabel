// Chat clock, day and countdown labels (ported from the inspiration's lib/format.ts).
// Pure: no React Native imports, so scripts/test-community-lib.ts can run it in node.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LOCALE = "en-PH";

/** "now", "5m", "2h", "Yesterday", "Mon", "12 Sep" — the chat-list style. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 2 * DAY) return "Yesterday";
  const d = new Date(t);
  if (diff < 7 * DAY) return d.toLocaleDateString(LOCALE, { weekday: "short" });
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isSameDay(aIso: string, bIso: string): boolean {
  return sameDay(new Date(aIso), new Date(bIso));
}

/** A day separator label: "Today", "Yesterday", "Mon, 14 Sep". */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
}

/** "1 message", "2 messages". */
export function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Member";
}

/** "2d 4h", "3h 12m", "45m", "under a minute", or null once passed. */
export function formatCountdown(untilIso: string, now = Date.now()): string | null {
  const remaining = new Date(untilIso).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "under a minute";
}

export type CountdownParts = { days: number; hours: string; minutes: string; seconds: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Flash-sale clock parts ("1d 02:05:09"), or null once the deadline passed. */
export function splitCountdown(untilIso: string, now = Date.now()): CountdownParts | null {
  const remaining = new Date(untilIso).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const total = Math.floor(remaining / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: pad2(Math.floor((total % 86_400) / 3600)),
    minutes: pad2(Math.floor((total % 3600) / 60)),
    seconds: pad2(total % 60),
  };
}

/** "Member since September 2026". */
export function memberSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}
