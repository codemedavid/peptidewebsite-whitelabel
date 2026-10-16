// Server-side read for the operator-edited plan pricing/features. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Falls back
// to the hardcoded PLAN_CARDS defaults when nothing has been saved yet (or the
// table hasn't been pushed), so pricing surfaces never break.

import { loadPlatformSettingValue } from "./platform-setting-cache";
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
    const value = await loadPlatformSettingValue(PLAN_CONFIG_KEY);
    return value !== null ? normalizePlanConfig(value) : defaultPlanConfig();
  } catch {
    // Table missing (db push not run yet) or DB hiccup — keep pricing rendering.
    return defaultPlanConfig();
  }
}
