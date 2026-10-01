import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import { resolveActor, storeAvailability } from "./auth";
import { decodeSubject, encodeSubject, isAdminSubject, type MobileSubject } from "./sessions";
import {
  buildNewOrderPush,
  isExpoPushToken,
  triageExpoTicket,
  type ExpoTicket,
  type PushMessage,
  type PushOrder,
} from "./push-message";

/**
 * Pepweb Admin push notifications (Expo Push Service, plain fetch — no SDK).
 *
 *   register  — a phone's Expo token is bound to exactly ONE session. The token
 *               is unique, so re-registering it under a new session (another
 *               store, another account) MOVES it: a phone never gets two
 *               stores' alerts. Logout / revocation deletes it (sessions.ts).
 *   notify    — called from the order-placement `after()` job for a NEWLY
 *               persisted order only. A unique MobileOrderAlert row is claimed
 *               first, so replaying the job can never notify twice. Every
 *               recipient is re-authorised at send time (live session, active
 *               account, `orders` permission, store available).
 *
 * Optional EXPO_ACCESS_TOKEN enables Expo's enhanced push security; without it
 * the public endpoint is used.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Tests point this at a local capture server; ignored in production. */
function pushEndpoint(): string {
  const override = process.env.MOBILE_PUSH_ENDPOINT_OVERRIDE;
  return override && process.env.NODE_ENV !== "production" ? override : EXPO_PUSH_URL;
}
const EXPO_BATCH = 100;
const SEND_TIMEOUT_MS = 10_000;
const ANDROID_CHANNEL_ID = "orders";

export type RegisterResult = { ok: true; newOrders: boolean } | { ok: false; message: string };

/**
 * May this session take over an existing registration of the same token?
 * Yes when the owning session is gone, revoked or expired (the phone moved on),
 * or belongs to the same account in the same store. A LIVE session of another
 * account keeps its token — nobody can redirect someone else's notifications
 * just by knowing their push token.
 */
function mayRebind(
  existing: { tenantId: string; session: { tenantId: string; subject: string; revokedAt: Date | null; refreshExpiresAt: Date } | null },
  session: { tenantId: string; subject: string },
  now: Date,
): boolean {
  const owner = existing.session;
  if (!owner || owner.revokedAt || owner.refreshExpiresAt.getTime() <= now.getTime()) return true;
  return owner.tenantId === session.tenantId && owner.subject === session.subject;
}

export async function registerDevice(
  session: { id: string; tenantId: string; subject: MobileSubject },
  body: Record<string, unknown>,
): Promise<RegisterResult> {
  const token = body.expoPushToken;
  const platform = body.platform === "ios" || body.platform === "android" ? body.platform : null;
  if (!isExpoPushToken(token) || !platform) return { ok: false, message: "This device can't receive notifications." };
  const newOrders = body.newOrders !== false;
  const messages = body.messages !== false;

  const existing = await prisma.mobilePushDevice.findUnique({
    where: { expoPushToken: token },
    select: { tenantId: true, session: { select: { tenantId: true, subject: true, revokedAt: true, refreshExpiresAt: true } } },
  });
  if (existing && !mayRebind(existing, { tenantId: session.tenantId, subject: encodeSubject(session.subject) }, new Date())) {
    return { ok: false, message: "This phone is still signed in to another account. Sign out there first." };
  }

  await prisma.mobilePushDevice.upsert({
    where: { expoPushToken: token },
    create: { expoPushToken: token, platform, newOrders, messages, tenantId: session.tenantId, sessionId: session.id },
    // Re-binding to THIS session and tenant is the whole point of the upsert.
    update: { platform, newOrders, messages, tenantId: session.tenantId, sessionId: session.id, lastError: null },
  });
  return { ok: true, newOrders };
}

export async function unregisterDevice(sessionId: string, token: unknown): Promise<void> {
  if (!isExpoPushToken(token)) return;
  await prisma.mobilePushDevice.deleteMany({ where: { sessionId, expoPushToken: token } });
}

// ── sending ──────────────────────────────────────────────────────────────────

export type Recipient = { id: string; token: string; platform: string };

