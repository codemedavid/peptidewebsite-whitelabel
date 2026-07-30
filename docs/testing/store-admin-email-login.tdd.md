# TDD evidence — email + password required for every `#admin` sign-in

**Source:** `/ecc:plan` → *"require every login to admin tenant a password and we will
now require an gmail and password every login to the #admin page of the tenant"*,
refined over the following turns and confirmed before any code was written.

## What the user asked for

- **Every** sign-in to a tenant's storefront `#admin` needs an email **and** a
  password — *"even the main storefront admin will now be required to enter the gmail"*.
- Any valid email address, not only `@gmail.com` (chosen via AskUserQuestion).
- *"the super admin will set the gmail in the tenant settings"* — the credential is
  operator-owned. The owner may still change their own password; staff keep theirs.
- Rollout: **backfill first, then hard enforce**, so no existing store is locked out.
- The owner's plaintext password must be **hashed and the client leak stopped**.

Out of scope by agreement: the platform `/dashboard` tenant login
(`Tenant.adminPasswordHash`), which was already hashed.

## User journeys

1. As a store owner, I sign in at `<slug>.<root>/#admin` with the email and password
   my provider gave me, so nobody who merely guesses a password gets into my store.
2. As a staff member, I sign in with my own email and password, and I am told when my
   account is suspended rather than being shown a generic "wrong password".
3. As the super admin, I set (and later correct) a store's sign-in email and password
   from tenant settings, and I can never leave a store half-configured.
4. As a storefront visitor, the page I load contains no admin credential of any kind.

## Task report

### 1. Login decision core — `src/lib/auth/store-admin-login.ts`

Rewrote the pure core from username + plaintext matching to email + scrypt for both
principals, with a new `unconfigured` result so a store with no credential **fails
closed** instead of falling back to a default.

- **RED:** `npm run test:store-admin-login` → 14 failed (tests written first, against
  the not-yet-existing email behaviour).
- **GREEN:** 20 passed, 0 failed.
- Superseded cases were deleted from `scripts/test-staff-permissions.ts` rather than
  left to diverge; that suite still passes 51/51.

Guarantees: neither field alone opens anything; the retired default password `admin`
opens nothing; email comparison is case- and whitespace-insensitive; a staff row
carrying the owner's address cannot shadow the owner; suspension is decided before the
password check.

### 2. Credential validator — `src/lib/auth/store-admin-credential.ts`

The rule that prevents a lockout: an email saved with no password would leave a store
nobody can enter. A blank password is therefore accepted **only** when one is already
stored, where it means "keep the current one" — which is what lets the operator fix a
typo'd email on its own.

- **RED:** `npm run test:store-admin-login` → `MODULE_NOT_FOUND` on
  `../src/lib/auth/store-admin-credential` (the intended missing implementation).
- **GREEN:** 28 passed, 0 failed.

`normalizeLoginEmail` moved to the dependency-free `src/lib/auth/login-email.ts` so the
operator's Client Component can validate without pulling `node:crypto` into the browser
bundle. Re-exported from `store-admin-login.ts`, so existing importers were unaffected.

### 3. Server enforcement — `src/actions/storefront-staff.ts`

`signInStoreAdminAction(email, password)` reads the owner credential from the `Tenant`
row and the staff rows, rate-limits per tenant+IP, and writes an `AuthAudit` row on both
success and failure. `invalid`, `unconfigured` and de-entitled-staff all return the
**same** generic message — telling a caller which stores have no credential set would be
a disclosure — while remaining distinguishable in the server-side audit trail.

### 4. Operator UI — tenant settings

`TenantSettingsView` gained a "Sign-in email" field and a **write-only** password
control: the stored password is never sent to the browser, so the input starts blank and
the Show toggle can only reveal what is being typed. The badge reads *Sign-in set* /
*Not set*. Save is blocked client-side by the same validator the server runs.

`getTenantAdminPassword` was replaced by `getTenantStoreAdminCredential`, which returns
`{ email, hasPassword }` — never the password or its hash. The rename is deliberate: the
old name promised a value that should not exist.

### 5. Closing the leak

`branding.config` is spread wholesale into the client `brand` object, so the owner's
plaintext password was serialized into the HTML of every public storefront page.

- `Brand.adminPassword` and `Brand.staffLoginActive` deleted from the type, so the
  compiler located every remaining consumer.
