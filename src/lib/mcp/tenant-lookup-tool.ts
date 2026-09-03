// MCP tool: list_whitelabel_tenants — let the connector FIND a store.
//
// Every other tenant-scoped tool takes a `tenantSlug` and resolved it with
// findUnique, so the connector could only act on a store whose exact slug it
// already held — in practice, one it had just created and got the slug back
// for. An operator asking to restyle a store that already existed hit a wall the
// model could not climb: "restyle HP Glow" becomes `hp-glow`, which is not a
// tenant (the real slug is `hpglow`), and there was no way to look it up.
//
// This module is the I/O shell only. The directory projection and the resolver
// are the pure, tested core in @/lib/tenant/tenant-lookup
// (npm run test:tenant-lookup). Auth is the ROUTE's job; by the time these run
// the caller has already proven the admin token.

import { prisma } from "@/lib/db/prisma";
import {
  buildTenantDirectory,
  buildTenantMatch,
  type TenantRow,
} from "@/lib/tenant/tenant-lookup";

const TOKEN_SCHEMA = {
  type: "string",
  description:
    "Fallback token for connectors configured with No Authentication. Prefer an Authorization: Bearer header, or a ?token= parameter on the connector URL.",
} as const;

export const LIST_TENANTS_TOOL = {
  name: "list_whitelabel_tenants",
  title: "List Whitelabel Tenants",
  description:
    "List the Pepweb whitelabel stores that exist, so you can act on one you did not create. Read-only — it changes nothing. Call it whenever the operator names a store rather than a slug (\"restyle HP Glow\"), when a tenant slug was not found, or to answer \"what stores do I have?\". Returns each store's slug, display name, status and storefront URL; pass that exact slug to update_whitelabel_branding, list_whitelabel_features or the product tools. It deliberately exposes no owner contact details, credentials or billing data.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      query: {
        type: "string",
        description:
          "Optional filter — part of a store name or slug, e.g. \"glow\". Omit to list every store.",
      },
      limit: { type: "number", description: "Maximum stores to return, 1 to 100. Defaults to 100." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
};

function ok(result: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError,
  };
}

/**
 * The identifying columns, and only those.
 *
 * Narrow on purpose: a Tenant row also carries adminPasswordHash,
 * storeAdminPasswordHash, accessCodeHash, the owner's WhatsApp and the whole
 * subscription ledger. Selecting the row wholesale would put all of it one
 * projection slip away from a remote model.
 */
const TENANT_SELECT = { id: true, slug: true, name: true, status: true, createdAt: true } as const;

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "pepweb.store").replace(/:\d+$/, "");

async function allTenants(): Promise<TenantRow[]> {
  return prisma.tenant.findMany({ select: TENANT_SELECT, orderBy: { name: "asc" } });
}

/** Read-only: the stores that exist, as the operator would recognise them. */
export async function callListTenants(args: Record<string, unknown>): Promise<ToolResult> {
  const tenants = await allTenants();
  const directory = buildTenantDirectory(tenants, {
    query: args.query,
    limit: args.limit,
    rootDomain: ROOT_DOMAIN,
  });
  return ok(directory);
}

export type ResolvedTenant = { id: string; slug: string; name: string };

/**
 * Resolve a tool's `tenantSlug` argument to exactly one tenant.
 *
 * Shared by every tenant-scoped tool so a store is addressable the same way
 * everywhere: by slug, by the name the operator actually says, or by a pasted
 * storefront URL. Returns an error STRING rather than throwing, because each
 * caller reports failure in its own result shape — and the string always tells
 * the model what to do next, since a bare "not found" strands it.
 */
export async function resolveTenantArg(
  raw: unknown,
): Promise<{ ok: true; tenant: ResolvedTenant } | { ok: false; error: string }> {
  const tenants = await allTenants();
  const match = buildTenantMatch(raw, tenants);
  if (!match.ok) return { ok: false, error: match.message };
  const { id, slug, name } = match.tenant;
  return { ok: true, tenant: { id, slug, name } };
}
