# Admin icon registry — missing-key crash fix — TDD evidence

**Branch:** `feat/trial-system` · **Date:** 2026-07-21

## Source / trigger

Follow-up to the near-due work: while building the "Expiring soon" surfaces I used `Ic.Clock`,
which type-checked but crashed at runtime. Root cause, not a one-off:

`src/components/admin/shell/primitives.tsx` exports `Ic: Record<string, LucideIcon>`. The index
signature means **any** access — `Ic.Clock`, `Ic.Box`, a typo, or a dynamic `Ic[name]` — type-checks
even when the key isn't in the map, then returns `undefined`. Rendering `<undefined />` throws
React's "Element type is invalid", and `tsc` never flags it. The registry was in fact already
missing `Box` (used by the dashboard KPI + activity feed) and `Clock`.

## User journeys

1. As a developer, if I reference an icon name that isn't in the registry, the admin renders a
   visible placeholder instead of crashing the whole page.
2. As the operator, the dashboard/tenants views never white-screen because of an icon typo.
3. Genuinely-referenced icons (`Box`, `Clock`) render their real Lucide glyph, not the placeholder.

## RED / GREEN

| Gate | Command | Result |
|------|---------|--------|
| RED | `npm run test:icon-fallback` | FAIL — `Cannot find module '../src/components/admin/shell/icon-fallback'` (compile-time RED) |
| GREEN | `npm run test:icon-fallback` | **6 passed, 0 failed** |
| Regression | `test:near-due` / `test:billing-cycle` / `test:subscription-state` / `test:trial-state` / `test:trial-gating` | 10 / 20 / 14 / 13 / 18 passed |
| Types | `npx tsc --noEmit --pretty false` | **0 errors** |

## The fix

| Layer | File |
|-------|------|
| Pure guard (RED/GREEN) | `src/components/admin/shell/icon-fallback.ts` — `withIconFallback(registry, fallback)` returns a `Proxy` whose `get` returns `fallback` for any missing **string** key (symbols pass through untouched). |
| Wiring | `primitives.tsx` — `Ic = withIconFallback({ …map… }, AlertCircle)`. A wrong/missing name now degrades to a visible `AlertCircle` placeholder instead of crashing. |
| Data fix | Added the genuinely-referenced `Box` and `Clock` to the registry so they render their real glyph rather than the placeholder. |

The two `Ic.Clock` usages I first wrote in `DashboardView`/`TenantsTable` were already swapped for
plain dots during the near-due build; this change fixes the underlying class of bug so it can't recur.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | A known key returns its own mapped component | `test-icon-fallback.ts` | unit | PASS |
| 2 | A missing key returns the fallback, never `undefined` | `test-icon-fallback.ts` | unit | PASS |
| 3 | Clock / Box / Timer / arbitrary names all resolve to a component | `test-icon-fallback.ts` | unit | PASS |
| 4 | Dynamic `Ic[name]` is safe for an unknown name | `test-icon-fallback.ts` | unit | PASS |
| 5 | The underlying registry is not mutated | `test-icon-fallback.ts` | unit | PASS |
| 6 | Symbol access passes through (not shadowed by the fallback) | `test-icon-fallback.ts` | unit | PASS |

## Known gaps / follow-ups

1. The fallback is a runtime safety net; `tsc` still can't reject a bad string literal (index signatures
   preclude that while dynamic `Ic[name]` access exists). A follow-up could add a lint/test that every
   string passed as an `icon` prop is a real registry key.
2. No component/visual test that the placeholder actually renders (pure-core coverage only).
