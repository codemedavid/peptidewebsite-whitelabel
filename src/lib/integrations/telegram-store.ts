// The encrypted-at-rest home for each tenant's Telegram bot token, plus the
// linked-recipient and pairing rows that decide who the bot will talk to.
//
// Modelled directly on integrations/store.ts (PostHog), including its two read
// shapes: a NON-SECRET status for the admin panel, and a decrypting read used
// only by the server paths that must actually call Telegram. The token is the
// bot — anyone holding it can read every message the bot receives and post as the
// store — so it is written once and never handed back out. getTelegramStatus
// returns no token field at all, rather than a blanked one, because a field that
// is sometimes populated eventually gets logged.

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db/tenant-client";
import { encryptSecret, decryptSecret, type EncryptedBlob } from "@/lib/crypto/envelope";
import {
  recipientLinkDefaults,
  type LinkedRecipient,
} from "@/lib/integrations/telegram-authz";
import { hashPairingCode, PAIRING_TTL_MS } from "@/lib/integrations/telegram-pairing";
import { prisma } from "@/lib/db/prisma";

export const TELEGRAM_PROVIDER = "telegram";

/** Non-secret config stored on the integration row. */
interface TelegramConfig {
  /** Random path segment + secret_token registered with setWebhook. */
  webhookSecret?: string;
  /** @username of the connected bot, for the panel's "Connected as" line. */
  botUsername?: string;
}

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  botUsername: string;
  healthOk: boolean | null;
  lastHealthCheckAt: Date | null;
}

type Row = {
  enabled: boolean;
  encryptedCredentials: unknown;
  dataKeyId: string;
  config: unknown;
  healthOk: boolean | null;
  lastHealthCheckAt: Date | null;
};

const configOf = (config: unknown): TelegramConfig =>
  (config ?? {}) as TelegramConfig;

async function findRow(tenantId: string): Promise<Row | null> {
  return withTenant(tenantId, (db) =>
    db.tenantIntegration.findFirst({ where: { provider: TELEGRAM_PROVIDER } }),
  ) as Promise<Row | null>;
}

/** Non-secret status for the admin panel. Null when nothing is configured. */
export async function getTelegramStatus(tenantId: string): Promise<TelegramStatus | null> {
  const row = await findRow(tenantId);
  if (!row) return null;
  return {
    configured: true,
    enabled: row.enabled,
    botUsername: configOf(row.config).botUsername ?? "",
    healthOk: row.healthOk,
    lastHealthCheckAt: row.lastHealthCheckAt,
  };
}

export interface TelegramCredentials {
  botToken: string;
  webhookSecret: string;
  botUsername: string;
}

/** Decrypt the token regardless of the enabled flag — for "Test connection",
 *  which has to work before the integration is switched on. */
export async function getTelegramCredentials(
  tenantId: string,
): Promise<TelegramCredentials | null> {
  const row = await findRow(tenantId);
  if (!row) return null;
  try {
    const botToken = decryptSecret(row.encryptedCredentials as EncryptedBlob, row.dataKeyId);
    if (!botToken) return null;
    const cfg = configOf(row.config);
    return { botToken, webhookSecret: cfg.webhookSecret ?? "", botUsername: cfg.botUsername ?? "" };
  } catch {
    return null; // sealed by a rotated ENCRYPTION_KEY → behave as unconfigured
  }
}

/** Credentials, but only while the integration is switched ON — the read the
 *  alert dispatcher uses, so a disabled integration sends nothing. */
export async function getEnabledTelegramTarget(
  tenantId: string,
): Promise<TelegramCredentials | null> {
  const row = await findRow(tenantId);
  if (!row || !row.enabled) return null;
  return getTelegramCredentials(tenantId);
}

/**
 * Persist (create or replace) the tenant's bot token. The webhook secret is
 * generated once and PRESERVED across token re-saves, so re-pasting a token does
 * not orphan a webhook URL that Telegram is still posting to. A new row starts
 * DISABLED — the owner turns it on after a successful test.
 */
export async function saveTelegramCredentials(
  tenantId: string,
  input: { botToken: string; webhookSecret: string; botUsername?: string },
): Promise<void> {
  const sealed = encryptSecret(input.botToken.trim());
  const existing = await findRow(tenantId);
  const config = {
    // Keep the established secret when there is one: rotating it silently would
    // 401 every update Telegram is already delivering to the old URL.
    webhookSecret: configOf(existing?.config).webhookSecret || input.webhookSecret,
    botUsername: input.botUsername ?? configOf(existing?.config).botUsername ?? "",
  } as unknown as Prisma.InputJsonValue;
  const encryptedCredentials = sealed.encryptedCredentials as unknown as Prisma.InputJsonValue;

  if (existing) {
    await withTenant(tenantId, (db) =>
      db.tenantIntegration.updateMany({
        where: { provider: TELEGRAM_PROVIDER },
        data: { encryptedCredentials, dataKeyId: sealed.dataKeyId, config },
      }),
    );
    return;
  }
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.create({
      data: {
        tenantId,
        provider: TELEGRAM_PROVIDER,
        enabled: false,
        encryptedCredentials,
        dataKeyId: sealed.dataKeyId,
        config,
      },
    }),
  );
}

/** Flip the on/off toggle (never touches the stored credentials). */
export async function setTelegramEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.updateMany({ where: { provider: TELEGRAM_PROVIDER }, data: { enabled } }),
  );
}

