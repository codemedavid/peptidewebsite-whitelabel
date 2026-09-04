// The store's "you received an order" push to Telegram.
//
// The chat sibling of analytics/admin-notify.ts, and it keeps that module's
// contract exactly: TOTAL and SILENT. Checkout calls this inside next/server
// after(), once the buyer already has their response, so a missing entitlement,
// a disabled integration, a revoked bot token, a blocked bot or any other error
// must never surface — the order is placed either way.
//
// Three gates compose, all of which must hold:
//   1. the platform entitlement (NOTIFY_TELEGRAM),
//   2. the tenant's integration row being present AND enabled,
//   3. at least one chat having completed the pairing handshake.

import { isDemoMode } from "@/lib/demo/fixtures";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getEnabledTelegramTarget, listRecipientRows } from "@/lib/integrations/telegram-store";
import { buildOrderAlert } from "@/lib/integrations/telegram-message";
import { sendMessage } from "@/lib/integrations/telegram";
import { resolveTopicFor, normalizeStatusTopics } from "@/lib/integrations/telegram-topics";
import type { Order } from "@/storefront/types";

/**
 * Push a new-order alert to every chat this tenant has linked. Never throws.
 *
 * @param currency the tenant's currency, so the chat total is printed the same
 *   way every other surface prints it.
 */
export async function sendTelegramOrderAlert(
  tenantId: string,
  order: Order,
  currency: unknown,
): Promise<void> {
  try {
    if (isDemoMode()) return; // demo tenants have no DB and no bot
    if (!(await hasFeature(tenantId, FEATURES.NOTIFY_TELEGRAM))) return;

    const creds = await getEnabledTelegramTarget(tenantId);
    if (!creds) return; // not configured, switched off, or key unreadable

    const recipients = await listRecipientRows(tenantId);
    if (recipients.length === 0) return; // nobody has linked a chat yet

    // Composed per recipient, not once: a group gets the redacted alert and a
    // private chat gets the full one, and that decision is per row.
    await Promise.all(
      recipients.map((r) =>
        sendMessage(
          creds.botToken,
          r.chatId,
          buildOrderAlert(order, {
            currency,
            showCustomerDetails: r.showCustomerDetails,
          }),
          // A forum supergroup files each status in its own topic. Undefined
          // (no topic configured for this status) posts to the chat itself
          // rather than guessing another status' column.
          resolveTopicFor(order.status, normalizeStatusTopics(r.statusTopics)),
        ),
      ),
    );
  } catch {
    /* best-effort — an alert failure must never surface to checkout */
  }
}
