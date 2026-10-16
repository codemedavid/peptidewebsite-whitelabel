import "server-only";

import { withTenant } from "@/lib/db/tenant-client";
import { FEATURES } from "@/lib/features/catalog";
import type { TenantContext } from "@/lib/tenant/context";
import { isModuleAllowed } from "@/storefront/admin/staff-permissions";
import type { AuthFailure, Principal } from "@/lib/mobile/auth";
import type { LiveSession } from "@/lib/mobile/sessions";
import { storeDisplayName } from "@/lib/mobile/store-name";
import { admitCustomer } from "./admission.server";
import { isActiveAdmin } from "./membership";
import { previewPolicyOf } from "./preview";
import { STORE_KEY, authorKeyFor, customerKey } from "./keys";
import type { RuleActor } from "./rules";

/**
 * Who is acting in the community, re-derived per request from the session:
 *   - an APPROVED customer (participant `c:<id>`) — in an "open" community
 *     every signed-in customer is admitted here on their first request, or
 *   - the store team — the owner, or staff holding the `community` module —
 *     posting as `store`, each write stamped with its author (`owner | s:<id>`).
 * A customer the team made a community admin is a moderator but not the team:
 * they still post as `c:<id>`, and lose the powers while revoked or muted.
 * A PENDING customer, while the store's preview is on, acts in preview
 * (`actor.preview`): only routes that opt in (withCommunity `preview: true`)
 * serve them, and rules.ts limits what they see and post.
 * The store must hold MOBILE_COMMUNITY. Everyone else gets `forbidden`.
 */

export type CommunityActor = RuleActor & {
  principal: Principal;
  session: LiveSession;
  tenantId: string;
  slug: string;
  tenant: TenantContext;
  /** Set for customers. */
  customerId: string | null;
  storeName: string;
  /** When this customer was approved — the unread baseline for threads never opened. */
  joinedAt: Date | null;
  /** Customers: whether the store's welcome DM has gone out. */
  welcomed: boolean;
};

export const COMMUNITY_OFF: AuthFailure = {
  code: "forbidden",
  message: "The community isn't available for this store.",
};

const NOT_MODERATOR: AuthFailure = {
  code: "forbidden",
  message: "Your account doesn't have access to the community. Ask the store owner.",
};

function memberBlocked(status: string | null): AuthFailure {
  if (status === "rejected" || status === "revoked") {
    return { code: "forbidden", message: "Your community membership isn't active." };
  }
  return { code: "forbidden", message: "Your membership is waiting for the store's approval." };
}

export function isCommunityModerator(principal: Principal): boolean {
  return (
    principal.kind === "admin" &&
    principal.ctx.tenant.has(FEATURES.MOBILE_COMMUNITY) &&
    isModuleAllowed(principal.ctx.actor, "community")
  );
}

export async function resolveCommunityActor(
  principal: Principal,
): Promise<{ ok: true; actor: CommunityActor } | { ok: false; failure: AuthFailure }> {
  const ctx = principal.ctx;
  if (!ctx.tenant.has(FEATURES.MOBILE_COMMUNITY)) return { ok: false, failure: COMMUNITY_OFF };
  const base = {
    principal,
    session: ctx.session,
    tenantId: ctx.tenantId,
    slug: ctx.slug,
    tenant: ctx.tenant,
    storeName: storeDisplayName(ctx.tenant),
  };

  if (principal.kind === "admin") {
    if (!isModuleAllowed(principal.ctx.actor, "community")) return { ok: false, failure: NOT_MODERATOR };
    return {
      ok: true,
      actor: {
        ...base,
        key: STORE_KEY,
        isModerator: true,
        isTeam: true,
        authorKey: authorKeyFor(principal.ctx.actor),
        customerId: null,
        joinedAt: null,
        welcomed: true,
      },
    };
  }

  const customerId = principal.ctx.customer.id;
  const member = await admitCustomer(ctx.tenant, ctx.tenantId, principal.ctx.customer);
  const policy = previewPolicyOf(ctx.tenant.branding?.config);
  if (member.status === "pending" && policy.enabled) {
    return {
      ok: true,
      actor: {
        ...base,
        key: customerKey(customerId),
        isModerator: false,
        isTeam: false,
        authorKey: null,
        customerId,
        // No unread backlog while previewing, and the welcome DM waits for approval.
        joinedAt: new Date(),
        welcomed: true,
        isMuted: member.mutedAt !== null,
        preview: policy,
      },
    };
  }
  if (member.status !== "approved") return { ok: false, failure: memberBlocked(member.status) };
  return {
    ok: true,
    actor: {
      ...base,
      key: customerKey(customerId),
      isModerator: isActiveAdmin(member),
      isTeam: false,
      authorKey: null,
      customerId,
      joinedAt: member.reviewedAt,
      isVerifiedReseller: member.verifiedReseller,
      isMuted: member.mutedAt !== null,
      welcomed: member.welcomedAt !== null,
    },
  };
}
