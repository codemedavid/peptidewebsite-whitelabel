# Pepweb Admin — mobile app architecture

One shared Expo app (`mobile/`) for every tenant's store admin. It talks to a
small, versioned JSON API in the existing Next.js app (`/api/mobile/v1/*`),
which reuses the website's own business logic. It is **not** a WebView wrapper.

## 1. What exists today (audit)

| Concern | Existing implementation |
|---|---|
| Store admin UI | Hash-routed client app, `src/storefront/admin/*` (`AdminPage.tsx` view switch, `admin-nav.ts` registry) on `<slug>.pepweb.store/#admin` |
| Admin data access | Server actions only (`src/actions/*`). No JSON API existed besides MCP, Telegram webhook, ImageKit auth, onboarding upload |
| Login | `signInStoreAdminAction` (`src/actions/storefront-staff.ts`) → pure `resolveStoreAdminLogin` (`src/lib/auth/store-admin-login.ts`). Tenant comes **from the request host**, never a form field |
| Credentials | Owner: `Tenant.storeAdminEmail` + `storeAdminPasswordHash` (scrypt). Staff: `StorefrontStaff` (`@@unique([tenantId,email])`). Emails are **not globally unique** — the same address can administer several stores |
| Session | `sf_admin_session` HMAC cookie (`tenantId.subject.exp.sig`), 7-day TTL, host-scoped, **not revocable** (no version) |
| Permissions | `staff-permissions.ts` module keys; server guards `requireStaffPermission` / `requireStoreOwner` (`src/lib/auth/staff-guard.ts`). Staff re-loaded from DB each request |
| Tenant status | `getTenantIdOrNull` refuses `suspended` / `pending_setup`. Trial expiry lock is **client-side only** (`AdminPage.tsx`) |
| Entitlements | `getEntitlements` / `hasFeature` (`src/lib/features/entitlements.ts`) |
| Isolation | `forTenant()` Prisma extension + Postgres RLS via `withTenant()` (`src/lib/db/tenant-client.ts`) |
| Orders | `StorefrontOrder`. 7 statuses (`src/lib/storefront/order-status.ts`), **any→any transitions allowed**. Confirm deducts stock, cancel restocks (history replay). `paymentStatus` pending/paid is a separate flag. One engine: `applyOrderStatusChange` (`src/lib/orders/apply-status.ts`), used by the web admin and the Telegram bot |
| Order totals | Not stored — `computeOrderTotals` (`src/storefront/admin/order-detail.ts`): items − discount + shipping + adminFee + paymentFee |
| New-order side effects | `placeStorefrontOrderAction` → `if (created)` block: promo usage, PostHog `order_placed`, owner email, Telegram alert (`src/actions/orders.ts`) |
| Branding | `Branding` row (themeId, colors, fonts, logoUrl, config) → `brandPaletteFromBranding` (`src/lib/theme/resolve-css-vars.ts`); cached under tag `tenant:<id>`; no `updatedAt` |
| Push | **None** (no device tokens, no web push, no FCM) |
| Password reset | **None.** Owner password is operator-set; staff passwords are owner-set; signed-in users can change their own (`changeStorefrontAdminPasswordAction`) |
| Customers module | **Does not exist** in the store admin (customers live inside orders) |

### Findings worth your attention (pre-existing, not changed)

1. **Checkout trusts the client's `paymentStatus`.** `CartCheckout.tsx` sends `paid`
   whenever a proof image is attached and the server stores it. So "paid" in the
   DB means "customer says paid / proof attached", not "admin verified". The
   mobile app labels it that way and never writes `paymentStatus` itself.
2. **No stale-write protection** on order updates. The mobile API adds an
   optional `expectedUpdatedAt` precondition (backward compatible; web callers
   are unaffected).
3. **Trial-expired admin lock is client-side only** on the web. The mobile API
   enforces it server-side.

## 2. Integration boundary

Server actions, the host-scoped cookie and the browser admin cannot be used from
React Native. The boundary is a **bearer-token JSON API** under
`/api/mobile/v1`, which can be served from any host (middleware passes `/api/*`
through) because the tenant comes from the **server-side session row**, never
from the app.

```
Expo app ──HTTPS + Bearer──▶ /api/mobile/v1/*  (Next.js route handlers)
                                  │
                                  ├─ authenticateMobileRequest()  → session row → tenant + actor (re-checked every call)
                                  ├─ reused cores: resolveStoreAdminLogin, applyOrderStatusChange,
                                  │                computeOrderTotals, formatMoney, brandPaletteFromBranding,
                                  │                isModuleAllowed, hasFeature, normalizeStoreStatus, trial-state
                                  └─ withTenant() for every tenant data read/write (RLS + forTenant)
```

### Auth design (smallest secure, backward-compatible addition)

* **Login:** `POST /auth/login {store, email, password}`. `store` is what the
  admin types to reach their site — `hpglow`, `hpglow.pepweb.store` or a custom
  domain — normalised to a host and resolved through the existing
  `resolveTenantByHost` (slug **or** `Domain` table). It then runs the **same**
  `resolveStoreAdminLogin` and the same rules as the web: generic error, staff
  require `STORE_STAFF_ACCOUNTS`, suspended staff message, rate limit, and
  `AuthAudit` rows.
