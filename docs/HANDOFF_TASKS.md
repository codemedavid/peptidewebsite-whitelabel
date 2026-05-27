# Hand-off Task Pack — Peptide White-Label SaaS

Self-contained work items for parallel agents working in **this** repo (Next.js 15 App Router,
TypeScript, Tailwind, Prisma + Supabase, demo-mode fallback). Each task lists current state,
files, what to build, and acceptance criteria. Copy a single `## Task` block into another
terminal as its prompt.

## Repo orientation (read first)
- **Tenancy:** `src/middleware.ts` tags `x-tenant-host`; `src/lib/tenant/headers.ts#getTenantId()`
  resolves it (Node, cached). `src/lib/tenant/context.ts#getTenantContext()` returns tenant +
  branding + entitlements.
- **DB:** `prisma/schema.prisma`; access via `src/lib/db/tenant-client.ts#forTenant(tenantId)`
  (auto-injects `tenantId`). Never use the raw `prisma` client for tenant-owned data.
- **Demo mode:** `src/lib/demo/fixtures.ts#isDemoMode()` is true when `DEMO_MODE=true` or
  `DATABASE_URL` is the placeholder. In demo, data comes from fixtures + `.demo-data/*.json`.
  **Every data touchpoint must keep a demo branch** so work stays viewable without a DB.
- **Theming:** `src/lib/theme/{presets,tokens,resolve-css-vars}.ts`. Components read CSS vars
  (`hsl(var(--primary))`, `text-brand`, `text-accent`). Never hardcode color/font.
- **Features:** `src/lib/features/{catalog,entitlements}.ts`, `<Gate>` in `src/components/Gate.tsx`.
- **Conventions:** String statuses, `@@map` snake_case, indexes lead with `tenantId`,
  composite uniques `[tenantId, x]`. Run `npx tsc --noEmit` + `npx next build` before done.
- **Naming note (see Task A4):** themes are `default|midnight|apex`, plans `basic|ecommerce|growth`.

---

## Task A1 — Feature-toggle admin panel + route guards + catalog

**Depends on:** nothing (demo-viable).
**State:** flag *system* exists (`lib/features/catalog.ts`, `entitlements.ts`, `<Gate>`), enforced
in some server actions via `requireFeature`. Missing: admin UI to toggle, per-route guards, and a
broader catalog.

**Build:**
1. **Broaden the catalog** in `lib/features/catalog.ts` with the granular keys from the spec:
   `calculator`, `orderTracking`, `floatingCart`, `multiCurrency`, `productSpecs`, `search`,
   `categories`, `communityLink`, plus notify/email keys. Add them to the relevant plan tiers.
2. **Demo persistence:** in `lib/demo/fixtures.ts` add `getDemoFeatures(slug)` / `saveDemoFeatures(slug, map)`
   backed by `.demo-data/features.json` (mirror the `branding.json` pattern). Merge into
   `getDemoContext().features`.
