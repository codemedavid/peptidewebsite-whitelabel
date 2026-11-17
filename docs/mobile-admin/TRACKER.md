# Peptide Tracker (PepWorld customer app)

Status: phases 0–4 BUILT 2026-11-17 (uncommitted). Release (phase 5) pending: db push + deploy + new app build. See §10.
Branch `feat/mobile-admin-app`.
Feature key: `mobile.tracker`, operator-grantable, **default OFF**.
First grant: **vrjonina** (VR Jonina, Pro). It already has `mobile.shop`,
`mobile.community` and `storefront.protocols`.

## 1. What the best trackers do (research, Nov 2026)

Apps reviewed: Shotsy (GLP-1), PeptidePal, Peptide Tracker, Dosed, PeptideBro,
OmniSite, PeptideCalc.io, CalcPep and SHOTLOG, plus App Store review
aggregates and UX teardowns.

| Pattern | Best at it | Ours |
|---|---|---|
| **Today screen**: next-dose countdown card, one-tap "Log dose" with dose and site pre-filled | Shotsy, PeptidePal | MVP. This is the tab root |
| Week strip over a month calendar, plus a streak | PeptidePal | MVP |
| **Multi-compound protocols** (stacks) with flexible frequency: daily, every N days, weekdays, on/off cycles | PeptidePal. Shotsy started single-drug and was criticised for it | MVP |
| **Body-map site rotation** with recency heat (ready / recovering / recent). The suggestion never blocks a log | PeptideBro, OmniSite, Peptly | MVP |
| **Vial inventory** that deducts on every log and shows doses left, run-out date and a low warning about 7 days out | PeptidePal | MVP. A tracker that doesn't deduct gets refund requests |
| Local reminders with Taken and Snooze actions | all | MVP |
| Daily check-in: side effects (with an explicit **"none today"**), weight, energy | Shotsy (it has no "none" option) | MVP-lite |
| **Estimated level curve** from half-life. Users call it "the most important feature" | Shotsy | v2. We go further by **overlaying side-effect markers** on it |
| Units converter with a **syringe fill visual** (U-100/U-40/U-30) | PeptidePal, CalcPep | v2, behind its own key (App Store risk, see §6) |
| Next-dose widget, Live Activity | Shotsy widgets. No peptide app has a Live Activity | v3 |
| CSV/PDF export for a doctor | Shotsy | v2 |
| Sample chart on the empty first-run screen | nobody. Shotsy shows a blank | MVP (cheap win) |

**Complaints to design against:**
- **Paywalls:** moving a free feature behind a paywall. We have no consumer paywall; the store grants the tracker.
- **One compound only.**
- **Too many taps to save,** or notes hidden in an edit mode.
- **Inventory that doesn't move when you log.**
- **Minute-by-minute time pickers.** Use 5-minute steps and default to "now".
- **No way to log "no side effects".**
- **Data stuck on one phone.**
- **Slow cold open.**

## 2. What we already have: MamaMicaGlow's tracker v2

`/Users/ynadonaire/MamaMicaGlow` ships a complete tracker whose core is pure and
tested. That core is `lib/tracker/*`, about 2.7k lines, with
`scripts/test-tracker-*.ts` tests. **Port it; don't rebuild.**

| Module | Gives us | Port |
|---|---|---|
| `schedule.ts` | `occurrences`, `nextOccurrences`, `isOnDay`, `inCycleOn`, `withScheduleHistory` (editing or pausing never rewrites the past), `describeSchedule` | ✅ as is |
| `today.ts` | `matchSlots` (matches logs and skips to scheduled slots), `buildToday`, `nextAfterToday` | ✅ |
| `consistency.ts` | streak, heatmap, `weekStrip`, `cyclePosition`, milestones | ✅ |
| `vials.ts` | `vialStatus`, `effectiveMix`, `vialForDose` | ✅ |
| `sites.ts` | `suggestSite`, `siteStates` (10 sites) | ✅ |
| `reminders.ts` | `planReminders`: 14 days ahead, at most 48, plus refill and check-in reminders | ✅ |
| `dose-math.ts` | `computeDraw`, `toBase`, `SYRINGES` | ✅ for unit handling. The converter UI comes in v2 |
| `weight.ts`, `protocol-form.ts`, `ids.ts`, `quick-log.ts`, `types.ts` | form ⇄ protocol, day keys | ✅ (also add tests for `ids` and `quick-log`) |
| `cloud-map.ts`, `migrate.ts`, `sync-errors.ts` | Supabase and legacy-schema glue | ❌ replaced by the sync in §5 |