* **Session:** new `MobileSession` row. Opaque random tokens; only SHA-256 hashes
  are stored. Access token 15 min, refresh token 30 days, **rotated on every
  refresh**. Presenting an already-rotated refresh token revokes the session
  (replay detection).
* **Revocation:** logout revokes the row. A `credentialStamp` (hash of the
  password hash at login) is re-checked on every request, so an operator
  resetting the owner password — or a staffer changing theirs — signs out every
  phone. Staff suspension or deletion takes effect on the next call.
* **Every request** re-derives the tenant from the session and re-checks tenant
  status (suspended / pending_setup / trial expired), the actor, and the module
  permission. The app never sends a tenant id.
* **Password reset:** none exists, so none is invented. The app routes owners to
  Pepweb support and staff to their store owner, and offers the existing
  "change password" when signed in.
* **Multiple stores:** accounts are per store, so "Switch store" is a clean
  sign-out followed by sign-in. The app remembers recent store addresses (not
  secrets).

### Push notifications

* Expo Push Service (no extra server SDK — plain `fetch`), registered through
  `expo-notifications` in a development or production build.
* `MobilePushDevice` is keyed by a **unique Expo push token** and bound to one
  `MobileSession`. Registering the same token under a new session **moves** it,
  so one phone can never receive two tenants' alerts. Logout, and session
  revocation, delete it.
* Trigger: an `after()` job inside the existing `if (created)` block of
  `placeStorefrontOrderAction`. It runs only for a newly persisted row, never an
  idempotent retry.
* Dedupe: `MobileOrderAlert @@unique([orderId])` is claimed before sending, so
  reprocessing the same order never double-notifies.
* Recipients are re-authorised at send time: live session, active actor with
  the `orders` permission, active tenant.
* `DeviceNotRegistered` tickets delete the device. Transient errors retry once.
* The payload carries only `{type, orderId}`. The copy is privacy-safe ("New
  order #ABC-1001 · Tap to review"): no customer or product names on the lock
  screen. Tapping opens the order **through the authenticated API** — the
  payload is not authorisation.

## 3. Mobile information architecture

```
Tabs:  Home  |  Orders  |  Products  |  More
Header (all tabs): tenant logo + name · notifications bell (→ Orders "New")
```

| Existing admin feature | Existing implementation | Mobile experience |
|---|---|---|
| Dashboard | `AdminDashboard` + `admin-dashboard.ts` builders | **Home**: "Needs you now" queue (new orders, to pack), today's orders/revenue (only if entitled to analytics), low-stock list, store open/closed switch |
| Orders list | `AdminOrders` (client filter, loads all) | **Orders**: segmented filters (New · To fulfil · Shipped · All), server-side search + cursor pagination, pull-to-refresh, status + payment chips with icon + text |
| Order detail | `AdminOrderDetail` | Summary header → **one primary next action** (sticky) → items → money breakdown → payment + proof viewer → customer/contact (tap to call/text/copy) → shipping/booking text copy → notes → timeline |
| Status change | `updateStorefrontOrderAction` → `applyOrderStatusChange` | Same engine. Next-step button + "Change status" sheet with all 7 statuses. Confirmation for stock-moving (confirm/cancel) changes. 409 conflict → reload prompt |
| Tracking / courier / note | same action (`saveTracking`) | "Add tracking" sheet |
| Trash / restore | trash/restore actions | "Move to trash" (confirm) on detail |
| Inventory quick edit | `AdminInventory` → `saveProductAction` | **Products**: search, stock badges, quick "In stock / Hidden" toggle and stock stepper |
| Store open/closed | `saveStoreStatusAction` | Switch on Home (with confirm) |
| Account password | `changeStorefrontAdminPasswordAction` | More → Account |
| Everything else (hero, banner, promo, COA, FAQ, group buys, staff, design…) | web admin | More → "Open on website" (system browser, external) — listed only if the user holds the permission |

## 4. Tenant theming

`GET /branding` (also embedded in `/me`) returns a **mobile theme** built from
`brandPaletteFromBranding` + `branding.config`: brand primary (button colour),
on-primary text (contrast-corrected to ≥ 4.5:1), accent, header colours, logo,
name, and heading/body fonts with TTF URLs. It carries a content-hash `version`.
The app:

* renders the neutral **Pepweb** theme before login;
* holds a splash screen until the session **and** that tenant's cached theme are
  both loaded, so there is no flash of another tenant;
* caches the theme per `tenantId`, re-validates on foreground, and swaps when
  the `version` changes;
* keeps **status colours app-owned** (success, warning, danger, info) so "paid",
  "cancelled" and so on mean the same in every tenant; tenant colour is used
  only for brand surfaces (CTAs, active tab, header, links);
* on logout, clears the React Query cache, the tenant theme and the push
  association.

Native icon and splash are **app-level Pepweb assets**: iOS and Android cannot
change them per tenant at runtime. Tenant identity is applied in-app after login.
