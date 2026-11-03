// Super-admin → store-admin push ("PepWorld update is out", "maintenance
// tonight"). Reaches every phone signed in to the app as a store OWNER or STAFF
// member — never a customer — optionally narrowed to some tenants.
//
// The same "who is really an admin right now" rule as the new-order alert
// (push.ts authorisedRecipients): a live session, an admin subject, and a
// credential stamp that still matches (a reset password / removed staff member
// stops receiving). Order-alert opt-outs are NOT applied: this is a service
// message from the platform, not a store notification.
//
// Old app builds open the app on tap (unknown push targets route nowhere), so
// it's safe to send before the new build is out.

import { prisma } from "@/lib/db/prisma";
import { resolveActor } from "./auth";
import { decodeSubject, isAdminSubject } from "./sessions";
import { deliverPush, type Recipient } from "./push";

import { parseBroadcastInput, dedupeRecipients, type BroadcastInput } from "./admin-broadcast-input";

export { parseBroadcastInput, type BroadcastInput };

export type BroadcastAudience = { recipients: Recipient[]; phones: number; stores: number };

/** Every currently-signed-in admin phone (owner or staff), all tenants or some. */
export async function adminBroadcastAudience(tenantIds: readonly string[]): Promise<BroadcastAudience> {
  const devices = await prisma.mobilePushDevice.findMany({
    where: {
      ...(tenantIds.length ? { tenantId: { in: [...tenantIds] } } : {}),
      session: { revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    },
    select: {
      id: true,
      tenantId: true,
      expoPushToken: true,
      platform: true,
      session: { select: { subject: true, credentialStamp: true } },
    },
  });
  const actors = new Map<string, Promise<Awaited<ReturnType<typeof resolveActor>>>>();
  const out: (Recipient & { tenantId: string })[] = [];
  for (const d of devices) {
    const subject = decodeSubject(d.session.subject);
    if (!subject || !isAdminSubject(subject)) continue; // customers never
    const key = `${d.tenantId}|${d.session.subject}`;
    if (!actors.has(key)) actors.set(key, resolveActor(d.tenantId, subject));
    const actor = await actors.get(key)!;
    if (!actor || actor.stamp !== d.session.credentialStamp) continue;
    out.push({ id: d.id, token: d.expoPushToken, platform: d.platform, tenantId: d.tenantId });
  }
  const recipients = dedupeRecipients(out);
  return { recipients, phones: recipients.length, stores: new Set(out.map((r) => r.tenantId)).size };
}

/** Send it. `data.type = "announcement"` — the app opens on tap, nothing more. */
export async function sendAdminBroadcast(input: BroadcastInput): Promise<{ sent: number; failed: number; phones: number }> {
  const { recipients } = await adminBroadcastAudience(input.tenantIds);
  if (recipients.length === 0) return { sent: 0, failed: 0, phones: 0 };
  const res = await deliverPush(recipients, { title: input.title, body: input.body, data: { type: "announcement" } });
  return { ...res, phones: recipients.length };
}
