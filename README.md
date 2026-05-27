# Peptide White-Label SaaS

One codebase · one database · per-tenant config · feature-gated. Multi-tenant
platform for launching branded peptide storefronts from a shared deployment.

> Architecture source of truth: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> (Package 3 — Automated Growth System). This README covers the **storefront /
> white-label layer** scaffolded on top of it.

## What the schema covers

The Prisma schema merges two layers:

- **Automation/commerce layer** (pre-existing): `Plan` / `Feature` / `PlanFeature` /
  `TenantFeatureOverride` entitlements, `TenantIntegration` (envelope-encrypted creds),
  `Contact`, `Cart`, `Order`, `Event` outbox, `EmailLog`, `AutomationRun`/`Metric`.
- **White-label layer** (added): `TenantUser` + `PlatformUser` (RBAC), `Branding`,
  `TenantSettings`, `Page` (section builder), `BlogPost`, `Coupon`, `MediaAsset`,
  plus storefront fields on `Product` (`slug`, `images`, `status`, compliance `metadata`).

## Tenant isolation (app-extension-first)

Primary enforcement is `forTenant(tenantId)` in `src/lib/db/tenant-client.ts` — a
Prisma client extension that injects `tenantId` into every multi-row read/write and
stamps it on creates. **Always** use it inside tenant context; never the raw `prisma`
client for tenant data. Postgres RLS (`prisma/rls.sql`) is the documented phase-2
backstop (not yet applied).

## Tenant resolution (diverges from docs §2.2 — intentionally)

The docs show the DB lookup happening *inside* edge middleware. Prisma can't run on the
Edge runtime, so here:

- `src/middleware.ts` (Edge) only tags the request with `x-tenant-host` and routes by host.
- `src/lib/tenant/headers.ts#getTenantId()` (Node, `react/cache` + `unstable_cache`)
  resolves host → tenant server-side.

For production, mirror host→tenantId into **Vercel Edge Config / Upstash KV** and read it
in middleware for sub-ms resolution + early rejection of unknown hosts.

## File map

```
src/
├── middleware.ts                     host-based routing (Edge, no DB)
├── lib/
│   ├── db/{prisma,tenant-client}.ts  singleton + forTenant() isolation
│   ├── tenant/{headers,resolve,context}.ts
│   ├── auth/{supabase-server,supabase-client,session,rbac}.ts
│   ├── features/{catalog,entitlements}.ts
│   ├── theme/{presets,resolve-css-vars}.ts
│   └── imagekit/server.ts
├── modules/                          modular section builder
│   ├── SectionRenderer.tsx
│   └── sections/{registry,Hero,ProductGrid,FAQ,ComplianceBanner}.tsx
├── components/Gate.tsx               feature-gate (UI layer)
├── actions/onboarding.ts            createTenant() server action
└── app/
    ├── (tenant)/(storefront)/        public themed storefront
    ├── (tenant)/dashboard/           tenant backoffice (role-guarded)
    ├── (platform)/admin/             platform admin (super_admin-guarded)
    ├── unknown-tenant/               fallback for unresolved hosts
    └── api/imagekit/auth/            signed upload params
```

## Run locally

```bash
cp .env.example .env        # fill in Supabase + ImageKit creds
npm run db:migrate          # create tables
npm run db:seed             # plans, features, demo tenant "acme"
npm run dev
```

Then visit **http://acme.localhost:3000** (browsers resolve `*.localhost`
automatically). Platform admin: **http://admin.localhost:3000**.

## Dynamic theming

`Branding` → `resolveCssVars()` → inline CSS variables on the storefront layout,
consumed by Tailwind tokens (`hsl(var(--primary))` …). Rebranding a tenant is a DB
write, not a deploy. Presets live in `src/lib/theme/presets.ts`.
# peptidewebsite-whitelabel
