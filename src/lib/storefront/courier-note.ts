// The owner's own note on a courier, shown at checkout under the courier picker
// while that courier is selected — "NCR and nearby areas only · pick-up is
// Malate, Manila". Plain text (rendered as text, never as HTML or a link), so
// it needs no scheme check the way bookingUrl does — only a trim and a cap.
//
// Lives on the courier (Courier.note) for the same reasons bookingUrl does: it
// is per-tenant by construction and keys off the SELECTED courier, not its name.

import type { Courier } from "@/storefront/types";

/** Longest note kept — a coverage/pick-up line, not a policy page. */
export const MAX_COURIER_NOTE_LENGTH = 300;

/** Normalize a note for storage: trimmed + capped, or `undefined` when blank so
 *  a courier without one persists exactly as it always did. */
export function cleanCourierNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const note = raw.trim().slice(0, MAX_COURIER_NOTE_LENGTH);
  return note || undefined;
}

/** The note to show for the selected courier, or "" when there is none. */
export function courierNote(courier: Pick<Courier, "note"> | null | undefined): string {
  return cleanCourierNote(courier?.note) ?? "";
}
