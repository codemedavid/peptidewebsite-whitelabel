// Pure view logic for Admin → Group Buys → Members: which bucket a member sits
// in, the one move each card leads with, and the round's flow in words. No
// React, no actions — the panel and test:paid-access-members both import it.
// Nothing here decides access; the server re-checks every move.

import type { QueueRow } from "../index";

export type MemberBucket = "needs" | "joining" | "waitlist" | "refunds" | "in" | "all";

export const BUCKETS: readonly { key: MemberBucket; label: string; empty: string }[] = [
  { key: "needs", label: "Needs you", empty: "You're all caught up. Nobody is waiting on you." },
  { key: "joining", label: "Joining", empty: "Nobody is part-way through joining." },
  { key: "waitlist", label: "Waitlist", empty: "Nobody is on the waitlist." },
  { key: "refunds", label: "Refunds owed", empty: "No refunds owed." },
  { key: "in", label: "In", empty: "Nobody is in yet." },
  { key: "all", label: "Everyone", empty: "Nobody has joined yet." },
];

const NEEDS = new Set(["payment_review", "approval_pending"]);
const JOINING = new Set(["form_pending", "payment_pending"]);
const OWED = new Set(["pending", "processing"]);

type BucketRow = Pick<QueueRow, "status" | "refundStatus">;

export function inBucket(row: BucketRow, bucket: MemberBucket): boolean {
  switch (bucket) {
    case "needs":
      return NEEDS.has(row.status);
    case "joining":
      return JOINING.has(row.status);
    case "waitlist":
      return row.status === "waitlisted";
    case "refunds":
      return row.status === "rejected" && OWED.has(row.refundStatus);
    case "in":
      return row.status === "active";
    case "all":
      return true;
  }
}

export function bucketCounts(rows: readonly BucketRow[]): Record<MemberBucket, number> {
  const counts = { needs: 0, joining: 0, waitlist: 0, refunds: 0, in: 0, all: 0 };
  for (const b of BUCKETS) counts[b.key] = rows.filter((r) => inBucket(r, b.key)).length;
  return counts;
}

/** Most urgent first: who is waiting on the store, oldest wait on top. */
export function sortForReview<T extends Pick<QueueRow, "status" | "createdAt"> & { payment: { submittedAt: string | null } | null }>(
  rows: readonly T[],
): T[] {
  const waitingSince = (r: T) => Date.parse(r.payment?.submittedAt ?? r.createdAt) || 0;
  return [...rows].sort((a, b) => {
    const urgent = Number(NEEDS.has(b.status)) - Number(NEEDS.has(a.status));
    return urgent || waitingSince(a) - waitingSince(b);
  });
}

export function matchesSearch(row: Pick<QueueRow, "customerName" | "customerEmail">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || row.customerName.toLowerCase().includes(q) || row.customerEmail.toLowerCase().includes(q);
}

export type MemberMove = "confirm_and_approve" | "confirm_payment" | "approve" | "refund";

type MoveRow = Pick<QueueRow, "status" | "refundStatus" | "steps"> & { payment: { status: string } | null };

/** Approval comes after payment in this member's own flow. */
export function approvesAfterPaying(steps: readonly string[]): boolean {
  return steps.includes("payment") && steps.includes("approval") && steps.indexOf("approval") > steps.indexOf("payment");
}

/** The one move the card leads with, or null when nothing waits on the store. */
export function primaryMove(row: MoveRow): MemberMove | null {
  if (row.status === "payment_review" && row.payment?.status === "submitted") {
    return approvesAfterPaying(row.steps) ? "confirm_and_approve" : "confirm_payment";
  }
  if (row.status === "approval_pending") return "approve";
  if (row.status === "rejected" && row.refundStatus === "pending") return "refund";
  return null;
}

/** Unpaid holds past their deadline — what "Release" would free right now. */
export function expiredHolds(rows: readonly Pick<QueueRow, "status" | "holdExpiresAt">[], now: number): number {
  return rows.filter((r) => r.status === "payment_pending" && !!r.holdExpiresAt && Date.parse(r.holdExpiresAt) <= now).length;
}

const STEP_WORD: Record<string, string> = { form: "Application", payment: "Pay", approval: "Admin approval" };

/** "Pay ₱100 → Admin approval", or "Open to everyone" for a flow with no steps. */
export function flowSummary(steps: readonly string[], amountLabel: string): string {
  if (steps.length === 0) return "Open to everyone";
  return steps.map((s) => (s === "payment" ? `Pay ${amountLabel}` : STEP_WORD[s] ?? s)).join(" → ");
}

export function formatAmount(currency: string, cents: number): string {
  const whole = cents / 100;
  return `${currency}${whole.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(whole) ? 0 : 2 })}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = Math.max(0, now - t);
  if (d < MINUTE) return "just now";
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Slots meter: "1 of 3 taken", fill 0–1 (null limit = no meter). */
export function slotMeter(taken: number, max: number | null): { label: string; fill: number | null } {
  if (max === null) return { label: `${taken} taken · no limit`, fill: null };
  const left = Math.max(0, max - taken);
  return { label: `${taken} of ${max} taken · ${left === 0 ? "full" : `${left} open`}`, fill: Math.min(1, taken / max) };
}
