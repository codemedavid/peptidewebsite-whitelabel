// Server-side read/write for the "new functionality" registry. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Reads never
// throw (missing table / DB hiccup → empty registry) so entitlement and storefront
// rendering are never blocked by this cosmetic layer.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoPlatformSetting, saveDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  FEATURE_REGISTRY_KEY,
  normalizeFeatureRegistry,
  type FeatureRegistry,
} from "./feature-registry";

export async function getFeatureRegistry(): Promise<FeatureRegistry> {
  if (isDemoMode()) return normalizeFeatureRegistry(getDemoPlatformSetting(FEATURE_REGISTRY_KEY));
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: FEATURE_REGISTRY_KEY } });
    return normalizeFeatureRegistry(row?.value);
  } catch {
    return normalizeFeatureRegistry(null);
  }
}

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
}
