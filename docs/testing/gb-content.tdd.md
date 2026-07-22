# TDD Evidence — Owner-editable Group Buy storefront copy (gb-content)

**Date:** 2026-07-22 · **Branch:** main · **Feature request:** let the K Glow tenant (and any
Group Buy tenant) edit the "How group buys work" section and the live-round banner copy
("Pay now to lock your slot. Ships 3–4 weeks after the group buy closes. COA posted before
shipping."), built into the Group Buy feature so the UI/page/behaviour is reusable.

## Source plan

No `*.plan.md` — journeys derived during this TDD run from the user request.

## User journeys

1. As the store owner (any tenant with the Group Buy module), I edit the "How group buys
   work" title + steps so the storefront explains my own process.
2. As the store owner, I edit the live-round terms line so the banner matches my policies.
3. As a shopper, I see the custom copy on BOTH the two-ways home and the group-buy page,
   with `{eta}` replaced by the live round's delivery ETA.
4. As a tenant that never edited anything, I see exactly the previous hardcoded copy.
5. As a tampered client, I cannot save copy without a store-admin session + the groupbuy
   entitlement (server re-checks in `saveGroupBuyContentAction`).

## RED → GREEN

- **RED** (`3812eab`): `npm run test:gb-content` → `MODULE_NOT_FOUND` for
  `src/lib/storefront/gb-content` — the module under test did not exist. Compile-time RED:
  the test newly references the missing implementation.
- **GREEN** (`8330443`): after writing `src/lib/storefront/gb-content.ts`,
  `npm run test:gb-content` → **31/31 checks passed · PASS: gb-content**.
- **Wiring** (`4e309f7`): brand field + server resolution + both render surfaces + admin
  editor + gated save action.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Defaults reproduce the previous hardcoded storefront copy (regression anchor) | `scripts/test-gb-content.ts` "defaults" block | unit | PASS | `npm run test:gb-content` |
| 2 | Missing/garbage config (undefined, null, string, number, array, {}) → defaults | "normalize: missing/garbage" | unit | PASS | same |
| 3 | Per-field fallback: blank field resets to default, others keep owner text | "normalize: per-field fallback" | unit | PASS | same |
| 4 | Steps trimmed; empties + non-strings dropped | "normalize: trimming + dropping" | unit | PASS | same |
| 5 | Caps enforced: ≤6 steps, title ≤80 chars, texts ≤300 chars | "normalize: caps" | unit | PASS | same |
| 6 | `{eta}` renders the delivery ETA everywhere; empty ETA → "after the round closes" | "renderGbCopy" | unit | PASS | same |
| 7 | Default terms render into the exact K Glow banner line | "renderGbCopy" last check | unit | PASS | same |
| 8 | Inputs never mutated; exported defaults survive result mutation | "immutability" | unit | PASS | same |
| 9 | Adjacent surfaces unbroken | `test:two-ways-home` 13/13, `test:group-buy-page` 28/28, `test:gb-banner` 10/10, `test:two-ways` 18/18 | regression | PASS | npm runs |
| 10 | Whole project type-checks (only 2 pre-existing errors in prior-session data-fix scripts) | `npx tsc --noEmit` | typecheck | PASS | tsc output |
| 11 | Live integration: K Glow home serializes `brand.groupBuyContent` and renders "How group buys work" with the live "june gb" round | curl `k-glow.lvh.me:3100` | smoke | PASS | RSC payload inspection |

## Coverage and known gaps

- The repo uses self-contained `tsx` script gates (no coverage tooling); the pure module's
  behaviour is exercised exhaustively (31 checks over every export).
- **Gaps:** the admin editor modal (`StorefrontCopyModal`) and the two React render
  surfaces have no unit tests — consistent with the repo's pattern (view-models are pure
  and tested; components verified via browser smoke). The save action's auth gate reuses
  the already-shipped `requireGroupBuyAdmin` (tested at the entitlement layer).
- E2E of the editor round-trip (edit → save → storefront shows new copy) not automated;
  verified paths: defaults render live, action mirrors the shipped
  `saveGroupBuyAllowOnHandAction` exactly.

## Merge evidence

Checkpoint commits on main: `3812eab` (RED) → `8330443` (GREEN core) → `4e309f7` (wiring).
No squash planned.
