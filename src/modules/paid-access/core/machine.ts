/**
 * Paid Access membership state machine — THE list of every allowed move. Anything
 * not described by an event below is refused, by this module and again by
 * Postgres (sql/paid-access.sql mirrors the same graph).
 *
 * The graph is per membership: where "the next step" leads is read from the
 * settings SNAPSHOT the member joined under, never from the GB's current
 * settings, so an admin editing the flow can't strand anyone mid-way.
 *
 *              ┌──────── promote ────────┐
 *   waitlisted ┘                         ▼
 *        (join) ──► first step ──► … each step's event … ──► active ──► revoked
 *                     │  form_pending     submit_form
 *                     │  payment_pending  submit_proof → payment_review → confirm_proof
 *                     │                   payment_succeeded (verified webhook)
 *                     │  approval_pending approve
 *                     └─► rejected (admin) · expired (payment window) · cancelled (member)
 */

import type { PaidAccessActor, PaidAccessActorKind, PaidAccessSettings, PaidAccessStatus, PaidAccessStep } from "./types";
import { PAID_ACCESS_STATUSES } from "./types";

export type PaidAccessEvent =
  | "promote"
  | "submit_form"
  | "submit_proof"
  | "confirm_proof"
  | "payment_succeeded"
  | "reject_proof"
  | "approve"
  | "reject"
  | "expire"
  | "cancel"
  | "revoke";

export const STEP_STATUS: Readonly<Record<PaidAccessStep, PaidAccessStatus>> = {
  form: "form_pending",
  payment: "payment_pending",
  approval: "approval_pending",
};

type Snapshot = Pick<PaidAccessSettings, "steps">;

/** Where a new member starts. No steps = straight to active. */
export function firstStatus(steps: readonly PaidAccessStep[]): PaidAccessStatus {
  return steps.length > 0 ? STEP_STATUS[steps[0]] : "active";
}

/** Where finishing `step` leads under this snapshot. */
export function statusAfter(steps: readonly PaidAccessStep[], step: PaidAccessStep): PaidAccessStatus {
  const next = steps[steps.indexOf(step) + 1];
  return next ? STEP_STATUS[next] : "active";
}

/** Can a membership under this snapshot ever be in `status`? */
function inFlow(status: PaidAccessStatus, steps: readonly PaidAccessStep[]): boolean {
  switch (status) {
    case "form_pending":
      return steps.includes("form");
    case "payment_pending":
    case "payment_review":
      return steps.includes("payment");
    case "approval_pending":
      return steps.includes("approval");
    default:
      return true;
  }
}

/** The member already paid if payment comes before the approval step. */
const paidBeforeApproval = (steps: readonly PaidAccessStep[]) =>
  steps.includes("payment") && steps.includes("approval") && steps.indexOf("payment") < steps.indexOf("approval");

type Rule = {
  from: readonly PaidAccessStatus[];
  by: readonly PaidAccessActorKind[];
  to: (steps: readonly PaidAccessStep[]) => PaidAccessStatus;
  needsReason?: boolean;
  /** Extra refusal for an otherwise-legal move. */
  guard?: (from: PaidAccessStatus, steps: readonly PaidAccessStep[]) => string | null;
};

