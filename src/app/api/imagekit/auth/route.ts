import { NextResponse } from "next/server";
import { getTenantUploadAuth } from "@/lib/imagekit/server";
import { getTenantSession } from "@/lib/auth/session";

/**
 * Returns short-lived upload auth params for the ImageKit client SDK, scoped to
 * the caller's tenant. Gated to authenticated tenant members so randoms can't
 * upload to your account, and the returned `folder` confines the upload to
 * `tenant/<tenantId>/` — derived from the session, not the request.
 */
export async function GET() {
  const session = await getTenantSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(getTenantUploadAuth(session.tenantId));
}
