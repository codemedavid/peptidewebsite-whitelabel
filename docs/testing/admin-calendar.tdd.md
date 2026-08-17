# Super Admin Calendar — TDD evidence

**Source plan:** inline `/ecc:plan` output (conversational mode, not a `.plan.md` file), grounded in
a codebase survey before any code was written. Journeys below were derived during that plan and
reused verbatim for the TDD cycle.

**Branch:** `feat/admin-calendar`

---

## User journeys

1. As the super admin, I want each tenant's subscription due date plotted on its calendar day, so I
   can see who owes me and when without opening every tenant.
2. As the super admin, I want overdue and nearly-due renewals visually distinct, so I can triage at
   a glance.
3. As the super admin, I want future recurring renewals projected forward, so next month's calendar
   isn't empty.
4. As the super admin, I want to add my own schedule entries — for a platform tenant **or** for a
   client who isn't on the whitelabel — so one calendar holds everything.
5. As the super admin, I want to move between months and have a month be linkable.

### Ambiguity recorded rather than silently resolved

The request said "add a schedule for the tenants that is not in the whitelabel". That reads two
ways: (A) entries for clients who aren't tenants at all, or (B) entries not auto-derived from
platform data. The user was asked and did not pick. **Chosen interpretation: support both** — the
model carries a nullable `tenantId` *and* a free-text `clientLabel`, and the form offers either.
Scope was not widened beyond that union.

---

## Task report

### Task 1 — Pure calendar core

Month grid, UTC day bucketing, month arithmetic, tenant due-date derivation, forward cycle
projection, trial expiries, and operator-entry mapping.

- **RED:** `npm run test:calendar` →
  `Error: Cannot find module '../src/lib/admin/calendar-core'`
  (compile-time RED: the test references the missing implementation)
- **GREEN:** `npm run test:calendar` → `54 passed, 0 failed`
- **Commits:** `93e0e50` (RED) → `e2f06db` (GREEN)

**Guaranteed:** a tenant's due date lands on the same square the operator typed; urgency matches the
tenant's own countdown banner by construction (both derive from `computeSubscriptionState`);
projections clamp at month ends and never escape the visible range.

### Task 2 — Schema

`PlatformCalendarEvent`, plus the RLS posture.

- **Validation:** `npx prisma validate` → `The schema at prisma/schema.prisma is valid 🚀`;
  `npx prisma generate` → client generated; delegate probe → `platformCalendarEvent: object`
- **Regression:** `test:calendar` 54/0, `test:billing-cycle` 20/0, `test:near-due` 10/0,
  `test:subscription-state` 20/0, `test:income` 12/0, `test:subscription-payments` 32/0
- **Commit:** `1ad1c0a`

**Guaranteed:** nothing else in the schema moved. The table is documented in the *"NOT covered, on
purpose"* block of `prisma/rls.sql` — it carries a nullable `tenantId` and so *looks* tenant-owned,
but a §1 isolation policy would hide every row from the operator (whose reads run outside
`withTenant`, GUC unset) and reject the null-`tenantId` off-platform inserts.

### Task 3 — Entry validation

- **RED:** `npm run test:calendar` → `54 passed, 16 failed`, every failure
  `normalizeCalendarEventInput is not a function` (runtime RED; the prior 54 still passed, so the
  failure was the missing implementation and not unrelated breakage)
- **GREEN:** `npm run test:calendar` → `70 passed, 0 failed`
- **Commits:** `b42bf15` (RED) → `373d6b2` (GREEN)

**Guaranteed:** the add-entry boundary rejects blank titles, malformed dates, impossible dates
(`2026-02-30`), unknown entry kinds, and over-long text — returning a friendly message rather than
throwing.

### Task 4 — Data layer, actions, page, UI

- **Validation:** `npx tsc --noEmit --pretty false` → **exit 0, 0 errors**
- **Regression:** `test:calendar` 70/0, `test:income` 12/0, `test:near-due` 10/0,
  `test:subscription-state` 20/0, `test:billing-cycle` 20/0, `test:admin-dashboard` 56/0
- **Commit:** `daddc5d`

