# Store admin logs out on every refresh — TDD evidence

**Branch:** `feat/gb-pricing-tab`
**Date:** 2026-07-31
**Source plan:** none — journeys were derived during this TDD run from the
instruction *"make sure the admin page automatically log out every refresh"*.

## Scope decisions (confirmed with the user before any code was written)

The repo has three admin surfaces, all of which survived a refresh beforehand:

| Surface | Session | In scope? |
|---|---|---|
| Store admin, `slug.<root>/#admin` | `sf_admin_session` cookie, 7-day TTL | **YES** |
| Platform admin, `app.<root>/admin` | Supabase `PlatformUser` session | no |
| Tenant login, `slug.<root>/admin` | `tenant_admin_session` cookie, 30-day TTL | no |

Strictness, also confirmed: **every page load kills the session** — the literal
reading. Not "session cookie that dies with the tab", not "short idle timeout".

## User journeys

1. As a store owner, when I refresh the `#admin` page, I am signed out and must
   log in again — so an unattended browser can't be picked up mid-session.
2. As a store owner, when I save something in the admin, I stay signed in — the
   logout must trigger on refreshes, never on the admin's own server traffic.
3. As an anonymous shopper, my storefront browsing is unaffected and my responses
   carry no session cookie churn.
4. As a platform operator, my own admin console and the tenant `/admin` login are
   untouched.

## Design note — why middleware, and why not `Sec-Fetch-Dest`

The storefront is a hash-routed SPA (`src/storefront/StorefrontApp.tsx`), so
there is no admin page load to hook: a refresh is simply a **top-level document
load of the storefront**. Server Components cannot delete cookies, so the kill
happens in middleware, alongside the existing visitor-gate roll
(`src/lib/auth/gate-roll.ts`) which writes cookies from the same place.

The entire risk collapses into one predicate — *is this a browser navigation, or
the booted SPA talking to the server?* The obvious discriminator,
`Sec-Fetch-Dest: document`, was **rejected**: Safari < 16.4 omits the whole
`Sec-Fetch-*` family, so reading "header missing" as "document" would sign those
users out on every single save. The predicate keys on Next's own `RSC` /
`Next-Action` headers instead, which every client emits.

## Task report

| # | Task | Command run | Result |
|---|---|---|---|
| 1 | Write the reproducer against a not-yet-existing decision core | `npm run test:admin-session-reset` | **RED** — `Error: Cannot find module '../src/lib/auth/admin-session-reset'` (MODULE_NOT_FOUND). Compile-time RED caused by the missing implementation, not by unrelated breakage. |
| 2 | Implement `src/lib/auth/admin-session-reset.ts` + wire middleware + drop the client's stale `sessionStorage` flag | `npm run test:admin-session-reset` | **GREEN** — `18 passed, 0 failed` |
| 3 | Regression sweep | `tsc --noEmit`; `test:store-admin-login`, `test:staff`, `test:auth-audit`, `test:gate-heartbeat`, `test:gate` | clean / 28 / 51 / 4 / 10 / 8 — all pass |
| 4 | Live verification against the running dev server | `curl` against `hpglow.lvh.me:3100` | refresh emits `set-cookie: sf_admin_session=; Path=/; Expires=Thu, 01 Jan 1970`; all five SPA/anonymous request shapes keep the cookie |

RED evidence (verbatim):

```
Error: Cannot find module '../src/lib/auth/admin-session-reset'
Require stack:
- /Users/.../scripts/test-admin-session-reset.ts
```

GREEN evidence (verbatim tail):

```
18 passed, 0 failed
```

Live evidence (verbatim):

```
=== 1. REFRESH (document load) with an admin cookie ===
set-cookie: sf_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT

=== must KEEP the session ===
  server action (Next-Action POST)               kept  ✓
  RSC navigation (RSC: 1)                        kept  ✓
  speculative prefetch                           kept  ✓
  JSON fetch / heartbeat                         kept  ✓
  anonymous shopper (no admin cookie)            kept  ✓
```

## Test specification

