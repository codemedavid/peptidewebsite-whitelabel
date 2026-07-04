# TDD Evidence — Announcement Banner under the header

**Date:** 2026-07-04
**Feature:** Store-admin-managed announcement banner rendered under the site header, with three layouts — single / carousel / marquee ("live" sideways scroll) — each message optionally linking to a page or custom URL.

## Source plan
Journeys derived during this TDD run from the approved inline `/ecc:plan` output (availability: on-for-everyone like Hero; motion: auto-play, freeze under `prefers-reduced-motion`).

## User journeys
1. As a store owner, I turn on an announcement bar under my header and choose one of three styles (single, carousel, live scroll).
2. As a store owner, I add one or more messages, each optionally linking to a storefront page or a custom URL.
3. As a visitor, the banner shows on every device (config persisted server-side), and its motion freezes if I prefer reduced motion.
4. As the platform, untrusted stored config can never carry a `javascript:`/`data:` link or a CSS-injection color — it is sanitized before it reaches the DOM.

## Task report
- **Pure core (`src/lib/storefront/banner.ts`)** — normalizer, color/URL sanitizers, slide-link resolver.
  - RED: `npm run test:banner` → `Cannot find module '../src/lib/storefront/banner'` (test exercises the not-yet-existing module — intended RED).
  - GREEN: after implementing the module → `35 passed, 0 failed`.
  - Guarantees: strict `enabled`; mode allowlist; slide text trimmed/capped, blank rows dropped, count capped at `MAX_BANNER_SLIDES`; `javascript:`/`data:` URLs stripped; colors filtered through a conservative charset (rejects `url()`, `;`, quotes, `<>`); `autoplayMs` clamped; `speed` allowlisted; link resolution to none/external/route.
- **Server action (`saveBannerAction`)** — `requireStaffPermission("banner")` → `normalizeBanner` → read-modify-write `config.banner` → upsert/demo → `revalidateTenant`. Validated by typecheck (0 errors).
- **Permission + routing** — `banner` module added to `staff-permissions.ts`; `AdminPage` View/route/tile wired. `test:staff` → `62 passed, 0 failed` (no regression).
- **Render + editor** — `AnnouncementBanner.tsx` (3 modes, reduced-motion freeze) slotted under `<Header>` in `StorefrontApp`; `AdminBannerSettings.tsx` editor with live preview reusing the real component. Validated by typecheck.

## Test specification
| # | What is guaranteed | Test file / command | Type | Result |
|---|--------------------|---------------------|------|--------|
| 1 | Empty/malformed config → safe disabled default, never throws | `scripts/test-banner.ts` `normalizeBanner — defaults` | unit | PASS |
| 2 | `javascript:`/`data:` slide URLs are stripped | `test-banner.ts` `custom link strips a javascript: URL` | unit | PASS |
| 3 | Colors reject `url()` / declaration-breakout / quotes | `test-banner.ts` `safeCssColor` block | unit | PASS |
| 4 | Blank slides dropped, count capped, ids stable | `test-banner.ts` `normalizeBanner — slides` | unit | PASS |
| 5 | `autoplayMs` clamped, `speed`/`mode` allowlisted | `test-banner.ts` `normalizeBanner — options`/`mode` | unit | PASS |
| 6 | Slide link resolves to none/external/route correctly | `test-banner.ts` `resolveBannerSlideTarget` | unit | PASS |
| 7 | New `banner` module gates staff access; no silent holes | `npm run test:staff` | unit | PASS (62) |
| 8 | Whole program type-checks | `npx tsc --noEmit` | typecheck | PASS (0 errors) |

## Coverage / known gaps
- Pure logic (the security-critical surface) is fully unit-tested via `test:banner`.
- Per the web testing rules, the visual/interaction layers (carousel auto-rotate, marquee scroll, reduced-motion freeze, responsive at 320/768/1440) are best verified by driving the live storefront — **pending a runtime `/run` pass** (see summary). No automated visual regression added yet.

## Commit evidence
Checkpoint commits deferred (harness rule: commit only when the user asks). RED→GREEN summary preserved above.
