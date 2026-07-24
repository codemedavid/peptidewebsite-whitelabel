# TDD Evidence — Configurable price font (SaaS default = body/sans)

**Task:** "Change the default price font of our SaaS; prioritize changing
Luminara's price font." Prices used to inherit the serif heading font, so they
rendered as serif numerals. They now render in a clean sans by default across
every tenant, and any tenant (Luminara first) can pin a distinct price face.

**Source plan:** none — derived during this TDD run.

## Decisions (confirmed with the operator)

| Question | Answer |
|---|---|
| What typeface should prices use? | **The body/sans font** (Inter by default). |
| How far should the change reach? | **Configurable `Brand.priceFont` → `--brand-price-font`, default = body font SaaS-wide; Luminara set explicitly.** |

## User journeys

1. As any tenant, my prices render in my body/sans font by default (no serif),
   with no action on my part.
2. As a tenant who pins `priceFont`, my prices render in that face, and the font
   is loaded (no fallback).
3. As Luminara, my prices are sans by default; the operator can pin the face
   explicitly via `scripts/set-luminara-price-font.ts`.

## Task report

| Behavior | Validation command | RED → GREEN |
|---|---|---|
| `resolvePriceFont` = priceFont ?? bodyFont ?? "Inter" | `npm run test:price-font` | RED: `Cannot find module price-font` → GREEN |
| `priceFontVar` overrides only when explicitly set | `npm run test:price-font` | RED → GREEN |
| CSS: `--brand-price-font` defaults to body font; card + detail price use it | `npm run test:price-font` | RED: token/rules absent → GREEN |
| Wiring: `store.tsx` sets the var; storefront layout loads `priceFont` | `npm run test:price-font` | RED → GREEN |
| Whole project type-checks | `npx tsc --noEmit` | GREEN: `0 error TS` |

**RED evidence:** `Error: Cannot find module '../src/lib/storefront/price-font'`.

**GREEN evidence:** `All price-font checks passed` (13/13); `tsc errors: 0`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `priceFont` set → used verbatim | `test-price-font.ts` resolve block | unit | PASS |
| 2 | `priceFont` unset/blank → body font | `test-price-font.ts` resolve block | unit | PASS |
| 3 | neither set → "Inter" fallback | `test-price-font.ts` resolve block | unit | PASS |
| 4 | `priceFontVar` = quoted family when set, else null | `test-price-font.ts` var block | unit | PASS |
| 5 | `--brand-price-font` defaults to `var(--brand-body-font)` | `test-price-font.ts` CSS block | regression guard | PASS |
| 6 | card + detail price rules use `var(--brand-price-font)` | `test-price-font.ts` CSS block | regression guard | PASS |
| 7 | runtime var wired in `store.tsx`; loader passes `priceFont` | `test-price-font.ts` wiring block | regression guard | PASS |

## Files

- `src/lib/storefront/price-font.ts` — `resolvePriceFont`, `priceFontVar` (new).
- `src/storefront/types.ts` — added `Brand.priceFont?: string`.
- `src/storefront/store.tsx` — `applyBrandStyle` sets `--brand-price-font` (remove-when-unset, like `buttonFont`).
- `src/storefront/storefront.css` — `--brand-price-font: var(--brand-body-font)` default; `.product-card__price` + `.sf-detail__price` use the token.
- `src/app/(tenant)/(storefront)/layout.tsx` — loads a pinned `priceFont`.
- `scripts/set-luminara-price-font.ts` — one-shot to pin Luminara's `priceFont`.
- `scripts/test-price-font.ts` + `package.json` `test:price-font`.

## Coverage & known gaps

- Pure resolver fully covered; CSS/wiring covered by content guards. Verify the
  rendered price face visually (dev at `luminara.lvh.me:3100`).
- **Luminara is already sans by default** via the SaaS-wide change — no live-DB
  write was run. To PIN it explicitly: `npx tsx scripts/set-luminara-price-font.ts`
  (reads Luminara's `bodyFont`, writes `priceFont` to match). Not auto-run.
- No admin picker yet for `priceFont` (font presets set heading/body/button only).
  A "Price font" picker can follow if operators need per-tenant control in the UI.

## Merge evidence

- `test: RED gate for configurable price font …` — RED validated.
- `feat: configurable price font, defaults to body/sans SaaS-wide …` — GREEN validated.
- `chore` — Luminara pin script + this evidence report.
