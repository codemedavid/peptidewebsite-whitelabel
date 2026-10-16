// Preview access: what a signed-in customer the store hasn't approved yet may
// do (branding.config.previewAccess, plus each channel's previewAccess).
// The rules that apply it live in rules.ts (community) and preview.server.ts
// (shop). Pure (npm run test:community-core).

import {
  CHANNEL_PREVIEW_ACCESS,
  DEFAULT_CHANNEL_PREVIEW_ACCESS,
  DEFAULT_PREVIEW_POLICY,
  type ChannelPreviewAccess,
  type PreviewPolicy,
} from "@/lib/mobile/contract";

export { PREVIEW_LOCKED_MESSAGE } from "@/lib/mobile/contract";
export type { ChannelPreviewAccess, PreviewPolicy };

const POLICY_KEYS = Object.keys(DEFAULT_PREVIEW_POLICY) as Array<keyof PreviewPolicy>;

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function isChannelPreviewAccess(v: unknown): v is ChannelPreviewAccess {
  return typeof v === "string" && (CHANNEL_PREVIEW_ACCESS as readonly string[]).includes(v);
}

/** A stored channel setting, read leniently: anything unknown is the default (locked). */
export function channelPreviewAccess(v: unknown): ChannelPreviewAccess {
  return isChannelPreviewAccess(v) ? v : DEFAULT_CHANNEL_PREVIEW_ACCESS;
}

/** The store's stored policy; each missing or malformed field falls back on its own. */
export function previewPolicyOf(config: unknown): PreviewPolicy {
  const stored = record(record(config)?.previewAccess);
  if (!stored) return DEFAULT_PREVIEW_POLICY;
  return Object.fromEntries(
    POLICY_KEYS.map((k) => [k, typeof stored[k] === "boolean" ? stored[k] : DEFAULT_PREVIEW_POLICY[k]]),
  ) as PreviewPolicy;
}

/** PATCH /community/preview: any subset of the switches, each a boolean, merged onto `current`. */
export function parsePreviewPolicyUpdate(
  input: unknown,
  current: PreviewPolicy,
): { ok: true; value: PreviewPolicy } | { ok: false; error: string } {
  const o = record(input);
  if (!o) return { ok: false, error: "Nothing to save." };
  const unknown = Object.keys(o).filter((k) => !(POLICY_KEYS as string[]).includes(k));
  if (unknown.length > 0) return { ok: false, error: "That setting isn't available." };
  const bad = POLICY_KEYS.filter((k) => k in o && typeof o[k] !== "boolean");
  if (bad.length > 0) return { ok: false, error: "Each setting is on or off." };
  return { ok: true, value: { ...current, ...(o as Partial<PreviewPolicy>) } };
}

/**
 * The policy a customer browses under, or null when they aren't in preview:
 * approved members (and stores with preview off) get the store as before.
 * Rejected and revoked members are in preview too — for the shop. The
 * community still refuses them outright (actor.server.ts).
 */
export function previewFor(policy: PreviewPolicy, memberStatus: string): PreviewPolicy | null {
  return policy.enabled && memberStatus !== "approved" ? policy : null;
}

/** Can someone in preview place this order? Each kind of line needs its own switch. */
export function previewOrderBlocked(policy: PreviewPolicy, hasGroupBuyLines: boolean, hasOnHandLines: boolean): boolean {
  if (hasGroupBuyLines && !policy.joinGroupBuys) return true;
  return hasOnHandLines && !policy.placeOrders;
}

/** Whether someone in preview could place any order at all (gates the proof upload too). */
export function previewCanOrder(policy: PreviewPolicy): boolean {
  return policy.placeOrders || policy.joinGroupBuys;
}