**UI to port, then restyle to the store palette:**
- `components/tracker/BodyMap.tsx`
- the `VialGauge` and `SyringeGauge` gauges
- the setup steps: `CompoundStep`, `DoseStep`, `ScheduleStep`
- `SkipSheet`
- `UndoToast`
- `MedicalDisclaimer` and the disclaimer screen

**Port with the theme fixed:** swap `useTrackerPalette()` and the leftover
`isDark ?` ternaries and hex values for the store palette (`useChatBrand`, `CHAT`, `INTER`).

**Don't port:** `services/notificationService.ts` and `peptideService.ts`
(legacy), and the duplicate `formatDose` in `lib/trackerCatalog.ts`.

This is a **straight copy**, not a shared package. That matches how the
Mamamica work has gone. Keep the file names so fixes can be diffed across both apps.

## 3. Where PepWorld beats a stand-alone tracker

The tracker lives inside the store's own app, signed in with the store account:

1. **"Add vial from my orders".** A delivered order line (product + variation
   strength) becomes a vial in one tap, with name and mg pre-filled.
2. **"Start from the store's guide".** Optionally copy a `storefront.protocols`
   entry into an *editable* draft. The user confirms every number and nothing
   auto-schedules. Super Admin toggle `mobile.tracker.guide_import` (§6).
3. **"Reorder" on the low-vial card** deep-links to that product in the in-app
   Shop. It is user-initiated only. Tracker data never feeds server-side pushes,
   broadcasts or marketing (Apple 5.1.3).
4. **Account-synced.** It survives a new phone and works on both iOS and Android.
5. It uses the store's palette and fonts, like every signed-in screen.

## 4. UX

**Tabs for a granted store:** Chats · Shop · **Tracker** · Orders · Me. The tab is
guarded with `Tabs.Protected guard={access.trackerTab}` and uses the `pulse` / `pulse-outline` icon.
**Inside the tab:** a segmented Today | Calendar | Progress, the same three views as Mamamica.

### Today (tab root)
```
┌──────────────────────────────────┐
│ Today · Sun 16 Nov        🔥 12  │  streak
│ M  T  W  T  F [S] S              │  week strip: done / missed / due
├──────────────────────────────────┤
│ NEXT DOSE · in 3h 12m            │  countdown card (brand colour)
│ BPC-157  250 mcg  · 8:00 PM      │
│ Suggested site: L abdomen ●ready │
│ [        Log dose        ]       │  one tap → pre-filled sheet
├──────────────────────────────────┤
│ ✓ TB-500  2 mg      8:00 AM  R thigh
│ ○ BPC-157 250 mcg   8:00 PM      │
├──────────────────────────────────┤
│ ⚠ BPC-157 vial: 3 doses left     │
│   runs out Wed       [Reorder]   │
├──────────────────────────────────┤
│ How do you feel today? [Check in]│
│ Tracking only — not medical advice ›
└──────────────────────────────────┘
```
**Empty state:** a greyed **sample** week and countdown, with "Add your first
protocol" and two shortcuts: *From my orders* and *From the store's guide*.

### Log sheet (one tap to save)
- **Pre-filled:** dose (editable), time "now" in 5-minute steps, and the vial
  (`vialForDose` picks the open vial).
- **Body map:**
  - front/back toggle
  - zone colour comes from `siteStates`
  - `suggestSite` is pre-selected
  - any zone can be tapped; it never blocks
- **Note** field inline. **Save** gives a haptic and an undo toast.
- **Secondary:** *Skip* (opens `SkipSheet` with reason chips).

### Protocol setup
Compound (free text, a store product, or copied from a guide) → dose + unit
(mcg / mg / IU / mL) → schedule (daily / every N days / weekdays / as needed,
optional on/off cycle, 1–3 times a day, start and end dates) → reminders → review.
Several protocols can run at once. Pausing or editing keeps history intact (`withScheduleHistory`).

### Vials
Each vial gets a card with:
- compound, strength, diluent mL, reconstituted date
- expiry (default: reconstituted + 28 days, editable)
- a `VialGauge` showing remaining, doses left and run-out date
- status: unopened / in use / finished / expired

