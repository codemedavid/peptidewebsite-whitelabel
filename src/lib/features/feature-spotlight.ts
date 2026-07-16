/**
 * New-feature spotlight picker — the gold "NEW FEATURE / BUSINESS EXCLUSIVE"
 * strip at the top of the trial dashboard. Reuses the operator's existing
 * "new feature" workflow: the feature registry's kept newKeys (the same source
 * as the module "New" tags) drive what gets advertised, so releasing a feature
 * to the spotlight needs no extra operator surface.
 *
 * Shown to stores that should upgrade to get it:
 *   - during an ACTIVE trial every kept new feature qualifies (new features
 *     land in the Business plan — the strip is the upsell), entitled or not;
 *   - otherwise only features the tenant is NOT entitled to qualify (a paid
 *     Business store that already has everything sees nothing).
 *
 * Pure and client-safe (test:feature-spotlight); the server projects the
 * result onto brand.featureSpotlight in page.tsx.
 */

import { FEATURE_META, type FeatureKey } from "./catalog";

export type FeatureSpotlight = {
  key: string;
  label: string;
  description: string;
};

export function pickFeatureSpotlight(
  newKeys: readonly string[],
  isEntitled: (key: string) => boolean,
  trialActive: boolean,
): FeatureSpotlight | undefined {
  for (const key of newKeys) {
    const meta = FEATURE_META[key as FeatureKey];
    if (!meta) continue; // retired/unknown keys must never break the render
    if (trialActive || !isEntitled(key)) {
      return { key, label: meta.label, description: meta.description };
    }
  }
  return undefined;
}
