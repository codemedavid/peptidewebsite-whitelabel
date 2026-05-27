import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Tenant isolation, two layers:
 *
 *   Layer 1 — forTenant() : the Prisma client extension (PRIMARY).
 *   Layer 2 — withTenant() : the same extension *inside* an interactive
 *             transaction that sets the Postgres `app.tenant_id` GUC, so the
 *             RLS policies in prisma/rls.sql can enforce isolation in the DB.
 *
 * forTenant(tenantId) returns a Prisma client that automatically:
 *   - injects `tenantId` into the WHERE of every multi-row read/write, and
 *   - stamps `tenantId` onto every create.
 *
 * Single-row ops (findUnique/update/delete) are intentionally NOT rewritten:
 * every tenant model in this schema is keyed by a tenant-inclusive composite
 * unique (e.g. tenantId_slug, tenantId_sku, tenantId_userId), so those calls
 * are already tenant-scoped by their key. Do not call them with a bare global id.
 * (Under RLS, the USING clause covers this gap too — a single-row read of
 * another tenant's row returns nothing even if you hand it a global id.)
 *
 * ⚠️ Choosing between the two:
 *   - Under the RLS-restricted app role (the production runtime), every query
 *     MUST run inside withTenant() — otherwise app.tenant_id is unset and the
 *     FORCEd policies return 0 rows. Prefer withTenant() for all runtime access.
 *   - forTenant() (no transaction, no GUC) is for privileged / non-RLS contexts:
 *     seed scripts, migrations, and platform-admin connections that run as a
 *     BYPASSRLS role. Using it under the app role yields empty results, by design.
 */

// camelCase delegate names that carry a `tenantId` scalar column.
const TENANT_MODELS = new Set<string>([
  "domain",
  "tenantIntegration",
  "tenantFeatureOverride",
  "contact",
  "product",
  "cart",
  "order",
  "event",
  "emailLog",
  "automationRun",
  "automationMetric",
  "tenantUser",
  "branding",
  "tenantSettings",
  "page",
  "blogPost",
  "coupon",
  "mediaAsset",
]);

const SCOPED_READS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

export function forTenant(tenantId: string) {
  if (!tenantId) throw new Error("forTenant() requires a tenantId");

  return prisma.$extends(tenantExtension(tenantId));
}

export type TenantClient = ReturnType<typeof forTenant>;

// The transactional client handed to a withTenant() callback. It is the
// extended client minus the methods Prisma forbids inside an interactive
// transaction (connection lifecycle + nested $transaction/$extends).
export type TenantTx = Omit<
  TenantClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$transaction" | "$extends"
>;

/**
 * RLS-safe tenant access. Opens one interactive transaction, sets the
 * transaction-local `app.tenant_id` GUC on that connection, then runs `fn`
 * against a tenant-scoped client bound to the same connection.
 *
 * Why a transaction (not a session SET): the app connects through Supabase's
 * PgBouncer in *transaction* pooling mode, where a bare `SET` would leak onto
 * an arbitrary later checkout. `set_config(_, _, true)` is transaction-local,
 * so the GUC lives and dies with this transaction on this exact connection —
 * matching the rows the RLS policies will allow.
 *
 *   const orders = await withTenant(tenantId, (db) =>
 *     db.order.findMany({ where: { status: "paid" } }),
 *   );
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantTx) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("withTenant() requires a tenantId");

  const db = forTenant(tenantId);
  return db.$transaction(async (tx) => {
    // MUST be the first statement: scopes every policy in this transaction.
    // Parameterized, so the tenantId can never break out into SQL.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// Builds the tenant-scoping query extension. Shared by forTenant() and (via it)
// withTenant() so both layers apply the exact same WHERE/data rewrites.
function tenantExtension(tenantId: string) {
  return Prisma.defineExtension({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const delegate = model
            ? model.charAt(0).toLowerCase() + model.slice(1)
            : "";
          if (!TENANT_MODELS.has(delegate)) return query(args);

          const a = args as Record<string, unknown>;

          if (SCOPED_READS.has(operation)) {
            a.where = { ...(a.where as object), tenantId };
          } else if (operation === "create") {
            a.data = { ...(a.data as object), tenantId };
          } else if (operation === "createMany") {
            const data = (a.data as unknown[]) ?? [];
            a.data = (Array.isArray(data) ? data : [data]).map((d) => ({
              ...(d as object),
              tenantId,
            }));
          }
          return query(a);
        },
      },
    },
  });
}
