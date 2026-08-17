# Super Admin Calendar — settlement & income TDD evidence

**Source plan:** no `*.plan.md`; journeys were derived during this TDD run from the user's request,
grounded in a survey of `calendar-core.ts`, `near-due.ts`, `payments.ts`, `income-analytics.ts`, and
the `SubscriptionPayment` / `Tenant` schema before any code was written.

**Branch:** `main`

Follows on from [admin-calendar.tdd.md](./admin-calendar.tdd.md), which covers the month grid and
the derived due dates this feature settles.

---

## User journeys

1. As the operator, I want to mark a tenant's subscription due date as paid from the calendar, so I
   stop chasing a tenant who has already paid.
2. As the operator, I want marking paid to roll that tenant's subscription window forward, so their
   countdown stops reading "due soon" / "overdue".
3. As the operator, I want the amount I received to land in My Income for the month it landed in.
4. As the operator, I want to set what the tenant will be charged next term and on what cycle
   (monthly by default), so the next due date and the MRR figure both follow from one action.
5. As the operator, I want to undo a mark-paid I entered by mistake, restoring the previous window.
6. As the operator, I want the month to read at a glance — expected income, received income, what's
   still to collect, what's overdue — and every month of the year one click away.

### Design decisions recorded rather than silently resolved

- **The window roll is what clears the countdown.** `near-due.ts` and the store-admin banner read
  the subscription *window*, never the payment ledger. Recording a payment alone would leave a
  paying tenant nagged indefinitely, so the payment and the roll are written in one transaction.
- **The roll is conservative.** It only fires when the settled day IS the tenant's live window end.
  Settling a back-dated square records money and moves nothing, so back-filling payment history can
  never rewrite the current term. Pinned by *"paying a date that is not the live due date records
  money but moves nothing"*.
- **A yearly "amount to charge" is normalized to a monthly rate.** `subscriptionPriceCents` feeds
  MRR as a per-month figure, so ₱15,899/year is stored as ₱1,324.92/month alongside the ₱15,899 term
  total on `subscriptionAmountCents`. Storing the term total in both would spike MRR twelvefold.
- **"Received this month" is keyed on when the money landed**, not on the term it settles — so a
  payment taken in August against September's term counts in August, matching how
  `income-analytics.ts` already counts (`paidAt ?? submittedAt`).
- **Only `status: "confirmed"` counts as paid.** A pending tenant-filed proof the operator hasn't
  reviewed must keep reading as due.
- **Undo is scoped to calendar-created payments** (identified by the `reviewNote` stamp), and rolls
  the window back only when it still starts where this payment's term ended. A window the operator
  has since edited by hand is left standing.

---

## Task report

### Task 1 — Pure settlement core

Settlement indexing, paid chips, settled-renewal suppression, next-due derivation, the mark-paid
plan (validation, payment, window roll, next-term re-pricing), and the reversal plan.

- **RED:** `npm run test:calendar-paid` →
  `Error: Cannot find module '../src/lib/admin/calendar-settlement'`
  Compile-time RED: the new test references the module that does not exist yet. The failure is the
  missing implementation, not unrelated breakage.
- **Implementation:** `src/lib/admin/calendar-settlement.ts` (new), plus additive changes to
  `src/lib/admin/calendar-core.ts` — the `"payment"` event kind, the `paid` / `settlementId` /
  `paidDay` event fields, a shared `settlementKey`, and an optional `settled` set on
  `deriveTenantEvents`.
- **GREEN:** `npm run test:calendar-paid` → `69 passed, 0 failed`
- **No regression:** `npm run test:calendar` → `70 passed, 0 failed`
- **Guaranteed:** a due date can only be settled with a valid amount and date; the money is dated
  when it landed; the window advances exactly one term on the chosen cycle; a settled due date never
  also reads as due; the undo restores the exact term the payment covered, or nothing.

### Task 2 — Server plumbing

- **Implementation:** `src/actions/admin-calendar-payments.ts` (new) —
  `markSubscriptionPaidAction` and `undoSubscriptionPaidAction`, both operator-gated
  (`requirePlatformUser`), demo-blocked, and writing the payment plus the window in one
  `prisma.$transaction`. `src/lib/admin/calendar-data.ts` loads confirmed payments, feeds the
  suppression set, emits paid chips, and computes `collectedCents` / `expectedCents`.
- **Validation:** `npx tsc --noEmit --pretty false` → clean (no output).
- **Fail-open preserved:** a missing `subscription_payments` table degrades to "nothing settled"
  and hides the Mark-paid button (`paidAvailable: false`) rather than taking the page down — the
  same two-tier fallback the other admin loaders use.

### Task 3 — Redesign

- **Implementation:** `src/components/admin/pages/CalendarView.tsx` (rewritten),
  `src/components/admin/pages/CalendarMarkPaidDrawer.tsx` (new),
  `src/app/(platform)/admin/admin.css` (`.sa .cal-*` block).
- **Validation:** `npx tsc --noEmit` → clean; `curl http://app.lvh.me:3100/admin/calendar` → `200`
  (renders the platform login when unauthenticated, so the route compiles and does not 500).
- **Not verified:** the authenticated visual pass. See "Known gaps" below.

