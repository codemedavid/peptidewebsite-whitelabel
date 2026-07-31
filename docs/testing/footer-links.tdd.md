# TDD evidence — footer link hygiene (Legal column + linkless socials)

**Branch**: `feat/gb-pricing-tab`
**Source plan**: none on disk — the plan was produced inline via `/ecc:plan` in the
same session and approved with "proceed". Its two open decisions were resolved as
the recommended defaults, recorded here so the choice is auditable:

- **Legal column scope**: the *narrow* rule (only the `Legal` column is subject
  to the dead-link sweep), not the blunt one (strip every `#` link from every
  column). The blunt variant would also have removed `Featured`, `New Arrivals`,
  `Bestsellers`, `Shipping`, `Contact` and `Blog` from the stock footer — beyond
  what was asked.
- **Platform registry**: the seven glyphs `SocialIcon` already draws. No YouTube
  row, because there is no YouTube glyph to render it with.

## User journeys

1. As a store owner, I don't want a `LEGAL → Privacy / Terms / Disclaimer` column
   on my site, because I never had those pages — the links go nowhere.
2. As a store owner, I want a social icon to appear only when I actually have
   that account, so my footer never shows an icon that leads nowhere.
3. As the super admin, I want one link field per social platform in each tenant's
   branding configuration, where leaving it empty *is* "off" — no separate switch
   to remember.
4. As a tenant that *does* have policy pages, I want to add a Legal column with
   real URLs and keep it.

## Task report

### Task 1 — the shared rule (`src/lib/storefront/footer-links.ts`)

`isDeadHref`, `normalizeSocialHref`, `SOCIAL_PLATFORMS`, `buildFooterSocials` and
`buildFooterColumns` are the single place that decides what a footer link has to
be to render. Reads untrusted `branding.config`, so it fails closed.

- **Validation**: `npm run test:footer-links`
- **RED** (before the module existed):
  ```
  Error: Cannot find module '../src/lib/storefront/footer-links'
  Require stack:
  - /Users/…/scripts/test-footer-links.ts
  ```
  The reproducer imports the module under test directly, so this resolution
  failure is the intended RED signal (compile-time RED).
- **GREEN**: `63 ok, 0 failed` → `All footer-links checks passed`
- **Guaranteed**: a social href that isn't http(s) after normalization resolves
  to `""` and renders nothing — which also closes the `javascript:` / `data:`
  hole the previous `<a href={s.href}>` had, since `branding.config` is
  operator-editable.

### Task 2 — defaults (`src/storefront/data.ts`)

`BRAND.footerColumns` loses the `Legal` block outright; `BRAND.footerSocials`
ships Facebook + Instagram with **empty** hrefs (Twitter row dropped), so a
brand-new store renders zero social icons instead of three pointing at `#`.

- **Validation**: `npm run test:footer-links` — the "Shipped defaults" block
  asserts against the real exported `BRAND`, not a fixture.
- **GREEN**: `no Legal column in the defaults`, `default socials carry no
  placeholder href`, `a brand-new store renders zero social icons` all ok.

### Task 3 — render (`src/storefront/components/Footer.tsx`)

The inline column chain and the `show !== false` social filter are replaced by
`buildFooterColumns` / `buildFooterSocials`. Social anchors gained
`target="_blank" rel="noopener noreferrer"`.

- **Validation**: `npm run test:footer-links` wiring guards read the source file.
- **GREEN**: `Footer renders socials from buildFooterSocials`, `Footer renders
  columns from buildFooterColumns`, `social anchor carries target="_blank" +
  rel="noopener noreferrer"`.

### Task 4 — branding configuration (`src/storefront/tweaks/FooterEditor.tsx`)

The Socials section became one URL field per platform (Facebook, Instagram,
TikTok, Viber, WhatsApp, Telegram, Twitter/X) with a live On/Off chip, inline
validation, and a `show on site` checkbox that only appears once a link exists.
Non-registry rows remain editable under "Other links" so no saved config is lost.
The component is shared, so this lands in **both** the super-admin
`BrandingEditor` (Storefront tab) and the store-admin Tweaks panel.

- **Validation**: `npm run test:footer-links` wiring guards + `tsc --noEmit`.
- **GREEN**: `editor drives its rows off SOCIAL_PLATFORMS`, `editor validates
  hrefs with normalizeSocialHref`; `tsc --noEmit` exits 0 with no output.

### Task 5 — live impact audit (`scripts/inspect-footer-config.ts`, read-only)

Removing the column from `BRAND` alone would not have reached tenants who had
already opened the Storefront tab — their placeholder column and socials are
saved in `branding.config`. The audit proves the render-time rule covers them.

- **Validation**: `npx tsx scripts/inspect-footer-config.ts`
- **Output**: `12 tenant(s) had a saved Legal column; 12 tenant(s) lose at least
  one linkless social icon.`
  - Every one of those 12 now renders columns without `Legal`
    (e.g. `peppertones → Shop, Support, Resources`) and zero social icons.
  - `pepsys-compound`, which has real URLs, keeps all three (TikTok, Telegram,
    WhatsApp) — the rule hides placeholders, not configured links.
