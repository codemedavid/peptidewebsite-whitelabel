# TDD evidence — Group Buy Management redesign & per-round dashboard

**Date:** 2026-07-29
**Branch:** `feat/gb-pricing-tab`
**Commits:** `4302bcf` (RED) → `569c4e6` (GREEN)
**Source plan:** inline `/ecc:plan` output in this session (no `*.plan.md` artifact). Journeys below are the plan's.

---

## User journeys

1. As a store owner, I want the Group Buy list to show name, product, batch, status, progress, orders, participants, gross income and created date, so I can triage rounds at a glance.
2. As a store owner, I want to click a round and land on a dashboard for *that round only*.
3. As a store owner, I want financial analytics per round where cancelled orders never inflate gross income or revenue.
4. As a store owner, I want vial analytics split by confirmed/pending/cancelled, with remaining and completion %, so I order the right amount from the supplier.
5. As a store owner, I want to filter the round's orders by payment status, order status, date and customer name.
6. As a store owner, I want an Excel export for the selected round only, matching the dashboard.

---

## Decisions and assumptions

Two requested fields had no backing data. Both were raised before implementation and confirmed with the store owner ("proceed" against the recommended defaults):

| Field | Reality | Decision |
|---|---|---|
| **Outstanding Balance** | `StorefrontOrder.paymentStatus` is only `pending\|paid` — no partial payments exist | Defined as **the value of non-cancelled orders not yet marked paid**. It cannot mean "part of an order still owed" without an order-level payment ledger, which would be a much larger change. |
| **Batch Number** | No field existed | Added as an **owner-typed** field on the round, falling back to the round name when blank. |

Three further fields also had no backing data and became nullable columns: `minVials`, `maxVials`, `closedAt`. `maxVials` is deliberately **not** the existing `slotGoal` — that one drives the customer-facing storefront progress bar, and overloading it would change what shoppers see.

`Product Name` needed no schema change: a round assigns 0..N products, so it is derived — one product shows its name, several show a count, none reads "Whole catalog". Naming a round after just its first product would be misleading when it sells five.

---

## Task report

### 1. Reproduce (RED)

`scripts/test-gb-analytics.ts` written first, against a module that did not exist.

```
$ npm run test:gb-analytics
Error: Cannot find module '../src/lib/storefront/group-buy-analytics'
```

Compile-time RED: the test newly references the missing implementation, and the
failure is the intended signal. Committed as `4302bcf`.

### 2. Implement (GREEN)

- `prisma/schema.prisma` — `batchNumber`, `minVials`, `maxVials`, `closedAt` (all nullable); `cancelled` added to the documented status set.
- `src/lib/storefront/group-buy.ts` — new fields through `normalizeGroupBuy` / `dbGroupBuyToStorefront` / `groupBuyToDbWrite`; `cancelled` added to `GROUP_BUY_STATUSES` and short-circuited as terminal in `effectiveGroupBuyStatus` so a called-off round can never be derived back to active by its window.
- `src/lib/storefront/group-buy-analytics.ts` — **new**, pure: `buildRoundAnalytics`, `buildRoundListRow`, `displayRoundStatus`, `resolveRoundProductName`, `countParticipants`, `filterOrderRows`.
- `src/actions/group-buys.ts` — `listGroupBuysAction` returns per-round rows; new `getGroupBuyDashboardAction(id)`. Both share `loadCandidateOrders` (one query, not N+1) and `loadProductNames`.
- `src/storefront/admin/AdminGroupBuyDetail.tsx` — **new** dashboard.
- `src/storefront/admin/gb-proof-lightbox.tsx` — **new**, extracted; reuses `AdminOrderDetail`'s existing `od-proof-viewer` CSS and `hasPaymentProof` rather than a second viewer.
- `AdminGroupBuys.tsx` — clickable rows, new editor fields, shared lightbox/badge.
- `AdminPage.tsx` / `visibility.ts` / `staff-permissions.ts` — `groupbuy-detail` registered in all three.
- `supplier-workbook.ts` — summary block on the Products-to-Order sheet.

```
$ npm run test:gb-analytics        37 passed, 0 failed
$ npm run test:gb-report           12 passed, 0 failed
$ npm run test:gb-report-orders    22 passed, 0 failed
$ npm run test:gb-rounds           13 passed, 0 failed
$ npm run test:gb-banner           10 passed, 0 failed
$ npm run test:onhand-gate          9 passed, 0 failed
$ npm run test:two-ways            18 passed, 0 failed
$ npm run test:staff         PASS — 62 passed, 0 failed
$ npx tsc --noEmit --pretty false | grep -c "error TS"     0
$ npm run build                    ✓ Compiled successfully in 9.3s
$ npx prisma db push --skip-generate
  🚀  Your database is now in sync with your Prisma schema. Done in 5.45s
```

### 3. Verify against live data

Read-only script over the real `k-glow` rows (deleted after the run; not committed):

