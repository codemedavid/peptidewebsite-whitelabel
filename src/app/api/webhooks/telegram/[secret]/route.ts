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
} from "@/lib/integrations/telegram-store";
import { interpretTelegramUpdate } from "@/lib/integrations/telegram-update";
import { findConfirmer, verifyWebhookSecret } from "@/lib/integrations/telegram-authz";
import { webhookDeduper } from "@/lib/integrations/telegram-dedupe";
import { buildConfirmedText, buildOrderAlert } from "@/lib/integrations/telegram-message";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/integrations/telegram";
import { applyOrderStatusChange } from "@/lib/orders/apply-status";
import { getTenantContext } from "@/lib/tenant/context";

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

    // ── A Confirm press ─────────────────────────────────────────────────────
    const recipients = await listRecipients(tenant.tenantId);
    const actor = findConfirmer(recipients, intent.telegramUserId);
    if (!actor) {
      // Answered, not ignored: an unanswered callback leaves a spinner on the
      // button and looks like the bot is broken.
      await answerCallbackQuery(
        creds.botToken,
        intent.callbackId,
        "You're not authorized to confirm orders for this store.",
        true,
      );
      return ack();
    }

    const res = await applyOrderStatusChange(
      tenant.tenantId,
      intent.orderId,
      { status: "confirmed" },
      tenant.slug,
    );
    if (!res.ok) {
      await answerCallbackQuery(creds.botToken, intent.callbackId, res.error, true);
      return ack();
    }

    await answerCallbackQuery(
      creds.botToken,
      intent.callbackId,
      res.statusChanged ? "Order confirmed." : "That order was already confirmed.",
    );

    // Re-render the alert in place and retire the button, so the chat records who
    // confirmed rather than silently losing the control. Rebuilt from the stored
    // order (not the chat text) so the edit shows the order as it now IS — and
    // with this recipient's own redaction setting, since the edit lands in their
    // chat.
    const row = (await listRecipientRows(tenant.tenantId)).find(
      (r) => r.chatId === intent.chatId,
    );
    const { branding } = await getTenantContext(tenant.tenantId);
    const currency = (branding?.config as { currency?: unknown } | null)?.currency;
    const rendered = buildOrderAlert(res.order, {
      currency,
      showCustomerDetails: row?.showCustomerDetails ?? false,
    });
    if (intent.messageId) {
      await editMessageText(
        creds.botToken,
        intent.chatId,
        intent.messageId,
        buildConfirmedText(rendered.text, actor.label, new Date().toISOString()),
      );
    }
    return ack();
  } catch (err) {
    // Swallowed on purpose. A thrown error here becomes a non-200, and a non-200
    // makes Telegram redeliver this same update indefinitely.
    console.error("telegram webhook", (err as Error)?.message);
    return ack();
  }
}
