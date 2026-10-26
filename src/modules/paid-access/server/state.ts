import "server-only";

// The customer's view of their way into one round — the JSON the website and
// the app both render (stepper, the one action, price, payment options). All
// rules are decided here, on the server, from the member's OWN snapshot.

import type { ShopPaymentMethod } from "@/lib/mobile/shop-contract";
import { OPEN_SETTINGS, UNCONFIGURED_SETTINGS } from "../core/presets";
import { requiresJoin } from "../core/settings";
import { hasAccess, isPaidAccessStatus } from "../core/machine";
import { stepperView, type StepperView } from "../core/view";
import type { PaidAccessQuestion, PaidAccessSettings, PaidAccessStatus, PaidAccessVisibility } from "../core/types";
import { joinWindow, money, NOT_READY_MESSAGE, paymentAccountsOf, type JoinWindow, type RoundContext } from "./context";
import { onlineProvider } from "./payments";
import { readSettings, type FlowRow, type MembershipRow, type PaymentRow } from "./repo";
import { flowReady } from "./settings";
import { holdLapsed } from "./slots";

export type JoinState = {
  groupBuyId: string;
  roundName: string;
  /** Does this round need a join at all? false = Open: everyone has access. */
  gated: boolean;
  status: PaidAccessStatus | null;
  canAccess: boolean;
  membershipId: string | null;
  stepper: StepperView;
  amountCents: number;
  amountLabel: string;
  amountMode: "full" | "deposit";
  paymentOptions: { manual: boolean; online: boolean };
  paymentAccounts: ShopPaymentMethod[];
  formQuestions: PaidAccessQuestion[];
  holdExpiresAt: string | null;
  window: JoinWindow;
  capacity: { maxSlots: number | null; slotsTaken: number; waitlist: boolean };
  proof: { reference: string; method: string; submittedAt: string | null; hasReceipt: boolean; rejectReason: string } | null;
  reviewReason: string;
  refundStatus: string;
  canJoin: boolean;
  visibility: PaidAccessVisibility;
};

/** A payment-pending member whose deadline passed reads as expired, even
 *  before the sweep writes it. */
export function effectiveStatus(m: Pick<MembershipRow, "status" | "holdExpiresAt"> | null, now: Date): PaidAccessStatus | null {
  if (!m || !isPaidAccessStatus(m.status)) return null;
  return holdLapsed(m, now) ? "expired" : m.status;
}

/** May this customer start a NEW membership after `m`? */
export function mayStartOver(m: Pick<MembershipRow, "status" | "refundStatus" | "holdExpiresAt"> | null, now: Date): boolean {
  const status = effectiveStatus(m, now);
  if (!status) return true;
  if (status === "revoked") return false;
  if (status === "rejected") return m!.refundStatus !== "pending" && m!.refundStatus !== "processing";
  return status === "expired" || status === "cancelled";
}

const ACCESS_STATES = new Set<PaidAccessStatus>(["active"]);

export function settingsFor(flow: FlowRow | null, m: MembershipRow | null): PaidAccessSettings {
  return m ? readSettings(m.settingsSnapshot) : flow?.settings ?? UNCONFIGURED_SETTINGS;
}

export function buildJoinState(input: {
  ctx: RoundContext;
  flow: FlowRow | null;
  membership: MembershipRow | null;
  payment: PaymentRow | null;
  now: Date;
}): JoinState {
  const { ctx, flow, membership: m, payment, now } = input;
  // No saved settings = members only, joining paused until the store sets it up.
  const current = flow?.settings ?? UNCONFIGURED_SETTINGS;
  const gated = ctx.enabled && requiresJoin(current);
  const status = effectiveStatus(m, now);
  // A member keeps the rules they joined under; a newcomer sees the current ones.
  const live = m && status && !["expired", "cancelled", "rejected", "revoked"].includes(status);
  const rules = live ? readSettings(m!.settingsSnapshot) : current;
  const canAccess = !gated || (status !== null && ACCESS_STATES.has(status) && hasAccess(status));
  const startOver = mayStartOver(m, now);
  const amountLabel = money(ctx.currency, rules.payment.amountCents);
  const hold = status === "payment_pending" && m?.holdExpiresAt ? m.holdExpiresAt.toISOString() : null;
  const provider = onlineProvider();
  const ready = !!flow && flowReady(flow.settings);
  const window: JoinWindow = ready
    ? joinWindow(ctx.round, current, ctx.caps, now)
    : { open: false, opensAt: null, closesAt: null, message: NOT_READY_MESSAGE };

  const stepper = !gated
    ? stepperView(OPEN_SETTINGS, "active", { amountLabel })
    : stepperView(live || status === "active" ? rules : current, status, {
        amountLabel,
        // Words follow the round's current settings; only the rules are snapshotted.
        copy: current.copy,
        reason: m?.reviewReason,
        holdExpiresAt: hold
          ? new Date(hold).toLocaleString("en-PH", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric", timeZone: "Asia/Manila" })
          : null,
        canRejoin: startOver,
      });

  return {
    groupBuyId: ctx.round.id,
    roundName: ctx.round.name,
    gated,
    status: gated ? status : status ?? null,
    canAccess,
    membershipId: m?.id ?? null,
    stepper,
    amountCents: rules.payment.amountCents,
    amountLabel,
    amountMode: rules.payment.amountMode,
    paymentOptions: {
      manual: rules.payment.method !== "online",
      online: rules.payment.method !== "manual" && !!provider,
    },
    paymentAccounts: rules.steps.includes("payment") ? paymentAccountsOf(ctx.config) : [],
    formQuestions: status === "form_pending" || (!m && rules.steps[0] === "form") ? rules.form.questions : [],
    holdExpiresAt: hold,
    window,
    capacity: { maxSlots: current.capacity.maxSlots, slotsTaken: flow?.slotsTaken ?? 0, waitlist: current.capacity.waitlist },
    proof: payment
      ? {
          reference: payment.reference,
          method: payment.method,
          submittedAt: payment.submittedAt?.toISOString() ?? null,
          hasReceipt: !!payment.receiptFilePath,
          rejectReason: payment.rejectReason,
        }
      : null,
    reviewReason: m?.reviewReason ?? "",
    refundStatus: m?.refundStatus ?? "none",
    canJoin: gated && window.open && startOver,
    visibility: (live ? rules : current).pendingVisibility,
  };
}
