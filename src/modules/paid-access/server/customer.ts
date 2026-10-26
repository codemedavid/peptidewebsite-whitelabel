import "server-only";

// The member's half: start joining, complete a step (form / payment), leave.
// Called by the module's actions with the SESSION's customer — these take a
// customer argument, so they must never be exported as server actions.

import { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import { firstStatus, planTransition } from "../core/machine";
import { parseFormAnswers, parseProofSubmission } from "../core/input";
import { requiresJoin } from "../core/settings";
import { fail, joinWindow, later, loadRound, NOT_READY_MESSAGE, type Customer, type Fail, type RoundContext } from "./context";
import { notifyAdminsPending, notifyMember } from "./notify";
import { checkReceiptFile, onlineProvider, receiptUrl, storeReceipt } from "./payments";
import {
  createMembership,
  createPayment,
  findFlow,
  latestMembership,
  lockFlow,
  logEvents,
  moveMembership,
  paymentsOf,
  readSettings,
  type FlowRow,
  type MembershipRow,
} from "./repo";
import { flowReady } from "./settings";
import { holdFor, holdLapsed, settleSlots } from "./slots";
import { buildJoinState, effectiveStatus, mayStartOver, type JoinState } from "./state";

export type JoinResult = { ok: true; state: JoinState; checkout?: { url: string; ref: string } } | Fail;

type Base = { tenantId: string; groupBuyId: unknown; customer: Customer; now?: Date };

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const isFull = (e: unknown) => e instanceof Error && e.message.includes("PAID_ACCESS_FULL");

async function stateFor(ctx: RoundContext, tenantId: string, customerId: string, now: Date): Promise<JoinState> {
  return withTenant(tenantId, async (db) => {
    const flow = await findFlow(db, ctx.round.id);
    const m = await latestMembership(db, ctx.round.id, customerId);
    const proof = m ? ((await paymentsOf(db, m.id)).find((p) => p.provider === "manual") ?? null) : null;
    return buildJoinState({ ctx, flow, membership: m, payment: proof, now });
  });
}

const notifyPromoted = (tenantId: string, ids: string[]) => {
  for (const id of ids) later(() => notifyMember(tenantId, id, "promoted"));
};

export async function getJoinState(input: Base): Promise<JoinResult> {
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, input.now ?? new Date()) };
}

/**
 * What a newcomer would see — the round's current rules and the first step,
 * with no membership. For a visitor who hasn't said who they are yet (the
 * website's email-only join page); it starts nothing and reads no customer.
 */
export async function previewJoinState(input: { tenantId: string; groupBuyId: unknown; now?: Date }): Promise<JoinResult> {
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  const now = input.now ?? new Date();
  const flow = await withTenant(input.tenantId, (db) => findFlow(db, ctx.round.id));
  return { ok: true, state: buildJoinState({ ctx, flow, membership: null, payment: null, now }) };
}

type JoinOutcome =
  | { kind: "open" | "existing" }
  | { kind: "created"; id: string; status: string; promoted: string[] }
  | { kind: "full" }
  | Fail;

async function joinTx(db: TenantTx, ctx: RoundContext, input: Base & { now: Date }): Promise<JoinOutcome> {
  const { tenantId, customer, now } = input;
  const flow = await findFlow(db, ctx.round.id);
  // Not set up yet (or settings no longer valid): members only, nobody may start joining.
  if (!flow) return fail("closed", NOT_READY_MESSAGE);
  if (!requiresJoin(flow.settings)) return { kind: "open" };
  if (!flowReady(flow.settings)) return fail("closed", NOT_READY_MESSAGE);
  const window = joinWindow(ctx.round, flow.settings, ctx.caps, now);
  if (!window.open) return fail("closed", window.message);

  // Waitlisters and lapsed holds are settled before anyone new takes a slot.
  const { promoted } = await settleSlots(db, tenantId, ctx.round.id, flow.id, now);
  const existing = await latestMembership(db, ctx.round.id, customer.id);
  if (existing && !mayStartOver(existing, now)) {
    if (existing.status === "revoked") return fail("forbidden", "You were removed from this group buy. Contact the store if you think this is a mistake.");
    if (existing.status === "rejected") {
      return fail("conflict", "Your last payment for this group buy is being refunded. You can join again once it's done.");
    }
    return { kind: "existing" };
  }

  const { slotsTaken, maxSlots } = await lockFlow(db, flow.id);
  const hasRoom = maxSlots === null || slotsTaken < maxSlots;
  if (!hasRoom && !flow.settings.capacity.waitlist) return { kind: "full" };
  const status = hasRoom ? firstStatus(flow.settings.steps) : "waitlisted";
  const created = await createMembership(db, {
    tenantId,
    flowId: flow.id,
    groupBuyId: ctx.round.id,
    customer,
    status,
    snapshot: flow.settings,
    version: flow.version,
    holdExpiresAt: holdFor(flow.settings, status, now),
  });
  await logEvents(db, tenantId, [
    { groupBuyId: ctx.round.id, membershipId: created.id, kind: "transition", fromStatus: null, toStatus: status, actorKind: "customer", actorId: customer.id, data: { settingsVersion: flow.version } },
  ]);
  return { kind: "created", id: created.id, status, promoted };
}

