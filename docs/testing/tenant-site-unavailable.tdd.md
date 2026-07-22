# TDD Evidence — Suspended tenant → "Website currently not available"

**Source plan:** none — journeys derived during this TDD run from:
"when the tenant website is deactivate the storefront should display website
currently not available".

## User journeys

1. As a visitor opening a **deactivated** (suspended) tenant's storefront, I see
   "Website currently not available" — not the generic "Site not found".
2. As a visitor on a genuinely unknown domain, I still see "Site not found"
   (/unknown-tenant unchanged).
3. Surfaces gated by `getTenantIdOrNull()` keep treating a suspended tenant as
   unavailable (no behavior change there).

## Implementation

- `src/lib/tenant/gate.ts` — new pure core `storefrontBouncePath(tenant)`:
  `null → /unknown-tenant`, `suspended → /site-unavailable`,
  `pending_setup → /unknown-tenant`, `active|trial → null`.
- `src/lib/tenant/headers.ts` — `getTenantId()` / `getTenantIdOrNull()` now
  decide via the pure core (replaces the inline `HIDDEN_STATUSES` set);
  public signatures unchanged.
- `src/app/site-unavailable/page.tsx` — root route (reachable on tenant hosts,
  middleware passes tenant hosts through) with the "Website currently not
  available" copy, styled like the sibling unknown-tenant page.

## Task report

| Step | Command | Result |
|------|---------|--------|
| RED  | `npm run test:tenant-unavailable` | 0 passed, 9 failed (missing gate.ts, headers.ts not routed through it, page missing) |
| GREEN | `npm run test:tenant-unavailable` | 9 passed, 0 failed |
| Regression | `npm run test:tenant-suspend` | 11 passed, 0 failed |
| Types | `npx tsc --noEmit` | No new errors (2 pre-existing in unrelated one-off scripts) |

Checkpoint commits (branch `main`):
- `5197add` test: RED — reproducer for suspended-tenant 'Website currently not available' page
- `3dcc448` feat: suspended tenant storefront shows 'Website currently not available' page

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | suspended → `/site-unavailable` | `scripts/test-tenant-unavailable.ts` | unit | PASS |
| 2 | unresolved host → `/unknown-tenant` | same | unit | PASS |
| 3 | pending_setup → `/unknown-tenant` | same | unit | PASS |
| 4 | active serves (no bounce) | same | unit | PASS |
| 5 | trial serves (no bounce) | same | unit | PASS |
| 6 | headers.ts routes through the pure core | same | integration (source) | PASS |
| 7 | `/site-unavailable` page exists as root route | same | integration (source) | PASS |
| 8 | page copy says "currently not available" | same | integration (source) | PASS |

## Coverage and known gaps

- The bounce decision is fully unit-covered; wiring + page verified by source
  assertions (repo precedent: `scripts/test-reseller-gate.ts`).
- Not covered: live E2E (suspend in admin → load `slug.lvh.me:3100` → see the
  new page). Verify manually after restarting/hot-reloading the dev server.
- The page is intentionally unbranded (no tenant theme) — the tenant is
  offline, and branding would require resolving tenant data for a suspended
  store.