3. **Admin Features panel:** `src/app/(platform)/admin/tenants/[slug]/features/page.tsx`
   (server loads current flags) + a client `FeaturesEditor` (grouped toggles with descriptions;
   show which are locked by the tenant's plan). Server action `saveFeaturesDemoAction(slug, map)`
   in `src/actions/demo.ts` (guard `isDemoMode()`, `revalidatePath`). Add an "Edit features" link
   in the admin tenant table (`src/app/(platform)/admin/page.tsx`).
4. **Route guards:** for gated storefront routes that exist or get added (`/products` specs,
   future `/coa`, `/faq`, `/calculator`, `/track-order`, `/blog`), check the feature in the page/
   layout and `notFound()` if disabled — don't just hide nav. Add a small helper
   `requireFeaturePage(tenantId, key)` in `lib/features/entitlements.ts` that throws `notFound()`.
5. Gate the existing nav links (`(tenant)/(storefront)/layout.tsx`) with `<Gate>`.

**Acceptance:** toggling a feature off in admin hides its nav link, makes its route `notFound()`,
and (where a server action exists) rejects it server-side. Plan still caps availability. Works in
demo (no DB). `tsc` + `build` clean.

---

## Task A2 — Per-tenant order-number format

**Depends on:** nothing (demo-viable); ties into B-track for the real generator.
**State:** `Order.orderNumber Int` with `@@unique([tenantId, orderNumber])`. No configurable
format, no generator.

**Build:**
1. **Schema:** add `orderNumberFormat Json @default("{}")` to `Tenant` (or `TenantSettings`):
   `{ prefix, separator, scheme: 'random'|'sequential', digits }`. For sequential, add
   `orderSeq Int @default(1000)` on `Tenant`.
2. **Generator:** `src/lib/orders/order-number.ts#nextOrderNumber(tenantId)` →
   `${prefix}${separator}${pad(n, digits)}`. Sequential = atomic increment of `Tenant.orderSeq`
   inside a transaction; random = N-digit with collision retry. Must be server-side.
3. **Change `orderNumber` to `String`** (formatted code) and keep `@@unique([tenantId, orderNumber])`.
   Update any references (none render yet, but check `prisma/seed.ts`).
4. **Admin UI:** add format fields to the create-tenant wizard
   (`src/app/(platform)/admin/tenants/new/page.tsx`) and a setting in the branding/settings area.
   Default `prefix` from business-name initials, `-`, 4 digits. Demo: persist in `.demo-data`.
5. Validate prefix (upper-case, `^[A-Z0-9]{2,6}$`); warn that format changes affect only new orders.

**Acceptance:** two tenants can both produce `ABC-1001`; sequential increments per tenant; unique
per tenant. `tsc` + `build` clean.

---

## Task A3 — Editable hero typography + live preview

**Depends on:** nothing (demo-viable). Builds on the branding editor (Task done).
**State:** `Hero` section (`src/modules/sections/Hero.tsx`) renders content props. No typography
controls.

**Build:**
1. Extend hero props/settings with: `titleFont`, `titleSize` (`sm|md|lg|xl` → responsive clamp),
   `titleWeight`, `bodyFont`, `bodySize`, `highlightColor`, `align`. Store per-tenant (demo:
   `.demo-data`; later `Page.sections`/settings).
2. Drive them via inline styles / CSS vars on `Hero`, **not** hardcoded Tailwind classes. Sizes are
   friendly presets that clamp on mobile (e.g. `clamp(1.75rem, 5vw, 3.5rem)` for `xl`).
3. Reuse the dynamic Google-Fonts loader (`lib/theme/tokens.ts#googleFontsUrl`) so the hero font
   can differ from the global heading font.
4. Add a **Hero** tab to the branding editor (`src/components/admin/BrandingEditor.tsx` or a sibling)
   with the existing live-preview pattern.

**Acceptance:** editing hero font/size/align updates the live preview and the storefront hero;
defaults inherit from the active theme; mobile never overflows. `tsc` + `build` clean.

---

## Task A4 — Naming alignment (themes + plans)

**Depends on:** nothing. **Do this before more UI to avoid churn.**
**State:** themes `default|midnight|apex`; plans `basic|ecommerce|growth`. Spec wants
`clinical-white|midnight-lab|apex-performance` and `starter|pro|enterprise`.

**Build:** decide with the owner, then rename consistently across `lib/theme/presets.ts`,
`lib/features/catalog.ts` (PLAN_FEATURES keys + names), `prisma/seed.ts`, `lib/demo/fixtures.ts`,
wizard/editor option lists. Keep a back-compat alias map if any persisted data uses old keys.

**Acceptance:** one canonical set of ids everywhere; `tsc` + `build` clean; demo tenants still render.

---

## Task A5 — UI/UX polish

**Depends on:** nothing (demo-viable).
**Build:** (a) reusable themed primitives in `src/components/ui/` (Button, Input, Select, Card,
Badge, Modal) reading theme tokens; refactor storefront/admin to use them. (b) Loading skeletons
for catalog/admin lists. (c) Accessibility pass: focus rings, `aria-label`s on icon-only buttons,
keyboard nav for modals/drawers, color-contrast check on all three themes (esp. Midnight Lab).
(d) Responsive: admin tables → cards on mobile.

**Acceptance:** all three themes look intentional; Lighthouse a11y ≥ 95 on storefront; no inline
hex anywhere. `tsc` + `build` clean.

---

## Task B2 — Activate Postgres RLS (defense-in-depth)

**Depends on:** B1 (DB connected).
**State:** `prisma/rls.sql` written but NOT applied; Prisma connects privileged and bypasses RLS.
Primary isolation is the `forTenant()` extension.

**Build:**
1. Create a dedicated non-superuser DB role for the app; `FORCE ROW LEVEL SECURITY` on every
   tenant-owned table; policies `USING (tenant_id = current_setting('app.tenant_id', true))`.
2. Set `app.tenant_id` per transaction. Wrap tenant reads/writes so they run
   `SELECT set_config('app.tenant_id', $1, true)` first — extend `forTenant()` to use an
   interactive transaction, or add a `withTenant(tenantId, fn)` helper.
3. Flesh out `prisma/rls.sql` for ALL tenant tables (list is in the file). Add anon read-only
   policies for public storefront tables, still scoped by `tenant_id`.

**Acceptance:** with the app role, a query without the GUC set returns 0 rows; crafted cross-tenant
access is rejected by the DB, not the app. Document the role + connection setup.

---

## Task B3 — Per-tenant storage namespacing + logo upload

**Depends on:** B1.
**State:** `MediaAsset` model + `src/app/api/imagekit/auth/route.ts` exist; no path scoping; branding
editor has no logo upload.

**Build:** (a) every upload writes under `tenant/<tenantId>/…` (ImageKit folder); the auth route
returns params scoped to the tenant. (b) Add logo upload to the branding editor → store on
`Branding.logoUrl` (+ `MediaAsset` row). (c) Storefront already prefers `branding.logoUrl` over the
monogram — verify. (d) Add a `faviconUrl` upload that overrides `/api/favicon`.

**Acceptance:** uploaded logo appears on that tenant's storefront only; one tenant's signed URL
can't list another's objects. `tsc` + `build` clean.

---

## Task B4 — Two-tenant isolation test (must pass before shipping)

**Depends on:** B1 (and ideally B2).
**Build:** a script/test that seeds two tenants with overlapping data, then asserts: tenant A's
queries (products, orders, media, analytics) return only A; a request forging tenant B's id is
rejected; image URLs don't cross tenants. Add as `npm run test:isolation`.

**Acceptance:** the test passes and fails loudly if a `tenantId` filter or RLS policy is removed.

---

## Task B5 — Supabase Auth + DB-backed admin/dashboard writes

**Depends on:** B1.
**State:** `lib/auth/{supabase-server,supabase-client,session}.ts` exist; admin/branding/wizard
write actions are demo-only (`saveBrandingDemoAction`, `createTenantDemoAction`). `getPlatformUser()`
and `getTenantSession()` gate the admin/dashboard but there's no login UI.

**Build:** (a) login route + Supabase email auth; (b) seed a `PlatformUser` for the owner;
(c) DB-backed versions of the create-tenant and save-branding actions (use the real
`actions/onboarding.ts#createTenant`; add `saveBranding` writing the `Branding` row); switch the
admin/editor to call the demo OR DB action based on `isDemoMode()`; (d) remove the `ADMIN_DEV_OPEN`
bypass once real auth works; (e) tenant dashboard (`(tenant)/dashboard`) unlocks for members.

**Acceptance:** logging in as the platform owner shows the admin against the real DB; creating a
tenant + editing branding persists to Postgres; non-members can't reach a tenant's dashboard.
`tsc` + `build` clean.

---

## Suggested parallelization
- **Owner (B1):** connect Supabase — unblocks B2–B5.
- **Agent 1:** A4 (naming) → A1 (feature toggles).
- **Agent 2:** A2 (order numbers) → A3 (hero typography).
- **Agent 3:** A5 (UI/UX) — independent.
- After B1 lands: B2 (RLS) + B3 (storage) + B5 (auth) → B4 (isolation test) gates release.

> Coordination: A2 and A4 both touch `prisma/schema.prisma` and `seed.ts` — land A4 first or
> rebase. Everything must preserve the demo-mode branch so the app stays runnable without a DB.
