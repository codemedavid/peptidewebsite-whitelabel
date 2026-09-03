"use server";

// Store-admin server actions for the tenant's Telegram order bot.
//
// OWNER-ONLY, every one of them. The bot token is the bot: whoever holds it can
// read everything the bot receives and post as the store. And the recipient list
// decides who is told about orders and who may confirm them — so a staff member,
// however many module grants they hold, must never be able to add themselves to
// it. requireStoreOwner() is the gate on all six.
//
// The token is write-only across this boundary. Nothing here returns it, and the
// panel reads status through getTelegramStatus, which has no token field at all.

import { randomBytes } from "node:crypto";

import { requireStoreOwner } from "@/lib/auth/staff-guard";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { getTenantSlug } from "@/lib/tenant/headers";
import {
  getTelegramStatus,
  getTelegramCredentials,
  saveTelegramCredentials,
  setTelegramEnabled,
  recordTelegramHealth,
  listRecipientRows,
  removeRecipient,
  setRecipientFlags,
  createPairing,
  type TelegramStatus,
} from "@/lib/integrations/telegram-store";
import { generatePairingCode } from "@/lib/integrations/telegram-pairing";
import { getMe, setWebhook, deleteWebhook } from "@/lib/integrations/telegram";

const NO_ACCESS = "Only the store owner can manage Telegram alerts.";
const NOT_ENTITLED = "Telegram alerts aren't enabled for this store.";

export type TelegramActionResult = { ok: true } | { error: string };

/** A recipient as the owner's list renders it — no secrets, ever. */
export interface RecipientView {
  chatId: string;
  label: string;
  chatType: string;
  canConfirm: boolean;
  showCustomerDetails: boolean;
  linkedAt: string;
}

export interface TelegramPanelState {
  status: TelegramStatus | null;
  recipients: RecipientView[];
}

/** Owner + entitlement, the pair every action below needs. Returns the tenantId. */
async function requireTelegramOwner(): Promise<{ tenantId: string } | { error: string }> {
  const tenantId = await requireStoreOwner();
  if (!tenantId) return { error: NO_ACCESS };
  if (!(await hasFeature(tenantId, FEATURES.NOTIFY_TELEGRAM))) return { error: NOT_ENTITLED };
  return { tenantId };
}

/**
 * The absolute URL Telegram should post updates to.
 *
 * Pinned to the PLATFORM host rather than the tenant's storefront subdomain: a
 * tenant can move to a custom domain, and a webhook registered against a host
 * they later stop using would go quietly dead. The secret path segment carries
 * the tenant identity, so one host serves every tenant's bot.
 */
function webhookUrl(secret: string): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
  const base = process.env.NEXT_PUBLIC_ADMIN_HOST || (root ? `app.${root}` : "");
  return `https://${base}/api/webhooks/telegram/${secret}`;
}

/** Everything the panel renders in one round trip. */
export async function loadTelegramPanelAction(): Promise<TelegramPanelState | { error: string }> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const [status, rows] = await Promise.all([
    getTelegramStatus(gate.tenantId),
    listRecipientRows(gate.tenantId),
  ]);
  return {
    status,
    recipients: rows.map((r) => ({
      chatId: r.chatId,
      label: r.label,
      chatType: r.chatType,
      canConfirm: r.canConfirm,
      showCustomerDetails: r.showCustomerDetails,
      linkedAt: r.linkedAt.toISOString(),
    })),
  };
}

/**
 * Store a bot token from @BotFather, verify it, and register the webhook.
 *
 * The token is validated against Telegram BEFORE it is stored: a typo'd token
 * saved as "configured" would leave the owner staring at a connected-looking
 * panel that never delivers. Saving does NOT switch the integration on — the
 * owner does that once they've linked a chat.
 */
