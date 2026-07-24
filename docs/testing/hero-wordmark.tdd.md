# TDD Evidence — Gold Wordmark Hero Variant (luminara)

**Date:** 2026-07-24
**Request (verbatim):** "[Image #1] can you copy this design to our tenant luminara hero page design"
**Reference:** the "luminara" gold logo — thin, wide-tracked, gold-gradient lowercase wordmark on white.
**Source plan:** none; journeys derived during this TDD run.

## User journeys

1. As a store owner, I want luminara's hero to be the brand name rendered as a large gold-gradient wordmark on a clean background, matching the logo.
2. As any tenant, I want a reusable "wordmark" hero variant selectable in Store Admin, so the look isn't a luminara-only one-off.
3. As the platform, an unknown/garbage `heroVariant` in untrusted `branding.config` must never break the hero (fail closed to the default).

## What shipped

- `src/lib/storefront/hero-style.ts` — `HERO_VARIANTS` (single source of truth), `normalizeHeroVariant` (untrusted → valid, fails closed to `centered`), `wordmarkText` (`heroLine1 || name`, trimmed), `isWordmarkVariant`.
- `src/storefront/components/Hero.tsx` — normalizes the variant; new `wordmark` render branch (no logo card / chip; paints the mark).
- `src/storefront/storefront.css` — `.hero[data-variant="wordmark"]` + `.hero__wordmark` metallic-gold gradient clipped to text; uppercase tracked sub; mobile tracking tweak.
- `src/storefront/tweaks/BrandTweaksForm.tsx` — imports/re-exports `HERO_VARIANTS` (adds `wordmark` to the Store Admin picker; drops the duplicate local list).
- `src/components/admin/BrandingEditor.tsx` — matching platform-admin preview branch.
- `src/storefront/types.ts` — `heroVariant` union widened with `"wordmark"`.
- `scripts/configure-luminara-hero.ts` — applies the variant to the `luminara` tenant (read-modify-write `branding.config`).

## Task report

**RED** — `npm run test:hero-wordmark` before implementation:
```
Error: Cannot find module '../src/lib/storefront/hero-style'
  code: 'MODULE_NOT_FOUND'
```
Compile-time RED: the new test references the not-yet-created helper module (the intended missing implementation). Committed as `e31a7a9`.

**GREEN** — after implementation, `npm run test:hero-wordmark` (30 checks):
```
All hero-wordmark checks passed
```
`npx tsc --noEmit` → `0` errors.

**Apply** — `npx tsx scripts/configure-luminara-hero.ts`:
```
Tenant: Luminara (cmrtofled0001i804tjpio6wf)
  • heroVariant: "wordmark"
  • heroLine1 (wordmark text): "luminara"
  • heroSub: "Slim, Radiant & Redefined Beauty"   (existing copy preserved)
  • heroCta1: "Shop Now"
  • heroShowLogo / heroShowChip: false
```

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Unknown/garbage/undefined/null `heroVariant` → `centered` (fail closed) | `test-hero-wordmark.ts` normalizeHeroVariant block | unit | PASS | `npm run test:hero-wordmark` |
| 2 | Every known variant incl. `wordmark` round-trips through normalize | same | unit | PASS | same |
| 3 | `HERO_VARIANTS` lists all 6 legacy + `wordmark`, no duplicates | same | unit | PASS | same |
| 4 | `wordmarkText`: `heroLine1` wins & trims; falls back to name; empty→"" | same | unit | PASS | same |
| 5 | `types.ts` hero union carries `"wordmark"` | wiring guard | static | PASS | same |
| 6 | `Hero.tsx` normalizes the variant and renders `hero__wordmark` on the wordmark branch | wiring guard | static | PASS | same |
| 7 | `storefront.css` defines the wordmark variant with a `linear-gradient` clipped to text | wiring guard | static | PASS | same |
| 8 | Whole project typechecks | `tsc --noEmit` | type | PASS | `0` errors |

## Coverage & known gaps

- Unit + wiring guards: 30/30 checks pass; `tsc` clean.
- **Visual regression:** not captured — the shared chrome-devtools browser profile was held by a concurrent session, so an automated screenshot would have disrupted it. Verify manually at `http://luminara.lvh.me:3100/`.
- **Contrast note (intentional):** the gold gradient includes light stops (`#e6c874`, `#f0d98f`) that fall below WCAG AA 3:1 on white for large text. This faithfully reproduces the supplied gold-on-white logo (which has the same property); the deeper stops carry legibility. Revisit if the brand wants a darker mark or a subtle backing.

## Merge evidence (history note)

- `e31a7a9` — RED (mine, intact).
- GREEN landed in `a3d5931 feat: per-variation stock …`: a concurrent session committed its inventory work with `git add -A` in the window between my `git add` and `git commit`, folding my 6 staged wordmark files into its commit. All wordmark code is present and correct in `HEAD` (verified: `test:hero-wordmark` green, `tsc` clean); history was left as-is to avoid rewriting the other live session's commit.
