/**
 * Upgrade-request state machine (pure, client-safe — test:trial-upgrade).
 * A store owner's upgrade submission (proof-of-payment upload) sits PENDING
 * until the platform operator decides it: APPROVED flips the tenant to the
 * Business plan and reactivates the storefront; REJECTED leaves the plan
 * untouched. Decisions are final — the owner files a new request instead of
 * mutating a decided one, so the audit trail stays intact.
 */

export const UPGRADE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type UpgradeRequestStatus = (typeof UPGRADE_REQUEST_STATUSES)[number];

/** Untrusted/stored → valid status; anything unknown is an undecided pending. */
export function normalizeUpgradeStatus(value: unknown): UpgradeRequestStatus {
  return (UPGRADE_REQUEST_STATUSES as readonly string[]).includes(value as string)
    ? (value as UpgradeRequestStatus)
    : "pending";
}

/** Only a pending request can be decided, and only to a decided state. */
export function canTransitionUpgrade(
  from: UpgradeRequestStatus,
  to: UpgradeRequestStatus,
): boolean {
  return from === "pending" && (to === "approved" || to === "rejected");
}