> An earlier typecheck was reported clean in error: it was wrapped in `timeout`, which does not
> exist on macOS, so `tsc` never ran. Re-run without it, 8 real errors surfaced (`Ic` used as a JSX
> component when it is a `Record<string, LucideIcon>` map). Fixed to the house `<Ic.Plus />` idiom;
> the exit-0 result above is from the corrected run.

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A late-evening UTC instant stays on its own UTC day (no local-zone shift) | `test-calendar.ts:a late-evening UTC instant stays on its own UTC day` | unit | PASS |
| 2 | An off-midnight legacy row still buckets to its calendar day | `test-calendar.ts:an off-midnight legacy row…` | unit | PASS |
| 3 | Every month yields a stable 42-cell grid, Sunday-first, strictly consecutive | `test-calendar.ts:every month of a year yields a full 42-cell grid` + `…strictly consecutive days` | unit | PASS |
| 4 | Leap-year February spans its 29 days | `test-calendar.ts:a leap-year February grid still spans its 29 days` | unit | PASS |
| 5 | Month nav rolls over year boundaries both directions | `test-calendar.ts:shiftMonth rolls forward/backward over a year boundary` | unit | PASS |
| 6 | A tenant's due date lands on its own day, with identity and amount attached | `test-calendar.ts:a tenant's due date lands on its own day` (+2) | unit | PASS |
| 7 | Lapsed → overdue, within 7 days → due_soon, otherwise scheduled | `test-calendar.ts:a lapsed due date is flagged overdue` (+2) | unit | PASS |
| 8 | A suspended tenant still shows its due date (unlike the Income page) | `test-calendar.ts:a suspended tenant still shows its due date` | unit | PASS |
| 9 | Monthly cycles project forward; yearly and cycle-less ones do not | `test-calendar.ts:a monthly cycle projects…` (+2) | unit | PASS |
| 10 | Projection clamps Jan 31 + 1 month to Feb 28, never overflowing to March | `test-calendar.ts:projection clamps to the end of a short month` | unit | PASS |
| 11 | Projection never escapes the visible range | `test-calendar.ts:projection never runs past the visible range` | unit | PASS |
| 12 | Trial tenants emit a trial expiry and never a renewal; paid tenants the reverse | `test-calendar.ts:a trial tenant does not also emit a renewal` (+2) | unit | PASS |
| 13 | An entry resolves a linked tenant's name, or falls back to the off-platform label | `test-calendar.ts:a manual event for a platform tenant…` (+1) | unit | PASS |
| 14 | The more urgent event sorts first within a day | `test-calendar.ts:the more urgent event sorts first within a day` | unit | PASS |
| 15 | Blank/missing titles, bad dates, impossible dates, unknown kinds are rejected | `test-calendar.ts:entry validation` section (16 checks) | unit | PASS |
| 16 | Linking a tenant clears the client label, so an entry never names two owners | `test-calendar.ts:linking a tenant clears any client label` | unit | PASS |

`npm run test:calendar` → **70 passed, 0 failed**

---

## Coverage and known gaps

There is no coverage instrument in this repo (no `test:coverage` script; ~110 standalone `tsx`
assertion scripts instead), so no percentage is claimed. Coverage of the **pure core** is
effectively complete — all exported functions are exercised, including boundary cases.

Deliberately untested, consistent with house convention (pure logic is extracted and tested; I/O
layers are not):

- `calendar-data.ts` — Prisma reads and the fail-open fallbacks
- `admin-calendar.ts` — the four server actions (auth gate, demo branch, revalidation)
- `CalendarView.tsx` — rendering and interaction

**Not yet verified in a browser.** The page has not been loaded against a running dev server, and no
visual/responsive check has been done at the breakpoints the web rules call for.

**`platform_calendar_events` does not exist in the live database.** `npm run db:push` has not been
run — that writes to production and was left for the user to authorise. Until then the derived half
(every tenant due date) works normally and entry creation returns
*"Could not save — has the platform_calendar_events table been pushed?"*. After pushing, the dev
server must be restarted or the new delegate reads as `undefined`.

---

## Merge evidence

If these commits are squashed, preserve:

```
RED    93e0e50  test:calendar -> Cannot find module 'calendar-core' (compile-time)
GREEN  e2f06db  test:calendar -> 54 passed, 0 failed
       1ad1c0a  schema: prisma validate OK, delegate present, 6 suites green
RED    b42bf15  test:calendar -> 54 passed, 16 failed (normalizeCalendarEventInput missing)
GREEN  373d6b2  test:calendar -> 70 passed, 0 failed
       daddc5d  page/actions/UI: tsc --noEmit exit 0, 6 suites green
```

**Branch hygiene note:** five unrelated storefront commits (`0670925`, `3a50f52`, `8bbe05c`,
`8088767`, `6c8d224`) were written onto this branch by a concurrent session between the first RED
and GREEN checkpoints. They are not part of this feature. The RED→GREEN chain was verified intact
(`git merge-base --is-ancestor 93e0e50 HEAD` → true).