```
=== MANAGEMENT LIST ===
  june gb   | 25 products | batch june gb | Completed | 0/- vials | 0 orders | 0 participants | PHP 0      | 2026-07-21
  july 28   | 5 products  | batch july 28 | Completed | 6/- vials | 2 orders | 2 participants | PHP 22,304 | 2026-07-28

=== DASHBOARD: july 28 ===
  FINANCIAL gross=22304 confirmed=22304 pending=0 collected=22304 outstanding=0 cancelledOrders=0
  INVARIANT gross === confirmed+pending : true
  PRODUCT total=6 confirmed=6 pending=0 cancelled=0 remaining=null completion=null
  INVARIANT total === confirmed+pending : true
  OVERVIEW participants=2 orders=2 product="5 products" batch="july 28" status=Completed minMet=null
  ORDER ROWS 5; filter Confirmed → 5; filter customer "eri" → 5
  EXCEL PARITY vials=true sales=true cancelled=true productsToOrder=true
```

`remaining`/`completion`/`minMet` are `null` because k-glow's rounds predate the
new columns and have no min/max configured — that renders as "Not set" rather
than a misleading 0%.

---

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Gross Income excludes cancelled orders | `test-gb-analytics.ts:Gross Income EXCLUDES cancelled orders` | unit | PASS | `npm run test:gb-analytics` |
| 2 | Confirmed Payments = paid, non-cancelled value | `…:Confirmed Payments = the paid, non-cancelled value` | unit | PASS | same |
| 3 | Pending Payments = unpaid, non-cancelled value | `…:Pending Payments = the unpaid, non-cancelled value` | unit | PASS | same |
| 4 | Revenue Collected equals Confirmed Payments | `…:Revenue Collected equals Confirmed Payments` | unit | PASS | same |
| 5 | Outstanding Balance = value of non-cancelled unpaid orders | `…:Outstanding Balance = value of non-cancelled orders not yet paid` | unit | PASS | same |
| 6 | Invariant: grossIncome === confirmed + pending | `…:grossIncome always equals confirmed + pending` | unit | PASS | same + live data |
| 7 | Cancelled orders are counted even though their money is excluded | `…:Total Cancelled Orders is counted even though its money is excluded` | unit | PASS | same |
| 8 | A paid-but-cancelled order adds nothing to revenue | `…:a paid BUT cancelled order adds nothing to revenue` | unit | PASS | same |
| 9 | Total Vials excludes cancelled vials | `…:Total Vials Ordered excludes cancelled vials` | unit | PASS | same |
| 10 | Vials split confirmed / pending / cancelled | `…:vials split into confirmed / pending / cancelled` | unit | PASS | same |
| 11 | Invariant: totalVials === confirmed + pending | `…:totalVials always equals confirmed + pending` | unit | PASS | same + live data |
| 12 | Remaining = max − total, never negative | `…:Remaining Available Vials = max − total, never negative` | unit | PASS | same |
| 13 | Completion % = total / max | `…:Completion Percentage = total / max` | unit | PASS | same |
| 14 | Over-subscription reports past 100% instead of capping | `…:over-subscription reports past 100% rather than silently capping` | unit | PASS | same |
| 15 | No maxVials → remaining/completion null, not a fake 0% | `…:no maxVials set → remaining and completion are null` | unit | PASS | same |
| 16 | Participants = unique non-cancelled customers | `…:Total Participants counts unique non-cancelled customers` | unit | PASS | same |
| 17 | One customer with two orders is one participant | `…:the same customer ordering twice is ONE participant` | unit | PASS | same |
| 18 | Total Orders counts every order incl cancelled | `…:Total Orders counts every order incl cancelled` | unit | PASS | same |
| 19 | Progress reads current vials against the maximum | `…:Progress reads current vials against the maximum` | unit | PASS | same |
| 20 | minimumMet flips at the minimum; null when unset | `…:minimumMet flips once the minimum requirement is reached` | unit | PASS | same |
| 21 | Closed Date surfaces only once the round closed | `…:Closed Date is surfaced only when the round actually closed` | unit | PASS | same |
| 22 | active→Open, closed→Completed, cancelled→Cancelled | `…:active → Open, closed → Completed, cancelled → Cancelled` | unit | PASS | same |
| 23 | draft/scheduled/archived keep their own labels | `…:draft / scheduled / archived keep their own labels` | unit | PASS | same |
| 24 | One assigned product shows its name | `…:a round assigned ONE product shows that product's name` | unit | PASS | same |
| 25 | Several products show a count, not a misleading single name | `…:a round assigned SEVERAL products shows the count` | unit | PASS | same |
| 26 | No products = whole catalog | `…:a round assigned NO products covers the whole catalog` | unit | PASS | same |
| 27 | A deleted product never renders a raw cuid | `…:an assigned product that no longer exists doesn't render a raw id` | unit | PASS | same |
| 28 | Batch Number falls back to the round name when blank | `…:Batch Number falls back to the round name` | unit | PASS | same |
| 29 | A list row carries every management-page column | `…:a list row carries every column the management page shows` | unit | PASS | same |
| 30 | List numbers match the dashboard's — no drift | `…:list-row numbers match the dashboard's for the same round` | unit | PASS | same + live data |
| 31 | **Analytics are per round — another round's orders never bleed in** | `…:analytics are per round — a different round's orders never bleed in` | unit | PASS | same |
| 32 | No filters returns every row | `…:no filters returns every row` | unit | PASS | same |
| 33 | Filter by payment status | `…:filter by payment status` | unit | PASS | same |
| 34 | Filter by order status | `…:filter by order status` | unit | PASS | same |
| 35 | Filter by customer name, case-insensitive substring | `…:filter by customer name, case-insensitive substring` | unit | PASS | same |
| 36 | Filter by date range, inclusive both ends | `…:filter by date range, inclusive on both ends` | unit | PASS | same |
| 37 | Filters combine with AND | `…:filters combine — every condition must hold` | unit | PASS | same |
| 38 | Order↔round association (attribution + window) unchanged | `scripts/test-gb-report-orders.ts` (22 checks) | unit | PASS | `npm run test:gb-report-orders` |
| 39 | Round status/window resolution unchanged by `cancelled` | `scripts/test-gb-rounds.ts` (13 checks) | unit | PASS | `npm run test:gb-rounds` |
| 40 | Staff/visibility gating still correct after registering `groupbuy-detail` | `scripts/test-staff-permissions.ts` (62 checks) | unit | PASS | `npm run test:staff` |
| 41 | Live k-glow dashboard + list + Excel parity | read-only verification over live rows | manual | PASS | output quoted above |

