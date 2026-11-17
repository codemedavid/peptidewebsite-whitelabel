import "server-only";

import type { NextResponse } from "next/server";
import { fail, withSession } from "@/lib/mobile/http";
import type { TenantContext } from "@/lib/tenant/context";
import { trackerAccess } from "@/lib/mobile/tracker-access";
import { trackerGate } from "./gate";
import { trackerOwnerOf, type TrackerOwner } from "./owner";

export type TrackerContext = {
  tenantId: string;
  sessionId: string;
  /** Whose tracker this is — the signed-in account itself, never anyone else. */
  owner: TrackerOwner;
  tenant: TenantContext;
};

/**
 * Every /api/mobile/v1/tracker/* route goes through here: any signed-in
 * account (customer, store owner or staff) of a store whose tracker is on
 * (trackerAccess — the same predicate /me uses). Each reads and writes only
 * its OWN tracker. App guests get 403; tracker off → 404. `guideImport`
 * routes also need the store-guide grant.
 */
export async function withTracker(
  req: Request,
  opts: { route: string; guideImport?: boolean },
  handler: (ctx: TrackerContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  return withSession(req, { route: opts.route }, async (principal) => {
    const access = trackerAccess((key) => principal.ctx.tenant.has(key));
    const guest = principal.kind === "customer" && principal.ctx.customer.guest;
    const refused = trackerGate(access, { guideImport: opts.guideImport, guest });
    if (refused) return fail(refused.code, refused.message);
    const owner =
      principal.kind === "customer"
        ? trackerOwnerOf({ kind: "customer", id: principal.ctx.customer.id })
        : trackerOwnerOf(principal.ctx.actor);
    return handler({
      tenantId: principal.ctx.tenantId,
      sessionId: principal.ctx.session.id,
      owner,
      tenant: principal.ctx.tenant,
    });
  });
}