### Calendar and Progress
- **Calendar:** month grid → day list (Mamamica `CalendarView`, `DayList`).
- **Progress:** consistency heatmap, check-in trends and a weight card.

### First open
1. A 3-screen onboarding: what the tracker does → the **disclaimer**: "For
   tracking only. Not medical advice. This app never suggests doses — talk to
   your doctor." The user must tap *I understand*.
2. The notification permission ask happens here, not at app launch.
3. The disclaimer is also linked from the Today footer and from Tracker → Settings.

## 5. Architecture

### Feature flag (phase 0)
- **Catalog entry:** `src/lib/features/catalog.ts` gets
  `MOBILE_TRACKER: "mobile.tracker"`, added to `OPERATOR_GRANTABLE` and **kept out
  of every plan ceiling**. Label "App peptide tracker", group "Ecommerce". Super
  Admin → Features lists it automatically.
- **Inert without the customer app:** a grant does nothing unless
  `isCustomerAppOpen` is true (shop or community on). Show an "Inert" badge,
  like the reseller-parent case.
- **`/me` contract:** `/me` gains `tracker: { enabled: boolean }` in
  `src/lib/mobile/contract.ts`. The app derives
  `trackerTab = mode === "customer" && tracker?.enabled === true`. Older servers
  leave the field out, so the tab stays hidden.
- **Revoking** hides the tab and makes the API return 404. Data is kept, so a re-grant
  restores it. **Account deletion** hard-deletes it, via the existing
  `account/delete` flow.

### Storage: local-first, synced to the account
Same model as Mamamica:
- The **phone is the source of truth** while in use. The store is in
  AsyncStorage under the `pepworld.tracker.*` keys and is scoped per signed-in
  account (it gets wiped on sign-out or account switch).
- An **outbox syncs** it to Pepweb.
- The whole tracker works **offline** and opens instantly.

Pepweb needs **one generic table**, following Mamamica's `tracker_records`
(⚠ requires `db:push`):

```
TrackerRecord  id  tenantId  customerId
               kind      (protocol | dose | skip | vial | checkin | settings)
               localId   (client uuid; unique per tenantId+customerId+kind)
               data      Json   (validated by zod per kind)
               occurredAt  updatedAt  deletedAt?   (tombstone)
               @@unique([tenantId, customerId, kind, localId])
               @@index([tenantId, customerId, updatedAt])
```

- **Sync rules:** last write wins on `updatedAt`. Pushes are idempotent on
  `localId`, so retries never double-log. Tombstones propagate deletes. One
  table means one `db:push` and no migration later when a field is added.
- **Isolation:**
  - all reads and writes go through `forTenant()` with
    `customerId = session customer`
  - add the table to `prisma/rls.sql`
  - re-run `prisma/lockdown-public-api.sql` after the push
