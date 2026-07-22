# TDD Evidence — Code-review fixes for the tenant suspend/unavailable work

**Source plan:** the 8 findings from `/code-review` (2026-07-23) on commits
`61d3882..53d1a58`; 7 fixed, 1 skipped.

## Fixes (RED `85becd4` → GREEN `e0fddd7`, branch `main`)

| Finding | Fix |
|---|---|
| deleteTenantAction skips tenant-host busting | Captures domain hostnames **before** the cascade delete, then `revalidateTenant(id, slug, hostnames)` |
| Custom-host enumeration left to each caller (altitude) | New `revalidateTenantVisibility(tenantId)` in `lib/tenant/revalidate.ts` self-fetches slug + domains; `publishTenantAction`/`unpublishTenantAction` now use it |
| Duplicated host normalization | `normalizeHost()` exported from `lib/tenant/cache-tags.ts`; `resolve.ts` (cache key) and `tenantCacheTags` (bust tags) share it |
| Suspend toggle race | Conditional `updateMany({ where: { id, status: <read> } })`; count 0 → "just changed — refresh" error |
| Demo suspend fakes status "active" | Demo branch returns explicit "Suspending built-in demo tenants isn't supported." (both UIs toast `res.error`) |
| /site-unavailable no title/noindex | `export const metadata` with title + `robots: { index: false, follow: false }` |
| Grep-brittle test assertions | `fnBody` now brace-matches the exact function instead of comment-boundary slicing |
| Live SPA sessions survive a suspend | **Skipped** — needs a design decision (mount a heartbeat for non-gated stores or add a status check to /api/gate/session); follow-up |

## Validation

| Step | Command | Result |
|---|---|---|
| RED | `npm run test:tenant-suspend` / `test:tenant-unavailable` | 11 passed / 8 failed and 9 passed / 1 failed — each new check failed for its intended reason |
| GREEN | same | **19 passed / 0 failed** and **10 passed / 0 failed** |
| Types | `npx tsc --noEmit` | No new errors (2 pre-existing in unrelated one-off scripts) |

New guarantees added to the suites: delete busts host caches; publish/unpublish
bust via the self-fetching helper; `revalidateTenantVisibility` exists and
self-fetches; resolver and bust tags share `normalizeHost` (plus a unit test);
suspend flip is conditional; demo mode errors honestly; the unavailable page is
noindexed and titled.

## Round 2 (review of the fixes; RED `af6ed67`-era commit → GREEN `ce08a06`)

6 findings; 5 fixed, 1 skipped (accepted tradeoff). RED: 16 passed / 5 failed;
GREEN: `test:tenant-suspend` **21/21**, `test:tenant-unavailable` **10/10**,
`tsc` no new errors.

| Finding | Outcome |
|---|---|
| setTenantPlanAction fakes demo success | Fixed — honest "Changing built-in demo tenants isn't supported." error |
| suspend/setPlan bypass the helper | Fixed — both now `await revalidateTenantVisibility(tenant.id)`; manual domains selects dropped (delete keeps pre-captured hosts by necessity) |
| normalizeHost keeps trailing FQDN dots | Fixed — `.replace(/\.$/, "")`, unit-tested |
| Dead `slug: true` selects in publish/unpublish | Fixed — selects fetch `tenantId` only; source assertion guards regressions |
| Orphaned JSDoc in cache-tags | Fixed — comments re-attached per function |
| Extra query per publish (self-fetch helper) | Skipped — deliberate cost of the can't-forget design on a rare operator action |
