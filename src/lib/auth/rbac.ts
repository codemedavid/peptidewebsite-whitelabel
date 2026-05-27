// Tenant-plane roles (TenantUser.role). Higher rank = more authority.
export const TENANT_ROLES = ["staff", "tenant_admin", "owner"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

const RANK: Record<TenantRole, number> = {
  staff: 1,
  tenant_admin: 2,
  owner: 3,
};

export function roleAtLeast(role: string, min: TenantRole): boolean {
  const r = RANK[role as TenantRole];
  return r !== undefined && r >= RANK[min];
}

// Platform-plane roles (PlatformUser.role).
export type PlatformRole = "super_admin" | "support";
