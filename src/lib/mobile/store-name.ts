import type { TenantContext } from "@/lib/tenant/context";

/**
 * The store's display name + logo exactly as the website (and the app theme)
 * show them: the branding config override, else the settings / tenant name.
 * Shared by the theme and the community (the store's participant card).
 */

function cfg(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function storeDisplayName(t: TenantContext): string {
  return str(cfg(t.branding?.config).name) ?? t.settings?.storeName ?? t.tenant.name;
}

export function storeLogoUrl(t: TenantContext): string | null {
  return str(cfg(t.branding?.config).logoUrl) ?? t.branding?.logoUrl ?? null;
}
