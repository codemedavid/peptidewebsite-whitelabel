/**
 * Pure subscription-payment core — the *ledger* half of the tenant Billing
 * feature. A tenant uploads a proof-of-payment screenshot against a billing
 * term; the operator reviews it (confirm / reject); the Billing page derives
 * lifetime metrics from the confirmed payments.
 *
 * Sibling of subscription-state.ts (reads the operator-set window) and
 * billing-cycle.ts (computes the due date). This module owns nothing about the
 * window — only the status catalogue, the operator review transitions, the
 * input-validation boundary (amount + method), a display invoice code, and the
 * metrics roll-up. Client-safe and side-effect free (no DB, no Next runtime),
 * so both the storefront submit form and the operator review drawer can call it
 * and it stays deterministically testable (npm run test:subscription-payments).
 */

/** Lifecycle of one subscription payment, in review order. */
export const SUBSCRIPTION_PAYMENT_STATUSES = ["pending", "confirmed", "failed"] as const;

export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

/** Human-facing label for each status (drawer, invoice-row badge). */
export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<SubscriptionPaymentStatus, string> = {
  pending: "Awaiting confirmation",
  confirmed: "Paid",
  failed: "Failed",
};

/** Admin design-system badge tone for each status (badge-success/warn/danger). */
export const SUBSCRIPTION_PAYMENT_STATUS_TONE: Record<SubscriptionPaymentStatus, "success" | "warn" | "danger"> = {
  pending: "warn",
  confirmed: "success",
  failed: "danger",
};

