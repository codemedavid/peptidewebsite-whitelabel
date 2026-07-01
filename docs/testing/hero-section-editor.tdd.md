# TDD Evidence — Hero Section Editor

**Feature:** Redesigned store-admin Hero Section editor (two-column + sticky live
preview, dirty/Saved states) **and** functional CTA link pickers (page-on-site /
custom URL) wired into the live storefront hero.

**Source plan:** Derived during this run from the approved `/ecc:plan` output for
"Implement: Hero Section Editor.dc.html" (both layers; CTA page list = real
storefront pages). No `*.plan.md` file was written.

## User journeys

1. As a store owner, when I point a hero CTA at a **custom URL**, only http(s)
   links are honored — `javascript:`/`data:`/garbage are rejected (security).
2. As a store owner, when I pick **"a page on my site"**, the button links to a
   known page; unknown/blank values fall back sensibly (primary → catalog,
   secondary → reviews).
3. As a customer, clicking a hero CTA navigates to exactly the configured target
   (custom URL in a new tab, catalog scroll, or a hash route).

## Design decision

The CTA link logic (sanitizing before persistence + resolving stored config into
a navigation target) was **extracted into a pure module** `src/lib/storefront/hero-links.ts`
so it is unit-testable without the DB/Next/browser runtime, and so the store-admin
save action and the live storefront share one source of truth (removing a
duplicated `safeHttpUrl`). This is the seam the RED/GREEN cycle proves.

## Task report

| Task | Summary | Validation command | Result |
|---|---|---|---|
| Extract + test hero-link core | Wrote reproducer against a not-yet-existent module, then implemented it | `npm run test:hero-links` | RED → GREEN (25/25) |
| Wire callers through the core | Save action + storefront nav import the shared module | `npm run test:hero-links` + `npx tsc --noEmit` | GREEN, 0 type errors |

**RED evidence** (commit `995c7bc`): `npm run test:hero-links` →
`Error: Cannot find module '../src/lib/storefront/hero-links'` (`MODULE_NOT_FOUND`),
non-zero exit. The test compiled and executed; the failure is the intended
missing-implementation signal.

**GREEN evidence** (commit `45450c9`): `npm run test:hero-links` → `25 passed, 0 failed`, exit 0.

**Refactor evidence** (commit `acb61d1`): callers routed through the shared core;
`npm run test:hero-links` still `25 passed, 0 failed`; `npx tsc --noEmit` → 0 errors.

## Test specification

| # | What is guaranteed | Test file / case | Type | Result |
|---|---|---|---|---|
| 1 | `safeHttpUrl` keeps http(s) URLs, trims whitespace | `scripts/test-hero-links.ts` (safeHttpUrl) | unit | PASS |
| 2 | `safeHttpUrl` rejects `javascript:`, `data:`, `ftp:`, non-URL garbage, empty/undefined | `scripts/test-hero-links.ts` | unit | PASS |
| 3 | `safeHttpUrl` never returns a value longer than 500 chars | `scripts/test-hero-links.ts` | unit | PASS |
| 4 | `normalizeHeroLinks` yields safe defaults for empty input (cta1→catalog, cta2→reviews, type page) | `scripts/test-hero-links.ts` | unit | PASS |
| 5 | Unknown page route falls back to the per-button default | `scripts/test-hero-links.ts` | unit | PASS |
| 6 | Known page route is preserved | `scripts/test-hero-links.ts` | unit | PASS |
| 7 | Custom type keeps a valid URL but strips a `javascript:` URL | `scripts/test-hero-links.ts` | unit | PASS |
| 8 | Page type drops any provided custom URL; unknown type coerces to `page` | `scripts/test-hero-links.ts` | unit | PASS |
| 9 | Malformed input (null/undefined/number) does not throw | `scripts/test-hero-links.ts` | unit | PASS |
| 10 | `resolveHeroCtaLink` maps custom/page/home/catalog/route + safe-URL gating; legacy defaults preserved | `scripts/test-hero-links.ts` (resolveHeroCtaLink) | unit | PASS |
| 11 | `HERO_LINK_PAGES` contains home, catalog and every toggle-able sub-page | `scripts/test-hero-links.ts` | unit | PASS |

## Coverage and known gaps

- This repo has **no coverage instrumentation** (tests are standalone `tsx`
  assertion scripts, e.g. `test:isolation`, `test:staff`). Coverage is reported as
  guarantee coverage: the pure CTA link core — the security- and behavior-critical
  logic — is fully exercised (25 assertions).
- **Untested (intentional):** the React presentation in `AdminHeroSettings.tsx`
  (form layout, dirty pill, "Saved" flash, live preview) and the browser-side
  handlers in `StorefrontApp.tsx` (`window.open` / hash navigation). These are
  visual/DOM concerns better covered by visual-regression/E2E than brittle markup
  assertions; the navigation *decision* they act on is covered via
  `resolveHeroCtaLink` (#10). `AdminHeroSettings.toPayload` mirrors the same field
  set the server re-normalizes, so the server core remains the security boundary.

## Merge evidence (for squash)

RED `995c7bc` (module missing) → GREEN `45450c9` (25/25) → refactor `acb61d1`
(callers share the core, 25/25 + tsc clean). `npm run test:hero-links` is the
regression guard.
