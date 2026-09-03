"use server";

// Super-admin actions for a tenant's Telegram order bot.
//
// This is OPERATOR infrastructure, not a store-owner setting, and it is scoped
// that way deliberately. The bot token can read every message the bot receives
// and post as the store; registering a webhook points a third party at this
// deployment; and a wrong token silently stops a tenant's alerts with no visible
// failure. So it sits beside the tenant's other third-party credentials in the
// platform admin, guarded by a platform session — exactly like
// admin-integrations.ts, whose shape this file follows.
//
// Every action is addressed by tenant SLUG: the operator acts ON a tenant, never
// AS one. The token is write-only across this boundary — nothing here returns
// it, and the panel reads status through getTelegramStatus, which has no token
// field at all.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
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

export type TelegramActionResult = { ok: true } | { error: string };

const SLUG_RE = /^[a-z0-9-]{2,}$/;

/** Common guard: valid slug, live DB, platform session, resolved tenant id.
 *  Mirrors admin-integrations.ts so both credential screens fail identically. */
async function guard(slug: string): Promise<{ tenantId: string } | { error: string }> {
  if (!SLUG_RE.test(slug)) return { error: "Invalid tenant slug." };
  if (isDemoMode()) return { error: "Telegram isn't available in demo mode." };
  if (!(await getPlatformUser())) return { error: "FORBIDDEN" };
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!t) return { error: "Tenant not found." };
  return { tenantId: t.id };
}

const refresh = (slug: string) => revalidatePath(`/admin/tenants/${slug}/integrations`);

/** A linked chat as the operator's list renders it — no secrets, ever. */
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

/** Everything the panel renders, in one round trip. */
export async function loadTelegramPanelAction(
  slug: string,
): Promise<TelegramPanelState | { error: string }> {
  const g = await guard(slug);
  if ("error" in g) return g;
  try {
    const [status, rows] = await Promise.all([
      getTelegramStatus(g.tenantId),
      listRecipientRows(g.tenantId),
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
  } catch (e) {
    // Most likely cause: the telegram tables haven't been pushed yet. Say so
    // plainly rather than throwing an unhandled rejection into the panel.
    const msg = e instanceof Error ? e.message : "Couldn't load the Telegram setup.";
    return { error: /telegram_(recipients|pairings)|does not exist/i.test(msg)
      ? "Telegram tables are missing — run `npm run db:push` and reload."
      : msg };
  }
}

/**
 * The absolute URL Telegram posts updates to.
 *
 * Pinned to the PLATFORM host, not the tenant's storefront subdomain: a tenant
 * can move to a custom domain, and a webhook registered against a host they stop
 * using would go quietly dead. The secret path segment carries the tenant
 * identity, so one host serves every tenant's bot.
 */
function webhookUrl(secret: string): string {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
  const base = process.env.NEXT_PUBLIC_ADMIN_HOST || (root ? `app.${root}` : "");
  return `https://${base}/api/webhooks/telegram/${secret}`;
}

/**
 * Store a bot token from @BotFather, verify it, and register the webhook.
 *
 * Validated against Telegram BEFORE storage: a typo'd token saved as
 * "configured" would leave a connected-looking panel that never delivers.
 * Saving does NOT switch alerts on — that is a separate, deliberate step.
 */
export async function saveTelegramTokenAction(
  slug: string,
  botToken: string,
): Promise<TelegramActionResult> {
  const g = await guard(slug);
  if ("error" in g) return g;

  const token = (botToken ?? "").trim();
  // BotFather tokens are "<digits>:<35-ish url-safe chars>". Checked here only to
  // fail fast with a clear message; getMe is the real verification.
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return { error: "That doesn't look like a bot token. Copy the whole line BotFather sent you." };
  }

  const identity = await getMe(token);
  if (!identity.ok) return { error: `Telegram rejected that token: ${identity.error}` };

  // Reuse the established secret when there is one (saveTelegramCredentials keeps
  // it) so re-pasting a token doesn't orphan the URL Telegram already posts to.
  const existing = await getTelegramCredentials(g.tenantId);
  const secret = existing?.webhookSecret || randomBytes(32).toString("hex");

  try {
    await saveTelegramCredentials(g.tenantId, {
      botToken: token,
      webhookSecret: secret,
      botUsername: identity.result.username ?? "",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the token." };
  }

  const hooked = await setWebhook(token, webhookUrl(secret), secret);
  await recordTelegramHealth(g.tenantId, hooked.ok);
  refresh(slug);
  if (!hooked.ok) return { error: `Connected, but Telegram refused the webhook: ${hooked.error}` };
  return { ok: true };
}

/** Switch order alerts on or off without discarding the token or recipients. */
export async function setTelegramEnabledAction(
  slug: string,
  enabled: boolean,
): Promise<TelegramActionResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  if (enabled) {
    const creds = await getTelegramCredentials(g.tenantId);
    if (!creds) return { error: "Connect a bot before switching alerts on." };
  }
  await setTelegramEnabled(g.tenantId, enabled === true);
  refresh(slug);
  return { ok: true };
}

/** Disconnect: stop Telegram posting to us, then switch the integration off. */
export async function disconnectTelegramAction(slug: string): Promise<TelegramActionResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const creds = await getTelegramCredentials(g.tenantId);
  // Best-effort: if Telegram is unreachable we still switch it off, so the
  // operator is never stuck "connected" to a bot they want gone.
  if (creds) await deleteWebhook(creds.botToken);
  await setTelegramEnabled(g.tenantId, false);
  refresh(slug);
  return { ok: true };
}

export type PairingCodeResult = { ok: true; code: string; expiresAt: string } | { error: string };

/**
 * Mint a one-time code that links a chat, sent to the bot as "/start <code>".
 * This — not a chat-id field — is how a recipient is created, because a chat id
 * typed into a form proves nothing about who owns the chat.
 */
export async function createTelegramPairingAction(slug: string): Promise<PairingCodeResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const creds = await getTelegramCredentials(g.tenantId);
  if (!creds) return { error: "Connect a bot first." };
  const code = generatePairingCode();
  const expiresAt = await createPairing(g.tenantId, code);
  return { ok: true, code, expiresAt: expiresAt.toISOString() };
}

