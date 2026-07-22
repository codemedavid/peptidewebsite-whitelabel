# TDD Evidence — Tenant deactivate/reactivate cache busting

**Source plan:** none — journeys derived during this TDD run from the question
"is the deactivate and reactivate of the tenant website working?"

## Diagnosis

The suspend toggle *half-worked*. `suspendTenantAction` (src/actions/admin.ts)
flipped `Tenant.status` and the admin UI updated, but it never busted the
storefront caches. The host resolver (src/lib/tenant/resolve.ts) caches
host → tenant with tag `tenant-host:<host>` and `revalidate: 300`, and
`getTenantId()` reads the tenant's status through that cache. Result:

- **Deactivate** → storefront stayed publicly live for up to ~5 minutes.
- **Reactivate** → storefront stayed dark (bounced to /unknown-tenant) for up to ~5 minutes.
- **Custom domains** were never busted at all — not even by `setTenantPlanAction`,
  whose `revalidateTenant(id, slug)` only busted the platform-subdomain entry.

## User journeys

1. As the platform operator, when I deactivate a tenant, their storefront
   (platform subdomain **and** custom domains) goes dark on the next request.
2. As the platform operator, when I reactivate a suspended tenant, their
   storefront is reachable again on the next request.

## Fix

- New pure core `src/lib/tenant/cache-tags.ts` — `tenantCacheTags(id, slug,
  customHosts, root)` computes the full tag set (`tenant:<id>`,
  `tenant-host:<slug>.<root>`, `tenant-host:<custom>` each), normalized,
  deduped, port-stripped.
- `src/lib/tenant/revalidate.ts` — `revalidateTenant` gains an optional
  `customHosts` param (backward compatible with all ~60 existing 1–2 arg call
  sites) and derives its tags from the pure core.
- `src/actions/admin.ts` — `suspendTenantAction` and `setTenantPlanAction`
  select `domains.hostname` and pass the custom hosts to `revalidateTenant`.

## Task report

| Step | Command | Result |
|------|---------|--------|
| RED  | `npm run test:tenant-suspend` | 0 passed, 11 failed — e.g. "suspendTenantAction never calls revalidateTenant() — the storefront stays cached (live/dark) for up to 5 min after the toggle" |
| GREEN | `npm run test:tenant-suspend` | 11 passed, 0 failed |
| Types | `npx tsc --noEmit` | No errors in changed files (2 pre-existing errors in unrelated one-off scripts `fix-pepstack-reseller.ts`, `remove-reseller-data.ts`) |

Checkpoint commits (branch `main`):
- `61d3882` test: RED — reproducer for tenant deactivate/reactivate cache busting (kill-switch latency)
- `201ccf6` fix: tenant deactivate/reactivate takes effect immediately (bust host-resolver caches, incl. custom domains)

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | suspendTenantAction busts tenant + host-resolver caches | `scripts/test-tenant-suspend.ts` (source assertion) | integration (source) | PASS |
| 2 | suspendTenantAction loads custom-domain hostnames | same | integration (source) | PASS |
| 3 | setTenantPlanAction busts custom-domain hosts | same | integration (source) | PASS |
| 4 | revalidateTenant accepts customHosts and uses the pure core | same | integration (source) | PASS |
| 5 | tags always include `tenant:<id>` | `tenantCacheTags` unit | unit | PASS |
| 6 | platform host tag built with port stripped from root | same | unit | PASS |
| 7 | every custom host busted, lowercased | same | unit | PASS |
| 8 | no slug → no phantom platform tag | same | unit | PASS |
| 9 | custom host equal to platform host deduped | same | unit | PASS |
| 10 | blank custom hosts ignored | same | unit | PASS |

## Coverage and known gaps

- The pure core is fully covered by unit tests; the action wiring is verified by
  source assertions (repo precedent: `scripts/test-reseller-gate.ts`), since
  `"use server"` actions can't execute outside the Next runtime in these
  self-contained tsx suites.
- Not covered: a live E2E (deactivate in the admin → curl the subdomain →
  expect /unknown-tenant). Requires a running dev server + DB; do manually via
  `slug.lvh.me:3100` if desired.
- Behavior note (pre-existing, unchanged): reactivating a tenant always sets
  status to `active`, even if the tenant was `trial` before suspension.
