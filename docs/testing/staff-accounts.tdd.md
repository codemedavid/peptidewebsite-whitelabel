# TDD Evidence — Store-Admin Staff Accounts & Permissions

**Feature branch:** `feat/staff-accounts`
**Source plan:** the approved inline `/ecc:plan` for "Staff Management System" (store-admin staff sub-accounts with per-module permissions). Three decisions confirmed via prompt: **dedicated `StorefrontStaff` Prisma model**, **unified username + password login** (owner = reserved username), **full server-side permission enforcement**.

## User journeys

1. **As a store owner**, I want to create staff sub-accounts with a username/password and a per-module permission set, so a teammate gets limited access to my storefront admin.
2. **As a staff member**, I want to log in with my own username/password and see only the admin modules I was granted (plus Dashboard, Account Settings, Logout), so I can't reach or change things outside my role.
3. **As the platform**, I want every gated store-admin action to enforce the staff's permission server-side, so client menu-hiding is never the only defense.
4. **As an owner**, I want suspending a staff member to lock them out immediately, and I want a staff member to never be able to manage staff or escalate their own grants.
5. **Back-compat:** existing owner sessions/cookies keep working through the session-token change.

## What is unit-tested (pure cores) vs integration-verified

The security-critical decision logic is extracted into pure modules and unit-tested via `npm run test:staff` (self-contained `tsx`, no DB/Next). The server actions (DB + cookies + headers) and React components are verified by `npx tsc --noEmit` (0 errors) and a full `npm run build` (passes), plus the pure cores they delegate to.

### Task report (RED → GREEN)

| Behavior | Validation | RED evidence | GREEN evidence |
|---|---|---|---|
| Permission registry + owner/staff access rules + session-token subject codec | `npm run test:staff` | `Cannot find module '../src/storefront/admin/staff-permissions'` | PASS 31/0 (commit `8da2597`) |
| Unified login resolver (owner reserved username, case-insensitivity, suspended, scrypt verify) | `npm run test:staff` | `Cannot find module '../src/lib/auth/store-admin-login'` | PASS 42/0 (commit `6eb2b22`) |
| Staff input validation (create/update/reserved-username) | `npm run test:staff` | `Cannot find module '../src/lib/storefront/staff-input'` | PASS 55/0 (commit `16132d9`) |
| `StorefrontStaff` model + subject-carrying session + guard | `npx prisma generate`; `npx tsc --noEmit` | n/a (schema/wiring) | generate OK; tsc 0 errors (commit `ab1e554`) |
| Staff CRUD + unified login + session actions | `npx tsc --noEmit` | n/a | 0 errors (commit `3b781a8`) |
| Per-module enforcement across all gated actions | `npx tsc --noEmit` | n/a | 0 errors (commit `c7db3d6`) |
| UI: unified login, owner panel, menu/view gating | `npx tsc --noEmit`; `npm run build` | n/a | 0 errors; build passes (commit on branch) |

## Test specification (guarantees)

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Permission registry covers every spec module **and** every other gateable admin view (no silent holes) | `test-staff-permissions.ts` › permission registry | unit | PASS |
| 2 | `isModuleAllowed` is the strict server boundary (owner all; staff exact key; no implies) | › isModuleAllowed | unit | PASS |
| 3 | `isViewAllowed` drives the menu ergonomically (always-allowed dashboard/account; Manage→edit) | › isViewAllowed | unit | PASS |
| 4 | `sanitizePermissions` drops invalid/duplicate keys; non-array → `[]` | › sanitizePermissions | unit | PASS |
| 5 | Session token round-trips owner & staff subjects; **legacy 2-part owner token still decodes** | › storefront-session-token | unit | PASS |
| 6 | Tampered/expired/wrong-secret/unknown-subject tokens are rejected, never throw | › storefront-session-token | unit | PASS |
| 7 | Owner reserved username matched first (case-insensitive); a staff row can't shadow it | › resolveStoreAdminLogin | unit | PASS |
| 8 | Suspended staff reported distinctly; wrong password / unknown user → invalid | › resolveStoreAdminLogin | unit | PASS |
| 9 | Staff create requires confirmed ≥6 password; update blank = keep-existing | › parseStaffCreate / parseStaffUpdate | unit | PASS |
| 10 | `isReservedUsername` blocks `owner` and the configured owner username | › isReservedUsername | unit | PASS |

