// Server-side read/write for the "new functionality" registry. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Reads never
// throw (missing table / DB hiccup → empty registry) so entitlement and storefront
// rendering are never blocked by this cosmetic layer.

import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoPlatformSetting, saveDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  FEATURE_REGISTRY_KEY,
  normalizeFeatureRegistry,
  type FeatureRegistry,
} from "./feature-registry";

/** Tag for the one platform-global registry row. Busted by persistFeatureRegistry. */
export const FEATURE_REGISTRY_TAG = "platform:feature-registry";

/** Long window: only an operator save changes this row, and that save busts the tag. */
const REVALIDATE_SECONDS = 3600;

// This row is platform-global — not per-tenant — so one cache entry serves every
// storefront on the platform. Uncached it cost a round trip (~500ms measured) on
// every render, to decide whether a cosmetic "new" badge shows.
const loadRegistry = unstable_cache(
  async () => {
    const row = await prisma.platformSetting.findUnique({ where: { key: FEATURE_REGISTRY_KEY } });
    return normalizeFeatureRegistry(row?.value);
  },
  ["platform-feature-registry"],
  { tags: [FEATURE_REGISTRY_TAG], revalidate: REVALIDATE_SECONDS },
);

/**
 * Reads never throw — a missing table or DB hiccup yields an empty registry, so
 * entitlement and storefront rendering are never blocked by this cosmetic layer.
 * Outer `cache()` dedupes within a single render.
 */
export const getFeatureRegistry = cache(
  async (): Promise<FeatureRegistry> => {
    if (isDemoMode()) return normalizeFeatureRegistry(getDemoPlatformSetting(FEATURE_REGISTRY_KEY));
    try {
      return await loadRegistry();
    } catch {
      return normalizeFeatureRegistry(null);
    }
  },
);

/** Persist the registry. Demo → file; DB → platform_settings upsert. */
export async function persistFeatureRegistry(registry: FeatureRegistry): Promise<void> {
  if (isDemoMode()) {
    saveDemoPlatformSetting(FEATURE_REGISTRY_KEY, registry);
    return;
  }
  await prisma.platformSetting.upsert({
    where: { key: FEATURE_REGISTRY_KEY },
    update: { value: registry as unknown as Prisma.InputJsonValue },
    create: { key: FEATURE_REGISTRY_KEY, value: registry as unknown as Prisma.InputJsonValue },
  });
  // Without this an operator's save would sit behind the cache window on every
  // storefront. The write is the only thing that changes this row.
  revalidateTag(FEATURE_REGISTRY_TAG);
}
