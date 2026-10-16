import "server-only";

// Shared I/O for the MCP store-settings tools: run a website store-admin action
// as the store OWNER, read/write branding.config, and shape tool results.
//
// Why run the website's actions instead of writing config here: those actions
// are where validation, plan locks (isBusinessExclusiveLocked / hasFeature),
// demo mode and cache busting live. Re-implementing them for the connector would
// fork every rule. The mobile app solved the same problem with the actor scope
// (lib/auth/app-actor-scope.ts); the connector reuses it. Auth is the ROUTE's
// job — nothing here runs until the operator's MCP admin token checked out.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { runAsAppActor } from "@/lib/auth/app-actor-scope";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { resolveTenantArg, type ResolvedTenant } from "@/lib/mcp/tenant-lookup-tool";
import { resolveMcpImage, type McpMediaKind } from "@/lib/mcp/tenant-media";
import type { McpImageAsset } from "@/lib/mcp/image-assets";
import type { Row } from "@/lib/mcp/store-settings-core";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError: boolean;
};

export const TOKEN_SCHEMA = {
  type: "string",
  description:
    "Fallback token for connectors configured with No Authentication. Prefer an Authorization: Bearer header, or a ?token= parameter on the connector URL.",
} as const;

export const TENANT_SCHEMA = {
  type: "string",
  description:
    "Which store: its slug, its display name, or its storefront URL. Call list_whitelabel_tenants if unsure.",
} as const;

export function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function ok(result: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError };
}

export function plainObject(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

export function rowList(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(plainObject).filter((r): r is Row => !!r) : [];
}

export async function resolveTenant(raw: unknown): Promise<{ ok: true; tenant: ResolvedTenant } | { ok: false; result: ToolResult }> {
  const resolved = await resolveTenantArg(raw);
  return resolved.ok ? resolved : { ok: false, result: fail(resolved.error) };
}

export async function readConfig(tenantId: string): Promise<Row> {
  const branding = await prisma.branding.findUnique({ where: { tenantId }, select: { config: true } });
  return (plainObject(branding?.config) ?? {}) as Row;
}

/** Read-modify-write a config patch (fresh read, so an action that ran just
 *  before in the same call is never overwritten), then bust the storefront cache. */
export async function writeConfigPatch(tenant: ResolvedTenant, patch: (current: Row) => Row): Promise<void> {
  const current = await readConfig(tenant.id);
  const config = patch(current) as Prisma.InputJsonValue;
  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: { config },
    create: { tenantId: tenant.id, config },
  });
  revalidateTenant(tenant.id, tenant.slug);
}

/** Run a website store-admin action as this store's owner. */
export function runAsStoreOwner<T>(tenant: ResolvedTenant, run: () => Promise<T>): Promise<T> {
  return runAsAppActor({ tenantId: tenant.id, slug: tenant.slug, subject: { kind: "owner" } }, run);
}

export type StepResult = { step: string; ok: boolean; error?: string; detail?: unknown };

/** Run one owner-scoped action and fold its {ok}|{error} reply into a step. */
export async function ownerStep(
  tenant: ResolvedTenant,
  step: string,
  run: () => Promise<unknown>,
): Promise<StepResult> {
  try {
    const reply = await runAsStoreOwner(tenant, run);
    const obj = plainObject(reply);
    if (typeof obj?.error === "string") return { step, ok: false, error: obj.error };
    // A plain {ok:true} carries nothing worth echoing; anything else (a read) does.
    const detail = obj && obj.ok === true && Object.keys(obj).length === 1 ? undefined : reply;
    return detail === undefined ? { step, ok: true } : { step, ok: true, detail };
  } catch (e) {
    return { step, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Summarize steps; any failure makes the whole tool result an error. */
export function stepsResult(tenant: ResolvedTenant, steps: StepResult[], extra: Row = {}): ToolResult {
  if (steps.length === 0) return fail("Nothing to change — send at least one section.");
  const failed = steps.filter((s) => !s.ok);
  return ok(
    {
      tenant: { slug: tenant.slug, name: tenant.name },
      applied: steps.filter((s) => s.ok).map((s) => s.step),
      ...(failed.length ? { failed: failed.map(({ step, error }) => ({ step, error })) } : {}),
      ...extra,
    },
    failed.length > 0,
  );
}

/**
 * Upload each row's `<assetKey>` image (if any) and set `<urlKey>` to the hosted
 * URL. Returns new rows; inputs are not mutated. Throws with the row named.
 */
export async function uploadRowImages(
  tenant: ResolvedTenant,
  rows: readonly Row[],
  assetKey: string,
  urlKey: string,
  kind: McpMediaKind,
  nameKey: string,
): Promise<Row[]> {
  const out: Row[] = [];
  for (const row of rows) {
    const { [assetKey]: asset, ...rest } = row;
    const assetObj = plainObject(asset);
    if (!assetObj) {
      out.push(rest);
      continue;
    }
    try {
      const uploaded = await resolveMcpImage(tenant.id, assetObj as McpImageAsset, kind);
      out.push({ ...rest, [urlKey]: uploaded.url });
    } catch (e) {
      throw new Error(`"${String(row[nameKey] ?? "row")}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** Strip upload-only keys so a dry validation pass sees plain rows. */
export function withoutKey(rows: readonly Row[], key: string): Row[] {
  return rows.map((r) => {
    const { [key]: _dropped, ...rest } = r;
    void _dropped;
    return rest;
  });
}
