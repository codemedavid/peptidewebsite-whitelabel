# TDD Evidence — Pepweb Landing (monthly pricing redesign)

**Source plan:** inline `/ecc:plan` output (2026-07-16), from the claude.ai/design project
"Website UI improvement" → `Pepweb Landing.dc.html` (imported via the claude_design MCP / DesignSync).
**Branch:** `feat/trial-system`
**Checkpoints:** RED `5a70dd8` → GREEN `ad168d0` → style `1088331`

## User journeys

1. As a visitor, I see monthly pricing (₱799 / ₱1,499 / ₱2,999) with one-time setup fees, so
   the landing matches what the get-started wizard charges.
2. As a visitor, the Business intro offer shows "first month ₱699, FREE setup" and its CTA
   enters trial mode (`/get-started?plan=pro&trial=1`).
3. As a visitor, I can compare all three plans feature-by-feature in the `#compare` table.
4. As an operator, plan pricing (now including setup fees) stays editable on /admin/plans and
   malformed stored values sanitize safely.
5. As a visitor, the sales site presents as **Pepweb** with the new 7-question FAQ
   (incl. the `yourbusinessname.pepweb.store` domain answer).

## RED → GREEN

- **RED:** `npm run test:pepweb-landing` → **0 passed, 14 failed** (commit `5a70dd8`).
  Failures were the intended ones: old one-time prices (₱5,999/₱9,899/₱16,899), missing
  `setupFeeCents`/`setupFeeWaived`, missing `INTRO_OFFER`/`WHY_MONTHLY`/`COMPARISON`/`VALUE_PROPS`
  exports, brand still "Jonina", FAQ still 6 questions.
- **GREEN:** `npm run test:pepweb-landing` → **14 passed, 0 failed** (commit `ad168d0`).
- **Full suite:** all **31** `test:*` scripts pass (incl. `test:trial-upgrade`,
  `test:trial-expiry`, `test:plan-distribution` which consume plan pricing).
- `npx tsc --noEmit` clean; `npm run build` succeeds.

## Test specification

| # | What is guaranteed | Test | Result |
|---|--------------------|------|--------|
| 1 | Default monthly prices are ₱799/₱1,499/₱2,999 (PLAN_CARDS + PLAN_META agree) | `test:pepweb-landing` #1–2 | PASS |
| 2 | Business first month = ₱699 = `DEFAULT_TRIAL_PRICE_CENTS` (via `discountPriceCents`) | #3 | PASS |
| 3 | Default setup fees ₱499 / ₱999 (waived) / ₱1,999 | #4 | PASS |
| 4 | Operator-set setup fee round-trips; garbage falls back per-plan; 0 = "no fee" is valid | #5–6 | PASS |
| 5 | `packagesFrom` carries setup fee + first-month framing; effective checkout price = promo | #7 | PASS |
| 6 | Brand = Pepweb; hero stats include 24/7 + ₱799/mo | #8–9 | PASS |
| 7 | Intro-offer CTA keeps `?plan=pro&trial=1` (trial mode preserved) | #10 | PASS |
| 8 | WHY_MONTHLY has the 8 included items; COMPARISON has 14 boolean rows with the designed matrix | #11–12 | PASS |
| 9 | 4 value props; 7 FAQs incl. pepweb.store domain + setup-fee answers | #13–14 | PASS |

## Visual verification (Chrome DevTools MCP, dev server lvh.me:3100)

Full-page screenshots at 1440 / 768 / 375: all nine design surfaces render (nav, hero+stats,
intro-offer banner, 3 cards with featured Business, why-monthly band, comparison table with
highlighted Business column, value props, 7-item FAQ accordion, dark final CTA, footer).
The comparison table scrolls inside its own container at 375px — no page-level overflow.

## Known gaps / follow-ups

- **Live DB override:** the deployed `plan_config` PlatformSetting row still holds the old
  one-time prices, so the live landing shows ₱5,999/₱9,899/₱16,899 with "/month" framing until
  the operator opens **/admin/plans → Reset to defaults → Save** (or edits prices manually).
  Deliberately not auto-migrated — operator-owned data.
- Setup fees are display + plan-config only; they are **not** added to wizard checkout totals yet.
- The `/automation` funnel page and legal Terms intentionally keep Jonina branding.
- UI sections are covered by visual verification, not unit tests (repo convention: script tests
  for logic, screenshots for `.mk` surfaces).
