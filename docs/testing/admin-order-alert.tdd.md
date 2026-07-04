# TDD Evidence — Admin "you received an order" email alert

**Feature:** On every new storefront order, email the store owner ("you received
an order") via the tenant's PostHog Messaging. Recipient is set by the owner in
the store admin; gated behind the Automated package.

**Source plan:** the `/ecc:plan` v2 output in-session (PostHog-Messaging transport,
owner-configurable recipient, feature-gated) — no `*.plan.md` file was written.

## User journeys

1. As a store owner, I want an email whenever my store receives an order, so I
   never miss one.
2. As a store owner, I want to set/change the inbox that alerts go to, so I can
   route them to my Gmail or a shared team address.
3. As the platform, the alert must only fire for Automated-package tenants that
   have PostHog connected and the alert turned on — and must never break checkout.

## What was built (RED → GREEN)

Pure cores were driven test-first with `scripts/test-admin-order-alert.ts`
(self-contained, no DB/Next/network — same style as `scripts/test-posthog.ts`).

- **RED:** `npm run test:admin-order-alert` → `FAIL — 0 passed, 11 failed`
  (`(0 , import_events.resolveAdminNotifyEmail) is not a function` — the module
  compiled and executed; the 11 tests failed for the intended reason: the new
  exports did not exist yet).
- **GREEN:** implemented `POSTHOG_EVENTS.ORDER_PLACED_ADMIN`,
  `buildAdminOrderPayload()`, `isValidEmail()`, `resolveAdminNotifyEmail()` in
  `src/lib/analytics/events.ts` → `npm run test:admin-order-alert` →
  `PASS — 11 passed, 0 failed`.

Wiring layered on top of the proven cores:
- `src/lib/analytics/admin-notify.ts` — `sendAdminOrderNotification()`, total &
  silent; gates on `FEATURES.NOTIFY_ADMIN_ORDER` + `resolveAdminNotifyEmail` +
  (inside `capturePostHogEvent`) connected PostHog.
- `src/actions/orders.ts` — fire-and-forget `after(() => sendAdminOrderNotification(...))`
  in the `if (created)` block of `placeStorefrontOrderAction` (new orders only).
- `src/lib/features/catalog.ts` — `NOTIFY_ADMIN_ORDER: "notify.admin_order"`,
  added to the Automated (enterprise) ceiling + `FEATURE_META`.
- `src/actions/storefront-admin.ts` — `saveOrderNotificationsAction` (OWNER-only),
  `src/storefront/types.ts` — `Brand.orderNotifications` + `Brand.showAdminOrderNotify`,
  `src/app/(tenant)/(storefront)/page.tsx` — entitlement projection,
  `src/storefront/visibility.ts` — `notify` view toggle,
  `src/storefront/admin/AdminPage.tsx` + `AdminOrderNotifications.tsx` — the panel.
- `emails/posthog/06-admin-order-alert.html` + README — the Messaging template
  and the per-tenant workflow setup step (config, not code).

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Recipient resolves only when enabled AND email valid; trimmed, case preserved | `test-admin-order-alert.ts:returns the trimmed email when enabled and valid` | unit | PASS | `npm run test:admin-order-alert` |
| 2 | Disabled config → no recipient (null) | `…:returns null when disabled` | unit | PASS | same |
| 3 | Missing/partial config slice → null | `…:returns null when the config slice is missing` | unit | PASS | same |
| 4 | Malformed/empty emails rejected (`a@b`, `@x.com`, `owner@`, spaces…) | `…:returns null for a malformed / empty email` | unit | PASS | same |
| 5 | Defensive against non-object/non-string config JSON | `…:is defensive against non-object / non-string shapes` | unit | PASS | same |
| 6 | Admin event name is `admin_order_placed` | `…:uses the admin event name` | unit | PASS | same |
| 7 | The ADMIN is the messaged person (distinctId + `$set` email, lowercased) | `…:targets the ADMIN as the person` | unit | PASS | same |
| 8 | The buyer is NEVER `$set` as the person | `…:NEVER identifies the buyer as the person` | unit | PASS | same |
| 9 | Order summary + buyer name ride in `properties` for the admin to read | `…:carries the order summary in properties` | unit | PASS | same |
| 10 | Tenant branding stamped when a brand is given | `…:carries brand properties when a brand is given` | unit | PASS | same |
| 11 | No brand → no brand keys leak into `properties` | `…:omits brand keys entirely when no brand is given` | unit | PASS | same |

## Full verification run

- `npm run test:admin-order-alert` → **PASS — 11 passed, 0 failed**
- `npm run test:posthog` → **PASS — 30 passed, 0 failed** (no regression to customer payloads)
- `npm run test:feature-disclosure` → **11 passed** · `test:plan-scope` → **16 passed** ·
  `test:staff` → **62 passed** · `test:plan-distribution` → **9 passed** (adding the
  feature key broke nothing)
- `npx tsc --noEmit` → **no errors** across all 11 changed/added files

## Coverage & known gaps

- The pure decision surface (gate + payload) is fully unit-covered (11 cases).
- **Not unit-tested (thin IO glue, verified by tsc + design):** `sendAdminOrderNotification`
  (entitlement/PostHog IO), the `after()` wiring, and `saveOrderNotificationsAction`.
  These mirror the already-covered `capturePostHogEvent` / `savePromoCodesAction`
  patterns.
- **Manual E2E (load-bearing, not automatable here):** in the tenant's PostHog
  project, create the `admin_order_placed → send email to person` workflow with the
  default sender; then place a test order on `slug.lvh.me:3100` and confirm the
  owner's inbox receives `06-admin-order-alert.html`. Documented in the emails README.
- **Deploy step:** the `notify.admin_order` Feature row must be seeded to the live
  DB (`scripts/sync-plan-features.ts` + `db:push`) or the entitlement reads false.

## Merge evidence (for squash)

RED: 11 failing (`resolveAdminNotifyEmail`/`buildAdminOrderPayload` undefined).
GREEN: 11 passing after implementing the pure cores in `events.ts`. No refactor
needed. No regressions across posthog/feature/plan/staff gates; clean `tsc`.
