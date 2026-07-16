/**
 * Starter downgrade (trial system) — pure, client-safe (test:trial-expiry).
 *
 * When a trial ends, the "Choose how to continue" screen offers Starter with
 * exactly ONE combination of storefront tools. Each combo is expressed as
 * feature grants/revokes RELATIVE to the Starter ceiling (so entitlements stay
 * the single source of truth) plus the storefront page toggles the downgrade
 * action stamps onto branding.config:
 *
 *   a) FAQ Page + Protocols Page — the calculator (which Starter would
 *      normally include) is revoked; FAQ/Protocols pages are content-driven
 *      (no feature key), so only their page toggles flip on.
 *   b) Peptide Calculator + Order Tracking Page — order tracking sits OUTSIDE
 *      the Starter ceiling, so it's granted via a TenantFeatureOverride.
 *
 * The downgrade also stamps branding.config.trialDowngrade = { combo, at } —
 * the marker that binds the 10-product cap. Legacy Starter stores (no marker)
 * are never capped retroactively.
 */

import { FEATURES, type FeatureKey } from "@/lib/features/catalog";

export const STARTER_DOWNGRADE_PRODUCT_CAP = 10;

export type StarterCombo = {
  id: "a" | "b";
  title: string;
  sub: string;
  /** Enable-overrides for features outside the Starter ceiling. */
  grants: FeatureKey[];
  /** Revocation-overrides for Starter-ceiling features outside the combo. */
  revokes: FeatureKey[];
  /** branding.config showPage* flips applied by the downgrade action. */
  pageToggles: Record<string, boolean>;
};

export const STARTER_COMBOS: StarterCombo[] = [
  {
    id: "a",
    title: "FAQ Page + Protocols Page",
    sub: "Includes 20 free peptide protocols",
    grants: [],
    // Calculator falls outside this combo; the Checkout Fee is Business-
    // exclusive but sits in Starter's ceiling, so it must be revoked here.
    revokes: [FEATURES.STORE_CALCULATOR, FEATURES.STORE_ADMIN_FEE],
    pageToggles: {
      showPageFAQ: true,
      showPageProtocols: true,
      showPageCalculator: false,
      showPageTrack: false,
    },
  },
  {
    id: "b",
    title: "Peptide Calculator + Order Tracking Page",
    sub: "Dosage calculator & customer track page",
    grants: [FEATURES.STORE_ORDER_TRACKING],
    // The Checkout Fee is Business-exclusive but sits in Starter's ceiling.
    revokes: [FEATURES.STORE_ADMIN_FEE],
    pageToggles: {
      showPageFAQ: false,
      showPageProtocols: false,
      showPageCalculator: true,
      showPageTrack: true,
    },
  },
];

export function starterCombo(id: string): StarterCombo | undefined {
  return STARTER_COMBOS.find((c) => c.id === id);
}

/** The 10-product creation gate — binds ONLY trial-downgraded stores. */
export function canAddProductAfterDowngrade(
  existingCount: number,
  downgraded: boolean,
): boolean {
  return !downgraded || existingCount < STARTER_DOWNGRADE_PRODUCT_CAP;
}

/** Truthy trialDowngrade marker in branding.config → the cap applies. */
export function hasDowngradeMarker(config: unknown): boolean {
  const marker = (config as { trialDowngrade?: unknown } | null)?.trialDowngrade;
  return typeof marker === "object" && marker !== null;
}
