# HP Glow — compact footer (reference screenshot) · TDD evidence

**Date:** 2026-07-26 · **Branch:** main · **Tenant:** `hpglow`

## Source

No plan file. The spec was a reference screenshot supplied in-session: a dark
single-row footer — logo + **HP GLOW** + "Premium pep solutions" on the left,
`Lab Reports` / `FAQ` outline pills and a purple `Viber: 09772189091` pill on the
right, and a centred `Made with ♥ © 2026 HP GLOW. All rights reserved.` line.

## User journey

> As the HP Glow store owner, I want my storefront footer to look like the
> reference, so the store reads as a finished brand instead of the generic
> multi-column default.

## What actually changed

The compact footer already shipped as a reusable brand option in an earlier
change (`Brand.footerStyle: "compact"` — `src/lib/storefront/footer-style.ts`,
`.site-footer--compact` in `src/storefront/storefront.css`, the branch at
`src/storefront/components/Footer.tsx:109`; evidence in
`hpglow-footer-and-card-font.tdd.md`). **No storefront code was modified here.**
The gap was live tenant data: `hpglow` was still on `columns`.

Written to `Branding.config` for `hpglow`:

| Key | Before | After |
|---|---|---|
| `footerStyle` | *(unset → "columns")* | `"compact"` |
| `footerBlurb` | "Verified products, transparent protocols, and discreet nationwide delivery." | `"Premium pep solutions"` |
| `footerShowBlurb` | `false` | `true` |
| `footerShowBrand` | *(unset → true)* | `true` |
| `contactChannels[viber]` | `{enabled:false, destination:""}` | `{enabled:true, destination:"09772189091"}` |

Both content decisions (tagline text, enabling Viber) were confirmed by the user
in-session. Enabling Viber also surfaces it as a contact option in checkout
(`src/storefront/components/CartCheckout.tsx:120`) — flagged and accepted.

## Task report

| Step | Command | Result |
|---|---|---|
| RED | `npx tsx scripts/configure-hpglow-footer.ts --verify` | exit **1** — 4 failures: `footerStyle renders compact`, `brand blurb is shown` (got `false`), `tagline is "Premium pep solutions"` (got the old blurb), `quick-links are Lab Reports · FAQ · Viber: 09772189091` (got `["outline:Lab Reports","outline:FAQ"]`) |
| Apply | `npx tsx scripts/configure-hpglow-footer.ts --apply` | wrote the config, re-verified inline |
| GREEN | `npx tsx scripts/configure-hpglow-footer.ts --verify` | exit **0** — 12/12 ok, `(footer renders: "Made with ♥ © 2026 HP GLOW. All rights reserved.")` |
| Regression | `npm run test:footer-style` | `All footer-style checks passed` (unchanged) |
| Visual | `--preview <path>` + screenshot at 1400px | matches the reference |

Checkpoints on `main`: `8394b8d` (RED gate) → `4f30679` (apply + render assertions).
Commits `66ae26c` / `4061a23` between them are unrelated work from a concurrent
session; `8394b8d` is verified as an ancestor of `HEAD`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | hpglow's stored `footerStyle` survives `normalizeFooterStyle` as `compact` | `configure-hpglow-footer.ts --verify` | config | PASS |
| 2 | The tagline is shown and reads "Premium pep solutions" | same | config | PASS |
| 3 | Brand mark + logo render in the footer | same | config | PASS |
| 4 | Quick-links are exactly Lab Reports (`#coa`, outline) → FAQ (`#faq`, outline) → Viber (`viber://chat?number=09772189091`, accent), in that order | same | config | PASS |
| 5 | The copyright template renders "© 2026 HP GLOW. All rights reserved." | same | config | PASS |
| 6 | The **real `Footer` component**, given the stored config, emits `site-footer--compact`, all three pills, the `viber://` deep link, and the "Made with ♥ …" line | same (`renderToStaticMarkup`) | render | PASS |
| 7 | `normalizeFooterStyle` fails closed to `columns` for unset/garbage; quick-links respect page visibility and channel state | `npm run test:footer-style` | unit | PASS |

## Known gaps

- **The local dev server (pid 93930) is stale.** It has been running since
  `Fri Jul 24 14:09`, minutes *before* commit `de416af` added the compact footer
  branch. Its compiled client bundle contains no `site-footer--compact` (the CSS
  does), so `hpglow.lvh.me:3100` still paints the old columns footer even though
  the served RSC payload carries `footerStyle:"compact"`. **Restart `npm run dev`
  to see it locally.** Same class of trap as `stale-devserver-prisma-client`.
  Verification was therefore done by server-rendering the real component, which
  is independent of that server.
- The reference shows a **✨** after the wordmark. `config.name` is `"HP GLOW"`
  with no emoji, and `brand.name` is used site-wide (header, page titles, order
  messages), so it was deliberately not changed. Add it in store admin → Brand
  name if the emoji is wanted everywhere.
- The `Lab Reports` pill also depends on the `STORE_COA` entitlement at render
  (`src/app/(tenant)/(storefront)/page.tsx:133` gates `showPageCOA`). hpglow has
  it on today; revoking the entitlement would drop the pill. The gate asserts
  config, not entitlement.
- No coverage run: this repo has no aggregate coverage command; the footer
  surface is covered by the two gates above.
