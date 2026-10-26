/**
 * Refunds — a small machine of its own beside the membership status. Only a
 * rejection can owe money back; what happens then is the snapshot's
 * `refundOnReject`:
 *
 *   none    → not_applicable
 *   manual  → pending ──(admin marks refunded + reference)──► refunded
 *   auto    → processing ──(provider webhook)──► refunded
 *                        └─(provider failed)──► pending (the admin finishes it)
 *
 * "auto" can only refund money the provider holds; a manual proof under
 * "auto" falls back to pending.
 */

import type { PaidAccessActor, PaidAccessActorKind, PaidAccessRefundPolicy, PaidAccessRefundStatus } from "./types";

export function planRefund(
  policy: PaidAccessRefundPolicy,
  payment: { paid: boolean; provider: "manual" | "online" | null },
): PaidAccessRefundStatus {
  if (!payment.paid || policy === "none") return "not_applicable";
  if (policy === "auto" && payment.provider === "online") return "processing";
  return "pending";
}

const EDGES: Readonly<Record<string, readonly PaidAccessActorKind[]>> = {
  "none>not_applicable": ["system", "admin"],
  "none>pending": ["system", "admin"],
  "none>processing": ["system", "admin"],
  "processing>refunded": ["webhook"],
  "processing>pending": ["webhook", "system"],
  "pending>refunded": ["admin"],
};

const REFERENCE_MIN = 4;
const REFERENCE_MAX = 64;

export type RefundTransitionInput = {
  from: PaidAccessRefundStatus;
  to: PaidAccessRefundStatus;
  actor: PaidAccessActor;
  reference?: unknown;
};

export function planRefundTransition(
  input: RefundTransitionInput,
): { ok: true; reference: string } | { ok: false; error: string } {
  const by = EDGES[`${input.from}>${input.to}`];
  if (!by) return { ok: false, error: `A refund that is ${input.from.replace(/_/g, " ")} can't become ${input.to}.` };
  if (!by.includes(input.actor.kind)) return { ok: false, error: "Only a store admin can mark a refund as done." };
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (input.to === "refunded" && input.actor.kind === "admin") {
    if (reference.length < REFERENCE_MIN || reference.length > REFERENCE_MAX) {
      return { ok: false, error: "Enter the refund's reference number." };
    }
  }
  return { ok: true, reference: reference.slice(0, REFERENCE_MAX) };
}