export async function saveTelegramTokenAction(input: unknown): Promise<TelegramActionResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;

  const botToken = typeof input === "string" ? input.trim() : "";
  // BotFather tokens are "<digits>:<35-ish url-safe chars>". Checked here only to
  // fail fast with a clear message; getMe is the real verification.
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    return { error: "That doesn't look like a bot token. Copy the whole line BotFather sent you." };
  }

  const identity = await getMe(botToken);
  if (!identity.ok) return { error: `Telegram rejected that token: ${identity.error}` };

  // Reuse the established secret when there is one (saveTelegramCredentials keeps
  // it) so re-pasting a token doesn't orphan the URL Telegram already posts to.
  const existing = await getTelegramCredentials(gate.tenantId);
  const secret = existing?.webhookSecret || randomBytes(32).toString("hex");

  await saveTelegramCredentials(gate.tenantId, {
    botToken,
    webhookSecret: secret,
    botUsername: identity.result.username ?? "",
  });

  const hooked = await setWebhook(botToken, webhookUrl(secret), secret);
  await recordTelegramHealth(gate.tenantId, hooked.ok);
  if (!hooked.ok) return { error: `Connected, but Telegram refused the webhook: ${hooked.error}` };

  return { ok: true };
}

/** Switch order alerts on or off without discarding the token or the recipients. */
export async function setTelegramEnabledAction(enabled: unknown): Promise<TelegramActionResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  await setTelegramEnabled(gate.tenantId, enabled === true);
  return { ok: true };
}

/** Disconnect the bot: stop Telegram posting to us, then forget the token. */
export async function disconnectTelegramAction(): Promise<TelegramActionResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const creds = await getTelegramCredentials(gate.tenantId);
  // Best-effort: if Telegram is unreachable we still switch the integration off,
  // so the owner is never stuck "connected" to a bot they want gone.
  if (creds) await deleteWebhook(creds.botToken);
  await setTelegramEnabled(gate.tenantId, false);
  return { ok: true };
}

export type PairingCodeResult = { ok: true; code: string; expiresAt: string } | { error: string };

/**
 * Mint a one-time code the owner sends to the bot as "/start <code>" to link a
 * chat. This — not a chat-id field — is how a recipient is created, because a
 * chat id typed into a form proves nothing about who owns the chat.
 */
export async function createTelegramPairingAction(): Promise<PairingCodeResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const creds = await getTelegramCredentials(gate.tenantId);
  if (!creds) return { error: "Connect your bot first." };
  const code = generatePairingCode();
  const expiresAt = await createPairing(gate.tenantId, code);
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

export async function unlinkTelegramRecipientAction(chatId: unknown): Promise<TelegramActionResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const id = typeof chatId === "string" ? chatId.trim().slice(0, 64) : "";
  if (!id) return { error: "Missing chat." };
  await removeRecipient(gate.tenantId, id);
  return { ok: true };
}

/** Per-recipient switches: may they confirm, and do they see the buyer's details. */
export async function setTelegramRecipientFlagsAction(
  chatId: unknown,
  flags: unknown,
): Promise<TelegramActionResult> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const id = typeof chatId === "string" ? chatId.trim().slice(0, 64) : "";
  if (!id) return { error: "Missing chat." };
  const f = (flags ?? {}) as Record<string, unknown>;
  await setRecipientFlags(gate.tenantId, id, {
    ...(typeof f.canConfirm === "boolean" ? { canConfirm: f.canConfirm } : {}),
    ...(typeof f.showCustomerDetails === "boolean"
      ? { showCustomerDetails: f.showCustomerDetails }
      : {}),
  });
  return { ok: true };
}

/** Ask Telegram who this token belongs to — the panel's "Test connection". */
export async function testTelegramConnectionAction(): Promise<
  { ok: true; botUsername: string } | { error: string }
> {
  const gate = await requireTelegramOwner();
  if ("error" in gate) return gate;
  const creds = await getTelegramCredentials(gate.tenantId);
  if (!creds) return { error: "No bot connected yet." };
  const identity = await getMe(creds.botToken);
  await recordTelegramHealth(gate.tenantId, identity.ok);
  if (!identity.ok) return { error: identity.error };
  // Touch the slug so this action participates in the same request-scoped tenant
  // resolution the rest of the admin uses (and so a host mismatch surfaces here).
  await getTenantSlug();
  return { ok: true, botUsername: identity.result.username ?? "" };
}