/** Anything the app knows how to open from a notification tap. */
export type OutgoingPush = { title: string; body: string; data: Record<string, string> };

async function authorisedRecipients(tenantId: string): Promise<Recipient[]> {
  const devices = await prisma.mobilePushDevice.findMany({
    where: { tenantId, newOrders: true, session: { revokedAt: null, refreshExpiresAt: { gt: new Date() } } },
    select: {
      id: true,
      expoPushToken: true,
      platform: true,
      session: { select: { subject: true, credentialStamp: true } },
    },
  });
  const out: Recipient[] = [];
  for (const d of devices) {
    const subject = decodeSubject(d.session.subject);
    // Customer phones never get store alerts, whatever their flags say.
    const actor = subject && isAdminSubject(subject) ? await resolveActor(tenantId, subject) : null;
    if (!actor || actor.stamp !== d.session.credentialStamp) continue;
    if (!isModuleAllowed(actor.actor, "orders")) continue;
    out.push({ id: d.id, token: d.expoPushToken, platform: d.platform });
  }
  return out;
}

async function postToExpo(messages: object[]): Promise<ExpoTicket[] | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  try {
    const res = await fetch(pushEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: ExpoTicket[] };
    return Array.isArray(json.data) ? json.data : null;
  } catch {
    return null;
  }
}

function toExpoMessage(r: Recipient, m: OutgoingPush, channelId: string) {
  return {
    to: r.token,
    title: m.title,
    body: m.body,
    data: m.data,
    sound: "default",
    priority: "high",
    channelId,
  };
}

/** Send one batch, retrying transient failures once. Returns [sent, failed]. */
async function sendBatch(
  batch: Recipient[],
  message: OutgoingPush,
  channelId = ANDROID_CHANNEL_ID,
): Promise<[number, number]> {
  let pending = batch;
  let sent = 0;
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
    const tickets = await postToExpo(pending.map((r) => toExpoMessage(r, message, channelId)));
    const retry: Recipient[] = [];
    for (let i = 0; i < pending.length; i++) {
      const outcome = triageExpoTicket(tickets?.[i]);
      const r = pending[i];
      if (outcome === "ok") sent++;
      else if (outcome === "retry") retry.push(r);
      else if (outcome === "remove-device") {
        await prisma.mobilePushDevice.deleteMany({ where: { id: r.id } });
      } else {
        await prisma.mobilePushDevice
          .update({ where: { id: r.id }, data: { lastError: tickets?.[i]?.details?.error ?? "error" } })
          .catch(() => undefined);
      }
    }
    pending = retry;
  }
  return [sent, batch.length - sent];
}

/**
 * Deliver one message to many phones (batched, retried once, dead tokens
 * removed). Shared by the new-order alert and the community pushes.
 */
export async function deliverPush(
  recipients: Recipient[],
  message: OutgoingPush,
  channelId = ANDROID_CHANNEL_ID,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += EXPO_BATCH) {
    const [s, f] = await sendBatch(recipients.slice(i, i + EXPO_BATCH), message, channelId);
    sent += s;
    failed += f;
  }
  return { sent, failed };
}

/**
 * Fan the new-order alert out to every authorised phone of the tenant. Safe to
 * call more than once for the same order — the unique claim makes the second
 * call a no-op. Never throws (it runs after the customer's response).
 */
export async function notifyNewOrder(
  tenantId: string,
  order: PushOrder,
  storeName: string,
  currency?: unknown,
): Promise<void> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
    if (await storeAvailability(tenant)) return;

    try {
      await prisma.mobileOrderAlert.create({ data: { tenantId, orderId: order.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // already sent
      throw e;
    }

    const recipients = await authorisedRecipients(tenantId);
    if (recipients.length === 0) return;
    const message: PushMessage = buildNewOrderPush(order, storeName, currency);
    const { sent, failed } = await deliverPush(recipients, message);
    await prisma.mobileOrderAlert.update({ where: { orderId: order.id }, data: { sent, failed } });
  } catch (e) {
    // Class + code only: messages can echo query arguments.
    const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
    console.error(`[mobile-push] new-order alert failed: ${e instanceof Error ? e.name : "Error"}${code}`);
  }
}