All in `scripts/test-admin-session-reset.ts`, run by `npm run test:admin-session-reset`.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A top-level document load clears the admin session | `a top-level document load clears the admin session` | unit | PASS |
| 2 | A refresh deep-linked at `#admin` clears too (the hash never reaches the server) | `a deep-linked refresh straight to #admin also clears` | unit | PASS |
| 3 | A Server Action POST never signs you out | `a server action (Next-Action POST) does NOT clear` | unit | PASS |
| 4 | An RSC navigation never signs you out | `an RSC navigation (RSC: 1) does NOT clear` | unit | PASS |
| 5 | The `RSC` header wins over a permissive `Accept` | `an RSC request that still advertises HTML does NOT clear` | unit | PASS |
| 6 | The gate heartbeat's JSON poll never signs you out | `a JSON fetch (gate heartbeat) does NOT clear` | unit | PASS |
| 7 | Asset requests never sign you out | `a same-origin image/asset request does NOT clear` | unit | PASS |
| 8 | `HEAD` probes never sign you out | `a HEAD probe does NOT clear` | unit | PASS |
| 9 | Header-less clients (curl, monitors) never sign you out | `a request with no Accept header does NOT clear` | unit | PASS |
| 10 | A hovered-link prefetch never signs you out | `a speculative prefetch does NOT clear` | unit | PASS |
| 11 | Anonymous storefront responses stay `Set-Cookie`-free (cacheability) | `no Set-Cookie churn when there is no admin session cookie` | unit | PASS |
| 12 | The platform admin host and marketing apex are untouched | `the platform admin / apex hosts are untouched` | unit | PASS |
| 13 | `/api/*` routes are untouched | `API routes are untouched even on a tenant host` | unit | PASS |
| 14 | The separate tenant `/admin` login is untouched | `the platform tenant login at /admin is untouched` | unit | PASS |
| 15 | Header casing/whitespace can't flip the verdict | `header casing and whitespace don't change the verdict` | unit | PASS |
| 16 | `isDocumentLoad` is the sole gate | `isDocumentLoad is the sole gate — it agrees with the decision` | unit | PASS |
| 17 | The core is actually wired into middleware | `middleware actually calls the reset on tenant responses` | integration (static) | PASS |
| 18 | The client no longer trusts a stale `sessionStorage` flag | `the client no longer trusts a stale sessionStorage auth flag` | integration (static) | PASS |

Guarantees 17–18 are deliberate static-source assertions: a perfectly tested pure
core that was never called is still a shipped bug, and both wiring points are the
kind that silently regress under a refactor.

## Files changed

- **new** `src/lib/auth/admin-session-reset.ts` — pure predicate + middleware adapter
- **new** `scripts/test-admin-session-reset.ts`, `package.json` script `test:admin-session-reset`
- `src/middleware.ts` — calls `clearStoreAdminSessionOnDocumentLoad(req, res, !isAdmin && !isApex)`
- `src/storefront/StorefrontApp.tsx` — admin gate is now tri-state (`checking|in|out`), always server-verified; `Log out` now calls `signOutStorefrontAdminAction`
- `src/storefront/admin/AdminLogin.tsx` — no longer writes the `sessionStorage` flag
- **deleted** `src/storefront/admin/authKey.ts` — the `__admin_auth_v1` flag existed
  only to survive a refresh, which is the behavior being removed

## Two things found in passing (both fixed, both worth knowing)

1. **`Log out` never reached the server.** `logoutAdmin` cleared client state only
   and left a valid `sf_admin_session` alive for its full 7 days;
   `signOutStorefrontAdminAction` existed but was never called. Now wired.
2. **`TrialPlansScreen.tsx:47` calls `window.location.reload()`** after a plan
   change. That is a document load, so it now signs the owner out — correct per
   the chosen rule, but a visible behavior change on that one screen.

## Coverage and known gaps

- **No coverage percentage is reported.** This repo has no coverage tooling: there
  is no Jest/Vitest config and no `test:coverage` script — the suite is ~90
  standalone `tsx` scripts under `scripts/`. Claiming an 80% figure here would be
  fabricated. Coverage of the *changed* logic is complete: every branch of
  `isDocumentLoad` and `shouldClearStoreAdminSession` is exercised, and both
  wiring points are asserted.
- **`npm run build` was not run** — a dev server was live on port 3100 and a
  concurrent build clobbers `.next/`, 500-ing the running server. `tsc --noEmit`
  passed clean, which covers compile errors for these changes. Worth running the
  build once the dev server is stopped.
- **No Playwright E2E.** The live `curl` matrix above covers the same ground at
  the HTTP layer (the SPA has no server-rendered admin surface for Playwright to
  assert against beyond the login form).
- **Edge-runtime safety:** `admin-session-reset.ts` uses only `NextRequest`/
  `NextResponse` types and pure string operations — no Node APIs — so it is safe
  in the Edge middleware bundle.

## Merge evidence (for squash)

- **RED** `649e58b` — `npm run test:admin-session-reset` → MODULE_NOT_FOUND on the
  missing decision core.
- **GREEN** `00364a7` — same command → `18 passed, 0 failed`; `tsc --noEmit`
  clean; 5 neighbouring auth suites pass; live dev-server curl matrix confirms
  the cookie is deleted on refresh and preserved on all SPA traffic.
- **Refactor** — none required; the core landed in its final shape.
