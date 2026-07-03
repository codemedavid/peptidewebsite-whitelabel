# TDD Evidence — Password-only `#admin` login until Staff Accounts are configured

**Source plan:** inline `/plan` output (this session), confirmed by the user. No `*.plan.md` file.
**Issue:** the storefront Admin login always asked for a username + password, implying
staff credentials that don't exist yet on a fresh store. Requirement: show a
**password-only** login (owner password) until Staff Accounts are **enabled AND
≥1 staff account exists**; the username field returns only once staff exist.

## User journeys

1. As a new store owner with **no staff configured**, I want the admin login to ask
   for my password only — not a username for staff that don't exist — so I can get
   into the admin without a phantom credential.
2. As an owner who has **enabled Staff Accounts and created ≥1 staff member**, I want
   the login to ask for username + password again, so each staffer signs in as
   themselves.
3. As any visitor, the store must stay protected — password-only still verifies the
   owner password server-side; the store is never left open.

## Task report

### Task 1 — Pure decision core (`resolveAdminLoginMode`)
- **Summary:** `resolveAdminLoginMode(staffFeatureOn, staffCount)` returns `"unified"`
  iff the feature is on AND `staffCount >= 1` (finite), else `"password-only"`.
- **Command:** `npm run test:admin-login-mode`
- **RED:** commit `44f4846` — test written first; run failed with
  `Cannot find module '../src/lib/storefront/admin-login-mode'` (intended missing impl).
- **GREEN:** commit `f18cfea` — `5 passed, 0 failed`.
- **Guarantees:** feature-off → password-only regardless of count; feature-on + 0
  staff → password-only (the deadlock case); feature-on + ≥1 → unified; negative/NaN
  count → password-only (never crashes).

### Task 2 — Server derivation (`brand.staffLoginActive`)
- **Summary:** `page.tsx` computes `staffEntitled` (existing entitlement), then counts
  staff **through `withTenant()`** and sets
  `brand.staffLoginActive = resolveAdminLoginMode(staffEntitled, staffCount) === "unified"`.
  The count is read only when the feature is on and is wrapped in try/catch → 0.
- **RLS correctness (caught in verification):** `storefront_staff` is under Postgres
  RLS; a bare `prisma.storefrontStaff.count` resolves to **0 rows** because
  `app.tenant_id` is unset outside a tenant transaction. First implementation used raw
  prisma and never flipped to unified. Fixed by routing the count through
  `withTenant()` (commit `a89472d`).
- **Command / evidence (fresh client):**
  `withTenant(tenantId, db => db.storefrontStaff.count({where:{tenantId}}))` = **1**
  for a tenant with one staff row → `resolveAdminLoginMode(true, 1)` = `"unified"`.
- **Resilience:** the try/catch degrades to password-only if the staff table/delegate
  is unavailable (DB drift, or a stale generated client), so the **public storefront
  render never crashes** — confirmed live: feature-on tenant rendered `HTTP 200` and
  fell back to password-only when the running dev server held a stale Prisma client.

### Task 3 — Client wiring (`AdminLogin.tsx`, `Brand`)
- **Summary:** `AdminLogin` reads `brand.staffLoginActive`. When false: hides the
  username field, autofocuses password, calls `signInStorefrontAdminAction(pw)` (owner
  password), and shows a password-only hint. When true: unchanged unified
  username+password flow via `signInStoreAdminAction(username, pw)`. `Brand` gains an
  optional `staffLoginActive?: boolean`.
- **Validate:** `npx tsc --noEmit` → 0 errors.

## Test specification

| # | What is guaranteed | Test / evidence | Type | Result |
|---|--------------------|-----------------|------|--------|
| 1 | Feature off → password-only regardless of staff count | `test:admin-login-mode` | unit | PASS |
| 2 | Feature on + 0 staff → password-only (no deadlock on a fresh store) | `test:admin-login-mode` | unit | PASS |
| 3 | Feature on + ≥1 staff → unified (username + password) | `test:admin-login-mode` | unit | PASS |
| 4 | Negative / NaN staff count → password-only, never throws | `test:admin-login-mode` | unit | PASS |
| 5 | Existing staff-permission gate unaffected | `npm run test:staff` | unit | PASS (62/62) |
| 6 | Server derives unified only inside RLS tenant context | `withTenant storefrontStaff.count = 1` (fresh tsx) | integration | PASS |
| 7 | Public storefront renders (feature off / on) without crash | `curl` peppertones & fit-n-glow → HTTP 200 | integration | PASS |
| 8 | Whole project type-checks | `npx tsc --noEmit --pretty false` | typecheck | PASS (0 errors) |

## Live verification (running dev server, port 3100)

- `peppertones.lvh.me` (feature OFF) → `staffLoginActive:false` → password-only. ✓
- `fit-n-glow.lvh.me` (feature ON, 0 staff) → `staffLoginActive:false` → password-only
  (the exact deadlock case, now resolved). ✓
- `fit-n-glow` with one temporary staff row + fresh client → `withTenant` count = 1 →
  `"unified"`. Temp row deleted after verification. ✓

## Coverage & known gaps

- Coverage tooling: this repo uses focused `tsx scripts/test-*.ts` gates, not a global
  coverage runner. The pure core `resolveAdminLoginMode` has full branch coverage
  (feature on/off × has/no staff × invalid count).
- **Environment note (not a code defect):** the long-running dev server (started before
  `storefront_staff` was generated) holds a stale in-memory Prisma client, so its
  live render currently falls back to password-only even for a feature-on + staff
  tenant. A dev-server restart (reloads/regenerates the client) makes the unified path
  render live. Code is proven correct in a fresh client. The try/catch makes the stale
  state safe (password-only, no crash).

## Merge evidence (checkpoints on `main`)

- `44f4846` test: RED reproducer (module missing)
- `f18cfea` feat: pure core GREEN (5/5)
- `6fe45da` feat: password-only login wiring (page/type/AdminLogin), tsc clean, staff 62/62
- `a89472d` fix: count staff via `withTenant` (RLS) so unified resolves correctly
