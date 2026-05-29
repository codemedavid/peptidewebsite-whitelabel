-- ============================================================================
-- Postgres Row-Level Security — defense-in-depth tenant isolation.
--
-- Layer 1 (primary) is the forTenant() Prisma extension. This file is Layer 2:
-- the database itself rejects cross-tenant access, so a query that ever forgets
-- the tenant filter leaks nothing.
--
-- ⚠️ COLUMN NAMING: this schema has NO field-level @map, so Prisma created the
--    columns in camelCase — the tenant key column is "tenantId" (NOT tenant_id),
--    likewise "cartId" / "orderId". camelCase identifiers MUST stay quoted in
--    SQL or Postgres folds them to lowercase and the policy silently matches
--    nothing. (The GUC name app.tenant_id is just a setting key and is fine.)
--
-- HOW IT WORKS
--   • The app connects as the non-superuser `app_user` role (see prisma/roles.sql).
--   • Every tenant transaction runs `set_config('app.tenant_id', <id>, true)`
--     first — done for you by withTenant() in src/lib/db/tenant-client.ts.
--   • Policies compare "tenantId" = current_setting('app.tenant_id', true).
--     With the GUC unset, current_setting(..., true) returns NULL, so the
--     comparison is never true → 0 rows. Fails closed.
--   • FORCE ROW LEVEL SECURITY makes the policies apply to the table owner too,
--     so the app role cannot escape them. The privileged `postgres` role used
--     for migrations/seeds has BYPASSRLS and is unaffected.
--
-- APPLY (run as the privileged postgres role, AFTER prisma/roles.sql):
--     psql "$DIRECT_URL" -f prisma/rls.sql
--
-- This script is idempotent — safe to re-run after every migration.
-- ============================================================================

-- ── 1. Tenant-owned tables (carry a "tenantId" column) ──────────────────────
-- Enable + FORCE RLS and install the app_user isolation policy for each.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'domains', 'tenant_integrations', 'tenant_feature_overrides', 'contacts',
    'products', 'carts', 'orders', 'storefront_orders', 'events', 'email_logs',
    'automation_runs', 'automation_metrics', 'tenant_users', 'branding',
    'tenant_settings', 'pages', 'blog_posts', 'coupons', 'media_assets'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        FOR ALL TO app_user
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))
    $f$, t);
  END LOOP;
END
$$;

-- ── 2. The tenants table itself (keyed by id, not "tenantId") ───────────────
-- Under the app role a tenant can only ever see/modify its own row; platform
-- admin (creating/listing tenants) uses the privileged BYPASSRLS connection.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  FOR ALL TO app_user
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

-- ── 3. Child rows that isolate through their parent (no own "tenantId") ─────
-- cart_items → carts."tenantId" ; order_items → orders."tenantId".
-- The parent is already RLS-scoped, so the EXISTS sub-select only finds parents
-- belonging to the current tenant.
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_via_cart ON cart_items;
CREATE POLICY tenant_isolation_via_cart ON cart_items
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM carts c
    WHERE c.id = cart_items."cartId"
      AND c."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM carts c
    WHERE c.id = cart_items."cartId"
      AND c."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_via_order ON order_items;
CREATE POLICY tenant_isolation_via_order ON order_items
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items."orderId"
      AND o."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items."orderId"
      AND o."tenantId" = current_setting('app.tenant_id', true)));

-- ── 4. Anonymous storefront reads (Supabase `anon` role) ────────────────────
-- Read-only, still tenant-scoped, and further narrowed to PUBLISHED/ACTIVE rows
-- so anon can never see drafts or archived content. These rely on the consumer
-- (server-rendered storefront, or a PostgREST pre-request hook) having set
-- app.tenant_id; with it unset these return 0 rows, same as everything else.
DROP POLICY IF EXISTS anon_read ON tenants;
CREATE POLICY anon_read ON tenants
  FOR SELECT TO anon
  USING (id = current_setting('app.tenant_id', true)
         AND status = 'active');

DROP POLICY IF EXISTS anon_read ON domains;
CREATE POLICY anon_read ON domains
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true)
         AND verified = true);

DROP POLICY IF EXISTS anon_read ON products;
CREATE POLICY anon_read ON products
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true)
         AND status = 'active' AND active = true);

DROP POLICY IF EXISTS anon_read ON pages;
CREATE POLICY anon_read ON pages
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true)
         AND status = 'published');

DROP POLICY IF EXISTS anon_read ON blog_posts;
CREATE POLICY anon_read ON blog_posts
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true)
         AND status = 'published');

DROP POLICY IF EXISTS anon_read ON branding;
CREATE POLICY anon_read ON branding
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS anon_read ON tenant_settings;
CREATE POLICY anon_read ON tenant_settings
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS anon_read ON media_assets;
CREATE POLICY anon_read ON media_assets
  FOR SELECT TO anon
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- ============================================================================
-- NOT covered, on purpose:
--   plans, features, plan_features  — global catalog, app reads all (no RLS).
--   platform_users                  — platform operators; privileged path only.
-- If a future tenant-owned table is added, add it to the array in §1 (or give
-- it a bespoke policy here) AND grant app_user/anon in prisma/roles.sql.
-- ============================================================================
