# TDD Evidence — Storefront FAQ DB Persistence

**Bug:** "the faq still cant be saved" — FAQ edits in the store admin vanished on
any other device/browser; customers kept seeing the seed FAQ.

**Root cause:** `AdminFAQManager` → `setFaqGroups` was still the legacy
`makeSetter` path (`src/storefront/store.tsx`), which wrote **localStorage
only**. No `saveFaqAction` existed and the storefront never seeded FAQ from
`branding.config`. FAQ was the last collection left behind by the
storefront-config DB-persistence migration (payment methods, couriers,
categories, shipping locations, promo codes, protocols were already moved).

**Source plan:** inline `/ecc:plan` output in-session (no `.plan.md` artifact);
plan confirmed via `/ecc:tdd-workflow`.

## User journeys

1. As a store owner, I edit FAQ groups/questions in the store admin so that
   every customer on every device sees my FAQ (not the seed samples).
2. As a store owner signed out mid-session, a failed save must surface a toast
   instead of silently looking saved.
3. As a platform, untrusted FAQ payloads must be sanitized before landing in
   `branding.config` (no garbage, capped sizes, whitelisted icons).

## RED → GREEN

| Stage | Commit | Command | Result |
|---|---|---|---|
| RED | `1c85a22` test: add reproducer for FAQ DB persistence | `npm run test:faq` | FAIL — `MODULE_NOT_FOUND: ../src/lib/storefront/faq` (the pure core did not exist; compile-time RED for missing implementation) |
| GREEN | `e034243` fix: persist storefront FAQ to the DB | `npm run test:faq` | PASS — `13 passed, 0 failed` |
| GREEN (gates) | `e034243` | `npm run typecheck` / `npm run build` | PASS — tsc clean; production build succeeded |

`npm run lint` was skipped: `next lint` in this repo drops into the interactive
ESLint setup wizard (no ESLint config exists) — pre-existing condition, not
introduced by this change.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Non-array FAQ input collapses to `[]`, never throws | `scripts/test-faq.ts` — "non-array input collapses to []" | unit | PASS |
| 2 | Garbage group entries (null/number/string) are dropped | "garbage entries inside the array are dropped" | unit | PASS |
| 3 | A valid group round-trips verbatim (save → load stable) | "a valid group is preserved verbatim" / "normalize is idempotent" | unit | PASS |
| 4 | Labels trimmed + capped (120); non-strings coerced | "label is coerced to a trimmed, length-capped string" | unit | PASS |
| 5 | Missing/blank ids get deterministic `g{index}` fallback | "missing/blank id falls back…" | unit | PASS |
| 6 | Icons whitelisted (`shipping/payment/product/default`); unknown → `default` | "unknown icon falls back to 'default'" | unit | PASS |
| 7 | Non-array `items` → `[]`; garbage rows dropped; q/a coerced+trimmed | "non-array items…" / "garbage item entries…" | unit | PASS |
| 8 | Blank Q/A rows SURVIVE (mid-edit rows persist across reload) | "BLANK rows are preserved" | unit | PASS |
| 9 | Question capped at 300 chars, answer at 4000 | "over-long question/answer are length-capped" | unit | PASS |
| 10 | ≤ 20 groups, ≤ 40 items per group persisted | "group count is capped" / "per-group item count is capped" | unit | PASS |
| 11 | Whole app still typechecks and builds with the new wiring | `npm run typecheck`, `npm run build` | integration (compile) | PASS |

## What changed (GREEN commit)

- `src/lib/storefront/faq.ts` — pure core: `normalizeFaqGroups`, `FAQ_ICONS`, caps.
- `src/actions/storefront-admin.ts` — `saveFaqAction`: `requireStaffPermission("faq")`,
  normalize, read-modify-write `branding.config.faqGroups`, demo-mode branch,
  `revalidateTenant`. Mirrors `saveProtocolsAction`.
- `src/storefront/types.ts` — `Brand.faqGroups?: FaqGroup[]` (DB seed field).
- `src/storefront/store.tsx` — FAQ state seeds from `brandSeed.faqGroups`
  (DB via the page's config spread); localStorage hydration removed (stale
  local copies can no longer mask DB state); `setFaqGroups` is now a debounced
  (600 ms, editor fires per keystroke) DB-backed setter with failure toasts.

## Coverage and known gaps

- The pure core (sanitization — the only new logic) is fully covered by
  `test:faq` (13 checks).
- `saveFaqAction` itself (auth gate + Prisma upsert) is not exercised by an
  automated test — consistent with every sibling action (`saveProtocolsAction`,
  `savePromoCodesAction`, …); the repo's convention is pure-core scripts, and
  the action is a line-for-line mirror of the protocols action.
- Manual verification still recommended: edit FAQ at `slug.lvh.me:3100/#admin`,
  reload in an incognito window at `#faq`, confirm the edits appear; signed-out
  save should toast "Couldn't save FAQ".
- Note: the live DB persists `branding.config` as JSON — no schema change, so
  no `db:push` needed for this feature.
