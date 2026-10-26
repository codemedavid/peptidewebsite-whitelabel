import type { Tone } from "@contract";

/**
 * Paid Access (configurable group-buy entry flows) — the shapes and pure helpers the
 * app's store-team screens need. The app can't import src/, so these are
 * COPIES, each section naming its source file. Every rule is still enforced on
 * the server (savePaidAccessSettingsAction re-validates everything); the copies
 * only drive the editor's preset chips, live preview and amount input.
 */

// ── src/modules/paid-access/core/types.ts ─────────────────────────────────────────

export const PAID_ACCESS_STEPS = ["form", "payment", "approval"] as const;
export type PaidAccessStep = (typeof PAID_ACCESS_STEPS)[number];

export type PaidAccessQuestionKind = "short" | "long" | "choice";
export type PaidAccessQuestion = { id: string; label: string; kind: PaidAccessQuestionKind; required: boolean; options: string[] };

export type PaidAccessPaymentMethod = "online" | "manual" | "either";
export type PaidAccessRefundPolicy = "auto" | "manual" | "none";
export type PaidAccessVisibility = "nothing" | "summary";

/** The join page's wording; "" = the built-in words. `payment` may use {amount}. */
export type PaidAccessCopy = {
  intro: string;
  button: string;
  note: string;
  steps: { form: string; payment: string; approval: string; access: string };
};

export type PaidAccessSettings = {
  steps: PaidAccessStep[];
  form: { questions: PaidAccessQuestion[] };
  payment: { amountMode: "full" | "deposit"; amountCents: number; method: PaidAccessPaymentMethod; windowMinutes: number | null };
  capacity: { maxSlots: number | null; waitlist: boolean };
  schedule: { opensAt: string | null; closesAt: string | null };
  refundOnReject: PaidAccessRefundPolicy;
  pendingVisibility: PaidAccessVisibility;
  notify: { paid: boolean; approved: boolean; rejected: boolean; newPending: boolean };
  copy: PaidAccessCopy;
};

// ── src/modules/paid-access/core/presets.ts ───────────────────────────────────────

export const PAID_ACCESS_PRESET_IDS = ["open", "pay_to_join", "pay_then_approve", "approve_then_pay", "apply_then_approve"] as const;
export type PaidAccessPresetId = (typeof PAID_ACCESS_PRESET_IDS)[number];
export type PaidAccessPreset = { id: PaidAccessPresetId; label: string; description: string; steps: readonly PaidAccessStep[] };

export const PAID_ACCESS_PRESETS: readonly PaidAccessPreset[] = [
  { id: "open", label: "Open", description: "Anyone can join instantly — no payment, no approval.", steps: [] },
  { id: "pay_to_join", label: "Pay to join", description: "Members get in as soon as their payment is confirmed.", steps: ["payment"] },
  { id: "pay_then_approve", label: "Pay then approve", description: "Members pay, then you approve each one before they get in.", steps: ["payment", "approval"] },
  { id: "approve_then_pay", label: "Approve then pay", description: "You approve first; approved members then pay to get in.", steps: ["approval", "payment"] },
  { id: "apply_then_approve", label: "Apply then approve", description: "Members fill a short application and you approve it. Free.", steps: ["form", "approval"] },
];

const DEFAULT_QUESTION: PaidAccessQuestion = {
  id: "about",
  label: "Tell us a bit about yourself and why you'd like to join.",
  kind: "long",
  required: true,
  options: [],
};

/** Switch `current` to a preset's steps, keeping every fine-tuned value. Pure. */
export function applyPreset(id: PaidAccessPresetId, current: PaidAccessSettings): PaidAccessSettings {
  const preset = PAID_ACCESS_PRESETS.find((p) => p.id === id) ?? PAID_ACCESS_PRESETS[0];
  const paid = preset.steps.includes("payment");
  const refundOnReject: PaidAccessRefundPolicy = !paid ? "none" : current.refundOnReject === "none" ? "manual" : current.refundOnReject;
  const kept = current.form.questions.map((q) => ({ ...q, options: [...q.options] }));
  const questions = preset.steps.includes("form") && kept.length === 0 ? [{ ...DEFAULT_QUESTION }] : kept;
  return {
    ...current,
    steps: [...preset.steps],
    form: { questions },
    payment: { ...current.payment },
    capacity: { ...current.capacity },
    schedule: { ...current.schedule },
    notify: { ...current.notify },
    refundOnReject,
  };
}

/** Which preset these settings are, or "custom" for any other step order. */
export function detectPreset(settings: Pick<PaidAccessSettings, "steps">): PaidAccessPresetId | "custom" {
  const key = settings.steps.join(">");
  return PAID_ACCESS_PRESETS.find((p) => p.steps.join(">") === key)?.id ?? "custom";
}

// ── src/modules/paid-access/core/copy.ts + view.ts (previewSteps) ─────────────────

export const COPY_LIMITS = { intro: 300, button: 40, note: 200, step: 40 } as const;
export const AMOUNT_TOKEN = "{amount}";

