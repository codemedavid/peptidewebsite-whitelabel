import "server-only";

// The customer half of paid group-buy access: start a join request, send the
// receipt, read the state back. Shared by the website's server actions
// (actions/gb-join.ts) and — through them, as the app shopper — the app API
// (/api/mobile/v1/shop/group-buy/*). Kept OUT of the "use server" file on
// purpose: these take a customer argument, and an exported server action that
// accepted one would let any visitor act as any customer.
//
// Rules live in gb-membership.ts (lifecycle, input parsing, status copy) and
// prisma/group-buy-memberships.sql (the same lifecycle, enforced by Postgres).
// The fee is ALWAYS the round's joinFeeCents, copied onto the request here.

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { getTenantContext } from "@/lib/tenant/context";
import { isDemoMode } from "@/lib/demo/fixtures";
import { classifyProofFile } from "@/lib/upload/image-file";
import { isImageKitConfigured, signedPrivateUrl, uploadPrivateTenantFile } from "@/lib/imagekit/server";
import { readPaymentMethods } from "@/lib/mobile/shop-checkout";
import { joinFeeLabel } from "@/lib/mobile/group-buy-share";
import type { GroupBuyJoinResult, GroupBuyJoinState } from "@/lib/mobile/shop-contract";
import { effectiveGroupBuyStatus, type GroupBuy, type GroupBuyCapabilities } from "./group-buy";
import { loadGroupBuys, resolveGroupBuyCaps } from "./group-buy-server";
import { buildGroupBuyTeaser, requiresPaidJoin } from "./gb-access";
import {
  GB_MEMBERSHIP_BLOCKING_STATUSES,
  isGbMembershipStatus,
  membershipStatusView,
  parseReceiptSubmission,
  planMembershipTransition,
} from "./gb-membership";

export type JoinCustomer = { id: string; name: string; email: string };
type Store = { tenantId: string; slug: string };
type Fail = Extract<GroupBuyJoinResult, { ok: false }>;

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_URL_TTL_SECONDS = 10 * 60;
const ROUND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const fail = (code: Fail["code"], message: string): Fail => ({ ok: false, code, message });

const MEMBERSHIP_SELECT = {
  id: true,
  status: true,
  amountCents: true,
  reference: true,
  method: true,
  paidAt: true,
  submittedAt: true,
  receiptFilePath: true,
  reviewReason: true,
  customerEmail: true,
} as const;
type MembershipRow = Prisma.GroupBuyMembershipGetPayload<{ select: typeof MEMBERSHIP_SELECT }>;

/** The round, scoped to the store. Foreign and unknown ids are both not_found. */
async function loadRound(store: Store, roundId: unknown): Promise<{ round: GroupBuy; caps: GroupBuyCapabilities } | Fail> {
  if (typeof roundId !== "string" || !ROUND_ID_RE.test(roundId)) return fail("invalid_input", "Unknown group buy.");
  const caps = await resolveGroupBuyCaps(store.tenantId);
  const round = (await loadGroupBuys(store.tenantId, store.slug)).find((gb) => gb.id === roundId);
  return round ? { round, caps } : fail("not_found", "We couldn't find that group buy.");
}

/** Open for joining: paid join applies AND the round hasn't ended. */
function joinable(round: GroupBuy, caps: GroupBuyCapabilities, now = new Date()): boolean {
  if (!requiresPaidJoin(round, caps)) return false;
  const status = effectiveGroupBuyStatus(round, caps.scheduled, now);
  return status === "active" || status === "scheduled";
}

function latestMembership(store: Store, roundId: string, customerId: string): Promise<MembershipRow | null> {
  if (isDemoMode()) return Promise.resolve(null);
  return withTenant(store.tenantId, (db) =>
    db.groupBuyMembership.findFirst({
      where: { groupBuyId: roundId, customerId },
      orderBy: { createdAt: "desc" },
      select: MEMBERSHIP_SELECT,
    }),
  );
}

/** A latest request that rules out starting another: anything live, a revoke,
 *  and a rejection still waiting on its refund. Only "refunded" frees the slot. */
