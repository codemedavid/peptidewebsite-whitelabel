// The tenant Telegram bot's inbound webhook.
//
// Reachable at /api/webhooks/telegram/<secret>. That path is EXCLUDED from
// middleware (see the matcher in src/middleware.ts), which is deliberate: this
// request comes from Telegram's servers, not a browser on a tenant host, so
// there is no tenant subdomain to resolve, no gate cookie to roll and no admin
// rewrite to apply. The tenant is established by the secret path segment instead.
//
// Two rules govern everything below.
//
// FIRST: ALWAYS ANSWER 200. Telegram redelivers an update until it receives one,
// so a 500 on a poison update becomes an infinite retry loop against production.
// The only non-200 here is the 401 for a failed authenticity check, which is
// correct precisely because we want a forged sender to stop.
//
// SECOND: AUTHORIZATION IS A ROW. Receiving a button press proves only that
// someone can see a chat the bot posts in. It is findConfirmer — a linked
// recipient naming that numeric Telegram user id, carrying canConfirm — that
// decides whether the press moves a real order.

import { NextRequest, NextResponse } from "next/server";

import {
  findTenantByWebhookSecret,
  getEnabledTelegramTarget,
  listRecipients,
  listRecipientRows,
  upsertRecipient,
  removeRecipient,
  consumePairing,
  findOrderByNumber,
  findOrderById,
} from "@/lib/integrations/telegram-store";
import { interpretTelegramUpdate } from "@/lib/integrations/telegram-update";
import { findConfirmer, verifyWebhookSecret } from "@/lib/integrations/telegram-authz";
import { webhookDeduper } from "@/lib/integrations/telegram-dedupe";
import { buildConfirmedText, buildOrderAlert } from "@/lib/integrations/telegram-message";
import { resolveTopicFor, normalizeStatusTopics } from "@/lib/integrations/telegram-topics";
import { buildTrackPrompt } from "@/lib/integrations/telegram-commands";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/integrations/telegram";
import { applyOrderStatusChange } from "@/lib/orders/apply-status";
import { getTenantContext } from "@/lib/tenant/context";
import type { OrderStatus } from "@/storefront/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram's own shared secret, echoed on every update it sends us. */
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** The 200 that tells Telegram "delivered, stop retrying". */
const ack = () => NextResponse.json({ ok: true });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
) {
  try {
    const { secret } = await params;

    // Gate 1 — the secret path segment names the tenant. A miss is indistinguish-
    // able from a wrong secret, on purpose: this endpoint tells an unauthenticated
    // caller nothing about which secrets exist.
    const tenant = await findTenantByWebhookSecret(secret);
    if (!tenant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const creds = await getEnabledTelegramTarget(tenant.tenantId);
    if (!creds) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Gate 2 — Telegram echoes the secret_token registered at setWebhook time.
    // Constant-time, fails closed on a blank expectation.
    if (!verifyWebhookSecret(req.headers.get(SECRET_HEADER), creds.webhookSecret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const update = await req.json().catch(() => null);
    const intent = interpretTelegramUpdate(update);
    if (intent.kind === "ignore") return ack();

    // A redelivered update is acknowledged but not re-run, so a retry can't post
    // a second reply. Correctness against a repeat does NOT depend on this —
    // planStatusChange already makes a second confirm a no-op.
    if (intent.updateId >= 0 && webhookDeduper.seen(intent.updateId)) return ack();

    if (intent.kind === "pair") {
      // Single-use and time-boxed: consumePairing spends the code atomically, so
      // a code shared into a group cannot link a second chat.
      const redeemed = await consumePairing(tenant.tenantId, intent.code);
      if (!redeemed) {
        await sendMessage(creds.botToken, intent.chatId, {
          text: "That code isn't valid any more. Generate a fresh one in your store admin → Telegram Alerts.",
          parse_mode: "HTML",
        });
        return ack();
      }
      await upsertRecipient(tenant.tenantId, {
        chatId: intent.chatId,
        chatType: intent.chatType,
        telegramUserId: intent.telegramUserId,
        label: intent.label,
      });
      const isGroup = intent.chatType !== "private";
      await sendMessage(creds.botToken, intent.chatId, {
        text: isGroup
          ? "✅ Linked. This group will receive new-order alerts <b>without customer details</b> — turn them on in your store admin if everyone here should see buyer names and addresses."
          : "✅ Linked. You'll get an alert here the moment someone orders, and you can confirm orders from the message.",
        parse_mode: "HTML",
      });
      return ack();
    }

    if (intent.kind === "unlink") {
      await removeRecipient(tenant.tenantId, intent.chatId);
      await sendMessage(creds.botToken, intent.chatId, {
        text: "Unlinked. This chat will no longer receive order alerts.",
        parse_mode: "HTML",
      });
      return ack();
    }

    // ── Everything below moves a real order, so authorize first ────────────
    //
    // Authorization is a ROW, not a chat: receiving a button press only proves
    // someone can see a chat the bot posts in. findConfirmer requires a linked
    // recipient naming this Telegram user id and carrying canConfirm.
    const recipients = await listRecipients(tenant.tenantId);
    const actor = findConfirmer(recipients, intent.telegramUserId);
    if (!actor) {
      if (intent.kind !== "track") {
        // Answered, not ignored: an unanswered callback leaves a spinner on the
        // button and looks like the bot is broken.
        await answerCallbackQuery(
          creds.botToken,
          intent.callbackId,
          "You're not authorized to manage orders for this store.",
          true,
        );
      }
      return ack();
    }

    const rows = await listRecipientRows(tenant.tenantId);
    const row = rows.find((r) => r.chatId === intent.chatId);
    const topics = normalizeStatusTopics(row?.statusTopics);
    const { branding } = await getTenantContext(tenant.tenantId);
    const currency = (branding?.config as { currency?: unknown } | null)?.currency;

    /** Apply a status/tracking change and reflect it back into the chat. */
    const applyAndReflect = async (
      orderId: string,
      patch: { status?: OrderStatus; trackingNumber?: string },
      note: string,
    ) => {
      const res = await applyOrderStatusChange(tenant.tenantId, orderId, patch, tenant.slug);
      if (!res.ok) return res.error;

      const rendered = buildOrderAlert(res.order, {
        currency,
        showCustomerDetails: row?.showCustomerDetails ?? false,
      });

      // Retire the message that was pressed, so the old topic stops showing the
      // order as if it were still at that status.
      if (intent.kind !== "track" && intent.messageId) {
        await editMessageText(
          creds.botToken,
          intent.chatId,
          intent.messageId,
          buildConfirmedText(rendered.text, `${actor.label} — ${note}`, new Date().toISOString()),
        );
      }

      // Re-post into the topic that now owns this status. Only when the status
      // actually moved AND that status has a topic of its own — otherwise the
      // edit above is the whole update and a second copy would be noise.
      const thread = resolveTopicFor(res.order.status, topics);
      if (res.statusChanged && thread !== undefined) {
        await sendMessage(creds.botToken, intent.chatId, rendered, thread);
      }
      return null;
    };

    if (intent.kind === "confirm" || intent.kind === "status") {
      const target = intent.kind === "confirm" ? ("confirmed" as const) : intent.status;
      const err = await applyAndReflect(intent.orderId, { status: target }, target);
      await answerCallbackQuery(
        creds.botToken,
        intent.callbackId,
        err ?? `Order moved to ${target}.`,
        !!err,
      );
      return ack();
    }

    if (intent.kind === "track-prompt") {
      const order = await findOrderById(tenant.tenantId, intent.orderId);
      if (!order) {
        await answerCallbackQuery(creds.botToken, intent.callbackId, "Order not found.", true);
        return ack();
      }
      await answerCallbackQuery(creds.botToken, intent.callbackId, "Reply with the number.");
      // force_reply so the admin's next message arrives as a reply we can
      // correlate — no conversation state has to survive between invocations.
      await sendMessage(
        creds.botToken,
        intent.chatId,
        {
          text: buildTrackPrompt(order.orderNumber),
          parse_mode: "HTML",
          reply_markup: { force_reply: true, selective: true },
        },
        intent.threadId,
      );
      return ack();
    }

    // A tracking number, by command or by reply.
    const order = await findOrderByNumber(tenant.tenantId, intent.orderNumber);
    if (!order) {
      await sendMessage(
        creds.botToken,
        intent.chatId,
        { text: `No live order ${intent.orderNumber} in this store.`, parse_mode: "HTML" },
        intent.threadId,
      );
      return ack();
    }
    // Recording a tracking number IS the shipment, so move the order to shipped
    // unless it is already at or past that point — which is what puts the number
    // on the buyer's public Track page.
    const alreadyShipped = order.status === "shipped" || order.status === "delivered";
    const err = await applyAndReflect(
      order.id,
      { trackingNumber: intent.tracking, ...(alreadyShipped ? {} : { status: "shipped" as const }) },
      "tracking added",
    );
    await sendMessage(
      creds.botToken,
      intent.chatId,
      {
        text: err
          ? `Couldn't save that: ${err}`
          : `Tracking <b>${intent.tracking}</b> saved for ${order.orderNumber}. The customer can see it on the Track page.`,
        parse_mode: "HTML",
      },
      intent.threadId,
    );
    return ack();
  } catch (err) {
    // Swallowed on purpose. A thrown error here becomes a non-200, and a non-200
    // makes Telegram redeliver this same update indefinitely.
    console.error("telegram webhook", (err as Error)?.message);
    return ack();
  }
}