`npm run test:staff` → **PASS — 55 passed, 0 failed.**

## Server-side enforcement map (verified by code + tsc)

- `storefront-admin.ts`: 13 save/get actions → `requireStaffPermission(<module>)`; `changeStorefrontAdminPassword` branches owner (config) vs staff (own hash).
- `products.ts`: list/delete → `products`; save/upload → `add-product` OR `products`.
- `orders.ts`: list/update/delete → `orders` (customer checkout/track/proof stay public).
- `group-buys.ts`: `requireGroupBuyAdmin` → `groupbuys`.
- `storefront-gate.ts`: gate settings/rotate → `access-code` (visitor verify stays public).
- Staff management (`storefront-staff.ts`): create/update/status/delete → **owner-only** (`requireStoreOwner`).
- Intentionally session-level (any valid admin): `media.ts` upload (shared across panels), `hasStorefrontAdminSessionAction`.

## Coverage & known gaps

- **Pure cores: high coverage** (55 assertions across registry/token/login/validation).
- **Server actions & components: not unit-tested** here — verified by `tsc` (0 errors) + `next build` (passes). A PGlite-based integration test (mirroring `scripts/test-isolation.ts`) for staff CRUD + tenant scoping + suspend-locks-out is a recommended follow-up.
- **`npm run db:push` REQUIRED before runtime use** — the `storefront_staff` table must be created on the live DB. Owner login was made independent of this table (it short-circuits before querying staff), but staff create/list/login need it. Until pushed, staff features return DB errors by design (drift, per project workflow).
- **Manual/E2E** (owner creates staff → staff logs in → sees only granted menu → suspended staff locked out → direct ungated action rejected) pending a migrated tenant.

## Feature gating — `FEATURES.STORE_STAFF_ACCOUNTS` (added 2026-06-28)

Staff Accounts is no longer open to every tenant. It is now an entitlement:

- **Catalog** (`src/lib/features/catalog.ts`): new key `storefront.staff_accounts`, added to the **PRO** ceiling (so Business + Automated/`enterprise` are **default ON**), **not** in STARTER, and also in **`OPERATOR_GRANTABLE`** so the operator can switch it on for an individual Starter tenant from admin → Features. The panel surfaces it automatically (derived from `ALL_FEATURES` + `FEATURE_META` + `OPERATOR_GRANTABLE`).
- **Storefront resolution** (`(storefront)/page.tsx`): `brand.showAdminStaff = await hasFeature(tenantId, STORE_STAFF_ACCOUNTS)`.
- **View visibility** (`storefront/visibility.ts`): `staff` **and** `staff-form` gated on `brand.showAdminStaff === true` — `staff-form` included so a deep-link can't bypass the hidden menu (AdminPage's `activeView` guard runs `isAdminViewVisible`).
- **Server enforcement** (`actions/storefront-staff.ts`, `staffFeatureOn`): re-checks the entitlement in all 5 owner-only CRUD actions (returns `{ error: FEATURE_OFF }`), **staff sign-in** (off → generic invalid; owner login unaffected), and **session resolution** (`getStorefrontAdminSessionAction` → `{ kind: "none" }` for a staff actor once revoked, so a downgrade locks staff out immediately).

Gate coverage added to `npm run test:staff` (now **62/0**): pro/enterprise ceilings include the key, starter does not, catalog aliases (`ecommerce`→pro, `growth`→enterprise) resolve, key is operator-grantable, and `isAdminViewVisible` returns false for unset/false and true only when `showAdminStaff === true`.

## Merge evidence (RED/GREEN summary for squash)

RED was observed for each pure module via "Cannot find module" before implementation; GREEN is `npm run test:staff` = 55/0. Wiring/UI GREEN is `npx tsc --noEmit` = 0 errors and a passing `npm run build`. Checkpoint commits: `8da2597`, `6eb2b22`, `16132d9`, `ab1e554`, `3b781a8`, `c7db3d6`, + UI/robustness commits on `feat/staff-accounts`.