- **Server-side validation:** `src/lib/tracker/records.ts` holds zod schemas per
  kind (taken from Mamamica's `types.ts`) and caps both payload size and record count.

### API: `/api/mobile/v1/tracker/*`

| Route | Purpose |
|---|---|
| `POST sync` | `{ since, push: Record[] }` → `{ pulled: Record[], cursor }`. One round-trip handles push and pull |
| `GET order-vials` | Delivered order lines (product, variation, strength) not yet added as vials |
| `GET store-guides` | The store's protocols, only when the owner's guide-import switch is on |

**Wrapper:** customer bearer session, `requireFeature(MOBILE_TRACKER)` and
`isCustomerAppOpen`. Admin and staff tokens get **403**. There is no store-owner
read path for individual tracker data.

### App: `mobile/src/features/tracker/`
```
lib/          ← ported Mamamica lib/tracker/* (pure) + tests
store.ts      ← AsyncStorage store + useSyncExternalStore (ported services/tracker/store.ts)
sync.ts       ← outbox → POST /tracker/sync (replaces cloud.ts)
reminders.ts  ← expo-notifications glue, Taken/Snooze actions (ported)
components/   ← TodayView, CalendarView, ProgressView, LogSheet, BodyMap,
                SkipSheet, setup steps, VialCard/VialGauge, MedicalDisclaimer
```
- **Routes:** `(customer)/tracker.tsx` plus the `tracker/*` stack screens
  (protocol/edit, protocol/[id], log, vial, checkin, settings).
- **Reminders stay local.** There is no server push, so no health data ever
  goes into a push payload. `useNotificationRouting` gets a `tracker` target
  that opens the log sheet.
- **Tests:** the ported tests run through the existing `mobile/scripts` tsx
  runner. Add `npm run test:tracker`, and `test:tracker-api` on the web side.

## 6. Compliance and store-review risk

- **Apple 1.4.2 (dosage calculators)** is the biggest risk, and enforcement is
  inconsistent.
  - **v1 ships no calculator screen.** `dose-math` is used only for unit
    handling inside the log.
  - **The v2 converter** is a units converter on numbers the user enters. It
    never proposes a dose and is kept out of screenshots and the listing.
  - **It gets its own key,** `mobile.tracker.converter` (default OFF), so it can
    be switched off without a new build.
- **1.4.1:** "consult your doctor" appears in onboarding and Settings.
- **1.4.3:** the app also sells peptides. The tracker must never say "buy more
  to stay on protocol"; Reorder is a plain, neutral button.
- **Store-guide import** puts store-written dosing next to a store that sells
  the product.
  - It must stay an explicit copy into an editable draft, labelled "From
    <store>'s guide".
  - Super Admin feature toggle `mobile.tracker.guide_import`, nested under the
    tracker (`masterSwitchFor`). It also needs `storefront.protocols`. ON for
    vrjonina, OFF by default elsewhere.
- **5.1.3:** tracker data is never used for marketing, broadcasts, community
  features or ads. PostHog gets event *names* only, never compounds or amounts.
- **Store listings:**
  - **Google Play:** update the Health apps declaration before the build that ships the tab.
  - **App Store:** set the privacy label to "Health & Fitness, linked to user,
    not used for tracking".
  - **Privacy policy:** update it to cover tracker data.

## 7. Build order (TDD, each phase shippable)

| # | Phase | Done when |
|---|---|---|
| 0 | **Flag.** Catalog key + label + grantable, then `db:sync-features`, then **grant vrjonina**: `npx tsx --env-file=.env scripts/grant-feature.ts vrjonina mobile.tracker on`. Add `/me.tracker` | Super Admin shows the toggle. vrjonina's `/me` returns `tracker.enabled: true`; every other tenant returns false |
| 1 | **Port the pure core** and its tests into `mobile/src/features/tracker/lib` | Ported tests green; `ids`/`quick-log` tests added |
| 2 | **Server:** `TrackerRecord` + `db:push` + RLS/lockdown, zod schemas, `sync` / `order-vials` / `store-guides` routes | `test:tracker-api` covers: customer A ≠ B, admin token 403, revoked flag 404, idempotent push, tombstone round-trip, payload caps |
| 3 | **App:** store + outbox sync, tab, Today, log sheet, body map, protocol setup, skip/undo | End-to-end logging on vrjonina, offline then sync |
| 4 | **App:** vials (+ from orders, Reorder link), calendar, progress, check-in, reminders, onboarding + disclaimer, guide import | MVP complete; visual pass at 320/375/768 |
| 5 | **Release:** deploy web, bump app version from 1.0.3, Play Health declaration, App Store review notes | Live for vrjonina |
| 6 | **v2:** converter + syringe visual (own key), level curve with side-effect overlay, CSV/PDF export | — |

**Two release halves:** phases 0–2 deploy any time and stay invisible. The tab
only appears in the **new app build**, and only for granted stores.

## 8. Decisions (locked with the user, 2026-11-16)

1. **Storage:** local-first + synced to the customer's account.
2. **Converter:** v2, behind its own key `mobile.tracker.converter`. Not in the MVP.
3. **Store-guide import:** yes, as a Super Admin feature toggle
   (`mobile.tracker.guide_import`), not an owner setting.

## 9. Phase 0: what shipped

- **`src/lib/features/catalog.ts`:** `MOBILE_TRACKER` and
  `MOBILE_TRACKER_GUIDE_IMPORT`. Both are operator-grantable, outside every plan
  ceiling, with labels in group "Ecommerce".
- **`src/lib/features/plan-scope.ts`:** `masterSwitchFor("mobile.tracker.*")` →
  `mobile.tracker`, so guide import nests and warns "inert" in Super Admin → Features.
- **`src/lib/mobile/tracker-access.ts`:** `trackerAccess(has)`, the one predicate
  that needs the tracker grant + an open customer app, plus protocols for guide import.
- **`/me.tracker`:** `TrackerMe` in `contract.ts`, filled by `buildMe` in `branding.ts`.
- **`npm run test:tracker-flag`:** 12 tests.
- **DB:** `features` rows upserted for both keys. vrjonina has both granted
  (TenantFeatureOverride). It is the only one of 24 tenants that resolves
  `tracker.enabled = true`.
- **Not deployed yet.** Production `/me` only gains the field after the next
  web deploy. Entitlement cache: up to 1h, or immediately after any Super Admin save.

## 10. Build status (2026-11-17)

**Built and verified**
- Server tests: `test:tracker-flag` 12, `test:tracker-records` 74, `test:tracker-api` 28 (PGlite), and `test:isolation` still holds.
- App: `npm run test:tracker` in mobile/ runs 19 files, 135 tests. tsc and eslint are clean.

**Server**
- `TrackerRecord` table (`tracker_records`, in rls.sql and tenant-client).
- `POST /tracker/sync`: LWW, tombstones trimmed to `{id}`, cursor paging under a customer-row lock, 2 MB body cap, 25k rows per customer, 90-day tombstone purge.
- `GET /tracker/order-vials` and `GET /tracker/store-guides`.
- `withTracker` refuses the store team (403), guests (403) and a revoked flag (404).
- Caps live in `src/lib/tracker/caps.ts`, and a test keeps the app's copy (`lib/caps.ts`) matching.

**App** (`mobile/src/features/tracker/`)
- Ported MamaMicaGlow core plus `level.ts`, `merge.ts`, `target.ts`, `caps.ts`, `sync-engine.ts`.
- Local-first store with keys hashed per account, and an outbox sync.
- Local reminders: names hidden by default, with Taken and Snooze actions.

**Screens**
- Tracker tab (guests get a sign-up lock).
- Today: countdown, one-tap log with undo, week dots, low vial with Reorder, check-in nudge, empty state with a sample plus "from my orders" and "from the store's guide".
- Log sheet with body map.
- Protocol wizard and detail.
- Vials, including add from orders.
- Check-in, including "No side effects".
- Calendar: month grid, filters, day list, log late.
- Progress: estimated-level curve with side-effect pins and scrubbing, consistency rings and heatmap, trends, weight, milestones.
- Settings, onboarding with the disclaimer.

**Review**
- One independent pass: 0 critical. Both HIGH items are fixed: no units/mL anywhere (Apple 1.4.2), and reminder names are hidden on the lock screen by default.
- MEDIUM sync and storage items are fixed.

**Release checklist (phase 5)**
1. ✅ 2026-11-17: `tracker_records` created on the live DB (only that table's SQL, applied via `prisma db execute`) and `lockdown-public-api.sql` re-run. RLS is on, anon/authenticated have no grants, and the schema diff is 0. Run `rls.sql` once `app_user` exists.
2. Restart the dev server (Prisma client regenerated).
3. Deploy the web app. `/me.tracker` and the routes go live, invisible until the new app build.
4. Bump the app version and run an EAS build. The tab appears for vrjonina only.
5. Store listings: Play Health apps declaration, App Store privacy label (Health & Fitness), privacy policy update.

**Store team tracker + any name (2026-11-17)**
- The owner and each staff member now keep their OWN tracker: More → Peptide Tracker (`/tracker/home`). Rows are keyed by `subject` ("owner" | "staff:<id>" | "customer:<id>", lib/tracker/owner.ts). `customerId`/`staffId` cascade on account delete. Nobody reads anyone else's tracker, so there is still no store-side read path.
- Sync locks per account with `pg_advisory_xact_lock`, which replaces the customer-row lock. Order-vials return `[]` for the team.
- Live DB: `subject`/`staffId` added and indexes re-keyed on 2026-11-17 (the table was empty).
- Setup step 1: the name is free text. A name that isn't in the shop gets a "tracked as your own" note. Suggestions show "Your peptides" first, then the shop (the team sees the store's product list). lib/name-suggestions.ts.

**Not yet verified**
- On-device or simulator run: no visual pass at 320/375/768 yet.
- Real push → pull across two phones.

**Known gaps**
- There is a small account-switch window inside the shared API client. It isn't tracker code.
- Schedule history has no client cap (server max 200).
- Slot matching after a timezone change falls back to window matching.
