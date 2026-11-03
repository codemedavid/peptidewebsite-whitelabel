"use server";

// Platform-operator only: push a notice to every store admin signed in to the
// app (owner + staff phones; customers never). See lib/mobile/admin-broadcast.

import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";
import { adminBroadcastAudience, parseBroadcastInput, sendAdminBroadcast } from "@/lib/mobile/admin-broadcast";

const FORBIDDEN = { error: "Only the platform operator can send app notifications." } as const;

export async function previewAdminBroadcastAction(
  tenantIds: string[],
): Promise<{ ok: true; phones: number; stores: number } | { error: string }> {
  if (isDemoMode()) return { error: "App notifications aren't available in demo mode." };
  if (!(await getPlatformUser())) return FORBIDDEN;
  try {
    const parsed = parseBroadcastInput({ title: "x", body: "x", tenantIds });
    if ("error" in parsed) return parsed;
    const { phones, stores } = await adminBroadcastAudience(parsed.tenantIds);
    return { ok: true, phones, stores };
  } catch (e) {
    console.error(`[admin-broadcast] preview failed: ${e instanceof Error ? e.name : "Error"}`);
    return { error: "Couldn't count the signed-in admins — try again." };
  }
}

export async function sendAdminBroadcastAction(
  raw: unknown,
): Promise<{ ok: true; sent: number; failed: number; phones: number } | { error: string }> {
  if (isDemoMode()) return { error: "App notifications aren't available in demo mode." };
  if (!(await getPlatformUser())) return FORBIDDEN;
  const input = parseBroadcastInput(raw);
  if ("error" in input) return input;
  try {
    const res = await sendAdminBroadcast(input);
    console.info(`[admin-broadcast] sent=${res.sent} failed=${res.failed} phones=${res.phones} tenants=${input.tenantIds.length || "all"}`);
    return { ok: true, ...res };
  } catch (e) {
    console.error(`[admin-broadcast] send failed: ${e instanceof Error ? e.name : "Error"}`);
    return { error: "Couldn't send the notification — nothing was sent, try again." };
  }
}