/**
 * Start (or re-show) the customer's way in. Idempotent: a live membership is
 * returned as-is, so pressing Join twice never opens a second one; the DB's
 * one-live-membership index backs that up against a double-tap race.
 */
export async function startJoin(input: Base): Promise<JoinResult> {
  const now = input.now ?? new Date();
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  if (!ctx.enabled) return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, now) };

  let outcome: JoinOutcome;
  try {
    outcome = await withTenant(input.tenantId, (db) => joinTx(db, ctx, { ...input, now }));
  } catch (e) {
    if (isUniqueViolation(e)) outcome = { kind: "existing" };
    else if (isFull(e)) outcome = { kind: "full" };
    else throw e;
  }
  if ("ok" in outcome) return outcome;
  if (outcome.kind === "full") return fail("full", "This group buy is full.");
  if (outcome.kind === "created") {
    notifyPromoted(input.tenantId, outcome.promoted);
    if (outcome.status === "approval_pending") later(() => notifyAdminsPending(input.tenantId, outcome.id, "approval"));
  }
  return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, now) };
}

type Member = { ctx: RoundContext; flow: FlowRow | null; m: MembershipRow };

/** The customer's current membership on the round, read fresh. */
async function member(input: Base, now: Date): Promise<Member | Fail> {
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  if (!ctx.enabled) return fail("unavailable", "Joining isn't available for this store.");
  const found = await withTenant(input.tenantId, async (db) => ({
    flow: await findFlow(db, ctx.round.id),
    m: await latestMembership(db, ctx.round.id, input.customer.id),
  }));
  if (!found.m) return fail("conflict", "Tap Join first.");
  if (holdLapsed(found.m, now)) {
    return fail("closed", "Your slot was released because the payment window passed. Join again if there's still room.");
  }
  return { ctx, flow: found.flow, m: found.m };
}

export type StepInput = Base & {
  step: "form" | "payment";
  data: unknown;
};

export async function submitStep(input: StepInput): Promise<JoinResult> {
  const now = input.now ?? new Date();
  const loaded = await member(input, now);
  if ("ok" in loaded) return loaded;
  const { ctx, m } = loaded;
  const snapshot = readSettings(m.settingsSnapshot);
  const window = joinWindow(ctx.round, snapshot, ctx.caps, now);
  const actor = { kind: "customer" as const, id: input.customer.id };
  const from = effectiveStatus(m, now);
  if (!from) return fail("conflict", "Tap Join first.");

  if (input.step === "form") {
    const plan = planTransition({ from, event: "submit_form", actor, snapshot });
    if (!plan.ok) return fail("conflict", plan.error);
    if (!window.open) return fail("closed", window.message);
    const answers = parseFormAnswers(snapshot.form.questions, input.data);
    if (!answers.ok) return fail("invalid_input", answers.error);
    const moved = await withTenant(input.tenantId, async (db) => {
      const ok = await moveMembership(db, m.id, "form_pending", { status: plan.to, formAnswers: answers.value, holdExpiresAt: holdFor(snapshot, plan.to, now) });
      if (ok) {
        await logEvents(db, input.tenantId, [
          { groupBuyId: m.groupBuyId, membershipId: m.id, kind: "transition", fromStatus: "form_pending", toStatus: plan.to, actorKind: "customer", actorId: actor.id },
        ]);
      }
      return ok;
    });
    if (!moved) return fail("conflict", "Your application was already sent.");
    if (plan.to === "approval_pending") later(() => notifyAdminsPending(input.tenantId, m.id, "approval"));
    return { ok: true, state: await stateFor(ctx, input.tenantId, actor.id, now) };
  }

  const data = (input.data && typeof input.data === "object" ? input.data : {}) as Record<string, unknown>;
  return data.kind === "online" ? startOnline(input, loaded, now) : submitProof(input, loaded, data, now);
}

