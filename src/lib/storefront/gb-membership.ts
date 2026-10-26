/**
 * Paid group-buy access — the pure rulebook (ZERO imports: client-safe, and
 * copyable into the Expo app like gb-invoice.ts).
 *
 * A customer pays a round's join fee by manual receipt (GCash / bank transfer),
 * a store admin approves or rejects it, and only an APPROVED membership opens
 * the round. Access is per round: paying for one never unlocks another.
 *
 *   pending_payment → paid_pending_approval → approved → revoked
 *                                           ↘ rejected → refunded
 *
 * Postgres enforces the same graph (prisma/group-buy-memberships.sql), so a
 * code path that skips this module still cannot skip a state. The amount is
 * never read from the customer: the server copies GroupBuy.joinFeeCents onto
 * the membership when the request is created.
 *
 * Gate: npm run test:gb-membership (pure) + test:gb-membership-db (Postgres).
 */

export const GB_MEMBERSHIP_STATUSES = [
  "pending_payment",
  "paid_pending_approval",
  "approved",
  "rejected",
  "refunded",
  "revoked",
] as const;

export type GbMembershipStatus = (typeof GB_MEMBERSHIP_STATUSES)[number];

/** A request in one of these states stops the customer opening (and paying
 *  for) another request on the same round. Revoked is included on purpose: a
 *  removed member cannot buy their way back in without the store's say-so.
 *  Mirrors the partial unique index group_buy_memberships_one_live. */
export const GB_MEMBERSHIP_BLOCKING_STATUSES: ReadonlySet<GbMembershipStatus> = new Set([
  "pending_payment",
  "paid_pending_approval",
  "approved",
  "revoked",
]);

export function isGbMembershipStatus(v: unknown): v is GbMembershipStatus {
  return typeof v === "string" && (GB_MEMBERSHIP_STATUSES as readonly string[]).includes(v);
}

/** The one question every gate asks. Anything but a literal "approved" — a
 *  missing row, a typo, a future status — is no access. */
