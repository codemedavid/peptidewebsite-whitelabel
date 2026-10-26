import "server-only";

// Notifications — each gated by the member's SNAPSHOT toggles (notify.paid /
// approved / rejected / newPending). They run after the response and never
// throw: the decision is already saved. Channels are the store's existing
// ones: a bot DM in the store ⇄ customer chat (when the store runs the app
// community), a push, and a PostHog event the store's workflow can email.

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { getTenantContext } from "@/lib/tenant/context";
import { storefrontOrigin } from "@/lib/tenant/resolve";
import { capturePostHogEvent } from "@/lib/analytics/capture";
import {
  buildEmailBrand,
  buildGroupBuyJoinDecisionPayload,
  buildGroupBuyJoinRequestAdminPayload,
  resolveAdminNotifyEmail,
} from "@/lib/analytics/events";
import { STORE_KEY, customerKey, dmPair } from "@/lib/community/keys";
import { ORDER_BOT_AUTHOR } from "@/lib/community/order-bot";
import { notifyGroupBuyJoinRequest, notifyGroupBuyJoinUpdate } from "@/lib/community/push.server";
import { currencyOf, money } from "./context";
import { membershipById, readSettings } from "./repo";

export type MemberNotice = "paid" | "proof_rejected" | "approved" | "promoted" | "rejected" | "refunded" | "revoked";

const TOGGLE: Readonly<Record<MemberNotice, "paid" | "approved" | "rejected">> = {
  paid: "paid",
  proof_rejected: "rejected",
  approved: "approved",
  promoted: "approved",
  rejected: "rejected",
  refunded: "rejected",
  revoked: "rejected",
};

/** What the member is told. Pure; the store's reason is quoted verbatim. */
export function memberNoticeText(input: {
  notice: MemberNotice;
  status: string;
  roundName: string;
  reason: string;
  refundStatus: string;
  refundReference: string;
  amountLabel: string;
}): string {
  const round = input.roundName || "the group buy";
  const next =
    input.status === "active"
      ? "You're in — the group buy is open to you now."
      : input.status === "payment_pending"
        ? `Pay ${input.amountLabel} to get in.`
        : input.status === "approval_pending"
          ? "The store will review your request next."
          : "";
  switch (input.notice) {
    case "paid":
      return `Your payment for ${round} is confirmed. ${next}`.trim();
    case "proof_rejected":
      return `Your proof of payment for ${round} wasn't accepted: ${input.reason}. Please send it again.`;
    case "approved":
      return input.status === "active" ? `You're in! ${round} is open to you now.` : `You're approved for ${round}! ${next}`.trim();
    case "promoted":
      return `A slot opened in ${round} — you're off the waitlist. ${next}`.trim();
    case "rejected": {
      const refund =
        input.refundStatus === "pending"
          ? " The store will refund your payment."
          : input.refundStatus === "processing"
            ? " Your refund is on its way."
            : "";
      return `Your request to join ${round} wasn't approved: ${input.reason}.${refund}`;
    }
    case "refunded":
      return `Your payment for ${round} was refunded${input.refundReference ? ` (reference ${input.refundReference})` : ""}.`;
    case "revoked":
      return `Your access to ${round} was removed: ${input.reason}.`;
  }
}

function logFailure(kind: string, e: unknown) {
  const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
  console.error(`[paid access] ${kind} notification failed: ${e instanceof Error ? e.name : "Error"}${code}`);
}

async function load(tenantId: string, membershipId: string) {
  return withTenant(tenantId, async (db) => {
    const m = await membershipById(db, membershipId);
    if (!m) return null;
    const round = await db.groupBuy.findFirst({ where: { id: m.groupBuyId }, select: { name: true } });
    return { m, roundName: round?.name ?? "" };
  });
}

