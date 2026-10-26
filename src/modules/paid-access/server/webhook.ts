import "server-only";

// Online payments arrive here, and ONLY here: a provider webhook whose
// signature verifies. Each event is recorded (provider, eventId) in the same
// transaction as its effects, so a re-delivered event is a no-op, and a
// payment can only be confirmed while it is still `initiated` — a second
// event for the same charge changes nothing. Money that arrives after the
// slot or the round closed is never applied: it is marked refund_due and
// handed back to the provider.

import { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { planTransition } from "../core/machine";
import type { PaidAccessStatus } from "../core/types";
import { joinWindow, later, loadRound } from "./context";
import { notifyMember } from "./notify";
import { providerByName, type WebhookEvent } from "./payments";
import {
  locateProviderPayment,
  logEvents,
  membershipById,
  moveMembership,
  movePayment,
  paymentById,
  paymentsOf,
  readSettings,
  recordWebhookEvent,
  webhookSeen,
  type MembershipRow,
  type PaymentRow,
} from "./repo";
import { effectiveStatus } from "./state";

export type WebhookResult = { ok: true; duplicate?: boolean; ignored?: boolean } | { ok: false; status: 401 | 404; message: string };

type Outcome = { notice?: "paid"; refund?: PaymentRow };

const sys = (m: MembershipRow, provider: string) => ({ groupBuyId: m.groupBuyId, membershipId: m.id, actorKind: "webhook", actorId: provider });

async function onPaid(db: TenantTx, tenantId: string, evt: WebhookEvent, p: PaymentRow, m: MembershipRow, joinOpen: boolean, now: Date): Promise<Outcome> {
  if (p.status !== "initiated") return {};
  if (evt.amountCents !== p.amountCents) {
    await movePayment(db, p.id, "initiated", { status: "failed", rejectReason: "Amount did not match" });
    await logEvents(db, tenantId, [{ ...sys(m, p.provider), kind: "payment", reason: `Amount mismatch (${evt.amountCents ?? "none"} ≠ ${p.amountCents})`, data: { paymentId: p.id, event: evt.id } }]);
    return {};
  }
  const status = effectiveStatus(m, now);
  const alreadyPaid = (await paymentsOf(db, m.id)).some((x) => x.status === "confirmed");
  const plan =
    status && joinOpen && !alreadyPaid
      ? planTransition({ from: status, event: "payment_succeeded", actor: { kind: "webhook", id: p.provider }, snapshot: readSettings(m.settingsSnapshot) })
      : null;
  if (plan?.ok && (await movePayment(db, p.id, "initiated", { status: "confirmed", confirmedAt: now, confirmedBy: `provider:${p.provider}` }))) {
    if (!(await moveMembership(db, m.id, status as PaidAccessStatus, { status: plan.to, holdExpiresAt: null }))) throw new Error("PAID_ACCESS_RACE");
    await logEvents(db, tenantId, [{ ...sys(m, p.provider), kind: "payment", fromStatus: status, toStatus: plan.to, data: { paymentId: p.id, event: evt.id } }]);
    return { notice: "paid" };
  }
  // Too late (slot released, round closed) or a second charge: never applied.
  await movePayment(db, p.id, "initiated", { status: "refund_due" });
  await logEvents(db, tenantId, [
    { ...sys(m, p.provider), kind: "payment", reason: alreadyPaid ? "Duplicate charge — refund due" : "Paid after the slot or group buy closed — refund due", data: { paymentId: p.id, event: evt.id } },
  ]);
  return { refund: { ...p, status: "refund_due" } };
}

async function onRefund(db: TenantTx, tenantId: string, evt: WebhookEvent, p: PaymentRow, m: MembershipRow, now: Date): Promise<void> {
  if (evt.type === "refund.succeeded") {
    if (p.status === "confirmed" || p.status === "refund_due") await movePayment(db, p.id, p.status, { status: "refunded" });
    if (m.status === "rejected" && m.refundStatus === "processing") {
      await moveMembership(db, m.id, "rejected", { refundStatus: "refunded", refundReference: evt.refundRef ?? evt.id, refundedAt: now });
      await logEvents(db, tenantId, [{ ...sys(m, p.provider), kind: "refund", fromStatus: "processing", toStatus: "refunded", data: { paymentId: p.id, event: evt.id } }]);
    }
    return;
  }
  if (m.status === "rejected" && m.refundStatus === "processing") {
    await moveMembership(db, m.id, "rejected", { refundStatus: "pending" });
    await logEvents(db, tenantId, [{ ...sys(m, p.provider), kind: "refund", fromStatus: "processing", toStatus: "pending", reason: "The provider couldn't refund — refund manually", data: { event: evt.id } }]);
  }
}

export async function handleWebhook(input: { provider: string; rawBody: string; headers: Headers; now?: Date }): Promise<WebhookResult> {
  const now = input.now ?? new Date();
  const provider = providerByName(input.provider);
  if (!provider) return { ok: false, status: 404, message: "Unknown payment provider." };
  const evt = provider.verifyWebhook(input.rawBody, input.headers);
  if (!evt) return { ok: false, status: 401, message: "Invalid signature." };
  const located = await locateProviderPayment(provider.name, evt.ref);
  if (!located) return { ok: true, ignored: true };
  const { tenantId } = located;

  // The round's join window, read before the transaction (it decides whether
  // a payment may still be applied).
  const preview = await withTenant(tenantId, async (db) => {
    const p = await paymentById(db, located.id);
    return p ? membershipById(db, p.membershipId) : null;
  });
  if (!preview) return { ok: true, ignored: true };
  const ctx = await loadRound(tenantId, preview.groupBuyId);
  const joinOpen = !("ok" in ctx) && joinWindow(ctx.round, readSettings(preview.settingsSnapshot), ctx.caps, now).open;

  let outcome: Outcome & { duplicate?: boolean; membershipId?: string };
  try {
    outcome = await withTenant(tenantId, async (db) => {
      if (await webhookSeen(db, provider.name, evt.id)) return { duplicate: true };
      await recordWebhookEvent(db, provider.name, evt.id);
      const p = await paymentById(db, located.id);
      const m = p ? await membershipById(db, p.membershipId) : null;
      if (!p || !m) return {};
      if (evt.type === "payment.paid") return { ...(await onPaid(db, tenantId, evt, p, m, joinOpen, now)), membershipId: m.id };
      if (evt.type === "payment.failed") {
        await movePayment(db, p.id, "initiated", { status: "failed" });
        return {};
      }
      await onRefund(db, tenantId, evt, p, m, now);
      return {};
    });
  } catch (e) {
    // A racing duplicate delivery lost on the event's unique key: already
    // handled. Any OTHER unique clash (e.g. two charges confirming at once)
    // must not be acknowledged — rethrow so the provider retries, and the retry
    // takes the duplicate-charge → refund_due path.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const seen = await withTenant(tenantId, (db) => webhookSeen(db, provider.name, evt.id)).catch(() => false);
      if (seen) return { ok: true, duplicate: true };
    }
    throw e;
  }
  if (outcome.duplicate) return { ok: true, duplicate: true };
  if (outcome.refund?.providerRef) {
    const r = outcome.refund;
    await provider.refund({ ref: r.providerRef!, amountCents: r.amountCents }).catch(() => undefined);
  }
  if (outcome.notice && outcome.membershipId) {
    const id = outcome.membershipId;
    later(() => notifyMember(tenantId, id, "paid"));
  }
  return { ok: true };
}