export async function unlinkTelegramRecipientAction(
  slug: string,
  chatId: string,
): Promise<TelegramActionResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const id = (chatId ?? "").trim().slice(0, 64);
  if (!id) return { error: "Missing chat." };
  await removeRecipient(g.tenantId, id);
  refresh(slug);
  return { ok: true };
}

/** Per-recipient switches: may they confirm, and do they see the buyer's details. */
export async function setTelegramRecipientFlagsAction(
  slug: string,
  chatId: string,
  flags: { canConfirm?: boolean; showCustomerDetails?: boolean },
): Promise<TelegramActionResult> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const id = (chatId ?? "").trim().slice(0, 64);
  if (!id) return { error: "Missing chat." };
  await setRecipientFlags(g.tenantId, id, {
    ...(typeof flags?.canConfirm === "boolean" ? { canConfirm: flags.canConfirm } : {}),
    ...(typeof flags?.showCustomerDetails === "boolean"
      ? { showCustomerDetails: flags.showCustomerDetails }
      : {}),
  });
  refresh(slug);
  return { ok: true };
}

/** Ask Telegram who this token belongs to — the panel's "Test connection". */
export async function testTelegramConnectionAction(
  slug: string,
): Promise<{ ok: true; botUsername: string } | { error: string }> {
  const g = await guard(slug);
  if ("error" in g) return g;
  const creds = await getTelegramCredentials(g.tenantId);
  if (!creds) return { error: "No bot connected yet." };
  const identity = await getMe(creds.botToken);
  await recordTelegramHealth(g.tenantId, identity.ok);
  refresh(slug);
  if (!identity.ok) return { error: identity.error };
  return { ok: true, botUsername: identity.result.username ?? "" };
}
