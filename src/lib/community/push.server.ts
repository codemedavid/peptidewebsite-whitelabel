import "server-only";

import { prisma } from "@/lib/db/prisma";
import { hasFeature } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import { customerStampFor, resolveActor, storeAvailability } from "@/lib/mobile/auth";
import { deliverPush, type OutgoingPush, type Recipient } from "@/lib/mobile/push";
import { decodeSubject } from "@/lib/mobile/sessions";
import { STORE_KEY, customerKey, parseParticipantKey } from "./keys";
import { isAudience } from "./rules";
import { firstName } from "./text";
import { buildTopicPush, topicPushAudience } from "./topic-push";

/**
 * Community pushes, through the same Expo sender as new-order alerts.
 *
 *   DM   → the OTHER participant's phones: a customer's own sessions, or — for
 *          the store — the owner's and every staff phone holding `community`.
 *   drop / group buy broadcast → every approved member's phones.
 *   topic message → every approved member who can see the channel, except the
 *          sender and members who muted the channel (CommunityChannelMute).
 *
 * Payload is {type, threadId} only; the lock screen names the sender but never
 * shows the message. Every recipient is re-authorised at send time (live
 * session, current credential stamp, still approved / still a moderator), and
 * `MobilePushDevice.messages` is the per-phone opt-out. Never throws.
 */

const CHANNEL_ID = "messages";

/**
 * At most one DM push per conversation per recipient every 3 minutes, so a
 * burst of messages buzzes a phone once. In-memory (per server instance): on
 * several instances a recipient can get one push per instance per window,
 * which is acceptable for a courtesy throttle.
 */
const DM_PUSH_GAP_MS = 3 * 60 * 1000;
const MAX_THROTTLE_ENTRIES = 10_000;
const lastDmPush = new Map<string, number>();

/** true = send now (and remember it); false = a push went out recently. */
export function claimDmPushSlot(key: string, now = Date.now()): boolean {
  const last = lastDmPush.get(key);
  if (last !== undefined && now - last < DM_PUSH_GAP_MS) return false;
  if (lastDmPush.size >= MAX_THROTTLE_ENTRIES) {
    for (const [k, t] of lastDmPush) if (now - t >= DM_PUSH_GAP_MS) lastDmPush.delete(k);
    if (lastDmPush.size >= MAX_THROTTLE_ENTRIES) lastDmPush.clear();
  }
  lastDmPush.set(key, now);
  return true;
}

type Device = { id: string; expoPushToken: string; platform: string; session: { subject: string; credentialStamp: string } };

async function liveDevices(tenantId: string, subjects?: string[]): Promise<Device[]> {
  return prisma.mobilePushDevice.findMany({
    where: {
      tenantId,
      messages: true,
      session: {
        revokedAt: null,
        refreshExpiresAt: { gt: new Date() },
        ...(subjects ? { subject: { in: subjects } } : {}),
      },
    },
    select: { id: true, expoPushToken: true, platform: true, session: { select: { subject: true, credentialStamp: true } } },
  });
}

const toRecipient = (d: Device): Recipient => ({ id: d.id, token: d.expoPushToken, platform: d.platform });

/**
 * Phones of these customers whose sessions still match an active account —
 * and, unless `anyMember` (an update about the customer's OWN order), an
 * approved community member.
 */
async function customerRecipients(tenantId: string, customerIds: string[], anyMember = false): Promise<Recipient[]> {
  if (customerIds.length === 0) return [];
  const devices = await liveDevices(tenantId, customerIds.map((id) => `customer:${id}`));
  if (devices.length === 0) return [];
  const accounts = await prisma.storefrontCustomer.findMany({
    where: {
      tenantId,
      id: { in: customerIds },
      status: "active",
      ...(anyMember ? {} : { communityMember: { status: "approved" } }),
    },
    select: { id: true, email: true, passwordHash: true, sessionVersion: true },
  });
  const stamps = new Map(accounts.map((a) => [a.id, customerStampFor(a.email, a.passwordHash, a.sessionVersion)]));
  return devices
    .filter((d) => {
      const s = decodeSubject(d.session.subject);
      return s?.kind === "customer" && stamps.get(s.id) === d.session.credentialStamp;
    })
    .map(toRecipient);
}

