# TDD Evidence — Logo Curve branding control

**Date:** 2026-07-23
**Source plan:** none — journey derived during this TDD run from the request
"can you allow in the edit branding to edit the curveness of the logo".

## User journey

> As a store owner, I want to adjust the curviness (corner rounding) of my logo
> in the Edit Branding panel, so my logo can appear square, soft-cornered, or
> fully circular wherever it renders (header, hero logo card, footer).

## Implementation

| Piece | File |
|---|---|
| Pure core (`logoCurveCss`, `LOGO_CURVE_PRESETS`, `logoCurveLabel`) | `src/lib/storefront/logo-curve.ts` |
| Brand field `logoCurve?: number` (percent 0–50, persists wholesale in `branding.config`) | `src/storefront/types.ts` |
| "Logo curve" select (Identity section, both storefront tweaks panel and platform Branding editor) | `src/storefront/tweaks/BrandTweaksForm.tsx` |
| Render: header logo img | `src/storefront/components/Header.tsx` |
| Render: hero logo card + img | `src/storefront/components/Hero.tsx` |
| Render: footer logo img | `src/storefront/components/Footer.tsx` |

Presets: Square (unset — pruned key, pre-feature look), Soft (12%), Rounded
(25%), Circle (50%). Percent radii keep the look consistent across the 44px
header img and up-to-260px hero card.

## RED → GREEN

- **RED** — `npm run test:logo-curve` before implementation:
  `Error: Cannot find module '../src/lib/storefront/logo-curve'` (MODULE_NOT_FOUND) —
  the intended missing-implementation failure.
  Checkpoint: `fa739ef` `test: add reproducer for logo curve branding control (RED — module missing)`
- **GREEN** — same command after implementation: `15 passed, 0 failed`.
  Checkpoint: `502e7cb` `feat: logo curve branding control — Square/Soft/Rounded/Circle presets`
- **Refactor** — none needed; implementation mirrors the existing
  `HERO_LOGO_SIZES` preset pattern verbatim.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Unset curve → `undefined`, stylesheet defaults apply (existing tenants unchanged) | `test-logo-curve.ts` "unset (undefined)" | unit | PASS |
| 2 | 0 behaves as Square (no emitted style) | "0 (Square)" | unit | PASS |
| 3 | Valid values map to `%` radii (12 → `12%`, 50 → `50%`, fractional kept) | 3 checks | unit | PASS |
| 4 | Values above 50 clamp to `50%` | "values above 50 clamp" | unit | PASS |
| 5 | Negative / NaN / non-number garbage from stored config → `undefined` (boundary validation) | 3 checks | unit | PASS |
| 6 | Square preset stores `undefined` (pruned from branding.config); Circle stores 50; all presets round-trip through `logoCurveCss` | 3 checks | unit | PASS |
| 7 | Label lookup: unset → "Square", 50 → "Circle", unknown stored value falls back to "Square" without crashing | 3 checks | unit | PASS |

Evidence command: `npm run test:logo-curve` → `15 passed, 0 failed`.

Type-check: `npx tsc --noEmit` — zero errors in any touched file (the only
errors are pre-existing, in unrelated one-off scripts
`scripts/fix-pepstack-reseller.ts` and `scripts/rebrand-fit-n-glow-peptibesties.ts`).

## Coverage and known gaps

- The pure core is fully covered (every branch of `logoCurveCss` /
  `logoCurveLabel` and the preset table).
- UI wiring (select in `BrandTweaksForm`, inline styles in
  Header/Hero/Footer) is exercised by type-check only — consistent with how
  every other Brand tweak (e.g. `heroLogoSize`) is verified in this repo;
  visual confirmation happens in the live tweaks panel preview.
- `StorePaused` / `AccessCodeGate` logos intentionally not curved — they are
  utility screens, not brand surfaces; extend later if wanted.
