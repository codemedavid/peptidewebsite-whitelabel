# TDD Evidence — HP Glow compact footer + bolder product-card font

**Task:** HP Glow tenant asked (via operator) for two storefront look changes from
reference screenshots:

- **Image #1** — product-card titles/prices should read heavier (Inter, bolder).
- **Image #2** — the footer should be a dark "compact" footer: logo + name +
  tagline on the left, pill quick-links on the right (Lab Reports · FAQ · Viber),
  and a centered "Made with ♥ © {year} {brand}. All rights reserved." line.

**Source plan:** none — journeys derived during this TDD run from the two images.

## Decisions (confirmed with the operator)

| Question | Answer |
|---|---|
| Match Image #1's font how? | Keep **Inter**, just heavier weights. |
| Where does the font change apply? | **Product cards only** (titles + prices). |
| Footer scope | **Reusable** `footerStyle: 'columns' \| 'compact'`, enabled per tenant. |

## User journeys

1. As a tenant on the default footer, my footer is unchanged (unset `footerStyle`
   → `columns`), even if a stray/garbage value is stored.
2. As HP Glow, I set `footerStyle: 'compact'` and get the dark footer with pill
   quick-links derived from my existing config (COA page → Lab Reports, FAQ page
   → FAQ, active contact channels → Viber), in that order.
3. As a tenant who turned the COA page off, the Lab Reports pill disappears
   (footer respects page visibility).
4. As a tenant with no active contact channel, no accent contact pill renders.
5. As HP Glow, my product-card titles and prices render bold (700 / 800) like the
   reference cards.
6. As the operator, I can flip any tenant between the two footer styles from the
   store-admin Tweaks → Footer panel.

## Task report

| Behavior | Validation command | RED → GREEN |
|---|---|---|
| `normalizeFooterStyle` fails closed to `columns` | `npm run test:footer-style` | RED: `Cannot find module footer-style` → GREEN |
| `buildFooterQuickLinks` derives COA/FAQ/contact pills, in order, respecting visibility | `npm run test:footer-style` | RED (module missing) → GREEN |
| Product-card `__name` weight ≥ 700, `__price` ≥ 800 in CSS | `npm run test:footer-style` | RED: weights absent → GREEN after CSS edit |
| Whole project still type-checks | `npx tsc --noEmit` | GREEN: `0 error TS` |

**RED evidence** (before implementation):

```
Error: Cannot find module '../src/lib/storefront/footer-style'
...
Product-card font weight (Image #1) — Inter, bolder
  FAIL  product-card__name is >= 700
  FAIL  product-card__price is >= 800
2 check(s) failed
```

**GREEN evidence** (after implementation):

```
All footer-style checks passed        (23/23)
tsc errors: 0
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Unset / garbage / null `footerStyle` → `columns` | `test-footer-style.ts` normalize block | unit | PASS |
| 2 | `"compact"` round-trips | `test-footer-style.ts` normalize block | unit | PASS |
| 3 | HP Glow shape → Lab Reports + FAQ outline pills, Viber accent pill | `test-footer-style.ts` HP Glow block | unit | PASS |
| 4 | Viber href is `viber://chat?number=<digits>`, label carries the number, opens external | `test-footer-style.ts` HP Glow block | unit | PASS |
| 5 | Pill order is coa, faq, then contact accent | `test-footer-style.ts` HP Glow block | unit | PASS |
| 6 | COA page off → no Lab Reports pill | `test-footer-style.ts` visibility block | unit | PASS |
| 7 | No / disabled contact channel → no accent pill | `test-footer-style.ts` visibility block | unit | PASS |
| 8 | Product-card name ≥ 700, price ≥ 800 in `storefront.css` | `test-footer-style.ts` CSS-guard block | regression guard | PASS |

## Files

- `src/lib/storefront/footer-style.ts` — `normalizeFooterStyle`, `buildFooterQuickLinks` (new, reuses `activeChannels`/`channelUrl`/`CHANNEL_LABELS`).
- `src/storefront/types.ts` — added `Brand.footerStyle?: "columns" | "compact"`.
- `src/storefront/components/Footer.tsx` — compact-layout branch + `QuickIcon`.
- `src/storefront/storefront.css` — `.product-card__name/__price` weights; `.site-footer--compact` dark styles.
- `src/storefront/tweaks/FooterEditor.tsx` — operator "Footer style" selector.
- `scripts/test-footer-style.ts` + `package.json` `test:footer-style`.

## Coverage & known gaps

- Pure-logic core (`footer-style.ts`) is fully covered by the gate.
- Footer JSX / CSS layout is **not** visually asserted here — verify the compact
  footer and heavier cards visually (Playwright screenshot / dev at
  `hpglow.lvh.me:3100`). Web testing rules put visual regression above brittle
  markup assertions for this surface.
- **Enablement is not wired to live data by this change.** To turn it on for HP
  Glow: store-admin → Tweaks → Footer → **Footer style: Compact**, and ensure the
  Footer **Blurb** = "Premium pep solutions" and an active **Viber** contact
  channel (`09772189091`) are set. No live-DB mutation was run.

## Merge evidence

- `test: RED gate …` (5cfc722) — failing reproducer, RED validated.
- `feat: compact dark footer + bolder card font …` (de416af) — GREEN validated.
- `chore` — operator selector + this evidence report.