const ownLabel = (copy: PaidAccessCopy | undefined, key: keyof PaidAccessCopy["steps"], amountLabel: string) =>
  copy?.steps[key]?.trim().split(AMOUNT_TOKEN).join(amountLabel) || "";

/** The editor's live preview: the steps a member will walk, then access. */
export function previewSteps(settings: Pick<PaidAccessSettings, "steps"> & { copy?: PaidAccessCopy }, amountLabel: string): string[] {
  const label: Record<PaidAccessStep, string> = { form: "Application form", payment: `Pay ${amountLabel}`, approval: "Admin approval" };
  const own = (key: keyof PaidAccessCopy["steps"], fallback: string) => ownLabel(settings.copy, key, amountLabel) || fallback;
  return [...settings.steps.map((s) => own(s, label[s])), own("access", "Access")];
}

// ── src/modules/paid-access/core/input.ts (parseAmountCents) ──────────────────────

const PESOS_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX_PESOS = 1_000_000;

/** "1,499.50" / "₱ 99.9" → integer centavos, digit by digit (never a float). */
export function parseAmountCents(input: string): { ok: true; value: number } | { ok: false; error: string } {
  const m = PESOS_RE.exec(input.replace(/[₱,\s]/g, "").replace(/^PHP/i, ""));
  if (!m) return { ok: false, error: "Enter the amount in pesos, e.g. 500 or 499.50." };
  const whole = Number(m[1]);
  const cents = whole * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents <= 0) return { ok: false, error: "The amount must be more than ₱0." };
  if (whole > MAX_PESOS || (whole === MAX_PESOS && cents % 100 > 0)) return { ok: false, error: "That amount is too high." };
  return { ok: true, value: cents };
}

/** 50000 → "500", 49950 → "499.50" — the editable text for a saved amount. */
export function centsToInput(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) return "";
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

/** "₱500" / "₱499.50" for the preview (labels only — never stored). */
export function centsLabel(currency: string, cents: number): string {
  const text = centsToInput(cents);
  if (!text) return `${currency}0`;
  const [whole, dec] = text.split(".");
  return `${currency}${Number(whole).toLocaleString("en-US")}${dec ? `.${dec}` : ""}`;
}

// ── server results (src/modules/paid-access/server/settings.ts, admin.ts) ─────────

export type SettingsError = { path: string; message: string };

export type SettingsView = {
  ok: true;
  enabled: boolean;
  exists: boolean;
  settings: PaidAccessSettings;
  suggested: PaidAccessSettings;
  preset: PaidAccessPresetId | "custom";
  version: number;
  slotsTaken: number;
  onlinePaymentsAvailable: boolean;
};

export type QueueTab = "payments" | "approvals" | "refunds" | "waitlist" | "all";

export type QueuePayment = {
  id: string;
  provider: string;
  status: string;
  amountLabel: string;
  kind: string;
  reference: string;
  method: string;
  paidAt: string | null;
  submittedAt: string | null;
  hasReceipt: boolean;
  duplicateReference: boolean;
};

export type QueueRow = {
  id: string;
  groupBuyId: string;
  customerName: string;
  customerEmail: string;
  status: string;
  refundStatus: string;
  refundReference: string;
  reviewReason: string;
  steps: string[];
  createdAt: string;
  holdExpiresAt: string | null;
  formAnswers: { question: string; answer: string }[];
  payment: QueuePayment | null;
};

export type QueueCounts = { payments: number; approvals: number; refunds: number; waitlist: number; active: number; total: number };
export type QueueResult = { ok: true; rows: QueueRow[]; counts: QueueCounts };

export type PaidAccessDecision =
  | { action: "approve"; membershipId: string }
  | { action: "reject" | "revoke"; membershipId: string; reason: string }
  | { action: "refund"; membershipId: string; reference: string }
  | { action: "confirm_payment" | "confirm_and_approve"; paymentId: string }
  | { action: "reject_payment"; paymentId: string; reason: string };

/** Decisions that need a typed reason or reference first. */
export type PromptAction = "reject" | "revoke" | "refund" | "reject_payment";

// ── labels ───────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  waitlisted: "Waitlist",
  form_pending: "Filling the form",
  payment_pending: "Not paid yet",
  payment_review: "Proof to check",
  approval_pending: "Waiting for approval",
  active: "Member",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Left",
  revoked: "Access removed",
};

export const STATUS_TONE: Record<string, Tone> = {
  waitlisted: "info",
  payment_review: "warning",
  approval_pending: "warning",
  active: "success",
  rejected: "danger",
  revoked: "danger",
};

export const REFUND_LABEL: Record<string, string> = {
  pending: "Refund owed",
  processing: "Refund in progress",
  refunded: "Refunded",
};

/** Confirming this row's proof moves it straight to the approval step. */
export function approvalFollowsPayment(steps: readonly string[]): boolean {
  const at = steps.indexOf("payment");
  return at >= 0 && steps[at + 1] === "approval";
}
