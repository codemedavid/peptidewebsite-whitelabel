# TDD Evidence — Protocols Page Alphabetical Sort

**Source plan**: inline `/ecc:plan` output in-session (2026-07-03), user request:
"in the protocol page add a filter by alphabetical". Confirmed interpretation:
an A–Z / Z–A sort dropdown beside the existing category filter.

## User journeys

- As a storefront visitor, I want to sort the protocol list A–Z (or Z–A) by
  name, so that I can find a specific peptide quickly in a long list.
- As a store owner, I want the default order to stay exactly as I arranged the
  protocols in the admin, so sorting is opt-in for visitors.

## Task report

### 1. Pure sort core (`src/lib/storefront/protocol-sort.ts`)

- **RED** — `npm run test:protocol-sort` failed with
  `MODULE_NOT_FOUND: src/lib/storefront/protocol-sort` (compile-time RED: the
  reproducer references the missing implementation). Checkpoint commit
  `387ff20 test: add reproducer for protocol alphabetical sort core (RED)`.
- **GREEN** — after implementing the module, the same command reported
  `12 passed, 0 failed`. Checkpoint commit
  `be16671 feat: pure protocol alphabetical sort core (GREEN, 12/12 test:protocol-sort)`.
- **Refactor** — none needed; module is 51 lines, single-purpose.

### 2. UI wiring (`src/storefront/pages/ProtocolsPage.tsx`)

- Added `sort` state + a second `<select>` in the existing `protocols__filter`
  row (existing CSS already flex-wraps; no CSS change).
- List renders from `sortProtocolsByName(filtered, sort)`; `<details>` keys
  changed from render index to source-list index so open state stays with its
  protocol when order changes.
- Validated with `npx tsc --noEmit` (clean). **Not committed** in this cycle:
  the file also carries unrelated, pre-existing uncommitted gallery/viewer work
  from a parallel session, so the wiring is left in the working tree for a
  combined commit by the owner.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Unknown/empty/non-string sort values coerce to "default" | `test-protocol-sort.ts` normalizeProtocolSort | unit | PASS | `npm run test:protocol-sort` |
| 2 | "default" preserves admin-defined order | sortProtocolsByName default | unit | PASS | same |
| 3 | A–Z sorts case-insensitively (aod-9604 < BPC-157 < TB-500) | az case | unit | PASS | same |
| 4 | Z–A is the exact reverse of A–Z | za case | unit | PASS | same |
| 5 | Input list (shared store state) is never mutated; a new array is always returned | mutation cases | unit | PASS | same |
| 6 | Empty list handled without throwing | empty case | unit | PASS | same |
| 7 | Numeric-aware ordering (BPC-2 before BPC-10) | numeric case | unit | PASS | same |
| 8 | Equal names keep relative input order (stable sort) | stability case | unit | PASS | same |
| 9 | Missing/non-string names tolerated, sort first in A–Z | missing-name case | unit | PASS | same |
| 10 | Select offers exactly default / az / za, each labelled | PROTOCOL_SORT_OPTIONS case | unit | PASS | same |

## Coverage and known gaps

- The pure core is fully covered by `test:protocol-sort` (12 checks). The repo
  has no jest/vitest/coverage tooling — self-contained `tsx` gate scripts are
  the established test convention (see `test:hero-links`, `test:protocol-images`).
- Gap: no automated E2E/visual check of the rendered dropdown. Manual check:
  `npm run dev` → `slug.lvh.me:3100` → Protocols page → toggle Sort with and
  without a category filter.
- Behavioural note: `open={i === 0}` still forces the first *visible* row open
  after re-sorting (pre-existing semantic, unchanged).

## Merge evidence

RED `387ff20` → GREEN `be16671` are separate checkpoint commits on `main`. If
these are ever squashed, this file preserves the RED/GREEN proof.