- `page.tsx` strips `adminPassword` / `adminEmail` / `adminPasswordHash` from the brand
  payload — defence in depth for rows the backfill has not yet cleared.
- The password-only `signInStorefrontAdminAction` and `DEFAULT_PASSWORD = "admin"` are
  gone; the owner's password change verifies and writes a scrypt hash.
- Onboarding provisions the hash and seeds the email from the client's own submission.
- `admin-login-mode.ts` and `test:admin-login-mode` retired with the two-form login they
  existed to choose between.

### 6. Backfill — `scripts/backfill-admin-credentials.ts`

Dry-run by default. Hashes any legacy plaintext password, derives the email from the
onboarding submission then the order-notification recipient, deletes the leaked
plaintext, and **reports rather than guesses** every tenant left without a credential.
It also checks for duplicate staff emails, which would stop the new
`@@unique([tenantId, email])` index from being created.

Run against the live database:

```
DRY RUN — nothing will be written
Tenant.storeAdminEmail / storeAdminPasswordHash are not in the database yet.
Run `npm run db:push` first, then re-run this script to backfill.

✓ no duplicate staff emails — the new unique index can be created
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A blank email rejects even with the right password | `test-store-admin-login.ts` | unit | PASS |
| 2 | A blank password rejects even with the right email | `test-store-admin-login.ts` | unit | PASS |
| 3 | Correct owner email + password signs the owner in | `test-store-admin-login.ts` | unit | PASS |
| 4 | Email matching ignores case and surrounding whitespace | `test-store-admin-login.ts` | unit | PASS |
| 5 | A tenant with no credential is `unconfigured` — never a way in | `test-store-admin-login.ts` | unit | PASS |
| 6 | The retired default password `admin` opens nothing | `test-store-admin-login.ts` | unit | PASS |
| 7 | Staff sign in with their own email and get their id back | `test-store-admin-login.ts` | unit | PASS |
| 8 | A suspended staffer is reported suspended whatever password is typed | `test-store-admin-login.ts` | unit | PASS |
| 9 | A staff row sharing the owner's email cannot shadow the owner | `test-store-admin-login.ts` | unit | PASS |
| 10 | A fresh tenant cannot be saved with an email but no password | `test-store-admin-login.ts` | unit | PASS |
| 11 | A blank password keeps the stored one, so the email can be edited alone | `test-store-admin-login.ts` | unit | PASS |
| 12 | Malformed emails and sub-minimum passwords are rejected | `test-store-admin-login.ts` | unit | PASS |
| 13 | A whitespace-only password counts as blank, not as 6 characters | `test-store-admin-login.ts` | unit | PASS |
| 14 | Staff permission behaviour is unchanged by the login rewrite | `test-staff-permissions.ts` | unit | PASS |
| 15 | Presets still never copy one tenant's secrets to another | `test-tenant-presets.ts` | unit | PASS |

```
npm run test:store-admin-login   → 28 passed, 0 failed
npm run test:staff               → 51 passed, 0 failed
npm run test:tenant-presets      → 46 passed, 0 failed
npx tsc --noEmit                 → src/ and scripts/ clean
```

(The one remaining `tsc` error is `scripts/kglow-test-gb.ts`, an untracked scratch file
from a parallel session that was already failing before this work and is not mine.)

## Coverage and known gaps

- The pure cores are covered case-by-case above. The server action, the operator UI and
  the backfill are not unit-tested — they are DB- and Next-runtime-bound, and this repo
  tests such code by extracting the decision into a pure module, which is what
  `store-admin-login.ts` and `store-admin-credential.ts` are. Both were extracted first
  and tested first.
- **No E2E test** covers the browser sign-in flow. Worth adding when the app next has a
  Playwright run against a seeded tenant.
- The demo-mode path (`isDemoMode()`) is exercised by neither suite.

## Deployment order — NOT yet shippable

Enforcement is live in code, but no tenant has a credential and the columns do not exist
in the database. **Shipping now locks every store owner out.** Required order:

1. `npm run db:push` — adds `Tenant.storeAdminEmail`, `Tenant.storeAdminPasswordHash`,
   and `@@unique([tenantId, email])` on `StorefrontStaff`. Pre-checked above: no
   duplicate staff emails, so the index can be created.
2. `npm run backfill:admin-credentials` — dry run, and read the list of blocked tenants.
3. `npm run backfill:admin-credentials -- --apply`.
4. For every tenant still reported as blocked, set the email and password in
   admin → tenant settings, and pass them to that store's owner.