function blocksNewRequest(m: MembershipRow | null): boolean {
  return !!m && (GB_MEMBERSHIP_BLOCKING_STATUSES.has(m.status as never) || m.status === "rejected");
}

async function buildState(store: Store, round: GroupBuy, caps: GroupBuyCapabilities, m: MembershipRow | null): Promise<GroupBuyJoinState> {
  const config = ((await getTenantContext(store.tenantId)).branding?.config ?? {}) as Record<string, unknown>;
  const currency = typeof config.currency === "string" && config.currency ? config.currency : "₱";
  const status = isGbMembershipStatus(m?.status) ? m!.status : null;
  const view = membershipStatusView(status, m?.reviewReason ?? "");
  return {
    round: buildGroupBuyTeaser(round, caps, m ? { status: m.status, reviewReason: m.reviewReason } : null),
    joinFeeLabel: joinFeeLabel(currency, round.joinFeeCents ?? 0),
    canJoin: joinable(round, caps) && !blocksNewRequest(m),
    paymentMethods: readPaymentMethods(config, false),
    status: { title: view.title, detail: view.detail, tone: view.tone },
    request: m
      ? {
          id: m.id,
          status: m.status,
          amountCents: m.amountCents,
          reference: m.reference,
          method: m.method,
          paidAt: m.paidAt?.toISOString() ?? null,
          submittedAt: m.submittedAt?.toISOString() ?? null,
          hasReceipt: !!m.receiptFilePath,
          reviewReason: m.reviewReason,
        }
      : null,
  };
}

export async function getJoinState(store: Store, customer: JoinCustomer, roundId: unknown): Promise<GroupBuyJoinResult> {
  const loaded = await loadRound(store, roundId);
  if ("ok" in loaded) return loaded;
  const m = await latestMembership(store, loaded.round.id, customer.id);
  return { ok: true, state: await buildState(store, loaded.round, loaded.caps, m) };
}

/**
 * Start (or re-show) the customer's request. Idempotent: a live request is
 * returned as-is, so pressing Join twice never opens a second payment. The DB's
 * one-live-request index backs this up against a double-tap race.
 */
