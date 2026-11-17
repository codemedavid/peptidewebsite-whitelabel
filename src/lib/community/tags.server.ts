import "server-only";

import type { CommunityTagsResponse } from "@/lib/mobile/contract";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { updateBrandingConfig } from "@/lib/tenant/branding-config-write";
import type { CommunityActor } from "./actor.server";
import { communityTags, parseCommunityTagsInput } from "./tags";

/**
 * Saves the member-tag looks (branding.config.communityTags). Read-modify-write
 * under a row lock so the owner and an admin restyling different tags at the
 * same moment both keep their change.
 */
export async function saveCommunityTags(actor: CommunityActor, body: unknown): Promise<{ ok: true; value: CommunityTagsResponse } | { ok: false; error: string }> {
  const out: { parsed?: ReturnType<typeof parseCommunityTagsInput> } = {};
  await updateBrandingConfig(actor.tenantId, (current) => {
    const parsed = parseCommunityTagsInput(body, communityTags(current));
    out.parsed = parsed;
    return parsed.ok ? { ...current, communityTags: parsed.value } : null;
  });
  const parsed = out.parsed;
  if (!parsed) return { ok: false, error: "Couldn't save the tags." };
  if (!parsed.ok) return parsed;
  revalidateTenant(actor.tenantId, actor.slug);
  return { ok: true, value: { tags: parsed.value } };
}