/** Narrow untrusted input (DB string, form value) to a known status. */
export function isSubscriptionPaymentStatus(value: unknown): value is SubscriptionPaymentStatus {
  return typeof value === "string" && (SUBSCRIPTION_PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** An operator can confirm a pending payment, or re-confirm one they earlier
 *  marked failed. A confirmed payment is terminal. */
export function canConfirm(status: SubscriptionPaymentStatus): boolean {
  return status === "pending" || status === "failed";
}

/** An operator can only reject (mark failed) a payment still awaiting review. */
export function canReject(status: SubscriptionPaymentStatus): boolean {
  return status === "pending";
}

export type SubscriptionPaymentReview = "confirm" | "reject";

/** The next status for a review action, or null when the transition is illegal
 *  (server actions use the null to reject the request without mutating). */
export function applyReview(
  status: SubscriptionPaymentStatus,
  action: SubscriptionPaymentReview,
): SubscriptionPaymentStatus | null {
  if (action === "confirm") return canConfirm(status) ? "confirmed" : null;
  return canReject(status) ? "failed" : null;
}

/**
 * Parse a tenant-entered peso amount to centavos. Tolerates the peso sign,
 * thousands separators and surrounding whitespace (e.g. "₱1,499.50"). Returns
 * null for zero, negative, blank or non-numeric input — the validation boundary
 * the submit action fails on.
 */
export function parsePaymentAmountCents(raw: string): number | null {
  const cleaned = raw.replace(/[₱,\s]/g, "");
  if (cleaned === "") return null;
  const pesos = Number(cleaned);
  if (!Number.isFinite(pesos) || pesos <= 0) return null;
  return Math.round(pesos * 100);
}

/** Known payment methods a tenant can pay a subscription with. Free text maps
 *  case-insensitively; anything unrecognized becomes "Other". */
export const SUBSCRIPTION_PAYMENT_METHODS = ["GCash", "Maya", "Bank transfer", "Card", "Other"] as const;

export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export function normalizePaymentMethod(raw: string): SubscriptionPaymentMethod {
  const trimmed = raw.trim().toLowerCase();
  const match = SUBSCRIPTION_PAYMENT_METHODS.find((m) => m.toLowerCase() === trimmed);
  return match ?? "Other";
}

/** A short, stable, deterministic suffix from a payment id — so two payments in
 *  the same month get distinct invoice codes. Deterministic (no Date/random), so
 *  it's render- and resume-stable. */
function invoiceSuffix(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).toUpperCase().slice(0, 4).padStart(4, "0");
}

/** Display invoice code for a payment, keyed to the UTC month it covers:
 *  "INV-YYYYMM". Stable across renders (no local-time drift). When a payment `id`
 *  is supplied the code carries a stable per-payment suffix ("INV-YYYYMM-XXXX")
 *  so multiple payments in the same month don't collide on one code. */
export function subscriptionInvoiceCode(date: Date, id?: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const base = `INV-${y}${m}`;
  return id ? `${base}-${invoiceSuffix(id)}` : base;
}

/** Raw ledger row as read from the DB (or after a JSON round-trip) — the input
 *  to the tenant-facing invoice-history projection. `status` is untrusted. */
export type TenantInvoiceSource = {
  id: string;
  amountCents: number;
  status: string;
  method: string;
  paidAt: Date | string | null | undefined;
  submittedAt: Date | string | null | undefined;
};

/** JSON-safe display row for the store-admin Billing invoice table. */
export type TenantInvoiceRow = {
  id: string;
  /** Stable display code, keyed to the invoice date's UTC month + payment id. */
  code: string;
  amountCents: number;
  method: string;
  status: SubscriptionPaymentStatus;
  /** The date that matters for the row: paidAt, falling back to submittedAt. */
  dateIso: string;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Project raw ledger rows into the tenant's invoice history: newest first,
 * invoice-coded, with unknown DB statuses narrowed to "pending" (a row must
 * never crash the page) and rows with no usable date dropped.
 */
export function tenantInvoiceRowsFrom(rows: readonly TenantInvoiceSource[]): TenantInvoiceRow[] {
  return rows
    .flatMap((row) => {
      const date = toValidDate(row.paidAt) ?? toValidDate(row.submittedAt);
      if (!date) return [];
      return [
        {
          id: row.id,
          code: subscriptionInvoiceCode(date, row.id),
          amountCents: row.amountCents,
          method: row.method,
          status: isSubscriptionPaymentStatus(row.status) ? row.status : ("pending" as const),
          dateIso: date.toISOString(),
        },
      ];
    })
    .sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
}

export type SubscriptionPaymentLedgerEntry = {
  amountCents: number;
  status: SubscriptionPaymentStatus;
};

export type SubscriptionPaymentSummary = {
  total: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  /** Sum of confirmed payment amounts — the platform's lifetime revenue from this tenant. */
  lifetimeConfirmedCents: number;
  /** lifetimeConfirmedCents ÷ confirmedCount, rounded (0 when nothing confirmed). */
  avgMonthlyCents: number;
  /** Confirmed / total, as a whole-number percent (0 for an empty ledger). */
  paidPct: number;
  /** Pending / total, as a whole-number percent (0 for an empty ledger). */
  pendingPct: number;
};

/** Roll a payment ledger up into the Billing page's lifetime metrics. Divides
 *  by zero nowhere: an empty ledger returns all zeros. */
export function summarizeSubscriptionPayments(
  payments: readonly SubscriptionPaymentLedgerEntry[],
): SubscriptionPaymentSummary {
  const total = payments.length;
  let confirmedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let lifetimeConfirmedCents = 0;

  for (const p of payments) {
    if (p.status === "confirmed") {
      confirmedCount++;
      lifetimeConfirmedCents += p.amountCents;
    } else if (p.status === "pending") {
      pendingCount++;
    } else {
      failedCount++;
    }
  }

  return {
    total,
    confirmedCount,
    pendingCount,
    failedCount,
    lifetimeConfirmedCents,
    avgMonthlyCents: confirmedCount > 0 ? Math.round(lifetimeConfirmedCents / confirmedCount) : 0,
    paidPct: total > 0 ? (confirmedCount / total) * 100 : 0,
    pendingPct: total > 0 ? (pendingCount / total) * 100 : 0,
  };
}

/**
 * Split a full payment ledger into a capped DISPLAY slice (the invoice table only
 * needs to show the most-recent rows) and a SUMMARY computed over the WHOLE
 * ledger. Keeps the lifetime metrics honest even when the table is capped —
 * summarizing only the displayed slice would under-report lifetime revenue once a
 * tenant exceeds the cap.
 */
export function buildPaymentsView<T extends SubscriptionPaymentLedgerEntry>(
  ledger: readonly T[],
  displayLimit: number,
): { display: T[]; summary: SubscriptionPaymentSummary } {
  return {
    display: ledger.slice(0, Math.max(0, displayLimit)),
    summary: summarizeSubscriptionPayments(ledger),
  };
}