const RULES: Readonly<Record<PaidAccessEvent, Rule>> = {
  promote: { from: ["waitlisted"], by: ["system"], to: firstStatus },
  submit_form: { from: ["form_pending"], by: ["customer"], to: (s) => statusAfter(s, "form") },
  submit_proof: { from: ["payment_pending"], by: ["customer"], to: () => "payment_review" },
  confirm_proof: { from: ["payment_review"], by: ["admin"], to: (s) => statusAfter(s, "payment") },
  payment_succeeded: { from: ["payment_pending"], by: ["webhook"], to: (s) => statusAfter(s, "payment") },
  reject_proof: { from: ["payment_review"], by: ["admin"], to: () => "payment_pending", needsReason: true },
  approve: { from: ["approval_pending"], by: ["admin"], to: (s) => statusAfter(s, "approval") },
  reject: {
    from: ["waitlisted", "form_pending", "payment_pending", "payment_review", "approval_pending"],
    by: ["admin", "system"],
    to: () => "rejected",
    needsReason: true,
  },
  expire: { from: ["payment_pending"], by: ["system"], to: () => "expired" },
  cancel: {
    from: ["waitlisted", "form_pending", "payment_pending", "approval_pending"],
    by: ["customer"],
    to: () => "cancelled",
    guard: (from, steps) =>
      from === "approval_pending" && paidBeforeApproval(steps)
        ? "You've already paid — ask the store to cancel and refund you."
        : null,
  },
  revoke: { from: ["active"], by: ["admin"], to: () => "revoked", needsReason: true },
};

export const PAID_ACCESS_EVENTS = Object.keys(RULES) as PaidAccessEvent[];

export function isPaidAccessStatus(v: unknown): v is PaidAccessStatus {
  return typeof v === "string" && (PAID_ACCESS_STATUSES as readonly string[]).includes(v);
}

/** The one access question. Anything but a literal "active" is no access. */
export function hasAccess(status: unknown): boolean {
  return status === "active";
}

/** Is `from → to` a legal move for some event under this snapshot? */
export function edgeAllowed(from: PaidAccessStatus, to: PaidAccessStatus, snapshot: Snapshot): boolean {
  if (!inFlow(from, snapshot.steps)) return false;
  return PAID_ACCESS_EVENTS.some((event) => {
    const rule = RULES[event];
    return rule.from.includes(from) && rule.to(snapshot.steps) === to && !rule.guard?.(from, snapshot.steps);
  });
}

export type TransitionInput = {
  from: PaidAccessStatus;
  event: PaidAccessEvent;
  actor: PaidAccessActor;
  snapshot: Snapshot;
  reason?: unknown;
  /** The acting admin is the member (matched by the caller, e.g. by email). */
  selfReview?: boolean;
};

export type TransitionResult = { ok: true; to: PaidAccessStatus; reason: string } | { ok: false; error: string };

const REASON_MAX = 500;
const words = (s: string) => s.replace(/_/g, " ");

function actorRefusal(rule: Rule): string {
  if (rule.by.includes("admin")) return "Only a store admin can do that.";
  if (rule.by.includes("webhook")) return "Only the payment provider can confirm an online payment.";
  if (rule.by.includes("customer")) return "Only the member can do that.";
  return "That happens automatically — it can't be done by hand.";
}

/** Decide one move. Never throws: wrong status, actor or input is a refusal. */
export function planTransition(input: TransitionInput): TransitionResult {
  const { from, event, actor, snapshot } = input;
  const rule = RULES[event];
  if (!rule) return { ok: false, error: "Unknown action." };
  if (!isPaidAccessStatus(from)) return { ok: false, error: "Unknown membership status." };

  if (!rule.from.includes(from) || !inFlow(from, snapshot.steps)) {
    if (event === "submit_proof" && from === "approval_pending") {
      return { ok: false, error: "You can pay once an admin has approved your request." };
    }
    return { ok: false, error: `A membership that is ${words(from)} can't do "${words(event)}".` };
  }
  if (!rule.by.includes(actor.kind)) return { ok: false, error: actorRefusal(rule) };
  if (actor.kind === "admin" && input.selfReview) {
    return { ok: false, error: "You can't review your own membership — ask another admin." };
  }

  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, REASON_MAX) : "";
  if (rule.needsReason && !reason) return { ok: false, error: "Please give a reason — the member will see it." };

  const refusal = rule.guard?.(from, snapshot.steps);
  if (refusal) return { ok: false, error: refusal };
  return { ok: true, to: rule.to(snapshot.steps), reason };
}