---

## Coverage and known gaps

No coverage harness exists in this repo (standalone `tsx` scripts, no Jest/Vitest),
so a percentage cannot be produced. All six exported functions of
`group-buy-analytics.ts` are exercised: `buildRoundAnalytics` (18 checks),
`buildRoundListRow` (3), `displayRoundStatus` (2), `resolveRoundProductName` (4),
`countParticipants` (1), `filterOrderRows` (6) — 6/6.

Intentional gaps and caveats:

- **No automated UI test.** The repo has no React test runner or Playwright setup.
  The dashboard, clickable list rows and proof lightbox were verified by
  typecheck, production build, and by reading the render paths — not by execution
  in a browser. The logic they render is fully unit-tested.
- **The proof lightbox was not clicked in a browser.** It reuses `AdminOrderDetail`'s
  already-shipped `od-proof-viewer` markup and CSS (see `payment-proof-viewer.tdd.md`),
  which is why reuse was chosen over a new viewer.
- **`db push` was applied to the live database.** All four columns are nullable, so
  existing rows remain valid. Per project convention there are no migrations.
- **k-glow's existing rounds have no min/max configured**, so remaining vials and
  completion % read "Not set" there until the owner fills them in on the edit form.
- **Query breadth.** `loadCandidateOrders` reads orders that are attributed to any
  round OR placed on/after the earliest round start. That is bounded, but a tenant
  with a very long history since its first round will read more rows than a single
  indexed equality would. If it becomes a problem, bound by the union of round
  windows instead.
- **ESLint not run** — `npx next lint` prompts to initialize a config this repo has
  never had. Typecheck and build both pass.
- **Unrelated pre-existing failure fixed.** `scripts/test-onhand-gate.ts` pinned
  `NOW` to `2026-07-17` while its resolver test used the real clock, so the fixture
  round read as closed once the calendar passed `2026-07-18`. Anchored to the real
  clock; all offsets were already relative.

## "Analytics update automatically as orders are placed, confirmed, or cancelled"

`getGroupBuyDashboardAction` and `listGroupBuysAction` are uncached Server Actions
querying through `withTenant` — no `unstable_cache` in the path. Both re-resolve
from current rows on every call, so opening (or pressing **Refresh** on) the
dashboard reflects the latest statuses. There is no push/websocket updating an
already-open page; refresh is explicit.

## Merge evidence

- **RED** — `4302bcf`: `npm run test:gb-analytics` → `Cannot find module
  '../src/lib/storefront/group-buy-analytics'` (compile-time RED, intended cause).
- **GREEN** — `569c4e6`: 37 + 12 + 22 + 13 + 10 + 9 + 18 + 62 checks passing,
  `tsc --noEmit` 0 errors, `next build` compiled successfully, `prisma db push`
  applied, live k-glow verification with both invariants true and Excel parity true.
- **Refactor** — folded into the GREEN commit: the proof lightbox and
  `PaymentBadge` were extracted from `AdminGroupBuys.tsx` into
  `gb-proof-lightbox.tsx` and re-pointed at the existing `od-proof-viewer` CSS,
  removing a duplicated viewer; tests stayed green across the extraction.
