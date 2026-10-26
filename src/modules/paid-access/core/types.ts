/**
 * Paid Access — the shared vocabulary. Pure types and constant lists, safe to import
 * from server code, client components and (by copy) the Expo app.
 */

/** The building blocks a group buy's entry flow is made of. */
export const PAID_ACCESS_STEPS = ["form", "payment", "approval"] as const;
export type PaidAccessStep = (typeof PAID_ACCESS_STEPS)[number];

/**
 * Every status a membership can be in. `active` is the only one with access.
 *
 *   waitlisted        joined a full GB with the waitlist on
 *   form_pending      must fill the application form
 *   payment_pending   must pay (the slot is held for the payment window)
 *   payment_review    sent a manual proof; an admin is checking it
 *   approval_pending  waiting for an admin to approve
 *   active            in — can see and order the group buy
 *   rejected          turned down by an admin (refund per settings)
 *   expired           didn't pay within the payment window; slot released
 *   cancelled         withdrew before paying
 *   revoked           an admin removed an active member
 */
export const PAID_ACCESS_STATUSES = [
  "waitlisted",
  "form_pending",
  "payment_pending",
  "payment_review",
  "approval_pending",
  "active",
  "rejected",
  "expired",
  "cancelled",
  "revoked",
] as const;
export type PaidAccessStatus = (typeof PAID_ACCESS_STATUSES)[number];

/** Statuses that end a membership. A new join is a new membership. */
export const PAID_ACCESS_TERMINAL_STATUSES: ReadonlySet<PaidAccessStatus> = new Set(["rejected", "expired", "cancelled", "revoked"]);

/** Statuses that hold one of the GB's slots (the capacity counter). */
export const PAID_ACCESS_SLOT_STATUSES: ReadonlySet<PaidAccessStatus> = new Set([
  "form_pending",
  "payment_pending",
  "payment_review",
  "approval_pending",
  "active",
]);

export const PAID_ACCESS_REFUND_STATUSES = ["none", "not_applicable", "pending", "processing", "refunded"] as const;
export type PaidAccessRefundStatus = (typeof PAID_ACCESS_REFUND_STATUSES)[number];

export type PaidAccessQuestionKind = "short" | "long" | "choice";

export type PaidAccessQuestion = {
  id: string;
  label: string;
  kind: PaidAccessQuestionKind;
  required: boolean;
  /** Only for kind "choice". */
  options: string[];
};

export type PaidAccessPaymentMethod = "online" | "manual" | "either";
export type PaidAccessRefundPolicy = "auto" | "manual" | "none";
export type PaidAccessVisibility = "nothing" | "summary";

/**
 * The store's own words on the join page. Every field is optional: "" means
 * the built-in wording. Text only — it never changes a rule, and it always
 * reads from the round's CURRENT settings (members' snapshots keep the rules,
 * not the words), so a typo fix reaches everyone at once.
 */
export type PaidAccessCopy = {
  /** The line under the round name ("8 products are waiting…"). */
  intro: string;
  /** The members-only button ("Get access"). */
  button: string;
  /** The small print under the button ("Already approved? …"). */
  note: string;
  /** Step names. `payment` may use {amount} for the price. */
  steps: { form: string; payment: string; approval: string; access: string };
};

/**
 * One group buy's entry rules. Sections that don't apply to the chosen steps
 * (e.g. `payment` without a payment step) are kept, not cleared, so switching
 * presets back and forth never loses what the admin typed.
 */
export type PaidAccessSettings = {
  steps: PaidAccessStep[];
  form: { questions: PaidAccessQuestion[] };
  payment: {
    /** "deposit" is credited against the member's GB order at checkout. */
    amountMode: "full" | "deposit";
    /** Integer centavos. */
    amountCents: number;
    method: PaidAccessPaymentMethod;
    /** Unpaid slots are released after this many minutes. null = no limit. */
    windowMinutes: number | null;
  };
  capacity: { maxSlots: number | null; waitlist: boolean };
  /** When joining opens/closes (ISO). null = follows the round's own dates. */
  schedule: { opensAt: string | null; closesAt: string | null };
  refundOnReject: PaidAccessRefundPolicy;
  /** What a member who isn't active yet may see of the group buy. */
  pendingVisibility: PaidAccessVisibility;
  notify: { paid: boolean; approved: boolean; rejected: boolean; newPending: boolean };
  /** The join page's wording ("" = built-in). */
  copy: PaidAccessCopy;
};

export type PaidAccessActorKind = "customer" | "admin" | "system" | "webhook";

export type PaidAccessActor = {
  kind: PaidAccessActorKind;
  /** customer id, "owner" / "staff:<id>", "system", or the provider name. */
  id: string;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
