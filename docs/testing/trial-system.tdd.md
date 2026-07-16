# TDD Evidence — 30-Day Trial System

**Source plan**: presented in-session from the design handoff
(`~/Downloads/i want to improve this design since i now added a trial package .zip` —
`handoff/PROMPT.md` + `Trial Dashboard.dc.html` mock) and confirmed by the user
("Yes, proceed"; upgrade activation: **after operator approval**).
**Branch**: `feat/trial-system` · **Date**: 2026-07-16

## User journeys (from the brief)

1. As a trial store owner, I see a countdown banner ("X days left", Day X of 30,
   end date, credit note) on every admin page, with an Upgrade CTA.
2. As a trial store owner, everything works except **Checkout Fee** and
   **Delivery Note**, which show a gold BUSINESS badge and open the Upgrade page.
3. As a trial/unentitled store owner, newly released features appear as a gold
   "NEW FEATURE / BUSINESS EXCLUSIVE" spotlight on my dashboard.
4. As a store owner, the Upgrade page shows Business monthly − trial credit =
   due today, the platform's receiving accounts, and a proof upload; my plan
   activates when the operator approves.
5. As a customer of an expired-trial store, I see a branded "We're currently on
   pause" page; checkout is refused server-side.
6. As an expired-trial store owner, my admin is locked behind "Choose how to
   continue": Business (recommended, credit applied) or Starter (ONE combo:
   FAQ+Protocols or Calculator+Order Tracking; 10-product cap).

## RED → GREEN cycle log (all on feat/trial-system)

| Phase | RED commit (reproducer, verified failing) | GREEN commit (verified passing) |
|---|---|---|
| 1 Trial-state core | `db3012a` — `MODULE_NOT_FOUND ../src/lib/trial/trial-state` | `45c37d7` — 13/13 |
| 2 Gating | `9ff867c` — `brandTrialFrom is not a function` (runtime) | `6ac82e2` — 14/14 |
| 3 Spotlight/UI | RED in `test:feature-spotlight` (`Cannot find module feature-spotlight`) | `eecd2b5` — 6/6 |
| 4 Upgrade | `04f8a96` — `Cannot find module upgrade-quote` | `17855ef` — 9/9 |
| 5 Expiry/downgrade | `6b45c8e` — `Cannot find module starter-downgrade` | `4579c2b` — 8/8 |

Every RED was compiled and executed (tsx) and failed for the intended missing
implementation, per the module-missing precedent set by `test:faq`.

## Test specification

| # | What is guaranteed | Command | Result |
|---|---|---|---|
| 1 | Countdown math (days left / Day X of Y / % used), expiry boundaries, operator windows, ISO round-trip; operator-created `status:"trial"` tenants without a window are never governed | `npm run test:trial-state` | PASS 13/13 |
| 2 | `STORE_TRACK_NOTE` in Business/Automated ceilings only (+ operator-grantable); fee/tracknote tiles lock during active trial or on revocation, stay visible as teasers, never lock legacy brands | `npm run test:trial-gating` | PASS 14/14 |
| 3 | Spotlight picks the first operator-kept new feature (all during trial, unentitled-only otherwise; unknown keys skipped) | `npm run test:feature-spotlight` | PASS 6/6 |
| 4 | `plan_config.trialPriceCents` (default ₱699, clamped); due today = Business − credit, clamped ≥ 0; request state machine pending→approved/rejected only, decisions final | `npm run test:trial-upgrade` | PASS 9/9 |
| 5 | Paused ⇔ trial-governed AND expired; both Starter combos well-formed (combo B grants order-tracking beyond the ceiling, both revoke the Checkout Fee); 10-product cap binds only trial-downgraded stores | `npm run test:trial-expiry` | PASS 8/8 |

## Server-authoritative enforcement (not client cosmetics)

- `saveStoreAdminFeeAction` / `saveTrackNoteAction` re-check
  `isBusinessExclusiveLocked` on write (`src/lib/trial/trial-info.ts`).
- `placeStorefrontOrderAction` refuses orders for paused stores and never
  stamps a locked admin fee.
- `saveProductAction` enforces the 10-product cap via the
  `branding.config.trialDowngrade` marker (legacy Starter stores exempt).
- Plan flips happen ONLY in `decideUpgradeRequestAction` (operator, txn) or
  `downgradeToStarterAction` (owner, expired trials only, txn).

## Full verification (2026-07-16)

- `npx tsc --noEmit` — clean.
- All 29 `npm run test:*` suites — PASS.
- `npm run build` — production build succeeded.

## Intentional test corrections (pre-existing failures, verified on main)

- `test:plan-scope` and `test:staff` each asserted Staff Accounts is in the
  **pro** ceiling — stale since the deliberate "Business narrowing"
  (pepstack-davao reference set). Both were failing identically at `main`
  (verified in a clean worktree at `6131218` / `45c37d7`) and were updated to
  the narrowed reality (staff = addon on pro, included on Automated).
- `scripts/test-business-package.ts` exists but has **no npm script** —
  pre-existing orphan, untouched.

## Known gaps / follow-ups

1. **`npm run db:push` required** before the upgrade flow works live — the new
   `UpgradeRequest` table (and any pending `storefront_staff` push) must reach
   the DB. Until then the Upgrade page degrades gracefully with an error.
2. `sync-plan-features` (or the /admin/plans save, which syncs the catalog)
   must run once so the DB `features`/`plan_features` rows pick up
   `storefront.track_note`; until then live entitlements for it resolve false.
3. Trial price is operator-editable only via the stored `plan_config` value
   (default ₱699) — no /admin/plans input field yet; saving plans preserves it.
4. E2E/visual pass (Playwright screenshots of the four mock states) not run —
   repo has no Playwright harness; recommend a follow-up `verify` run against
   a dev tenant with an operator-set trial window.
