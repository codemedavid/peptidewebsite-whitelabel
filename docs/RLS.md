# Row-Level Security (Task B2) — defense-in-depth tenant isolation

Tenant isolation has **two layers**:

| Layer | Where | What it does |
|---|---|---|
| 1 — primary | `forTenant()` / `withTenant()` Prisma extension (`src/lib/db/tenant-client.ts`) | Forces `tenantId` into every read/write so app code can't forget it. |
| 2 — backstop | Postgres RLS (`prisma/rls.sql`) under a restricted role | The **database** rejects cross-tenant access even if Layer 1 is bypassed or buggy. |

This doc covers Layer 2: the role, the connection setup, how to apply it, and how to verify it.

---

## 1. The roles

| Role | Used by | Superuser? | BYPASSRLS? | Purpose |
|---|---|---|---|---|
| `postgres` | migrations, seeds, applying these SQL files, platform-admin writes | no (Supabase) | **yes** | Privileged. Not subject to RLS. |
| `app_user` | the application runtime (`DATABASE_URL`) | no | **no** | Every query is constrained by the policies. |
| `anon` | anonymous storefront reads (Supabase) | no | no | SELECT-only, narrowed to published/active rows. |

`app_user` is created by `prisma/roles.sql`. **Edit the password in that file first**, then point the app's `DATABASE_URL` at it.

> Why a dedicated role: `FORCE ROW LEVEL SECURITY` makes policies apply even to a
> table's owner, but a **superuser or BYPASSRLS role still bypasses RLS entirely**.
> Supabase's `postgres` role has BYPASSRLS, so the app must connect as a separate
> non-privileged role for the policies to mean anything.

---

## 2. How a tenant query reaches the right rows

The policies compare `"tenantId" = current_setting('app.tenant_id', true)`. That GUC
is set **per transaction** by `withTenant()`:

```ts
await withTenant(tenantId, (db) =>
  db.product.findMany({ where: { status: "active" } }),
);
```

`withTenant` opens one interactive transaction, runs
`SELECT set_config('app.tenant_id', $tenantId, true)` as its first statement, then
runs your callback on the **same** connection.

- `set_config(..., true)` is **transaction-local** — required because the app connects
  through Supabase's PgBouncer in *transaction* pooling mode, where a session-level
  `SET` would leak onto a later, unrelated checkout.
- With the GUC **unset**, `current_setting('app.tenant_id', true)` returns `NULL`, so
  every policy is false → **0 rows**. RLS fails closed.

⚠️ **Under `app_user`, all runtime data access must go through `withTenant()`.** A bare
`forTenant()` (no transaction, no GUC) returns 0 rows under this role — keep it only for
privileged/non-RLS contexts (seeds, migrations, admin on the `postgres` connection).

### Column naming gotcha
This schema has **no field-level `@map`**, so Prisma created the tenant key column as
**`"tenantId"`** (camelCase), not `tenant_id`. The policies quote it (`"tenantId"`); an
unquoted `tenantId` would fold to lowercase and silently match nothing. If you ever add
`@map("tenant_id")` to the schema, update `prisma/rls.sql` and `prisma/rls-check.ts` to
match.

---

## 3. Coverage (`prisma/rls.sql`)

- **All 18 tenant-owned tables** (`products`, `orders`, `contacts`, `events`, … — full
  list in §1 of the file): `ENABLE` + `FORCE` RLS, policy `tenant_isolation` on
  `"tenantId"` for `app_user`, with both `USING` (reads/updates/deletes) and `WITH CHECK`
  (inserts/updates can't write another tenant's id).
- **`tenants`**: scoped by `id` — under `app_user` a tenant sees only its own row.
- **`cart_items` / `order_items`** (no own `tenantId`): scoped via an `EXISTS` join to the
  RLS-protected parent `carts` / `orders`.
- **Anonymous reads** (`anon` role): SELECT-only on the public storefront surface
  (`tenants`, `domains`, `products`, `pages`, `blog_posts`, `branding`, `tenant_settings`,
  `media_assets`), still scoped by tenant **and** narrowed to active/published rows.
- **Not covered, deliberately**: `plans`, `features`, `plan_features` (global catalog,
  no RLS) and `platform_users` (privileged path only — never granted to `anon`).

---

## 4. Apply

Run **as the privileged `postgres` role** (the `DIRECT_URL`), roles first:

```bash
# Recommended — explicit privileged connection:
psql "$DIRECT_URL" -f prisma/roles.sql      # create app_user + anon, grants
psql "$DIRECT_URL" -f prisma/rls.sql         # enable + FORCE RLS, policies

# Or via Prisma (NOTE: these use DATABASE_URL — point it at the postgres role
# while applying, since app_user can't ALTER TABLE / CREATE ROLE):
npm run db:roles
npm run db:rls
```

Re-run `prisma/rls.sql` after every `prisma migrate` / `db push` — it's idempotent, and a
new table without a policy is a hole. (Add any new tenant table to the array in §1 of the
file and grant it in `roles.sql`.)

Then switch the app's `DATABASE_URL` to the `app_user` credentials.

---

## 5. Verify (acceptance)

```bash
APP_DATABASE_URL="postgresql://app_user:...@host:6543/postgres?pgbouncer=true" \
DIRECT_URL="postgresql://postgres:...@host:5432/postgres" \
npm run db:rls:check
```

`prisma/rls-check.ts` connects as `app_user` and asserts:

1. **No GUC set → 0 rows** (even though products exist).
2. GUC = tenant A → sees exactly A's products.
3. GUC = A → **cannot read B's row even by its exact id**.
4. GUC = A → **INSERT stamped with tenant B is rejected** by the DB (`WITH CHECK`).
5. GUC = A → `tenants` exposes only A's own row.

Manual spot-check in `psql` as `app_user`:

```sql
SELECT count(*) FROM products;                                  -- 0 (no GUC)
BEGIN;
  SELECT set_config('app.tenant_id', '<tenant-A-id>', true);
  SELECT count(*) FROM products;                                -- only A's
  SELECT * FROM products WHERE id = '<a-tenant-B-product-id>';  -- 0 rows
COMMIT;
```

---

## 6. Platform-admin writes

Creating/listing tenants and other cross-tenant operations can't run under `app_user`
(the `tenants` policy would block an INSERT whose `id` ≠ the GUC). Those use the
**privileged `postgres` connection** (BYPASSRLS) — wired up as part of the auth/admin
work (Task B5), separate from the tenant runtime client.
