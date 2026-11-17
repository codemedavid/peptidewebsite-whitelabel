// Who may call /api/mobile/v1/tracker/* (docs/mobile-admin/TRACKER.md §5). Pure.
//
//   any signed-in account      → its OWN tracker: customers, the store owner and
//   (customer, owner, staff)     each staff member (lib/tracker/owner.ts). Nobody
//                                reads anyone else's — there is no store-side
//                                read path for a customer's tracker
//   app guest                  → 403 — no real account to own the data
//   tracker off for the store  → 404 — revoking hides the feature; data is kept
//   store-guides               → additionally needs guide import (404 otherwise)

import type { ApiErrorCode, TrackerMe } from "@/lib/mobile/contract";

export type GateFailure = { code: ApiErrorCode; message: string };

export const TRACKER_OFF: GateFailure = { code: "not_found", message: "The tracker isn't available for this store." };

export const TRACKER_GUEST_REFUSED: GateFailure = {
  code: "forbidden",
  message: "Create an account to use the tracker.",
};

export function trackerGate(
  access: TrackerMe,
  opts: { guideImport?: boolean; guest?: boolean } = {},
): GateFailure | null {
  // An app guest (lib/mobile/app-guest) has no real account to own the data.
  if (opts.guest) return TRACKER_GUEST_REFUSED;
  if (!access.enabled) return TRACKER_OFF;
  if (opts.guideImport && !access.guideImport) return TRACKER_OFF;
  return null;
}