/** Record a "Test connection" result. */
export async function recordTelegramHealth(tenantId: string, ok: boolean): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.tenantIntegration.updateMany({
      where: { provider: TELEGRAM_PROVIDER },
      data: { healthOk: ok, lastHealthCheckAt: new Date() },
    }),
  );
}

/**
 * Resolve the tenant that owns a webhook secret path segment.
 *
 * This is the ONE read in the whole feature that cannot be tenant-scoped: it is
 * what establishes which tenant the request belongs to, so there is no tenantId
 * to scope by yet. It therefore goes through the base client and matches on the
 * secret alone — which is exactly why that secret is 32 random bytes, and why the
 * route ALSO checks Telegram's own secret_token header before acting.
 */
export async function findTenantByWebhookSecret(
  secret: string,
): Promise<{ tenantId: string; slug: string } | null> {
  if (!secret || secret.length < 16) return null;
  const row = await prisma.tenantIntegration.findFirst({
    where: {
      provider: TELEGRAM_PROVIDER,
      enabled: true,
      config: { path: ["webhookSecret"], equals: secret },
    },
    select: { tenantId: true, tenant: { select: { slug: true } } },
  });
  if (!row) return null;
  return { tenantId: row.tenantId, slug: row.tenant?.slug ?? "" };
}

// ── Recipients ───────────────────────────────────────────────────────────────

/** Every chat linked to this tenant, in the shape the authorization core wants. */
export async function listRecipients(tenantId: string): Promise<LinkedRecipient[]> {
  const rows = await withTenant(tenantId, (db) =>
    db.telegramRecipient.findMany({ orderBy: { linkedAt: "asc" } }),
  );
  return rows.map((r) => ({
    chatId: r.chatId,
    telegramUserId: r.telegramUserId,
    canConfirm: r.canConfirm,
    label: r.label,
  }));
}

/** The full rows, for the owner's recipient list (adds the redaction flag). */
export async function listRecipientRows(tenantId: string) {
  return withTenant(tenantId, (db) =>
    db.telegramRecipient.findMany({ orderBy: { linkedAt: "asc" } }),
  );
}

/**
 * Link a chat, or refresh an existing link. Permissions come from the shared
 * recipientLinkDefaults so the group rule has exactly one definition — including
 * the part that matters: a group records the person who linked it, so they can
 * confirm from it. Re-sending a code in an already-linked chat re-stamps that
 * person, which is how a group linked before this fix is repaired.
 */
export async function upsertRecipient(
  tenantId: string,
  input: {
    chatId: string;
    chatType: string;
    telegramUserId: string | null;
    label: string;
  },
): Promise<void> {
  const defaults = recipientLinkDefaults(input.chatType, input.telegramUserId);
  await withTenant(tenantId, async (db) => {
    const existing = await db.telegramRecipient.findFirst({ where: { chatId: input.chatId } });
    if (existing) {
      await db.telegramRecipient.updateMany({
        where: { chatId: input.chatId },
        data: {
          chatType: input.chatType,
          telegramUserId: defaults.telegramUserId,
          label: input.label,
          linkedAt: new Date(),
        },
      });
      return;
    }
    await db.telegramRecipient.create({
      data: {
        tenantId,
        chatId: input.chatId,
        chatType: input.chatType,
        telegramUserId: defaults.telegramUserId,
        label: input.label,
        canConfirm: defaults.canConfirm,
        showCustomerDetails: defaults.showCustomerDetails,
      },
    });
  });
}

export async function removeRecipient(tenantId: string, chatId: string): Promise<void> {
  await withTenant(tenantId, (db) => db.telegramRecipient.deleteMany({ where: { chatId } }));
}

export async function setRecipientFlags(
  tenantId: string,
  chatId: string,
  flags: { canConfirm?: boolean; showCustomerDetails?: boolean },
): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.telegramRecipient.updateMany({
      where: { chatId },
      data: {
        ...(flags.canConfirm !== undefined ? { canConfirm: flags.canConfirm } : {}),
        ...(flags.showCustomerDetails !== undefined
          ? { showCustomerDetails: flags.showCustomerDetails }
          : {}),
      },
    }),
  );
}

// ── Pairing ──────────────────────────────────────────────────────────────────

/** Store a freshly generated code (hashed) and return when it dies. */
export async function createPairing(tenantId: string, code: string): Promise<Date> {
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const codeHash = hashPairingCode(code);
  await withTenant(tenantId, async (db) => {
    // Clear this tenant's earlier codes: only the code on screen should work, so
    // an abandoned tab can't be redeemed ten minutes later by someone else.
    await db.telegramPairing.deleteMany({ where: { usedAt: null } });
    await db.telegramPairing.create({ data: { tenantId, codeHash, expiresAt } });
  });
  return expiresAt;
}

/**
 * Redeem a code for this tenant. Returns true only if a live, unused code
 * matched — and marks it used in the same breath, so it can never link twice.
 */
export async function consumePairing(tenantId: string, code: string): Promise<boolean> {
  const codeHash = hashPairingCode(code);
  return withTenant(tenantId, async (db) => {
    const row = await db.telegramPairing.findFirst({ where: { codeHash, usedAt: null } });
    if (!row) return false;
    if (row.expiresAt.getTime() <= Date.now()) return false;
    // updateMany with the usedAt: null guard makes the spend atomic — two racing
    // redemptions of the same code cannot both come back true.
    const spent = await db.telegramPairing.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return spent.count === 1;
  });
}
