# Pepweb Admin (mobile)

One shared Expo app for every Pepweb store's admins. Owners and staff sign in
with their **existing website admin email + password**, then manage orders,
stock and their store in their own store's branding. Architecture, the audit
and the design decisions: [`../docs/mobile-admin/ARCHITECTURE.md`](../docs/mobile-admin/ARCHITECTURE.md).

```
src/
  app/                 Expo Router routes (screens only)
    sign-in.tsx          Pepweb-branded sign-in
    (app)/(tabs)/        Home · Orders · Products · More
    (app)/order/[id]/    detail · status sheet · tracking sheet · proof viewer
    (app)/notifications  push opt-in / setting
    (app)/password       change password
  api/                 typed client for /api/mobile/v1 (+ token refresh)
  auth/                session state machine, Keychain storage
  theme/               tokens, tenant ThemeProvider, runtime brand fonts
  notifications/       push registration + tap → order routing
  features/            orders, products, store, session UI + hooks
  ui/                  shared components (buttons, cards, pills, fields, states)
```

API types are shared with the server: `@contract` → `../src/lib/mobile/contract.ts`
(type-only import; nothing server-side is bundled).

## 1. Backend prerequisites (the Next.js app in the repo root)

The mobile API lives at `src/app/api/mobile/v1/*` and adds **three new tables**
(`mobile_sessions`, `mobile_push_devices`, `mobile_order_alerts`). They are
additive — nothing existing reads or changes them — but they must exist before
the app can sign in:

```bash
# from the repo root, against the environment you intend to use
npm run db:push
```

Server environment (all optional):

| Variable | Purpose |
|---|---|
| `EXPO_ACCESS_TOKEN` | Only if you enable Expo's "enhanced push security". |

Deploy the web app as usual; the API is served from any platform host
(`https://app.pepweb.store/api/mobile/v1/...`).

## 2. Run the app

```bash
cd mobile
npm install
cp .env.example .env        # point EXPO_PUBLIC_API_URL at your server
npx expo start
```

- **Expo Go** runs everything **except remote push** (Android Expo Go has no
  remote push since SDK 53). Sign-in, orders, products and theming all work.
- For push, build a **development build**: `npx eas-cli@latest build --profile development`
  (or `npx expo run:ios` / `run:android` with Xcode / Android Studio installed).

Local backend: run `npm run dev` in the repo root (port 3100) and set
`EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:3100`. Sign in with a store
address such as `acme` (resolved against `NEXT_PUBLIC_ROOT_DOMAIN`).

## 3. Push notifications — one-time setup

1. `npx eas-cli@latest init` — creates the EAS project and writes
   `expo.extra.eas.projectId` into `app.json`. **Without a project id the app
   says "This build isn't set up for notifications yet" and never registers.**
2. `npx eas-cli@latest credentials` — iOS: let EAS create the APNs key.
   Android: upload an FCM V1 service-account key (Firebase project → Cloud
   Messaging). Expo's push service then delivers to both.
3. Build (`eas build --profile development` or `preview`) and install on a
   real phone (simulators can't receive remote push).

How it works end to end: a new order → `placeStorefrontOrderAction` saves it
→ an `after()` job calls `notifyNewOrder` (`src/lib/mobile/push.ts`) → one
`mobile_order_alerts` row per order (dedupe) → every phone signed in to that
store with the Orders permission gets "New order · Store — Order #… is waiting
for you." Tapping it opens the order through the authenticated API.

## 4. Device test checklist (not yet run — needs a real build)

- [ ] Owner of store A signs in; A's logo, colours and name appear; no flash of the neutral brand on relaunch.
- [ ] Sign out → sign in to store B: B's branding; none of A's orders in any list or cache.
- [ ] Staff without the Orders grant: no Orders tab, bell hidden; Products works.
- [ ] Place an order on store A's website → push arrives on A's phone within seconds; lock screen shows only the order number.
- [ ] Tap the push with the app killed → opens that order.
- [ ] Sign out on the phone → place another order → **no** push arrives.
- [ ] Confirm an order in the app → the website admin shows "confirmed" and stock dropped.
- [ ] Change the same order on the website, then act on the stale screen in the app → "This order just changed" and the latest version loads.
- [ ] Airplane mode: offline banner; status buttons disabled; nothing queued.
- [ ] Dark mode, large text (Dynamic Type / font scale 1.6×), VoiceOver / TalkBack labels on order cards and status pills.

## 5. Checks

```bash
cd mobile && npx tsc --noEmit && npx expo-doctor        # app
npm run test:mobile-core && npm run test:mobile-api     # repo root: API logic + integration (PGlite)
```
