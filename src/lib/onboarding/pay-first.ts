// PURE decisions behind the "pay first, details later" sign-up flow. Kept free
// of Prisma / Next so the rules are unit-tested (npm run test:onboarding-pay-first)
// and the server actions only do I/O around them.

import { toWaDigits } from "@/lib/admin/whatsapp";

/** A lead saved within this window with the same WhatsApp is updated, not duplicated. */
export const LEAD_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const LEAD_STATUS = "lead";

/** Comparable form of a PH-or-international WhatsApp number: digits only, with
 *  the local trunk "09xx…" (11 digits) rewritten to "639xx…". */
export function whatsappKey(raw: string | null | undefined): string {
  const digits = toWaDigits(raw ?? "");
  if (digits.length === 11 && digits.startsWith("0")) return `63${digits.slice(1)}`;
  return digits;
}

export type LeadCandidate = {
  id: string;
  whatsapp: string | null;
  tenantId: string | null;
  setupStatus: string;
  createdAt: Date;
};

export type LeadWriteDecision = { action: "update"; id: string } | { action: "insert" };

/** An unpaid lead that has not been converted into a store yet. */
export function isOpenLead(row: Pick<LeadCandidate, "tenantId" | "setupStatus">): boolean {
  return row.setupStatus === LEAD_STATUS && !row.tenantId;
}

/**
 * Update an existing lead or insert a new one.
 *   1. The browser's own lead token wins, as long as that row is still an open lead.
 *   2. Otherwise, an open lead with the same WhatsApp from the last 24h is reused.
 *   3. Otherwise insert.
 */
export function decideLeadWrite(input: {
  whatsapp: string;
  now: Date;
  tokenMatch: LeadCandidate | null;
  recent: LeadCandidate[];
}): LeadWriteDecision {
  if (input.tokenMatch && isOpenLead(input.tokenMatch)) {
    return { action: "update", id: input.tokenMatch.id };
  }
  const key = whatsappKey(input.whatsapp);
  if (!key) return { action: "insert" };
  const cutoff = input.now.getTime() - LEAD_DEDUPE_WINDOW_MS;
  const match = input.recent.find(
    (r) => isOpenLead(r) && r.createdAt.getTime() >= cutoff && whatsappKey(r.whatsapp) === key,
  );
  return match ? { action: "update", id: match.id } : { action: "insert" };
}

export type DetailsUpdateDecision = { ok: true } | { ok: false; error: string };

/**
 * May the holder of an access token send post-payment store details?
 * Only for a PAID submission whose store is still being built (pending_setup) —
 * never overwrite a published (or suspended) store.
 */
export function detailsUpdateDecision(
  sub: { tenantId: string | null; tenantStatus: string | null } | null,
): DetailsUpdateDecision {
  if (!sub) return { ok: false, error: "We couldn't find your sign-up. Please message us on WhatsApp." };
  if (!sub.tenantId) return { ok: false, error: "Please finish payment first." };
  if (sub.tenantStatus !== "pending_setup") {
    return {
      ok: false,
      error: "Your store is already live — message us on WhatsApp and we'll update it for you.",
    };
  }
  return { ok: true };
}

/** Short human reference for a submission (what the client quotes on WhatsApp). */
export function submissionReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