---

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Only confirmed payments count as settled; pending, failed, and unknown statuses still read as due | `scripts/test-calendar-settlement.ts:"a pending row is not a settlement"` (+ failed, unknown) | unit | PASS | `npm run test:calendar-paid` |
| 2 | A payment settles the day its term ends, while the money is dated when it landed | `…:"the paid day is tracked separately from the day settled"` | unit | PASS | `npm run test:calendar-paid` |
| 3 | A ledger row with no usable date is dropped rather than bucketed onto the epoch | `…:"a row with no usable date at all is dropped, not crashed on"` | unit | PASS | `npm run test:calendar-paid` |
| 4 | Two payments on one due date collapse to the later one; two tenants on one day don't collide | `…:"two payments on one due date keep the later one"` | unit | PASS | `npm run test:calendar-paid` |
| 5 | A settled due date is suppressed from the derived renewals, so a square never reads both due and paid | `…:"a settled due date drops out of the derived renewals"` | unit | PASS | `npm run test:calendar-paid` |
| 6 | Settling one tenant never hides another's due date on the same day | `…:"settling one tenant does not hide another's due date"` | unit | PASS | `npm run test:calendar-paid` |
| 7 | The next due date follows the cycle, clamping short months (Jan 31 → Feb 28) | `…:"a short target month clamps rather than overflowing"` | unit | PASS | `npm run test:calendar-paid` |
| 8 | A blank, zero, negative, or non-numeric amount is refused; peso formatting is accepted | `…:"a blank amount is refused"` (+ 4 siblings) | unit | PASS | `npm run test:calendar-paid` |
| 9 | Malformed and impossible dates are refused rather than rolled forward | `…:"a date that does not exist is refused"` | unit | PASS | `npm run test:calendar-paid` |
| 10 | A trial tenant cannot be settled | `…:"a trial tenant cannot be settled"` | unit | PASS | `npm run test:calendar-paid` |
| 11 | The planned payment is confirmed and stamped, so it counts as income immediately and stays undoable | `…:"the payment is confirmed, so it counts as income immediately"` | unit | PASS | `npm run test:calendar-paid` |
| 12 | Paying the live due date rolls the window forward, clearing near-due | `…:"the rolled window clears near-due, which is the whole point"` | unit | PASS | `npm run test:calendar-paid` |
| 13 | The form's cycle wins over the tenant's stored one; an unknown cycle is refused | `…:"the cycle chosen on the form wins over the tenant's stored one"` | unit | PASS | `npm run test:calendar-paid` |
| 14 | A yearly charge is normalized to a monthly rate for MRR | `…:"a yearly billing amount is normalized to a monthly rate for MRR"` | unit | PASS | `npm run test:calendar-paid` |
| 15 | A blank charge leaves the tenant's pricing alone | `…:"no billing amount typed leaves the tenant's pricing alone"` | unit | PASS | `npm run test:calendar-paid` |
| 16 | Settling a non-live due date records money and moves nothing | `…:"paying a date that is not the live due date records money but moves nothing"` | unit | PASS | `npm run test:calendar-paid` |
| 17 | Undo restores the exact term the payment covered | `…:"undoing restores the term the payment covered"` | unit | PASS | `npm run test:calendar-paid` |
| 18 | A tenant-filed payment cannot be undone from the calendar | `…:"a tenant-filed payment cannot be undone from the calendar"` | unit | PASS | `npm run test:calendar-paid` |
| 19 | A window the operator has since moved is left alone by undo | `…:"a window the operator has since moved is left alone"` | unit | PASS | `npm run test:calendar-paid` |
| 20 | The existing grid, derivation, projection, and entry-validation behaviour is unchanged | `scripts/test-calendar.ts` | unit | PASS | `npm run test:calendar` → 70 passed |
| 21 | The income roll-up and payment-ledger cores are unaffected | `scripts/test-income.ts`, `scripts/test-subscription-payments.ts`, `scripts/test-billing-cycle.ts` | unit | PASS | 12 / 32 / 20 passed |
| 22 | Every touched module type-checks | `npx tsc --noEmit --pretty false` | typecheck | PASS | no output |

---

## Coverage and known gaps

`npm run test:calendar-paid` → **69 passed, 0 failed**. The pure settlement core is covered
end-to-end: every exported function has cases for its happy path, its rejections, and its boundary
conditions (missing dates, unknown statuses, duplicate rows, short months, non-live due dates).

Intentional gaps, none of them silent:

- **No DB-level integration test.** `markSubscriptionPaidAction` / `undoSubscriptionPaidAction` are
  thin: gate → pure plan → one transaction. The rules they enforce are all covered above; what is
  not covered is Prisma actually writing both rows atomically. The repo has no integration harness
  for platform actions, so adding one was out of scope for this change.
- **No authenticated visual/E2E pass.** The route was verified to compile and return 200; the
  redesigned surface has not been screenshotted while signed in as the operator. Worth a look at
  1440 and 768 before this is considered finished.
- **`subscription_payments` must exist on the live DB.** If it hasn't been pushed
  (`npm run db:push`), the loader fails open, the calendar still shows every due date, and the
  Mark-paid button is hidden rather than erroring.

---

## Merge evidence

Checkpoint commits on `main`, in order:

| Commit | Stage | Evidence captured |
|--------|-------|-------------------|
| `9cded1b` | RED | `npm run test:calendar-paid` → `Cannot find module '../src/lib/admin/calendar-settlement'` — the intended missing implementation |
| `5bfcb30` | GREEN | `npm run test:calendar-paid` → 69 passed; `npm run test:calendar` → 70 passed (no regression) |
| `1f1c72d` | Plumbing + redesign | `npx tsc --noEmit` clean; all five suites green; route returns 200 |
