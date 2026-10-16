// Server-side read for the operator-edited plan→feature ceiling. Demo mode →
// .demo-data/platform-settings.json; DB mode → platform_settings row. Falls back
// to the hardcoded catalog PLAN_FEATURES defaults when nothing has been saved yet
// (or the table hasn't been pushed), so entitlement resolution never breaks.

import { loadPlatformSettingValue } from "./platform-setting-cache";
import { isDemoMode, getDemoPlatformSetting } from "@/lib/demo/fixtures";
import {
  PLAN_FEATURES_CONFIG_KEY,
  defaultPlanFeatureConfig,
  normalizePlanFeatureConfig,
  type PlanFeatureConfig,
} from "./plan-feature-config";

export async function getPlanFeatureConfig(): Promise<PlanFeatureConfig> {
  if (isDemoMode()) {
    const saved = getDemoPlatformSetting(PLAN_FEATURES_CONFIG_KEY);
    return saved ? normalizePlanFeatureConfig(saved) : defaultPlanFeatureConfig();
  }
  try {
    const value = await loadPlatformSettingValue(PLAN_FEATURES_CONFIG_KEY);
    return value !== null ? normalizePlanFeatureConfig(value) : defaultPlanFeatureConfig();
  } catch {
    // Table missing (db push not run yet) or DB hiccup — keep entitlements resolving.
    return defaultPlanFeatureConfig();
  }
}