/** The store's phones: owner + staff with the Community module. */
async function storeRecipients(tenantId: string): Promise<Recipient[]> {
  const out: Recipient[] = [];
  for (const d of await liveDevices(tenantId)) {
    const s = decodeSubject(d.session.subject);
    if (!s || s.kind === "customer") continue;
    const actor = await resolveActor(tenantId, s);
    if (actor && actor.stamp === d.session.credentialStamp && isModuleAllowed(actor.actor, "community")) out.push(toRecipient(d));
  }
  return out;
}

async function send(tenantId: string, recipients: Recipient[], message: OutgoingPush): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (await storeAvailability(tenant)) return;
  if (!(await hasFeature(tenantId, FEATURES.MOBILE_COMMUNITY))) return;
  if (recipients.length > 0) await deliverPush(recipients, message, CHANNEL_ID);
}

function logFailure(kind: string, e: unknown) {
  const code = e && typeof e === "object" && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
  console.error(`[community-push] ${kind} failed: ${e instanceof Error ? e.name : "Error"}${code}`);
}

export async function notifyDm(args: {
  tenantId: string;
  conversationId: string;
  senderKey: string;
  recipientKey: string;
  senderName: string;
  storeName: string;
}): Promise<void> {
  try {
    const ref = parseParticipantKey(args.recipientKey);
    if (!ref) return;
    if (!claimDmPushSlot(`${args.tenantId}:${args.conversationId}:${args.recipientKey}`)) return;
    const recipients = ref.kind === "store" ? await storeRecipients(args.tenantId) : await customerRecipients(args.tenantId, [ref.id]);
    const from = args.senderKey === STORE_KEY ? args.storeName : firstName(args.senderName);
    await send(args.tenantId, recipients, {
      title: args.storeName,
      body: `New message from ${from}`,
      data: { type: "dm", threadId: args.conversationId },
    });
  } catch (e) {
    logFailure("dm", e);
  }
}

/**
 * A chat message in a channel topic. Throttled per recipient per topic (the DM
 * gap), so a busy thread buzzes each phone once while the replies keep coming —
 * but someone who hasn't been pushed yet (the person being answered) still is.
 */
export async function notifyTopicMessage(args: {
  tenantId: string;
  topic: { id: string; name: string; isGeneral: boolean };
  channel: { id: string; name: string; emoji: string; audience: string };
  senderKey: string;
  senderName: string;
  storeName: string;
}): Promise<void> {
  try {
    if (!isAudience(args.channel.audience)) return;
    const [members, mutes] = await Promise.all([
      prisma.communityMember.findMany({ where: { tenantId: args.tenantId, status: "approved" }, select: { customerId: true } }),
      prisma.communityChannelMute.findMany({ where: { tenantId: args.tenantId, channelId: args.channel.id }, select: { participantKey: true } }),
    ]);
    const audience = topicPushAudience(
      members.map((m) => m.customerId),
      { senderKey: args.senderKey, mutedKeys: new Set(mutes.map((m) => m.participantKey)) },
    );
    const due = audience.filter((id) => claimDmPushSlot(`${args.tenantId}:topic:${args.topic.id}:${id}`));
    if (due.length === 0) return;
    await send(
      args.tenantId,
      await customerRecipients(args.tenantId, due),
      buildTopicPush({
        storeName: args.storeName,
        channel: args.channel,
        topic: args.topic,
        senderName: args.senderName,
        fromStore: args.senderKey === STORE_KEY,
      }),
    );
  } catch (e) {
    logFailure("topic", e);
  }
}

