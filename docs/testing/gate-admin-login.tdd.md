# TDD evidence — store-admin login reachable without the visitor access code

**Source plan:** none. Journeys were derived during this TDD run from the reported bug:
> "fix the feaature code access bug it requires the code access also to access the admin page instead of just the gmail and password to log in"

**Branch:** `feat/gb-pricing-tab`
**Checkpoints:** `6a02101` (RED test) → `d348c08` (GREEN fix)

---

## The defect

The storefront is a hash-routed SPA, so `#admin` **never reaches the server** — no
header, no cookie, nothing in the request distinguishes a shopper from a store
owner heading for the dashboard.

When a tenant's visitor access-code gate is on,
`src/app/(tenant)/(storefront)/layout.tsx:63` early-returns the access wall
**instead of** the SPA. The `#admin` email + password form lives *inside* that
SPA, so it never mounted. The owner had to type the **visitor** code before they
could type their own credentials.

The gate's existing admin exemption (`src/lib/auth/gate-enforcement.ts:50`,
`requireStorefrontAdmin()`) could not help: it only recognises someone who is
**already** signed in. And `src/lib/auth/admin-session-reset.ts` deletes
`sf_admin_session` on every document load, so the exemption never survived a
refresh either — the two mechanisms deadlocked.

## User journeys

1. As a **store owner** of a gated store, I want to open `<slug>.<root>/#admin`
   and sign in with only my email and password, so that I don't need the visitor
   access code to manage my own store.
2. As a **store owner**, I want to sign in from the wall and land in the
   dashboard without being immediately signed back out.
3. As a **shopper** on a gated store, I want the storefront to stay hidden until
   I enter the access code — the owner's convenience must not open the store.
4. As the **platform operator**, I want the wall's notion of "the admin route" to
   stay locked to the SPA's, so neither can drift into exposing the wrong surface.

## The fix

| File | Change |
|---|---|
| `src/lib/auth/gate-surface.ts` | **New.** `resolveGateSurface(hash)` → `"wall" \| "admin-login"`. Exact match on `#admin`, mirroring the SPA's `pageFromHash`. Pure; never imported by the server gate. |
| `src/storefront/components/AccessCodeGate.tsx` | Resolves the surface on the client (mount + `hashchange`) and renders `AdminLogin` inside `.sf-root` on `#admin`. On success calls `router.refresh()` — **not** a hard reload, which middleware would use to kill the session just issued. |
| `src/storefront/admin/AdminLogin.tsx` | `brand` prop widened from `Brand` to the new structural `AdminLoginBrand`, so the wall can render it from the branding row (the assembled client `Brand` only exists once the SPA boots). Full `Brand` still satisfies it; the SPA call site is unchanged. |
| `src/app/(tenant)/(storefront)/layout.tsx` | Passes `adminLoginTitle` / `adminLoginSub` from `branding.config` so the admin surface stays white-labeled. Blocked branch still early-returns the wall. |

**Why this is safe.** The server decision is untouched: `evaluateVisitorGate`
still says "blocked", the storefront HTML is still withheld, and the client hash
never influences it. All the hash can swap in is a login form that carries its
own server-side scrypt verification, generic failure message, and rate limit
(`src/actions/storefront-staff.ts`). The branding it shows — store name and logo
— is what the wall already shows.

## Task report

### 1. Reproduce the bug as a failing test

Added `scripts/test-gate-admin-login.ts` + `npm run test:gate-admin-login`.

**RED (compile-time), commit `6a02101`:**

```
> tsx scripts/test-gate-admin-login.ts
Error: Cannot find module '../src/lib/auth/gate-surface'
```

**RED (runtime, behavioural)** — after adding only the pure module, the wiring
assertions still failed for the intended reason:

```
visitor gate — store-admin sign-in reachability
  ✓ a visitor at #admin gets the store-admin login, not the code wall
  ✓ every other visitor still gets the access-code wall
  ✓ a missing hash (server render, no window) falls back to the wall
  ✓ near-miss hashes do NOT open the admin surface
  ✓ the wall's route table cannot drift from the SPA's
  ✗ the access wall renders the store-admin login on the admin surface
    wall does not consult resolveGateSurface
  ✗ the wall re-decides when the visitor navigates to #admin
    wall does not listen for hashchange
  ✗ the admin login is styled by the storefront scope so it isn't unstyled
    admin login is rendered outside the .sf-root scope
  ✓ the layout still returns the wall instead of the store when blocked
  ✓ the server-side gate decision is unchanged by this fix

7 passed, 3 failed
```

### 2. Make it pass