async function submitProof(input: Base, { ctx, m }: Member, data: Record<string, unknown>, now: Date): Promise<JoinResult> {
  const snapshot = readSettings(m.settingsSnapshot);
  const plan = planTransition({ from: m.status as never, event: "submit_proof", actor: { kind: "customer", id: input.customer.id }, snapshot });
  if (!plan.ok) return fail("conflict", plan.error);
  const window = joinWindow(ctx.round, snapshot, ctx.caps, now);
  if (!window.open) return fail("closed", `${window.message} Payments are no longer accepted.`);
  if (snapshot.payment.method === "online") return fail("invalid_input", "This group buy takes online payments only.");
  const fields = parseProofSubmission(data, now);
  if (!fields.ok) return fail("invalid_input", fields.error);
  const file = checkReceiptFile(data.file);
  if (!file.ok) return fail("invalid_input", file.error);

  let stored: { fileId: string | null; filePath: string };
  try {
    stored = await storeReceipt(input.tenantId, file.file);
  } catch (e) {
    console.error(`[paid access] receipt upload failed for tenant ${input.tenantId}: ${e instanceof Error ? e.message : "error"}`);
    return fail("server_error", "We couldn't save your proof of payment. Please try again.");
  }

  try {
    await withTenant(input.tenantId, async (db) => {
      await createPayment(db, {
        tenantId: input.tenantId,
        membershipId: m.id,
        provider: "manual",
        providerRef: null,
        amountCents: snapshot.payment.amountCents,
        kind: snapshot.payment.amountMode,
        status: "submitted",
        reference: fields.value.reference,
        method: fields.value.method,
        receiptFileId: stored.fileId,
        receiptFilePath: stored.filePath,
        paidAt: fields.value.paidAt ?? now,
        submittedAt: now,
      });
      // Conditional on the status we read: a double click can't move it twice.
      if (!(await moveMembership(db, m.id, "payment_pending", { status: "payment_review", holdExpiresAt: null }))) {
        throw new Error("PAID_ACCESS_ALREADY_SENT");
      }
      await logEvents(db, input.tenantId, [
        { groupBuyId: m.groupBuyId, membershipId: m.id, kind: "payment", fromStatus: "payment_pending", toStatus: "payment_review", actorKind: "customer", actorId: input.customer.id, data: { reference: fields.value.reference } },
      ]);
    });
  } catch (e) {
    if (isUniqueViolation(e) || (e instanceof Error && e.message === "PAID_ACCESS_ALREADY_SENT")) {
      return fail("conflict", "Your payment for this group buy was already sent.");
    }
    throw e;
  }
  later(() => notifyAdminsPending(input.tenantId, m.id, "proof"));
  return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, now) };
}

async function startOnline(input: Base, { ctx, m }: Member, now: Date): Promise<JoinResult> {
  const snapshot = readSettings(m.settingsSnapshot);
  const plan = planTransition({ from: m.status as never, event: "submit_proof", actor: { kind: "customer", id: input.customer.id }, snapshot });
  if (!plan.ok) return fail("conflict", plan.error);
  const window = joinWindow(ctx.round, snapshot, ctx.caps, now);
  if (!window.open) return fail("closed", `${window.message} Payments are no longer accepted.`);
  const provider = onlineProvider();
  if (snapshot.payment.method === "manual" || !provider) return fail("invalid_input", "Online payment isn't available for this group buy.");

  const checkout = await provider.createCheckout({
    amountCents: snapshot.payment.amountCents,
    currency: "PHP",
    description: `Join ${ctx.round.name}`.slice(0, 120),
    membershipId: m.id,
  });
  await withTenant(input.tenantId, async (db) => {
    await createPayment(db, {
      tenantId: input.tenantId,
      membershipId: m.id,
      provider: provider.name,
      providerRef: checkout.ref,
      amountCents: snapshot.payment.amountCents,
      kind: snapshot.payment.amountMode,
      status: "initiated",
    });
    await logEvents(db, input.tenantId, [
      { groupBuyId: m.groupBuyId, membershipId: m.id, kind: "payment", fromStatus: m.status, toStatus: m.status, actorKind: "customer", actorId: input.customer.id, data: { checkout: checkout.ref, provider: provider.name } },
    ]);
  });
  return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, now), checkout };
}

/** Leave before paying (the machine refuses once money is in). */
export async function cancelJoin(input: Base): Promise<JoinResult> {
  const now = input.now ?? new Date();
  const loaded = await member(input, now);
  if ("ok" in loaded) return loaded;
  const { ctx, m } = loaded;
  const plan = planTransition({ from: m.status as never, event: "cancel", actor: { kind: "customer", id: input.customer.id }, snapshot: readSettings(m.settingsSnapshot) });
  if (!plan.ok) return fail("conflict", plan.error);
  const promoted = await withTenant(input.tenantId, async (db) => {
    await lockFlow(db, m.flowId);
    if (!(await moveMembership(db, m.id, m.status as never, { status: "cancelled", holdExpiresAt: null }))) return null;
    await logEvents(db, input.tenantId, [
      { groupBuyId: m.groupBuyId, membershipId: m.id, kind: "transition", fromStatus: m.status, toStatus: "cancelled", actorKind: "customer", actorId: input.customer.id },
    ]);
    return (await settleSlots(db, input.tenantId, m.groupBuyId, m.flowId, now)).promoted;
  });
  if (!promoted) return fail("conflict", "That changed just now — please refresh.");
  notifyPromoted(input.tenantId, promoted);
  return { ok: true, state: await stateFor(ctx, input.tenantId, input.customer.id, now) };
}

/** A 10-minute link to the customer's OWN latest proof on the round. */
export async function customerReceiptUrl(input: Base): Promise<{ ok: true; url: string } | Fail> {
  const ctx = await loadRound(input.tenantId, input.groupBuyId);
  if ("ok" in ctx) return ctx;
  const path = await withTenant(input.tenantId, async (db) => {
    const m = await latestMembership(db, ctx.round.id, input.customer.id);
    if (!m) return null;
    return (await paymentsOf(db, m.id)).find((p) => p.receiptFilePath)?.receiptFilePath ?? null;
  });
  return path ? { ok: true, url: receiptUrl(path) } : fail("not_found", "No proof of payment on file for this group buy.");
}
