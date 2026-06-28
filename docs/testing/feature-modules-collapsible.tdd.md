# TDD Evidence — Collapsible feature modules (Tenant → Features editor)

## Source plan
Derived during this TDD run from the confirmed inline `/ecc:plan` output:
*"make the features in feature modules a dropdown so that it's more organized."*
Scope confirmed by the user as the **admin Tenant → Features editor**
(`src/components/admin/FeaturesEditor.tsx`), not the Plans page Plan Scope panel.

## User journeys
- As a platform operator, I want each feature module (Site, Catalog, Ecommerce,
  Group Buy, …) to start collapsed, so the Features page reads as a short,
  scannable list of modules instead of one long wall of toggles.
- As a platform operator, I want to click a module header to expand/collapse it,
  so I only see the toggles I care about.
- As a platform operator, I want the "Enable all" control to keep working
  without expanding/collapsing the module when I click it.
- As a platform operator, when I filter by On/Off, I want every module that has a
  matching row to open automatically, so the filter never looks empty because a
  module happened to be collapsed.

## Task report

### Task 1 — Pure disclosure helpers (`src/components/admin/feature-disclosure.ts`)
- **Summary**: extracted the accordion's open/closed decision, immutable toggle,
  and DOM-safe body id into React-free helpers so they can be unit-tested.
- **Validation command**: `npm run test:feature-disclosure`
- **RED evidence** (before the helper existed):
  ```
  Error: Cannot find module '../src/components/admin/feature-disclosure'
  ```
  The new test references the missing implementation — compile-time RED for the
  intended behaviour, not an unrelated setup error.
- **GREEN evidence** (after implementing the helper):
  ```
  Feature-module disclosure helpers — pure core
  isGroupOpen ✓✓✓✓✓  toggleGroupOpen ✓✓✓✓  groupBodyId ✓✓
  11 passed, 0 failed
  ```
- **Guaranteed**: default-collapsed; user open/close honoured under "all"; On/Off
  filter force-opens; toggle is immutable and isolates other groups; body ids are
  unique, stable, and DOM-safe (`^ftr-grp-[a-z0-9-]+$`).

### Task 2 — Wire helpers into the editor UI (`FeaturesEditor.tsx`)
- **Summary**: added `openGroups` state + `toggleOpen`, turned each module header
  into a disclosure `<button>` (icon + title + count pill + rotating chevron)
  with `aria-expanded`/`aria-controls`, kept "Enable all" as a sibling (no nested
  buttons), and wrapped the rows in a `role="region"` body hidden when collapsed.
- **Validation command**: `npx tsc --noEmit -p tsconfig.json`
- **Evidence**: `tsc exit: 0` (clean) and `test:feature-disclosure` still 11/0.
- **Guaranteed**: the rendered editor consumes the tested helpers; markup stays
  valid (Enable-all toggle is not inside the trigger button).

### Task 3 — CSS (`src/app/(platform)/admin/admin.css`)
- **Summary**: header padding moved onto `.ftr-gtoggle`; added hover/focus-visible
  states, chevron rotation (`[data-open="true"]`), and a `:has()` rule that drops
  the header border when a module is collapsed so closed cards read as a list.
- **Validation**: visual/manual (no CSS test harness in repo).

## Test specification
| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Modules default to collapsed when nothing is toggled (filter = all) | `scripts/test-feature-disclosure.ts:isGroupOpen` | unit | PASS | `npm run test:feature-disclosure` |
| 2 | User-opened group reports open; user-closed group reports closed (filter = all) | same | unit | PASS | same |
| 3 | On/Off filter force-opens every group (incl. ones the user collapsed) | same | unit | PASS | same |
| 4 | `toggleGroupOpen` flips one group immutably, leaving others intact | `…:toggleGroupOpen` | unit | PASS | same |
| 5 | `groupBodyId` is unique, stable, and DOM-safe across all catalog groups | `…:groupBodyId` | unit | PASS | same |
| 6 | Editor + helpers type-check cleanly | `npx tsc --noEmit` | typecheck | PASS | `tsc exit: 0` |

## Coverage and known gaps
- The pure helper has branch-complete coverage (all-filter open/closed default,
  forced-open filters, immutable toggle, id slugging) via the 11 assertions.
- **Gap**: no DOM/interaction test (click-to-expand, keyboard, `hidden` toggling)
  — the repo has no React Testing Library / Playwright harness for the admin
  surface, consistent with how the existing `ftr-*` UI shipped. Covered here by
  type-check + manual verification.
- **Manual checklist**: open admin → a tenant → Features. Confirm modules start
  collapsed; clicking a header expands/collapses with chevron rotation; "Enable
  all" toggles without expanding; switching filter to On/Off auto-expands groups
  with matches; Tab/Enter/Space operate the header.

## Merge evidence
RED: `Cannot find module '…/feature-disclosure'` (new test, missing impl).
GREEN: `11 passed, 0 failed` + `tsc exit: 0`. No refactor needed.
Checkpoint commits intentionally not created — repository policy is to commit
only when the user asks.
