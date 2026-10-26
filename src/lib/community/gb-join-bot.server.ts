import "server-only";

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
import { STORE_KEY, customerKey, dmPair } from "./keys";
import { ORDER_BOT_AUTHOR } from "./order-bot";
import { notifyGroupBuyJoinRequest, notifyGroupBuyJoinUpdate } from "./push.server";

/**
 * Paid group-buy join notifications (lib/storefront/gb-membership.ts):
 *
 *   sendJoinDecision  — the store approved / rejected / refunded / revoked a
 *     request: a bot DM in the ONE store ⇄ customer chat (when the store runs
 *     the app community), a push to the customer, and a `gb_join_decided`
 *     PostHog event the store's workflow can email.
 *   alertJoinRequest  — a customer sent a receipt: a push to the team members
 *     holding `groupbuys`, and `admin_gb_join_request` for the owner's email.
 *
 * Both run after the response and never throw — the decision is already
 * saved. The DM is idempotent on clientId `bot:gbjoin:<id>:<status>`.
 */

const DECIDED = new Set(["approved", "rejected", "refunded", "revoked"]);

/** What the customer is told. Pure; the store's reason is quoted verbatim. */
export function joinDecisionText(input: { status: string; roundName: string; reason: string; refundReference: string }): string {
  const round = input.roundName || "the group buy";
  switch (input.status) {
    case "approved":
      return `You're in! Your payment for ${round} was approved — the group buy is open to you now.`;
    case "rejected":
      return `Your join request for ${round} wasn't approved: ${input.reason}. The store will refund your join fee directly.`;
    case "refunded":
      return `Your join fee for ${round} was refunded${input.refundReference ? ` (reference ${input.refundReference})` : ""}.`;
    case "revoked":
      return `Your access to ${round} was removed: ${input.reason}.`;
    default:
      return "";
  }
}

export function joinDecisionClientId(membershipId: string, status: string): string {
  return `bot:gbjoin:${membershipId}:${status}`;
}

type Loaded = {
  status: string;
  customerId: string | null;
  customerEmail: string;
  customerName: string;
  amountCents: number;
  reviewReason: string;
  refundReference: string;
  method: string;
  groupBuyId: string;
  roundName: string;
};

async function load(tenantId: string, membershipId: string): Promise<Loaded | null> {
  return withTenant(tenantId, async (db) => {
    const m = await db.groupBuyMembership.findFirst({
      where: { id: membershipId },
      select: {
        status: true,
        customerId: true,
        customerEmail: true,
        customerName: true,
        amountCents: true,
        reviewReason: true,
        refundReference: true,
        method: true,
        groupBuyId: true,
        groupBuy: { select: { name: true } },
      },
    });
    if (!m) return null;
    const { groupBuy, ...rest } = m;
    return { ...rest, roundName: groupBuy.name };
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

function logFailure(kind: string, e: unknown) {
  const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
  console.error(`[gb-join-bot] ${kind} failed: ${e instanceof Error ? e.name : "Error"}${code}`);
}

export async function sendJoinDecision(tenantId: string, membershipId: string): Promise<void> {
  try {
    const m = await load(tenantId, membershipId);
    if (!m || !DECIDED.has(m.status)) return;
    const body = joinDecisionText({ status: m.status, roundName: m.roundName, reason: m.reviewReason, refundReference: m.refundReference });
    const ctx = await getTenantContext(tenantId);
    const config = (ctx.branding?.config ?? {}) as Record<string, unknown>;

    if (m.customerId && (await hasFeature(tenantId, FEATURES.MOBILE_COMMUNITY))) {
      const clientId = joinDecisionClientId(membershipId, m.status);
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
        roundName: m.roundName,
        toStatus: m.status,
        amountCents: m.amountCents,
        reason: m.reviewReason,
        refundReference: m.refundReference,
        brand: buildEmailBrand(config, storefrontOrigin(ctx.tenant.slug)),
      }),
    );
  } catch (e) {
    logFailure("decision", e);
  }
}

export async function alertJoinRequest(tenantId: string, membershipId: string): Promise<void> {
  try {
    const m = await load(tenantId, membershipId);
    if (!m || m.status !== "paid_pending_approval") return;
    const ctx = await getTenantContext(tenantId);
    await notifyGroupBuyJoinRequest({ tenantId, storeName: storeDisplayName(ctx), customerName: m.customerName, roundName: m.roundName });
    const config = (ctx.branding?.config ?? {}) as Record<string, unknown>;
    const adminEmail = resolveAdminNotifyEmail(config);
    if (adminEmail) {
      await capturePostHogEvent(
        tenantId,
        buildGroupBuyJoinRequestAdminPayload({
          adminEmail,
          customerName: m.customerName,
          customerEmail: m.customerEmail,
          roundName: m.roundName,
          amountCents: m.amountCents,
          method: m.method,
          brand: buildEmailBrand(config, storefrontOrigin(ctx.tenant.slug)),
        }),
      );
    }
  } catch (e) {
    logFailure("request alert", e);
  }
}
