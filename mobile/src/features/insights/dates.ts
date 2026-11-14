// Store-calendar date keys (YYYY-MM-DD, Asia/Manila — fixed UTC+8) for the
// Insights period picker. The server owns the real window maths
// (src/lib/analytics/sales-period.ts); the app only needs "today" and labels.

const STORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Ymd = { y: number; m: number; d: number };

export function keyOf({ y, m, d }: Ymd): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseKey(key: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
}

/** Today on the store's clock. */
export function storeToday(now: Date = new Date()): string {
  const d = new Date(now.getTime() + STORE_UTC_OFFSET_MS);
  return keyOf({ y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() });
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday, for a Monday-first grid. */
export function mondayIndex(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7;
}

/** "Nov 3, 2026" */
export function formatKey(key: string): string {
  const p = parseKey(key);
  return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : key;
}
