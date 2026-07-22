# TDD Evidence — Per-tenant storefront border customization

**Date:** 2026-07-23 · **Branch:** main · **Request:** "make the branding the border to be changeable of colors and the width and change the border color of tenant hp glow to black"

## Source plan

No `*.plan.md` — journeys derived during this TDD run from the user request.

## User journeys

1. As a store owner, I can set a custom storefront border **color** and **width** in branding so hairlines/panels/card frames match my brand.
2. As an existing tenant who never touches the setting, my storefront keeps the theme's default border at 1px (no regression).
3. As the operator, tenant **hpglow**'s storefront border renders **black**.

## Task report

| Task | Summary | Validation | Result |
|---|---|---|---|
| RED | `scripts/test-brand-border.ts` written first, importing not-yet-existing `src/lib/storefront/brand-border` | `npx tsx scripts/test-brand-border.ts` → `MODULE_NOT_FOUND` (intended missing implementation) | RED ✅ commit `0c25e35` |
| GREEN | Pure module `src/lib/storefront/brand-border.ts` (fail-closed hex/width normalizer, CSS-var resolver, width presets) | `npm run test:brand-border` → **32/32 ok**, exit 0 | GREEN ✅ commit `a32a71e` |
| Wiring | `Brand.borderColor/borderWidth` (types.ts), `applyBrandStyle` sets/removes `--brand-border`/`--brand-border-width` (store.tsx), `--brand-border-width: 1px` default + 130× `1px solid var(--brand-border)` → `var(--brand-border-width) solid …` (storefront.css), Border controls in BrandTweaksForm + platform BrandingEditor | `npx tsc --noEmit` — no errors in touched files (3 pre-existing Prisma-Json errors in untouched one-off scripts remain) | ✅ |
| Neighbor sanity | Adjacent pattern still green | `npm run test:logo-curve` → 15 passed, 0 failed | ✅ |
| hpglow | `scripts/set-hpglow-border-black.ts` one-shot against live DB | `BEFORE borderColor=undefined → AFTER borderColor="#000000"` | ✅ |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Unset config → no overrides/vars; theme default (1px) preserved for existing tenants | `test-brand-border.ts` "unset config → {}", "unset → no vars" | unit | PASS |
| 2 | Valid `#RGB`/`#RRGGBB` (incl. `#000000`) round-trips to `--brand-border` | "black #000000 kept", "color var emitted" | unit | PASS |
| 3 | Non-hex / CSS-injection strings, numbers, objects are dropped (fail closed — values land in inline styles) | 8 "invalid color dropped" cases, "junk → no vars" | unit | PASS |
| 4 | Width strictly numeric, rounded, clamped to [1, 6]; 0/negative/NaN/string → unset | 6 width cases | unit | PASS |
| 5 | Color-only override leaves the 1px width default intact (the hpglow case) | "color-only → no width var" | unit | PASS |
| 6 | Width preset labels round-trip; unknown values read as default | preset round-trip block | unit | PASS |

## Coverage and known gaps

- Project convention is `tsx` script gates (no jest/coverage harness); the pure core is fully covered by the 32 checks above.
- `applyBrandStyle` DOM set/remove and the two editor controls are verified by `tsc` + the pure-core contract, not DOM tests — consistent with how `headerBg`/`logoCurve` shipped. Visual spot-check on hpglow recommended after deploy.
- Dashed/1.5px/2px accent borders intentionally keep fixed widths (documented in storefront.css).

## Merge evidence

RED `0c25e35` → GREEN `a32a71e` on main; this report preserves the RED/GREEN proof if history is later squashed.