- **Checked, not a regression**: `dragon-peptides`, `pepstack-davao`,
  `beautystack`, `k-glow`, `luminara`, `hpglow` render no columns at all — each
  has `footerShowColumns: false` in its own saved config (hpglow additionally
  uses `footerStyle: compact`). Pre-existing owner choice.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Placeholder hrefs (`""`, `"#"`, `"#!"`, `"/"`, bare `https://`, non-strings) are dead; real hash routes (`#catalog`, `#faq`), mailto and relative paths are not | `scripts/test-footer-links.ts` → "isDeadHref" | unit | PASS | `npm run test:footer-links` |
| 2 | A scheme-less paste (`instagram.com/x`, `www.facebook.com/x`) becomes an https URL; whitespace is trimmed | same → "normalizeSocialHref" | unit | PASS | `npm run test:footer-links` |
| 3 | `javascript:` (any case, with padding), `data:`, `mailto:` and bare handles never reach an href | same → "normalizeSocialHref" | unit (security) | PASS | `npm run test:footer-links` |
| 4 | A social with no usable link renders no icon; the stock all-`#` set renders none | same → "buildFooterSocials" | unit | PASS | `npm run test:footer-links` |
| 5 | `show: false` still hides a linked social, but can never surface a linkless one | same → "buildFooterSocials" | unit | PASS | `npm run test:footer-links` |
| 6 | An unknown icon falls back to the generic glyph rather than rendering nothing | same → "buildFooterSocials" | unit | PASS | `npm run test:footer-links` |
| 7 | An all-dead `Legal` column is dropped (case/whitespace-insensitive title match) | same → "buildFooterColumns" | unit | PASS | `npm run test:footer-links` |
| 8 | A `Legal` column with even one real URL is kept | same → "buildFooterColumns" | unit | PASS | `npm run test:footer-links` |
| 9 | Dead links in non-legal columns are preserved (narrow rule) | same → "buildFooterColumns" | unit | PASS | `npm run test:footer-links` |
| 10 | Pre-existing behaviour survives the extraction: `footerShowLegal: false` drops even a real Legal column; `footerShowColumns: false` drops all; hidden-page links stripped and emptied columns dropped; the Wholesale column is appended once for entitled tenants and never duplicated | same → "buildFooterColumns" | unit (regression) | PASS | `npm run test:footer-links` |
| 11 | The shipped `BRAND` defaults contain no Legal column, no Privacy/Terms/Disclaimer link, and no placeholder social href | same → "Shipped defaults" | unit | PASS | `npm run test:footer-links` |
| 12 | Footer renders from the shared helpers and opens socials with `target="_blank" rel="noopener noreferrer"`; the editor is wired to the registry and validates hrefs | same → "Wiring guards" | source guard | PASS | `npm run test:footer-links` |
| 13 | Compact-footer style, two-ways home, contact channels and the reseller gate are unaffected | `test:footer-style`, `test:two-ways-home`, `test:contact-channels`, `test:reseller-gate` | regression | PASS | 19 / 12 / 14 passed, 0 failed |
| 14 | Whole project still typechecks | `npx tsc --noEmit --pretty false` | typecheck | PASS | exit 0, 0 lines of output |
| 15 | 12 live tenants stop rendering the placeholder Legal column and their linkless icons; a tenant with real URLs keeps all three | `npx tsx scripts/inspect-footer-config.ts` | live audit (read-only) | PASS | see Task 5 output |

## Coverage and known gaps

This repo has no coverage instrumentation — verification is a suite of ~100
`scripts/test-*.ts` gates run via `npm run test:*`, and `test:footer-links` is
the gate for this change. The 80% line-coverage target in the global rules has no
tooling to measure here, so it is not asserted; the module under test is covered
exhaustively at the behaviour level (63 checks over every exported function,
including the failure and hostile-input paths).

Known gaps, deliberately left:

- **No DB backfill.** The placeholder column and socials stay in
  `branding.config`; the render-time rule hides them. Consequence: an operator
  who opens the branding editor still sees the legacy rows (the Legal column
  under "Link columns", the placeholder socials as empty platform fields) and can
  delete or fill them. This is reversible by design — deleting the render rule
  would bring the old footer back — and it means a tenant who genuinely wants
  policy links only has to paste URLs.
- **No visual regression screenshots.** Verified by asserting on the rendered
  HTML of live tenants (`site-footer` present, zero `site-footer__social`
  anchors, no `Privacy`/`Terms`/`Disclaimer` text) plus the config audit, not by
  screenshot diff at the 320/768/1024/1440 breakpoints.
- **Editor interaction is covered by source guards, not a DOM test.** There is no
  React test runner wired up in this repo, so the per-platform rows are asserted
  structurally (registry + validator are imported and used) and by typecheck.

## Merge evidence

- RED — `8cdb2ab test: add reproducer for dead footer links (legal column + linkless socials)`
  → `npm run test:footer-links` failed with `Cannot find module
  '../src/lib/storefront/footer-links'`.
- GREEN — `344e6b7 fix: retire the placeholder Legal column and hide linkless socials`
  → `npm run test:footer-links` 63 ok / 0 failed; `tsc --noEmit` exit 0;
  `test:footer-style`, `test:two-ways-home` (19), `test:contact-channels` (12),
  `test:reseller-gate` (14) all pass.
- Refactor — no separate commit. The extraction into
  `lib/storefront/footer-links.ts` *was* the refactor and shipped inside the
  GREEN commit, which is why `Footer.tsx` got shorter rather than longer.
