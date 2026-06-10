// Server-side read for the operator-edited plan pricing/features. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Falls back
// to the hardcoded PLAN_CARDS defaults when nothing has been saved yet (or the
// table hasn't been pushed), so pricing surfaces never break.

import { prisma } from "@/lib/db/prisma";
import { isDemoMode, getDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PLAN_CONFIG_KEY,
  defaultPlanConfig,
  normalizePlanConfig,
  type PlanConfig,
} from "./plan-config";

export async function getPlanConfig(): Promise<PlanConfig> {
  if (isDemoMode()) {
    const saved = getDemoPlatformSetting(PLAN_CONFIG_KEY);
    return saved ? normalizePlanConfig(saved) : defaultPlanConfig();
  }
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: PLAN_CONFIG_KEY } });
    return row ? normalizePlanConfig(row.value) : defaultPlanConfig();
  } catch {
    // Table missing (db push not run yet) or DB hiccup — keep pricing rendering.
    return defaultPlanConfig();
  }
}
