# TDD Evidence — code-review fixes (7 findings)

**Branch:** `feat/trial-system`
**Source:** high-effort `/code-review` of commit `438268b "gb functionalities and billings"`.
**Cycle:** RED reproducers committed at `c57d419`; fixes made GREEN afterwards.
No `*.plan.md` was used — the journeys below were derived from the review findings.

## User journeys

1. As a **customer**, when I check out a group-buy product during a live round, I am
   charged the exact price the group-buy page and cart advertised — even when that
   product has size variations — so the receipt never differs from what I saw.
2. As a **reseller**, buying group-buy products in bulk during a live round never
   costs me *more* than my normal wholesale price.
3. As a **store owner**, a group-buy product that is **not** in the live round keeps
   its regular price; only the round's assigned products get the group price.
4. As a **platform operator**, the tenant Billing "Subscription revenue" reflects
   **all** confirmed payments, not just the most recent screenful.
5. As an **operator**, every filed payment has a distinct invoice code, even when
   several land in the same month.
6. As an **engineer** running the image re-host migration, two images that share a
   filename never overwrite each other's backup or upload.
7. As a **maintainer**, the "counts as demand" status list has one definition shared
   by the storefront slot count and the supplier report.

## Task report (per finding)

| # | Finding | Fix | Validation | RED → GREEN |
|---|---------|-----|------------|-------------|
| 1 | `authoritativeItemPrice` charged a gb **variation** the raw variation price while the cart charged `gbPrice` (client/server divergence). | Route the variation through `makeVariationEntry` → `unitPrice`, so server & cart share one path. | `npm run test:group-buy-pricing` | RED `900 == 560` → GREEN |
| 2 | Lifetime billing metrics were summarized from a ledger truncated to 60 rows. | `buildPaymentsView(fullLedger, 60)` — summary over the whole ledger, display slice capped; server passes `subscriptionPaymentSummary`. | `npm run test:subscription-payments` | RED `buildPaymentsView is not a function` → GREEN |
| 3 | Live gb pricing overrode the cheaper reseller/discount price, over-charging bulk resellers. | `unitPrice` = `Math.min(gbPrice, regularUnitPrice)` — the group price can only ever lower a line. | `npm run test:group-buy-pricing` | RED `900 == 700` → GREEN |
| 4 | Cart/server priced **every** gb product at `gbPrice` whenever any round was live, ignoring the round's `productIds`. | New `GroupBuyPriceScope` + `isInGroupBuyScope`; `unitPrice`/`cartTotal`/`authoritativeItemPrice`/`repriceItems` take a scope; `stampGroupBuy` returns the attributed round's scope. | `npm run test:group-buy-pricing` | RED `560 == 700` (out-of-round gb priced at gbPrice) → GREEN |
| 5 | Storefront filled-slot DB query hardcoded `["cancelled","canceled","refunded"]` while the demo path used `orderCountsAsDemand`. | Export `DEMAND_EXCLUDED_STATUS_LIST`; both paths use it. | `npm run test:group-buy-pricing` | RED `…STATUS_LIST is not iterable` → GREEN |
| 6 | `subscriptionInvoiceCode` returned `INV-YYYYMM` — same-month payments collided. | Optional `id` param adds a deterministic per-payment suffix `INV-YYYYMM-XXXX`. | `npm run test:subscription-payments` | RED `expected INV-202608-…` → GREEN |
| 7 | `fileNameFromUrl` collided for distinct URLs sharing a basename → backup/upload overwrite. | `backupFileName(url, index)` prefixes the per-URL index; migration script uses it. | `npm run test:rehost-urls` | RED `backupFileName is not a function` → GREEN |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | gb variation in a live round is priced like the cart (`gbPrice`), not the variation price | `test-group-buy-pricing.ts:server matches the cart…` | unit | PASS |
| 2 | lifetime metrics roll up over the whole ledger while the table caps at 60 | `test-subscription-payments.ts:buildPaymentsView summarizes the full ledger…` | unit | PASS |
| 3 | bulk reseller in a live round keeps the cheaper wholesale price | `test-group-buy-pricing.ts:bulk reseller during a live round…` | unit | PASS |
| 4 | a gb product not assigned to the round keeps its regular price | `test-group-buy-pricing.ts:gb product NOT assigned to the round…` | unit | PASS |
| 5 | one shared demand-excluded status list | `test-group-buy-pricing.ts:DEMAND_EXCLUDED_STATUS_LIST is the single source…` | unit | PASS |
| 6 | same-month payments get distinct invoice codes | `test-subscription-payments.ts:…disambiguates same-month payments by id` | unit | PASS |
| 7 | colliding basenames get distinct, fs-safe backup names | `test-rehost-urls.ts:backupFileName keeps distinct names…` | unit | PASS |

## Results (GREEN)

```
test:group-buy-pricing      18 passed, 0 failed
test:subscription-payments  21 passed, 0 failed
test:rehost-urls            14 passed, 0 failed
test:group-buy-page         21 passed, 0 failed   (updated to the scope signature)
test:cart-pricing / test:reseller-pricing / test:two-ways / test:gb-banner /
test:gb-rounds / test:checkout-total   all PASS (no regression)
tsc --noEmit                0 errors
```

## Coverage & known gaps

- These are self-contained `tsx` harnesses (repo convention), asserting behavioral
  guarantees on the pure cores; no coverage instrumentation is wired in this repo.
- **Pre-existing, out of scope:** `npm run test:onhand-gate` reports `8 passed, 1 failed`
  ("blocks the paused product through the real resolvers"). Verified it fails
  **identically with these changes stashed**, so it predates this work — not
  addressed here.
- Findings #2/#4's data-flow wiring (`data.ts`, `orders.ts`, `CartCheckout.tsx`) is
  covered by the pure seams (`buildPaymentsView`, `isInGroupBuyScope`,
  `stampGroupBuy` scope) plus the full `tsc` compile; there is no DB/RSC integration
  harness in this repo to exercise the wiring at runtime.

## Merge evidence (for squash)

RED reproducers `c57d419`; GREEN fixes in the follow-up commit. All seven findings
went RED (reproduced the exact defect) then GREEN; full `tsc --noEmit` clean.
