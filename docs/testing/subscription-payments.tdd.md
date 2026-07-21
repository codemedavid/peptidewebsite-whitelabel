# Tenant Billing — subscription payments (TDD evidence)

Feature: redesign the per-tenant Billing surface (imported from the Claude Design
`Tenant Billing.dc.html`) and make it **real**: tenants file proof-of-payment for
their subscription term; the platform operator confirms/rejects each; the Billing
page derives lifetime metrics from confirmed payments.

Source plan: none — journeys derived during this TDD run from the imported design
and the "Full real feature" scope choice.

## User journeys

1. As a **store owner**, I open Billing in my store admin, see my next due date, and
   file a payment (amount, method, reference, date, screenshot) so my provider can
   confirm it.
2. As a **platform operator**, I open a tenant's Billing tab, see the invoice
   history, click an invoice to review the uploaded proof, and confirm or reject it.
3. As an operator, I see the tenant's **lifetime subscription metrics** (revenue from
   confirmed payments, paid/pending/failed counts, average per confirmed payment).
4. The review transitions are **safe**: a confirmed payment can't be re-confirmed or
   rejected; a failed one can be re-confirmed but not re-rejected.

## Task report

The domain core (status catalogue, review transitions, amount/method validation,
invoice code, metrics roll-up) was built test-first.

- **RED**: wrote `scripts/test-subscription-payments.ts` against the not-yet-created
  `src/lib/subscription/payments.ts`. `npm run test:subscription-payments` failed with
  `Cannot find module '../src/lib/subscription/payments'` — the intended missing-impl RED.
- **GREEN**: implemented `src/lib/subscription/payments.ts`. Re-ran the same target →
  `17 passed, 0 failed`.
- Integration layers (Prisma model, server actions, admin data layer, operator UI,
  storefront view) were then built on the verified core and validated by `tsc --noEmit`
  (clean) plus the sibling suites (no regression).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Status catalogue = pending/confirmed/failed, each with a label + badge tone | `test-subscription-payments.ts` | unit | PASS |
| 2 | `isSubscriptionPaymentStatus` narrows known values, rejects junk | same | unit | PASS |
| 3 | Pending → confirm/reject; confirmed terminal; failed → re-confirm only | same | unit | PASS |
| 4 | `applyReview` returns next status for legal moves, `null` for illegal | same | unit | PASS |
| 5 | `parsePaymentAmountCents` parses ₱/comma/spacing, rejects ≤0 & non-numeric | same | unit | PASS |
| 6 | `normalizePaymentMethod` maps known methods, falls back to "Other" | same | unit | PASS |
| 7 | `subscriptionInvoiceCode` → INV-YYYYMM (UTC) | same | unit | PASS |
| 8 | `summarizeSubscriptionPayments` counts, sums confirmed, avg, %s, empty-safe | same | unit | PASS |
| 9 | Whole feature typechecks (actions, data layer, both UIs) | `tsc --noEmit` | compile | PASS |
| 10 | No regression in sibling subscription math | `test:subscription-state` (14), `test:billing-cycle` (20) | unit | PASS |

Commands:

```
npm run test:subscription-payments   # 17 passed
npm run test:subscription-state       # 14 passed
npm run test:billing-cycle            # 20 passed
npx tsc --noEmit                      # clean
```

## Files

- `src/lib/subscription/payments.ts` — pure core (tested)
- `prisma/schema.prisma` — `SubscriptionPayment` model + `Tenant.subscriptionPayments`
- `src/lib/db/tenant-client.ts` — `subscriptionPayment` added to `TENANT_MODELS`
- `src/actions/subscription-payments.ts` — submit (tenant) + confirm/reject (operator)
- `src/actions/media.ts` — `subscription-proof` upload kind
- `src/lib/admin/data.ts` — `TenantSubscriptionPayment[]` on `TenantDetail` (fail-open read)
- `src/components/admin/pages/TenantDetailView.tsx` — operator Billing redesign + review drawer
- `src/storefront/admin/AdminBilling.tsx` + `AdminPage.tsx` — tenant Billing view

## Known gaps / follow-ups

- **`db:push` PENDING** — `subscription_payments` is not on the DB yet. Run
  `npm run db:push` (and, if RLS is enabled, add a policy for the table in
  `prisma/rls.sql`). Until then the operator ledger reads fail-open to empty and the
  submit action errors on write — by design, nothing crashes.
- No automated DB/integration test for the server actions (the repo's DB tests use a
  self-contained PGlite harness; adding one for subscription payments is a follow-up).
  Coverage here is the pure core + typecheck.
- The operator subscription *editor* still uses the existing `SubscriptionWindowCard`
  (cycle dropdown); the design's segmented Monthly/Yearly toggle is cosmetic and was
  not reworked.
