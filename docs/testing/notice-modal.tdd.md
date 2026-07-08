# TDD Evidence — Storefront Notice Modal

**Feature:** Per-tenant notice/disclaimer modal shown on every storefront visit,
imported from the Claude Design `Storefront Notice Modal.dc.html`.

**Source plan:** derived inline from `/ecc:plan` (see conversation). No `.plan.md`
file was written; journeys captured here.

## User journeys

1. **As a platform operator**, I can grant/revoke the Notice Modal per tenant on
   `/admin/tenants/[slug]/settings`, so it is never on for a tenant automatically.
2. **As a store owner**, once granted, I see a **Notice Modal** editor where I
   toggle it on/off and edit every line of copy, so I control what customers read.
3. **As a customer**, when the operator has granted it AND the owner enabled it, a
   themed modal pops up on every visit; the chrome adopts my store's palette.
4. **Safety:** an ungranted or owner-disabled tenant shows nothing; a store owner
   can never grant the feature to themselves.

## Design decision

Two-flag **entitlement gate** (`visible = operatorEnabled && enabled`), both
default `false`. The operator grant is a per-tenant `branding.config` switch
(mirrors `requireProofOfPayment`), not a platform FEATURES catalog entry.

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| Pure core | `normalizeNoticeModal` + `isNoticeModalVisible` gate | `npm run test:notice-modal` | RED (module absent) → GREEN 18/18 |
| Integration wiring | brand projection, modal, editor, actions, operator toggle | `npx tsc --noEmit` | exit 0, 0 errors |

### RED evidence
```
Error: Cannot find module '../src/lib/storefront/notice-modal'
```
(commit `f7e9469` — test added, compiled, failed for the intended reason)

### GREEN evidence
```
18 passed, 0 failed
```
(commit `4e880a9` — pure core; commit `85d7ac5` — full integration, tsc exit 0)

## Test specification (guarantees)

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Gate hidden unless BOTH operatorEnabled AND enabled | `test-notice-modal.ts:isNoticeModalVisible` (6 cases) | unit | PASS |
| 2 | No tenant auto-on — both flags default false | `DEFAULT_NOTICE_MODAL` cases | unit | PASS |
| 3 | Untrusted input never throws; non-object → safe default | `normalizeNoticeModal` non-object case | unit | PASS |
| 4 | Missing fields fall back to default copy | missing-fields case | unit | PASS |
| 5 | `enabled`/`operatorEnabled` coerce to STRICT booleans | strict-boolean case | unit | PASS |
| 6 | Owner copy preserved (trimmed); blanks dropped; counts capped | content cases | unit | PASS |
| 7 | Normalize is idempotent | idempotent case | unit | PASS |

## Files changed

- `src/lib/storefront/notice-modal.ts` (new) — pure core
- `scripts/test-notice-modal.ts` (new) + `package.json` script
- `src/storefront/components/NoticeModal.tsx` (new) — themed modal + preview card
- `src/storefront/admin/AdminNoticeModal.tsx` (new) — owner editor + live preview
- `src/storefront/types.ts`, `visibility.ts`, `StorefrontApp.tsx`, `admin/AdminPage.tsx`, `storefront.css`
- `src/actions/storefront-admin.ts` (owner save), `src/actions/branding.ts` (operator grant)
- `src/lib/admin/data.ts`, `TenantSettingsView.tsx`, super-admin `settings/page.tsx`, storefront `page.tsx`

## Coverage & known gaps

- Pure gate/normalizer logic: unit-covered (self-contained `tsx` harness, the
  repo's convention for `src/lib/storefront/*`).
- **Not yet exercised at runtime (manual QA follow-up):** the visual pop-up,
  theme adoption across presets, Esc/scroll-lock behavior, and the two admin
  toggles end-to-end. Recommended manual pass: grant on the settings page →
  enable + edit in the store admin → refresh a tenant storefront (`slug.lvh.me:3100`)
  and confirm the themed modal appears; revoke → confirm it disappears and the
  owner editor hides. React escapes all copy (no `dangerouslySetInnerHTML`).