**GREEN, commit `d348c08`:**

```
> npm run test:gate-admin-login
visitor gate — store-admin sign-in reachability
  ✓ a visitor at #admin gets the store-admin login, not the code wall
  ✓ every other visitor still gets the access-code wall
  ✓ a missing hash (server render, no window) falls back to the wall
  ✓ near-miss hashes do NOT open the admin surface
  ✓ the wall's route table cannot drift from the SPA's
  ✓ the access wall renders the store-admin login on the admin surface
  ✓ the wall re-decides when the visitor navigates to #admin
  ✓ the admin login is styled by the storefront scope so it isn't unstyled
  ✓ the layout still returns the wall instead of the store when blocked
  ✓ the server-side gate decision is unchanged by this fix

10 passed, 0 failed
```

### 3. Regression check

```
$ npx tsc --noEmit --pretty false        → exit 0, no output
$ npm run test:gate                      → 8 checks passed
$ npm run test:gate-heartbeat            → 10 passed, 0 failed
$ npm run test:store-admin-login         → 28 passed, 0 failed
$ npm run test:admin-session-reset       → 18 passed, 0 failed
$ npm run test:staff                     → PASS — 51 passed, 0 failed
$ npm run test:auth-audit                → 4 passed, 0 failed
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A visitor at `#admin` gets the store-admin login, not the code wall | `test-gate-admin-login.ts:"a visitor at #admin gets the store-admin login"` | unit | PASS |
| 2 | Every other hash still gets the access-code wall | `…:"every other visitor still gets the access-code wall"` | unit | PASS |
| 3 | A missing hash (server render, no `window`) falls back to the wall — no hydration split | `…:"a missing hash … falls back to the wall"` | unit | PASS |
| 4 | Near-miss hashes (`#adminx`, `#admin/orders`, `#ADMIN`, `#/admin`) do **not** open the admin surface | `…:"near-miss hashes do NOT open the admin surface"` | unit | PASS |
| 5 | The wall's route table cannot drift from the SPA's — parsed live from `StorefrontApp.tsx` `ROUTES` | `…:"the wall's route table cannot drift from the SPA's"` | integration | PASS |
| 6 | The wall actually consults the resolver and renders `AdminLogin` | `…:"the access wall renders the store-admin login"` | wiring | PASS |
| 7 | The wall re-decides on `hashchange` (the SPA never reloads on one) | `…:"the wall re-decides when the visitor navigates to #admin"` | wiring | PASS |
| 8 | The admin login renders inside `.sf-root`, where its CSS is scoped | `…:"the admin login is styled by the storefront scope"` | wiring | PASS |
| 9 | The blocked layout still early-returns the wall and never leaks `{children}` | `…:"the layout still returns the wall instead of the store"` | wiring | PASS |
| 10 | `evaluateVisitorGate` is unweakened and never imports the client hash resolver | `…:"the server-side gate decision is unchanged by this fix"` | wiring | PASS |

Run all of the above with `npm run test:gate-admin-login`.

## Coverage and known gaps

- **No coverage number.** This repo has no coverage tooling — `npm run test:coverage`
  does not exist and there is no vitest/jest/nyc dependency. The convention is
  targeted `tsx` assertion scripts per behaviour (90+ `test:*` scripts), and this
  change follows it. The percentage target in the TDD skill is not measurable here.
- **Not covered by an automated test:** the browser round-trip
  (sign in on the wall → `router.refresh()` → SPA boots at `#admin`). There is no
  Playwright suite in this repo; `playwright-core` is present only as a transitive
  dependency. Verified by reading `admin-session-reset.ts`
  (`isDocumentLoad` returns false when the `RSC` header is present, so the
  refresh cannot clear the session it just issued) rather than by execution.
- **One-frame wall flash on `#admin`.** The server cannot read the hash, so the
  wall is the SSR output on both surfaces and the swap happens on hydration.
  Accepted deliberately — resolving it would mean delaying the wall's first paint
  for every shopper.

## Operational follow-up (not a code defect)

A read-only query across all 14 tenants found exactly one with the visitor gate
enabled:

```
dragon-peptides: gate=ON hasCode=true hasStoreAdminLogin=false
1 of 14 tenants have the visitor gate enabled
```

`dragon-peptides` has **no `storeAdminEmail` / `storeAdminPasswordHash`** on its
`Tenant` row. This fix makes their login form reachable, but sign-in will still
fail closed with "Incorrect email or password." until the operator sets that
credential in the super-admin tenant settings console — by design, there is no
default password. Setting it is an operator action requiring a chosen password,
so it was not done here.