async function postDm(tenantId: string, customerId: string, clientId: string, body: string): Promise<string | null> {
  return withTenant(tenantId, async (db) => {
    const pair = dmPair(STORE_KEY, customerKey(customerId))!;
    const conversation =
      (await db.communityConversation.findFirst({ where: pair, select: { id: true } })) ??
      (await db.communityConversation.create({ data: { ...pair, tenantId }, select: { id: true } }));
    if (await db.communityMessage.findFirst({ where: { senderKey: STORE_KEY, clientId }, select: { id: true } })) return null;
    const now = new Date();
    await db.communityMessage.create({
      data: { tenantId, conversationId: conversation.id, senderKey: STORE_KEY, authorKey: ORDER_BOT_AUTHOR, kind: "text", body, clientId, createdAt: now },
    });
    await db.communityConversation.updateMany({ where: { id: conversation.id }, data: { lastMessageAt: now, messageCount: { increment: 1 } } });
    return conversation.id;
  });
}

/** Tell the member about a decision on their membership. */
export async function notifyMember(tenantId: string, membershipId: string, notice: MemberNotice): Promise<void> {
  try {
    const loaded = await load(tenantId, membershipId);
    if (!loaded) return;
    const { m, roundName } = loaded;
    const snapshot = readSettings(m.settingsSnapshot);
    if (!snapshot.notify[TOGGLE[notice]]) return;
    const ctx = await getTenantContext(tenantId);
    const config = (ctx.branding?.config ?? {}) as Record<string, unknown>;
    const body = memberNoticeText({
      notice,
      status: m.status,
      roundName,
      reason: m.reviewReason,
      refundStatus: m.refundStatus,
      refundReference: m.refundReference,
      amountLabel: money(currencyOf(config), snapshot.payment.amountCents),
    });

    if (m.customerId && (await hasFeature(tenantId, FEATURES.MOBILE_COMMUNITY))) {
      const clientId = `bot:paid-access:${membershipId}:${notice}:${m.status}`;
      let conversationId: string | null;
      try {
        conversationId = await postDm(tenantId, m.customerId, clientId, body);
      } catch (e) {
        // A race on the conversation pair or the clientId: one retry reads the winner.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        conversationId = await postDm(tenantId, m.customerId, clientId, body);
      }
      if (conversationId) {
        await notifyGroupBuyJoinUpdate({ tenantId, customerId: m.customerId, conversationId, roundId: m.groupBuyId, body, storeName: storeDisplayName(ctx) });
      }
    }

    await capturePostHogEvent(
      tenantId,
      buildGroupBuyJoinDecisionPayload({
        customerEmail: m.customerEmail,
        customerName: m.customerName,
        roundName,
        toStatus: notice,
        amountCents: snapshot.payment.amountCents,
        reason: m.reviewReason,
        refundReference: m.refundReference,
        brand: buildEmailBrand(config, storefrontOrigin(ctx.tenant.slug)),
      }),
    );
  } catch (e) {
    logFailure(notice, e);
  }
}

/** Tell the store team something is waiting for them (a proof to check, an approval). */
export async function notifyAdminsPending(tenantId: string, membershipId: string, what: "proof" | "approval"): Promise<void> {
  try {
    const loaded = await load(tenantId, membershipId);
    if (!loaded) return;
    const { m, roundName } = loaded;
    const snapshot = readSettings(m.settingsSnapshot);
    if (!snapshot.notify.newPending) return;
    const ctx = await getTenantContext(tenantId);
    const who = m.customerName.split(/\s+/)[0] || "A customer";
    await notifyGroupBuyJoinRequest({
      tenantId,
      storeName: storeDisplayName(ctx),
      customerName: m.customerName,
      roundName,
      body: what === "proof" ? `💳 ${who} sent a payment for ${roundName}. Tap to check it.` : `🙋 ${who} is waiting for approval to join ${roundName}.`,
    });
    const config = (ctx.branding?.config ?? {}) as Record<string, unknown>;
    const adminEmail = resolveAdminNotifyEmail(config);
    if (adminEmail) {
      await capturePostHogEvent(
        tenantId,
        buildGroupBuyJoinRequestAdminPayload({
          adminEmail,
          customerName: m.customerName,
          customerEmail: m.customerEmail,
          roundName,
          amountCents: what === "proof" ? snapshot.payment.amountCents : 0,
          method: what === "proof" ? "proof" : "approval",
          brand: buildEmailBrand(config, storefrontOrigin(ctx.tenant.slug)),
        }),
      );
    }
  } catch (e) {
    logFailure(`admin ${what}`, e);
  }
}