export function hasGroupBuyAccess(status: unknown): boolean {
  return status === "approved";
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export type MembershipActorKind = "customer" | "owner" | "staff" | "operator";

export type MembershipActor = {
  kind: MembershipActorKind;
  /** customer id, staff id, operator id; "owner" for the store owner. */
  id: string;
  email: string;
};

type Step = { by: "customer" | "admin"; needsReason?: boolean; needsRefundReference?: boolean };

/** Every legal edge and who may walk it. Anything absent is illegal. */
const STEPS: Readonly<Record<string, Step>> = {
  "pending_payment>paid_pending_approval": { by: "customer" },
  "paid_pending_approval>approved": { by: "admin" },
  "paid_pending_approval>rejected": { by: "admin", needsReason: true },
  "rejected>refunded": { by: "admin", needsRefundReference: true },
  "approved>revoked": { by: "admin", needsReason: true },
};

const REASON_MAX = 500;
const REFUND_REFERENCE_MAX = 64;

export type MembershipPatch = {
  status: GbMembershipStatus;
  submittedAt?: Date;
  decidedAt?: Date;
  decidedBy?: string;
  reviewReason?: string;
  refundedAt?: Date;
  refundReference?: string;
};

export type TransitionInput = {
  from: unknown;
  to: unknown;
  actor: MembershipActor;
  membership: { customerId: string | null; customerEmail: string };
  reason?: unknown;
  refundReference?: unknown;
  at?: Date;
};

export type TransitionResult = { ok: true; patch: MembershipPatch } | { ok: false; error: string };

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Stable audit key for who decided: "owner", "staff:<id>", "operator:<id>". */
export function membershipActorKey(actor: MembershipActor): string {
  return actor.kind === "owner" ? "owner" : `${actor.kind}:${actor.id}`;
}

/**
 * Decide one status change. Returns the column patch to write, or a readable
 * refusal. Never throws: unknown statuses and wrong actors are refusals.
 */
export function planMembershipTransition(input: TransitionInput): TransitionResult {
  const { from, to, actor, membership } = input;
  if (!isGbMembershipStatus(from) || !isGbMembershipStatus(to)) {
    return { ok: false, error: "Unknown request status." };
  }
  const step = STEPS[`${from}>${to}`];
  if (!step) return { ok: false, error: `A request that is ${from.replace(/_/g, " ")} cannot become ${to.replace(/_/g, " ")}.` };

  const at = input.at ?? new Date();

  if (step.by === "customer") {
    if (actor.kind !== "customer" || !membership.customerId || actor.id !== membership.customerId) {
      return { ok: false, error: "Only the customer who made this request can submit its payment." };
    }
    return { ok: true, patch: { status: to, submittedAt: at } };
  }

  if (actor.kind === "customer") return { ok: false, error: "Only a store admin can review join requests." };
  if (sameEmail(actor.email, membership.customerEmail)) {
    return { ok: false, error: "You can't review your own join request — ask another admin." };
  }

  const decided = { decidedAt: at, decidedBy: membershipActorKey(actor) };
  if (step.needsReason) {
    const reason = text(input.reason, REASON_MAX);
    if (!reason) return { ok: false, error: "Please give a reason — the customer will see it." };
    return { ok: true, patch: { status: to, ...decided, reviewReason: reason } };
  }
  if (step.needsRefundReference) {
    const refundReference = text(input.refundReference, REFUND_REFERENCE_MAX);
    if (!refundReference) return { ok: false, error: "Enter the refund's reference number." };
    return { ok: true, patch: { status: to, refundedAt: at, refundReference } };
  }
  return { ok: true, patch: { status: to, ...decided } };
}

// ── Customer input: the receipt ──────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type ReceiptSubmission = { reference: string; method: string; paidAt: Date | null };

const REFERENCE_MIN = 4;
const REFERENCE_MAX = 64;
// Letters, digits and the separators real receipts use. No markup, no newlines.
const REFERENCE_RE = /^[A-Za-z0-9 .#/_-]+$/;
const METHOD_MAX = 60;
/** Phone clocks drift; a receipt "a few minutes in the future" is not fraud. */
const PAID_AT_SKEW_MS = 60 * 60 * 1000;

/**
 * The customer's half of a payment: reference number, how they paid, when.
 * Deliberately has no amount — whatever the client sends there is dropped,
 * because the price is the server's (GroupBuy.joinFeeCents).
 */
export function parseReceiptSubmission(input: unknown, now: Date = new Date()): Parsed<ReceiptSubmission> {
  if (!input || typeof input !== "object") return { ok: false, error: "Missing payment details." };
  const o = input as Record<string, unknown>;

  const reference = text(o.reference, REFERENCE_MAX + 1);
  if (reference.length < REFERENCE_MIN) return { ok: false, error: "Enter the reference number from your receipt." };
  if (reference.length > REFERENCE_MAX) return { ok: false, error: "That reference number is too long." };
  if (!REFERENCE_RE.test(reference)) return { ok: false, error: "The reference number can only use letters, numbers, spaces and - . # / _" };

  const method = text(o.method, METHOD_MAX);

  let paidAt: Date | null = null;
  if (typeof o.paidAt === "string" && o.paidAt.trim()) {
    const d = new Date(o.paidAt);
    if (!Number.isNaN(d.getTime())) {
      if (d.getTime() > now.getTime() + PAID_AT_SKEW_MS) return { ok: false, error: "The payment date can't be in the future." };
      paidAt = d;
    }
  }
  return { ok: true, value: { reference, method, paidAt } };
}

// ── Owner input: the fee ─────────────────────────────────────────────────────

const FEE_MAX_PESOS = 1_000_000;
const PESOS_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "1,499.50" / 1499.5 / "₱ 99.9" → integer centavos, parsed digit-by-digit so
 *  no float ever touches the stored amount. Zero is refused: a free round is
 *  simply one without paid join. */
export function parseJoinFeeCents(input: unknown): Parsed<number> {
  const raw =
    typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : typeof input === "string" ? input : "";
  const cleaned = raw.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  const m = PESOS_RE.exec(cleaned);
  if (!m) return { ok: false, error: "Enter the join fee in pesos, e.g. 500 or 499.50." };
  const whole = Number(m[1]);
  const cents = whole * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents <= 0) return { ok: false, error: "The join fee must be more than ₱0." };
  if (whole > FEE_MAX_PESOS || (whole === FEE_MAX_PESOS && cents % 100 > 0)) {
    return { ok: false, error: "That join fee is too high." };
  }
  return { ok: true, value: cents };
}

// ── Customer-facing status ───────────────────────────────────────────────────

export type MembershipStatusView = { title: string; detail: string; tone: "neutral" | "pending" | "success" | "danger" };

export function membershipStatusView(status: unknown, reason = ""): MembershipStatusView {
  const why = reason.trim();
  switch (status) {
    case "pending_payment":
      return { title: "Awaiting payment", detail: "Pay the join fee, then upload your receipt and reference number.", tone: "pending" };
    case "paid_pending_approval":
      return { title: "Payment received – waiting for admin approval", detail: "The store will check your receipt. You'll be notified once you're in.", tone: "pending" };
    case "approved":
      return { title: "Approved", detail: "You're in. You can now see this group buy and order.", tone: "success" };
    case "rejected":
      return {
        title: `Rejected: ${why || "no reason given"} – refund in progress`,
        detail: "The store will refund you directly using the details on your receipt.",
        tone: "danger",
      };
    case "refunded":
      return { title: "Refunded", detail: "Your join fee was refunded. You can request to join again.", tone: "neutral" };
    case "revoked":
      return { title: `Access removed: ${why || "no reason given"}`, detail: "Contact the store if you think this is a mistake.", tone: "danger" };
    default:
      return { title: "Join this group buy", detail: "Pay the join fee to see the products and order.", tone: "neutral" };
  }
}