/** The approved members who can see the topic's channel (see canSeeChannel); none for a hidden one. */
async function audienceOf(tenantId: string, topicId: string): Promise<Array<{ customerId: string }>> {
  const topic = await prisma.communityTopic.findFirst({
    where: { tenantId, id: topicId },
    select: { channel: { select: { audience: true } } },
  });
  if (!isAudience(topic?.channel.audience ?? "everyone")) return [];
  return prisma.communityMember.findMany({
    where: { tenantId, status: "approved" },
    select: { customerId: true },
  });
}

export async function notifyDrop(args: { tenantId: string; topicId: string; headline: string; storeName: string; exceptKey?: string }): Promise<void> {
  try {
    const members = await audienceOf(args.tenantId, args.topicId);
    const ids = members.map((m) => m.customerId).filter((id) => customerKey(id) !== args.exceptKey);
    await send(args.tenantId, await customerRecipients(args.tenantId, ids), {
      title: args.storeName,
      body: `🔥 ${args.headline}`,
      data: { type: "drop", threadId: args.topicId },
    });
  } catch (e) {
    logFailure("drop", e);
  }
}

/**
 * One "group buy is open" push per round per store every 30 minutes, however
 * many staff press "Send to everyone" (each has their own rate limit). The
 * cards still post; only the repeat buzz is skipped. In-memory per instance,
 * like the DM throttle.
 */
const GROUP_BUY_PUSH_GAP_MS = 30 * 60 * 1000;
const lastGroupBuyPush = new Map<string, number>();

export function claimGroupBuyPushSlot(tenantId: string, roundId: string, now = Date.now()): boolean {
  const key = `${tenantId}:${roundId}`;
  const last = lastGroupBuyPush.get(key);
  if (last !== undefined && now - last < GROUP_BUY_PUSH_GAP_MS) return false;
  if (lastGroupBuyPush.size >= MAX_THROTTLE_ENTRIES) lastGroupBuyPush.clear();
  lastGroupBuyPush.set(key, now);
  return true;
}

/** "Send the group buy to everyone": one push per approved member, opening the first channel it landed in. */
export async function notifyGroupBuy(args: { tenantId: string; topicId: string; roundName: string; storeName: string }): Promise<void> {
  try {
    const members = await audienceOf(args.tenantId, args.topicId);
    await send(args.tenantId, await customerRecipients(args.tenantId, members.map((m) => m.customerId)), {
      title: args.storeName,
      body: `👥 ${args.roundName} is open — join the group buy`,
      data: { type: "group_buy", threadId: args.topicId },
    });
  } catch (e) {
    logFailure("group_buy", e);
  }
}

/**
 * The order bot's push to the buyer (see order-bot.server.ts). Not throttled —
 * status updates are few and each one matters. Data carries the DM thread and
 * the order number so a tap opens the chat, or the order when the buyer isn't
 * in the community.
 */
export async function notifyOrderUpdate(args: {
  tenantId: string;
  customerId: string;
  conversationId: string;
  orderNumber: string;
  body: string;
  storeName: string;
}): Promise<void> {
  try {
    await send(args.tenantId, await customerRecipients(args.tenantId, [args.customerId], true), {
      title: args.storeName,
      body: args.body,
      data: { type: "order_update", threadId: args.conversationId, orderNumber: args.orderNumber },
    });
  } catch (e) {
    logFailure("order_update", e);
  }
}

/**
 * The safety bot hid a message: tell the store team's phones (owner + staff
 * holding `community`), at most once per store every 3 minutes. The payload
 * is only a pointer to the review queue — never the message.
 */
export async function notifySafetyFlag(args: { tenantId: string; storeName: string }): Promise<void> {
  try {
    if (!claimDmPushSlot(`${args.tenantId}:safety`)) return;
    await send(args.tenantId, await storeRecipients(args.tenantId), {
      title: args.storeName,
      body: "🛡 The safety bot hid a message that invited members to another group. Tap to review.",
      data: { type: "safety" },
    });
  } catch (e) {
    logFailure("safety", e);
  }
}
