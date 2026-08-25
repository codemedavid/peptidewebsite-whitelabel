// MCP tools: list_whitelabel_features / set_whitelabel_features — read and move
// an EXISTING tenant's entitlements from the connector.
//
// The connector could create a tenant, restyle it and stock its catalog, but
// every "switch group buys on for k-glow" still meant the operator opening
// admin → Features by hand — the one thing the connector exists to avoid.
//
// It lives outside app/api/mcp/route.ts because that file is already long, and
// because the decision itself is NOT here: the pure, tested core is
// @/lib/tenant/feature-toggle (npm run test:mcp-features) and the write is the
// same @/lib/tenant/feature-write path the admin editor uses. This module is
// only the shell — schema, tenant lookup, one batch of writes, revalidate.
// Auth is the ROUTE's job; by the time these run the caller proved the token.

import { prisma } from "@/lib/db/prisma";
import { getEntitlements } from "@/lib/features/entitlements";
import { ALL_FEATURES } from "@/lib/features/catalog";
import { applyFeatureWrites } from "@/lib/tenant/feature-write";
import { buildFeatureInventory, buildFeatureTogglePlan } from "@/lib/tenant/feature-toggle";
import { revalidateTenant } from "@/lib/tenant/revalidate";

const TOKEN_SCHEMA = {
  type: "string",
  description:
    "Fallback token for connectors configured with No Authentication. Prefer an Authorization: Bearer header, or a ?token= parameter on the connector URL.",
} as const;

const SLUG_SCHEMA = {
  type: "string",
  description: "Existing tenant slug, e.g. k-glow.",
} as const;

/**
 * The exact catalog keys, advertised to the model. Human labels still resolve
 * server-side ("Group buy system" → groupbuy.module), but showing the model the
 * real keys is what stops it inventing plausible ones.
 */
const FEATURE_NAME_SCHEMA = {
  type: "array",
  items: { type: "string", enum: [...ALL_FEATURES] },
  description:
    "Feature keys, e.g. [\"groupbuy.module\", \"storefront.reviews\"]. Human labels from list_whitelabel_features also work, except where two modules share one label (\"Excel export\") — then send the exact key.",
} as const;

export const LIST_FEATURES_TOOL = {
  name: "list_whitelabel_features",
  title: "List Whitelabel Tenant Features",
  description:
    "Read which features are on or off for an existing Pepweb whitelabel tenant, grouped exactly as the platform admin's Features panel shows them. Read-only — it changes nothing. Call it before set_whitelabel_features so you use exact feature keys, and to answer questions like \"what does this store have enabled?\". Rows marked lockedByPlan need a plan change, not a toggle.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: SLUG_SCHEMA,
      enabledOnly: {
        type: "boolean",
        description: "Return only the features that are currently ON. Defaults to false (the full sheet).",
      },
    },
    required: ["tenantSlug"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const SET_FEATURES_TOOL = {
  name: "set_whitelabel_features",
  title: "Turn Whitelabel Tenant Features On or Off",
  description:
    "Turn features on or off for an existing Pepweb whitelabel tenant — the same switches as the platform admin's Features panel. This is a LIVE write that changes what a real storefront and its store admin expose, so only call it when the operator has explicitly asked to enable or disable something for a named tenant; do not call it to explore or to 'fix' a store on your own initiative. It never grants beyond the tenant's package: a feature the plan does not include and that is not operator-grantable is refused, naming the plan it would need. The whole call is refused if any name is unknown or ambiguous — nothing is half-applied.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: SLUG_SCHEMA,
      enable: { ...FEATURE_NAME_SCHEMA, description: `Features to turn ON. ${FEATURE_NAME_SCHEMA.description}` },
      disable: { ...FEATURE_NAME_SCHEMA, description: `Features to turn OFF. ${FEATURE_NAME_SCHEMA.description}` },
      dryRun: {
        type: "boolean",
        description:
          "Validate and report what WOULD change without writing anything. Use it to confirm an ambiguous request with the operator before applying it.",
      },
    },
    required: ["tenantSlug"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
};

function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function ok(result: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError,
  };
}

function cleanSlug(args: Record<string, unknown>): string {
  const raw = args.tenantSlug ?? args.slug;
  return typeof raw === "string" ? raw.trim().slice(0, 80).toLowerCase() : "";
}

async function findTenant(slug: string) {
  return prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, plan: { select: { key: true } } },
  });
}

/** Read-only: the tenant's feature sheet as the admin panel would show it. */
export async function callListFeatures(args: Record<string, unknown>): Promise<ToolResult> {
  const slug = cleanSlug(args);
  if (!slug) return fail("tenantSlug is required.");

  const tenant = await findTenant(slug);
  if (!tenant) return fail(`Tenant "${slug}" was not found.`);

  const current = await getEntitlements(tenant.id);
  const inventory = buildFeatureInventory({ planKey: tenant.plan.key, current });

  const groups =
    args.enabledOnly === true
      ? inventory.groups
          .map((g) => ({ ...g, features: g.features.filter((f) => f.enabled) }))
          .filter((g) => g.features.length > 0)
      : inventory.groups;

  return ok({
    tenant: { slug: tenant.slug, name: tenant.name },
    plan: { key: inventory.planKey, label: inventory.planLabel },
    enabledCount: inventory.enabledCount,
    total: inventory.total,
    groups,
  });
}

/**
 * Write: validate the whole batch against the plan ceiling FIRST, then apply.
 * A refused batch writes nothing — an agent that cannot see the store must not
 * leave it half-toggled.
 */
export async function callSetFeatures(args: Record<string, unknown>): Promise<ToolResult> {
  const slug = cleanSlug(args);
  if (!slug) return fail("tenantSlug is required.");

  const tenant = await findTenant(slug);
  if (!tenant) return fail(`Tenant "${slug}" was not found.`);

  const current = await getEntitlements(tenant.id);
  const plan = buildFeatureTogglePlan({
    planKey: tenant.plan.key,
    current,
    enable: args.enable,
    disable: args.disable,
  });

  const tenantInfo = { slug: tenant.slug, name: tenant.name, plan: tenant.plan.key };

  if (plan.errors.length) {
    return ok({ tenant: tenantInfo, applied: false, errors: plan.errors }, true);
  }

  if (args.dryRun === true) {
    return ok({
      tenant: tenantInfo,
      applied: false,
      dryRun: true,
      wouldChange: plan.changes,
      unchanged: plan.unchanged,
      warnings: plan.warnings,
    });
  }

  if (!plan.changes.length) {
    return ok({
      tenant: tenantInfo,
      applied: true,
      changed: [],
      unchanged: plan.unchanged,
      warnings: plan.warnings,
      note: "Every requested feature was already in that state — nothing was written.",
    });
  }

  try {
    await applyFeatureWrites(tenant.id, plan.changes);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed to update tenant features.");
  }

  revalidateTenant(tenant.id, tenant.slug);

  return ok({
    tenant: tenantInfo,
    applied: true,
    changed: plan.changes,
    unchanged: plan.unchanged,
    warnings: plan.warnings,
  });
}
