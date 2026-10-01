import { fail, ok, withMobile } from "@/lib/mobile/http";
import { encodeHandoffToken } from "@/lib/mobile/handoff-token";
import { sessionSecret } from "@/lib/auth/storefront-admin";
import { appStorefrontOrigin } from "@/lib/mobile/storefront-origin";

// POST /api/mobile/v1/admin/handoff — a 60s token that signs the EMBEDDED
// website admin (app/(app)/web-admin.tsx) in as this app session. The token
// names the session; redeemAppHandoffAction re-checks it before any cookie.
export async function POST(req: Request) {
  return withMobile(req, { route: "admin/handoff" }, async (ctx) => {
    const origin = appStorefrontOrigin(ctx.slug);
    if (!origin) return fail("store_unavailable", "This store isn't available right now.");
    const { token, expiresAt } = encodeHandoffToken(sessionSecret(), ctx.session.id, ctx.tenantId, Date.now());
    return ok({ token, expiresAt, url: `${origin}/#admin` });
  });
}
