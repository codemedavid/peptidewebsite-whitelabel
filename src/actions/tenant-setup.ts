"use server";

import { Prisma } from "@prisma/client";
import { getPlatformUser } from "@/lib/auth/session";
import {
  createTenantWithSetup,
  type TenantSetupInput,
  type TenantSetupResult,
} from "@/lib/tenant/setup";

export type TenantSetupActionResult =
  | { ok: true; tenant: TenantSetupResult }
  | { error: string };

/**
 * Platform-operator wrapper for automated tenant setup. This is intentionally
 * narrow: callers can create a tenant and attach branding/hero assets, but the
 * current platform user is still the authorization boundary.
 */
export async function createTenantSetupAction(
  input: Omit<TenantSetupInput, "ownerUserId" | "ownerEmail"> &
    Partial<Pick<TenantSetupInput, "ownerUserId" | "ownerEmail">>,
): Promise<TenantSetupActionResult> {
  const operator = await getPlatformUser();
  if (!operator) return { error: "FORBIDDEN" };

  try {
    const tenant = await createTenantWithSetup({
      ...input,
      ownerUserId: input.ownerUserId || operator.id,
      ownerEmail: input.ownerEmail || operator.email,
    });
    return { ok: true, tenant };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `Slug "${input.slug}" is already taken.` };
    }
    return { error: e instanceof Error ? e.message : "Failed to create tenant." };
  }
}
