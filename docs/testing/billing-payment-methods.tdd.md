# TDD Evidence — Billing payment methods connected to the SaaS receiving accounts

**Date:** 2026-07-23 · **Branch:** main · **Commits:** RED `81ee5f5` → GREEN `10626f7` (+ test import fix `23ff3c6`)

## Journey

> As a store owner on my Billing page, I want to see my provider's actual
> payment channels (GCash/Maya/bank, with account, number, note, QR) and pick
> from those same methods when filing proof, so I pay the right account.

## Change

| File | Change |
|---|---|
| `src/lib/subscription/payments.ts` | `paymentMethodOptions()` (dedupe case-insensitive, drop blanks, append "Other", default-catalogue fallback) + `normalizePaymentMethodWith()` (case-insensitive canonical match, else "Other") |
| `src/actions/subscription-payments.ts` | `getBillingPaymentInfoAction()` — tenant-side read of the platform's `package_payment` PlatformSetting (same source as /get-started checkout; edited on /admin/payments); submit action now normalizes the method against those live options |
| `src/storefront/admin/AdminBilling.tsx` | 💳 Payment methods card (instructions + per-channel account/number/note/QR); method dropdown driven by the same options; selection snaps to a valid option on load |

## RED → GREEN

- RED (`npm run test:subscription-payments`, `81ee5f5`): 5 new cases failed —
  `paymentMethodOptions is not a function` / `normalizePaymentMethodWith is not a function` (27 passed, 5 failed).
- GREEN (`10626f7`): `32 passed, 0 failed`. `tsc --noEmit`: 0 new errors.

## Guarantees (all unit, PASS)

1. Platform names → options, deduped case-insensitively, "Other" appended
2. Blank entries dropped; empty list falls back to the default catalogue
3. Existing "Other" (any case) isn't duplicated
4. Submitted methods match case-insensitively to the canonical spelling
5. Unknown methods narrow to "Other"

## Verification & gaps

- Live platform config confirmed (2 active channels: GCash, Maya) via read-only DB check.
- Served dev bundle confirmed to contain the new card (`curl` + grep on the page chunk)
  after clearing a stale `.next` cache that was serving an old bundle (Fast Refresh
  had been failing silently; fixed by moving `.next` aside and restarting `next dev`).
- Visual click-through pending — browser-automation MCP disconnected; check in a
  normal browser with a hard refresh (Cmd+Shift+R) on the store-admin Billing view.
- Action + card render covered by typecheck/bundle check, not unit tests (Next runtime).
