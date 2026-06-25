import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Authoritative per-tenant access-gate state for the storefront layout. Read
 * FRESH on every request — deliberately NOT cached — because the gate is a
 * security boundary: enabling, disabling, or rotating the code must take effect
 * immediately no matter how it was changed (admin UI, the ops script, or a direct
 * DB edit). A cached read would leave a window where a rotated code still admits
 * old sessions or a disabled gate keeps blocking, which an `unstable_cache` TTL
 * (and its inability to be busted from outside the Next process) made real.
 *
 * Cost is one indexed lookup per storefront request. Returns ONLY booleans + the
 * version + display copy — never the hash — so the scrypt hash can't ride along
 * into a client payload.
 */
export async function getTenantGateState(tenantId: string): Promise<{
  enabled: boolean;
  heading: string;
  hasCode: boolean;
  codeVersion: number;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      accessCodeHash: true,
      accessCodeVersion: true,
      branding: { select: { config: true } },
    },
  });

  const cfg = (tenant?.branding?.config ?? {}) as {
    accessGate?: { enabled?: boolean; heading?: string };
  };
  return {
    enabled: cfg.accessGate?.enabled === true,
    heading:
      typeof cfg.accessGate?.heading === "string" && cfg.accessGate.heading.trim()
        ? cfg.accessGate.heading.trim()
        : "Enter access code",
    hasCode: !!tenant?.accessCodeHash,
    codeVersion: tenant?.accessCodeVersion ?? 1,
  };
}
