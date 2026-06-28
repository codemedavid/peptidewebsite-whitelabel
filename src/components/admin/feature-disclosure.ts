// Pure disclosure helpers for the collapsible feature modules in the admin
// Tenant → Features editor (see FeaturesEditor.tsx). Kept React-free so the
// accordion behaviour can be unit-tested without a DOM (npm run
// test:feature-disclosure).

import type { FeatureGroup } from "@/lib/features/catalog";

/** All/On/Off segmented filter on the Features page. */
export type FeatureFilter = "all" | "on" | "off";

/** Per-group open/closed state. Absent key = never toggled = collapsed. */
export type OpenGroups = Record<string, boolean>;

/**
 * Effective open/closed for one module.
 *
 * Modules default to collapsed so the page reads as a scannable list. When the
 * user narrows to On/Off, every group is forced open — otherwise a collapsed
 * module would hide its matching rows and the filter would look broken.
 */
export function isGroupOpen({
  group,
  openGroups,
  filter,
}: {
  group: FeatureGroup;
  openGroups: OpenGroups;
  filter: FeatureFilter;
}): boolean {
  if (filter !== "all") return true;
  return openGroups[group] === true;
}

/** Immutably flip one module's open state, leaving the rest untouched. */
export function toggleGroupOpen(openGroups: OpenGroups, group: FeatureGroup): OpenGroups {
  return { ...openGroups, [group]: openGroups[group] !== true };
}

/**
 * Stable, DOM-safe id for a module's body region — used for the disclosure
 * trigger's `aria-controls` and the collapsible body's `id`.
 */
export function groupBodyId(group: FeatureGroup): string {
  const slug = group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `ftr-grp-${slug}`;
}
