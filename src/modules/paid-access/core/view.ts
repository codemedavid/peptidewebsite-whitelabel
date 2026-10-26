/**
 * What the member sees: a stepper ("Step 2 of 3: Waiting for admin approval")
 * and the one action button that moves them forward. Built on the server from
 * the member's snapshot and shipped as plain JSON, so the website and the app
 * render the same words without re-deriving any rule.
 */

import { accessLabel, stepLabel } from "./copy";
import type { PaidAccessCopy, PaidAccessSettings, PaidAccessStatus, PaidAccessStep } from "./types";

export type StepState = "done" | "current" | "upcoming";
export type StepperStep = { key: PaidAccessStep; label: string; state: StepState };
export type StepperAction = { kind: "join" | "fill_form" | "pay"; label: string };
export type StepperTone = "neutral" | "pending" | "success" | "danger";

export type StepperView = {
  steps: StepperStep[];
  /** 1-based position of the current step; null when not inside a step. */
  position: number | null;
  total: number;
  headline: string;
  detail: string;
  tone: StepperTone;
  action: StepperAction | null;
  /** The last stop's name ("Access", or the store's own). */
  accessLabel: string;
};

export type StepperContext = {
  /** e.g. "₱500.00" — formatted by the caller in the store's currency. */
  amountLabel: string;
  reason?: string;
  /** ISO — when an unpaid slot is released. */
  holdExpiresAt?: string | null;
  /** May a rejected member start over (no refund still pending)? */
  canRejoin?: boolean;
  /** The store's step names — from the round's CURRENT settings, not a snapshot. */
  copy?: PaidAccessCopy;
};

const STEP_LABEL: Readonly<Record<PaidAccessStep, string>> = {
  form: "Application",
  payment: "Payment",
  approval: "Admin approval",
};

const CURRENT_STEP: Partial<Record<PaidAccessStatus, PaidAccessStep>> = {
  form_pending: "form",
  payment_pending: "payment",
  payment_review: "payment",
  approval_pending: "approval",
};

function stepsFor(steps: readonly PaidAccessStep[], status: PaidAccessStatus | null, ctx: StepperContext): StepperStep[] {
  const current = status ? CURRENT_STEP[status] : undefined;
  const at = current ? steps.indexOf(current) : -1;
  return steps.map((key, i) => ({
    key,
    label: stepLabel(ctx.copy, key, ctx.amountLabel, STEP_LABEL[key]),
    state: status === "active" ? "done" : at < 0 ? "upcoming" : i < at ? "done" : i === at ? "current" : "upcoming",
  }));
}

export function stepperView(
  snapshot: Pick<PaidAccessSettings, "steps">,
  status: PaidAccessStatus | null,
  ctx: StepperContext,
): StepperView {
  const steps = stepsFor(snapshot.steps, status, ctx);
  const total = steps.length;
  const currentIdx = steps.findIndex((s) => s.state === "current");
  const position = currentIdx >= 0 ? currentIdx + 1 : null;
  const prefix = position ? `Step ${position} of ${total}: ` : "";
  const reason = ctx.reason?.trim() || "no reason given";
  const join: StepperAction = { kind: "join", label: total > 0 ? "Join this group buy" : "Join" };
  const base = { steps, position, total, accessLabel: accessLabel(ctx.copy) };

  switch (status) {
    case null:
      return {
        ...base,
        headline: "Ready to join?",
        detail: total > 0 ? `${total} ${total === 1 ? "step" : "steps"} to get in: ${steps.map((s) => s.label.toLowerCase()).join(", then ")}.` : "One tap and you're in.",
        tone: "neutral",
        action: join,
      };
    case "waitlisted":
      return { ...base, headline: "You're on the waitlist", detail: "We'll move you in as soon as a slot opens.", tone: "pending", action: null };
    case "form_pending":
      return {
        ...base,
        headline: `${prefix}Fill in the application`,
        detail: "Answer a few questions so the store can review your request.",
        tone: "pending",
        action: { kind: "fill_form", label: "Fill in the application" },
      };
    case "payment_pending":
      return {
        ...base,
        headline: `${prefix}Pay ${ctx.amountLabel}`,
        detail: ctx.holdExpiresAt
          ? `Your slot is held until ${ctx.holdExpiresAt}. Pay, then upload your proof of payment.`
          : "Pay, then upload your proof of payment.",
        tone: "pending",
        action: { kind: "pay", label: `Pay ${ctx.amountLabel}` },
      };
    case "payment_review":
      return {
        ...base,
        headline: `${prefix}Checking your payment`,
        detail: "The store is checking your proof of payment. You'll be notified.",
        tone: "pending",
        action: null,
      };
    case "approval_pending":
      return {
        ...base,
        headline: `${prefix}Waiting for admin approval`,
        detail: "The store will review your request. You'll be notified once you're in.",
        tone: "pending",
        action: null,
      };
    case "active":
      return { ...base, headline: "You're in", detail: "You can now see this group buy and order.", tone: "success", action: null };
    case "rejected":
      return {
        ...base,
        headline: `Not approved: ${reason}`,
        detail: "If you paid, the store will handle your refund.",
        tone: "danger",
        action: ctx.canRejoin ? { kind: "join", label: "Join again" } : null,
      };
    case "expired":
      return {
        ...base,
        headline: "Your slot was released — the payment window expired",
        detail: "You can join again if there's still room.",
        tone: "neutral",
        action: { kind: "join", label: "Join again" },
      };
    case "cancelled":
      return { ...base, headline: "You left this group buy", detail: "You can join again any time it's open.", tone: "neutral", action: { kind: "join", label: "Join again" } };
    case "revoked":
      return { ...base, headline: `Access removed: ${reason}`, detail: "Contact the store if you think this is a mistake.", tone: "danger", action: null };
  }
}

/** The admin panel's live preview: the steps a member will walk, then access. */
export function previewSteps(settings: Pick<PaidAccessSettings, "steps"> & { copy?: PaidAccessCopy }, amountLabel: string): string[] {
  const label: Record<PaidAccessStep, string> = {
    form: "Application form",
    payment: `Pay ${amountLabel}`,
    approval: "Admin approval",
  };
  return [...settings.steps.map((s) => stepLabel(settings.copy, s, amountLabel, label[s])), accessLabel(settings.copy)];
}
