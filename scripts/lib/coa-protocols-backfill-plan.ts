// Pure decision core for scripts/backfill-coa-protocols-grants.ts. Extracted so
// the grant/revoke/skip logic can be tested without a database — the script
// itself only does Prisma I/O around this function.

export interface BackfillTenant {
  id: string;
  slug: string;
}

export interface BackfillFeature {
  id: string;
  key: string;
}

export interface BackfillOverride {
  tenantId: string;
  featureId: string;
  enabled: boolean;
}

export interface BackfillPlanItem {
  tenantId: string;
  featureId: string;
  label: string;
  enabled: boolean;
}

export interface BackfillPlan {
  planned: BackfillPlanItem[];
  grants: BackfillPlanItem[];
  revokes: BackfillPlanItem[];
  skipped: string[];
  unknownExclusions: string[];
}

export function planCoaProtocolsBackfill(
  tenants: readonly BackfillTenant[],
  features: readonly BackfillFeature[],
  existing: readonly BackfillOverride[],
  excludedSlugs: ReadonlySet<string>,
): BackfillPlan {
  const hasOverride = new Set(existing.map((o) => `${o.tenantId}:${o.featureId}`));

  const planned: BackfillPlanItem[] = [];
  const skipped: string[] = [];

  for (const tenant of tenants) {
    for (const feature of features) {
      const label = `${tenant.slug} · ${feature.key}`;
      // Never clobber a recorded operator decision — skip wins over both grant
      // and exclusion-revoke, whichever direction the existing override points.
      if (hasOverride.has(`${tenant.id}:${feature.id}`)) {
        const current = existing.find(
          (o) => o.tenantId === tenant.id && o.featureId === feature.id,
        );
        skipped.push(`${label} (already set: enabled=${current?.enabled})`);
        continue;
      }
      // Excluded tenants are written OFF explicitly (not left absent) so the
      // decision survives a re-run — a later pass then skips them as "already set".
      const enabled = !excludedSlugs.has(tenant.slug);
      planned.push({ tenantId: tenant.id, featureId: feature.id, label, enabled });
    }
  }

  // A typo in an excluded slug would silently grant the tenant it meant to skip;
  // surface it so the caller can fail loudly instead.
  const unknownExclusions = [...excludedSlugs].filter(
    (slug) => !tenants.some((t) => t.slug === slug),
  );

  return {
    planned,
    grants: planned.filter((p) => p.enabled),
    revokes: planned.filter((p) => !p.enabled),
    skipped,
    unknownExclusions,
  };
}
