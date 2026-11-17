import "server-only";

import { prisma } from "@/lib/db/prisma";
import { customerStampFor } from "./auth";
import { deliverPush, type Recipient } from "./push";
import { decodeSubject } from "./sessions";
import type { PromoPushStatus, PromoPushSent } from "./contract";
import { promoNextFreeAt, promoNotification, promoSendsLeft, PROMO_WINDOW_MS, type PromoInput } from "./promo-push";

/**
 * Sending a store's promo / event notification (rules: promo-push.ts).
 *
 * Recipients are re-checked at send time, like every other push: a LIVE
 * customer session on this store, an active account that OPTED IN, and the
 * session's credential stamp still matching (a password change or disable
 * drops the phone). Store-team phones never get it.
 */

const RECENT_SHOWN = 10;

/** Opted-in customers' phones for this store. */
async function promoRecipients(tenantId: string): Promise<Recipient[]> {
  const optedIn = await prisma.storefrontCustomer.findMany({
    where: { tenantId, status: "active", promoPushOptIn: true },
    select: { id: true, email: true, passwordHash: true, sessionVersion: true },
  });
  if (optedIn.length === 0) return [];
  const stamps = new Map(optedIn.map((c) => [c.id, customerStampFor(c.email, c.passwordHash, c.sessionVersion)]));
  const devices = await prisma.mobilePushDevice.findMany({
    where: {
      tenantId,
      session: { revokedAt: null, refreshExpiresAt: { gt: new Date() }, subject: { in: optedIn.map((c) => `customer:${c.id}`) } },
    },
    select: { id: true, expoPushToken: true, platform: true, session: { select: { subject: true, credentialStamp: true } } },
  });
  return devices
    .filter((d) => {
      const s = decodeSubject(d.session.subject);
      return s?.kind === "customer" && stamps.get(s.id) === d.session.credentialStamp;
    })
    .map((d) => ({ id: d.id, token: d.expoPushToken, platform: d.platform }));
}

async function recentSends(tenantId: string) {
  return prisma.storePromoPush.findMany({
    where: { tenantId },
    orderBy: { sentAt: "desc" },
    take: RECENT_SHOWN,
    select: { id: true, headline: true, message: true, recipients: true, sentAt: true },
  });
}

/** What the composer shows: who'll get it, what's left today, what was sent. */
export async function promoPushStatus(tenantId: string, now = new Date()): Promise<PromoPushStatus> {
  const [recipients, recent] = await Promise.all([promoRecipients(tenantId), recentSends(tenantId)]);
  const times = recent.map((r) => r.sentAt).filter((d) => d.getTime() > now.getTime() - PROMO_WINDOW_MS);
  const nextFree = promoNextFreeAt(times, now);
  return {
    audience: new Set(recipients.map((r) => r.token)).size,
    sendsLeft: promoSendsLeft(times, now),
    nextFreeAt: nextFree ? nextFree.toISOString() : null,
    recent: recent.map((r) => ({ id: r.id, headline: r.headline, message: r.message, recipients: r.recipients, sentAt: r.sentAt.toISOString() })),
  };
}

export type SendResult = { ok: true; value: PromoPushSent } | { ok: false; code: "rate_limited"; message: string };

/**
 * Logs the send, then pushes. The log row is written FIRST inside a
 * transaction that re-counts the window under an advisory lock, so two quick
 * taps (or two staff phones) can never both slip past the daily cap.
 */
export async function sendPromoPush(
  tenantId: string,
  storeName: string,
  sentBy: string,
  input: PromoInput,
  now = new Date(),
): Promise<SendResult> {
  const recipients = await promoRecipients(tenantId);
  const claimed = await prisma.$transaction(async (tx) => {
    const key = `promo-push:${tenantId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
    const inWindow = await tx.storePromoPush.findMany({
      where: { tenantId, sentAt: { gt: new Date(now.getTime() - PROMO_WINDOW_MS) } },
      select: { sentAt: true },
    });
    if (promoSendsLeft(inWindow.map((r) => r.sentAt), now) === 0) return null;
    return tx.storePromoPush.create({
      data: { tenantId, headline: input.headline, message: input.message, sentBy, recipients: recipients.length, sentAt: now },
      select: { id: true },
    });
  });
  if (!claimed) {
    return { ok: false, code: "rate_limited", message: "You've sent 3 promo notifications in the last 24 hours. Try again later." };
  }
  const { title, body } = promoNotification(storeName, input);
  const res = recipients.length > 0 ? await deliverPush(recipients, { title, body, data: { type: "promo", id: claimed.id } }, "promos") : { sent: 0, failed: 0 };
  return { ok: true, value: { id: claimed.id, recipients: recipients.length, sent: res.sent } };
}

/** A customer turns "Promos & events" on or off. The time they said yes is kept as consent. */
export async function setPromoOptIn(tenantId: string, customerId: string, on: boolean, now = new Date()): Promise<boolean> {
  await prisma.storefrontCustomer.updateMany({
    where: { id: customerId, tenantId },
    data: on ? { promoPushOptIn: true, promoPushOptInAt: now } : { promoPushOptIn: false },
  });
  return on;
}

export async function readPromoOptIn(tenantId: string, customerId: string): Promise<boolean> {
  const row = await prisma.storefrontCustomer.findFirst({ where: { id: customerId, tenantId }, select: { promoPushOptIn: true } });
  return row?.promoPushOptIn === true;
}
