# TDD Evidence — Invoice history on the tenant Billing page

**Date:** 2026-07-22 · **Branch:** main · **Commits:** RED `1a45a28` → GREEN `1253c22`

## Source plan

No `*.plan.md` — journey derived in this TDD run from the request: "add a invoice
history in the billing in the admin page" (the store-admin Billing view — tenants
could submit payments but never see their own ledger; only the platform operator
had an invoice history in TenantDetailView's BillingPanel).

## User journey

> As a store owner, I want an invoice history on my Billing page showing each
> payment I filed (invoice code, date, amount, method, review status), so I can
> track what's paid, awaiting confirmation, or failed.

## Change

| File | Change |
|---|---|
| `src/lib/subscription/payments.ts` | New pure `tenantInvoiceRowsFrom(rows)` + `TenantInvoiceSource`/`TenantInvoiceRow`: newest-first, invoice-coded (`subscriptionInvoiceCode(date, id)`), date = `paidAt` → `submittedAt` fallback, unknown statuses narrow to `pending`, undated rows drop, ISO-serialized |
| `src/actions/subscription-payments.ts` | New `listMySubscriptionPaymentsAction()` — tenant-side read (`requireStorefrontAdmin` + `withTenant`), newest 60 rows, fails open to `[]` (demo mode / table not yet `db:push`ed) |
| `src/storefront/admin/AdminBilling.tsx` | 📜 Invoice history card: loading + empty states, rows with code/date/method/amount + status badge (labels/tones from `payments.ts`), reloaded after each successful submit |

## Task report (RED → GREEN)

- **RED** (`npm run test:subscription-payments`, commit `1a45a28`): 6 new cases,
  all failing for the intended reason — the projection didn't exist:
  ```
  ✗ tenantInvoiceRowsFrom maps a row to code/amount/method/status — (0 , import_payments.tenantInvoiceRowsFrom) is not a function
  … (6 total)
  21 passed, 6 failed
  ```
- **GREEN** (same command, commit `1253c22`): `27 passed, 0 failed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Row maps to invoice code (INV-YYYYMM-XXXX of paid month), amount, method, status, ISO date | "maps a row to code/amount/method/status" | unit | PASS |
| 2 | Missing/invalid `paidAt` falls back to `submittedAt` | "falls back to submittedAt…" | unit | PASS |
| 3 | History orders newest first regardless of input order | "orders newest first…" | unit | PASS |
| 4 | Unknown DB status narrows to `pending` — a bad row can't crash the page | "narrows an unknown DB status…" | unit | PASS |
| 5 | ISO-string dates accepted (JSON round-trip); rows with no usable date dropped | "accepts ISO-string dates…" | unit | PASS |
| 6 | Empty ledger → empty history (no throw) | "empty ledger projects…" | unit | PASS |

## Regression / verification

- `npm run test:subscription-payments` 27/27 · `test:subscription-state` 20/20
- `npx tsc --noEmit`: 0 new errors (2 pre-existing in unrelated one-off scripts)
- Live smoke: hpglow storefront renders 200 after the change.

## Known gaps

- `listMySubscriptionPaymentsAction` (DB + auth) and the card render are covered
  by typecheck + smoke, not unit tests (Next runtime / RSC-client boundary).
- No browser E2E of the logged-in Billing page (needs owner credentials).
- ⚠ The `subscription_payments` table still needs `npm run db:push` on the live
  DB ([[subscription-payments]]); until then the history fails open to empty.
