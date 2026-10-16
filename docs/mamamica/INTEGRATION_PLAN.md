# Mamamica Glow ← PepWorld community + shop

Status: PLAN (2026-10-07). Nothing implemented yet.

## Decisions (locked with the owner)

| Question | Decision |
|---|---|
| Backing store | New `mamamica` tenant on Pepweb (fresh catalog + community) |
| Sign-in | One login: Supabase session is exchanged for a Pepweb token pair |
| Toggle | Two operator switches per store: `mobile.community`, `mobile.shop` |
| Repo | Move `MamaMicaGlow/` into this monorepo; community/shop live in one shared kit |

## Target architecture

```
mobile/            PepWorld       ─┐
mamamica/          Mamamica Glow  ─┤ both consume
packages/                          │
  mobile-contract/  contract.ts + shop-contract.ts (types only, from src/lib/mobile)
  mobile-kit/       api client, auth adapter, community, shop, push, theme tokens,
                    configured via KitConfig
                    { appName, scheme, storagePrefix, apiBaseUrl, palette, safetyEmail }
src/                Next.js backend (/api/mobile/v1) — single source of truth
```

Mamamica keeps its Supabase for tracker data (stacks, doses, schedules, FAQ).
Community + shop data lives in Pepweb Postgres, scoped to the `mamamica` tenant.

## Phase 0 — Security (do first, live risk)

Unverified until the live Supabase SQL is dumped, but the code implies:

- `mama-mica-admin` uses the **anon key** for admin RPCs and catalog/FAQ writes
  → any app user holding the anon key may be able to verify users, read all users,
  or edit the catalog. Fix: server-only service-role client, revoke anon writes,
  `admin_*` functions check the caller.
- Admin cookie is the constant `admin_session=authenticated` → forgeable.
  Fix: signed/HMAC session (same pattern as Pepweb store admin).
- `.env` sat in git history (`0fe8675`). Anon keys are public by design; rotate anyway.
- Request bodies go straight into `.insert(body)` → add zod validation.

## Phase 1 — Clean up Mamamica (behavior-preserving, test-first)

1. **Repo hygiene**: dump the live schema into `supabase/migrations/` (peptides, faq_*,
   admin_* RPCs, nurture tables, RLS); move root `*.sql` dumps to `supabase/seed/`;
   delete `.ralphy/`, template leftovers (hello-wave, parallax-scroll-view, themed-*,
   ui/collapsible, icon-symbol, external-link, use-theme-color, constants/theme.ts,
   explore.tsx, modal.tsx, reset-project), unused components (haptic-tab, GlassCard,
   AuroraBackground, GlowStatus, HeaderCurve), unused deps (clsx, tailwind-merge,
   expo-symbols, picker, …). Fix duplicated `UIBackgroundModes`, drop `RECORD_AUDIO`,
   `expo-av` → `expo-audio`, one icon set (lucide).
2. **Tooling**: `typecheck`, `lint`, `test` scripts; test runner + CI gate.
3. **Upgrade** Expo 54 → 57 / RN 0.86 to match PepWorld (required to share the kit).
4. **Data layer**: one repository module per entity (`user_peptides` is currently
   touched raw in 8 screens); React Query; sync with a real pending queue and
   checked Supabase errors.
5. **UI structure**: `features/tracker/{calendar,progress,catalog,stack}` folders;
   shared `CATEGORY_CONFIG` (5 copies), `SoftBlob` (18 copies), `PeptideDetailModal`
   (2 copies); a `useAppTheme()` hook replacing ~130 inline `isDark ?` ternaries.
   Target: no file > 400 lines.
6. **Bug fixes** (each gets a failing test first):
   - deleted peptides / schedules resurrect on next sync (deletes never pushed)
   - `deleteSchedulesByPeptide` substring match deletes other peptides' schedules
   - biweekly schedules fire weekly
   - weight/metric history + notifications leak to the next signed-in user
   - cloud prefs overwritten by defaults after user switch
   - notification listeners never unsubscribed (duplicates history)
   - side effects in render (`_layout.tsx`), UnverifiedScreen outside the navigator,
     ghost `progress` Stack.Screen, `Date.now()` ID collisions, `as any` routes
   - dead `VerificationContext`

## Phase 2 — Backend (Pepweb)

1. Split the flag: add `FEATURES.MOBILE_SHOP = "mobile.shop"` (operator-grantable,
   default OFF). Community endpoints gate on `mobile.community`, shop endpoints on
   `mobile.shop`, customer login allowed when either is on. Migration: tenants with
   `mobile.community` today get `mobile.shop` too, so PepWorld behavior is unchanged.
2. Expose `features: { community, shop }` on public `GET /stores/:slug` and on `/me`.
   The app hides tabs from this; the server stays the enforcer (fail closed).
3. `POST /auth/exchange { supabaseAccessToken, store }`: verify the JWT against an
   allowlisted Supabase project configured on the tenant (JWKS), require a confirmed
   email, find-or-create the `StorefrontCustomer` by email, issue the normal token pair.
   Anonymous Supabase guests → shop as guest; community requires an email account.
   Rate-limited; tests for forged/expired/wrong-project tokens.
4. Create the `mamamica` tenant (preset), set the Supabase project allowlist, flip the switches.
5. Make the deep-link scheme per app (`pepwebadmin` hardcoded in `store-link.ts`).

## Phase 3 — Extract the shared kit from PepWorld

- Move contract types → `packages/mobile-contract` (types only, zero risk).
- Move api client, community, shop, push → `packages/mobile-kit`, behind `KitConfig`
  (replaces hardcoded `APP_NAME`, `pepweb.` storage keys, `pepwebadmin` scheme,
  `PEPWEB`/`CHAT` palettes, `SAFETY_EMAIL`).
- Auth becomes an adapter: PepWorld = password login; Mamamica = Supabase exchange.
- Admin-only pieces (ViewSwitch, ManageForms, MembersScreen, DropForm, broadcast,
  `preview` shop mode) stay in PepWorld, outside the kit.
- Gate: PepWorld's existing tests + a smoke run must stay green after the move.

## Phase 4 — Wire into Mamamica

- Tabs (max 5 fit the floating bar): Home · Tracker · Community · Shop · More.
  Progress moves into Home/Tracker. Community/Shop tabs use `href: null` when the
  store flag is off; tab bar driven by a route→{icon,label} map, not an if-chain.
- Kit theme from Mamamica's palette (purple `#5B4B8A`), Outfit font.
- Push: Mamamica EAS project id, `messages` + `orders` channels, `mamamicaglow://` links.
- Store compliance: UGC report/block/rules (guideline 1.2), privacy policy + terms
  updated for chat and purchases, account deletion covers Pepweb data too.

## Phase 5 — Release

EAS builds (Android internal → Play closed track; iOS TestFlight), staged rollout
with Community/Shop switches OFF, then flip them on per store.

## Risks

- Expo upgrade on a code base with no tests → do it after Phase 1 tests exist.
- Mamamica users whose Supabase email isn't confirmed can't join the community.
- Two auth systems = two account-deletion paths; both must be wired.
- Polling (3 s threads) × a second app's users → watch API load.