export async function startJoin(store: Store, customer: JoinCustomer, roundId: unknown): Promise<GroupBuyJoinResult> {
  const loaded = await loadRound(store, roundId);
  if ("ok" in loaded) return loaded;
  const { round, caps } = loaded;
  const existing = await latestMembership(store, round.id, customer.id);
  if (existing && existing.status !== "refunded") {
    if (existing.status === "rejected") {
      return fail("conflict", "Your last payment for this group buy is being refunded. You can join again once it's done.");
    }
    return { ok: true, state: await buildState(store, round, caps, existing) };
  }
  if (!joinable(round, caps)) return fail("conflict", "This group buy isn't open for joining.");
  if (isDemoMode()) return fail("conflict", "Joining isn't available in the demo store.");

  try {
    await withTenant(store.tenantId, async (db) => {
      const created = await db.groupBuyMembership.create({
        data: {
          tenantId: store.tenantId,
          groupBuyId: round.id,
          customerId: customer.id,
          customerName: customer.name.slice(0, 120),
          customerEmail: customer.email,
          amountCents: round.joinFeeCents ?? 0,
        },
        select: { id: true },
      });
      await db.groupBuyMembershipEvent.create({
        data: { tenantId: store.tenantId, membershipId: created.id, toStatus: "pending_payment", actorKind: "customer", actorId: customer.id },
      });
    });
  } catch (e) {
    // A double tap raced us to the one-live-request index: show the winner.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return { ok: true, state: await buildState(store, round, caps, await latestMembership(store, round.id, customer.id)) };
}

export type ReceiptUpload = { file: unknown; reference: unknown; method: unknown; paidAt: unknown };

/**
 * Store a receipt where only the uploader and the store's admins can read it.
 * Production refuses rather than fall back to anything public; elsewhere (dev,
 * tests, demo) an unconfigured ImageKit keeps the image inline.
 */
async function storeReceipt(store: Store, bytes: Buffer, name: string, type: string): Promise<{ fileId: string | null; filePath: string }> {
  if (isDemoMode() || !isImageKitConfigured()) {
    if (process.env.NODE_ENV === "production" && !isDemoMode()) throw new Error("RECEIPT_STORAGE_UNAVAILABLE");
    return { fileId: null, filePath: `data:${type || "image/jpeg"};base64,${bytes.toString("base64")}` };
  }
  return uploadPrivateTenantFile({
    tenantId: store.tenantId,
    subfolder: "gb-receipts",
    file: bytes,
    fileName: `gb-receipt-${name || "image"}`.slice(0, 120),
    tags: ["gb-join-receipt"],
  });
}

export async function submitReceipt(store: Store, customer: JoinCustomer, roundId: unknown, input: ReceiptUpload): Promise<GroupBuyJoinResult> {
  const loaded = await loadRound(store, roundId);
  if ("ok" in loaded) return loaded;
  const { round, caps } = loaded;

  const fields = parseReceiptSubmission({ reference: input.reference, method: input.method, paidAt: input.paidAt });
  if (!fields.ok) return fail("invalid_input", fields.error);
  const file = input.file;
  if (!(file instanceof File) || file.size === 0) return fail("invalid_input", "Add a screenshot of your payment.");
  if (file.size > MAX_RECEIPT_BYTES) return fail("invalid_input", "That image is too large (max 10 MB).");
  const verdict = classifyProofFile(file.name || "", file.type || "");
  if (!verdict.ok) return fail("invalid_input", verdict.reason);

  const m = await latestMembership(store, round.id, customer.id);
  if (!m || m.status !== "pending_payment") {
    return fail("conflict", m ? "Your payment for this group buy was already sent." : "Tap Join first, then send your receipt.");
  }
  const plan = planMembershipTransition({
    from: m.status,
    to: "paid_pending_approval",
    actor: { kind: "customer", id: customer.id, email: customer.email },
    membership: { customerId: customer.id, customerEmail: m.customerEmail },
  });
  if (!plan.ok) return fail("conflict", plan.error);

  let stored: { fileId: string | null; filePath: string };
  try {
    stored = await storeReceipt(store, Buffer.from(await file.arrayBuffer()), file.name, file.type);
  } catch (e) {
    console.error(`[gb-join] receipt upload failed for tenant ${store.tenantId}: ${e instanceof Error ? e.message : "error"}`);
    return fail("server_error", "We couldn't save your receipt. Please try again.");
  }

  const moved = await withTenant(store.tenantId, async (db) => {
    // Conditional on the state we read: a concurrent submit can't win twice.
    const res = await db.groupBuyMembership.updateMany({
      where: { id: m.id, status: "pending_payment" },
      data: {
        ...plan.patch,
        reference: fields.value.reference,
        method: fields.value.method,
        paidAt: fields.value.paidAt ?? plan.patch.submittedAt,
        receiptFileId: stored.fileId,
        receiptFilePath: stored.filePath,
      },
    });
    if (res.count === 0) return false;
    await db.groupBuyMembershipEvent.create({
      data: { tenantId: store.tenantId, membershipId: m.id, fromStatus: "pending_payment", toStatus: "paid_pending_approval", actorKind: "customer", actorId: customer.id },
    });
    return true;
  });
  if (!moved) return fail("conflict", "Your payment for this group buy was already sent.");
  return { ok: true, state: await buildState(store, round, caps, await latestMembership(store, round.id, customer.id)) };
}

/** A 10-minute link to the customer's OWN latest receipt on the round. */
export async function receiptUrlFor(
  store: Store,
  customer: JoinCustomer,
  roundId: unknown,
): Promise<{ ok: true; url: string } | Fail> {
  if (typeof roundId !== "string" || !ROUND_ID_RE.test(roundId)) return fail("invalid_input", "Unknown group buy.");
  const m = await latestMembership(store, roundId, customer.id);
  if (!m?.receiptFilePath) return fail("not_found", "No receipt on file for this group buy.");
  return { ok: true, url: privateReceiptUrl(m.receiptFilePath) };
}

/** Signed, short-lived link for a stored receipt path (inline in dev/tests). */
export function privateReceiptUrl(filePath: string): string {
  return filePath.startsWith("data:") ? filePath : signedPrivateUrl(filePath, RECEIPT_URL_TTL_SECONDS);
}
