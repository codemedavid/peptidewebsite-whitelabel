# TDD Evidence — Super-Admin → Tenant WhatsApp Quick-Contact

**Date:** 2026-06-28
**Branch:** main
**Feature:** Let the platform super admin connect each tenant's WhatsApp number for one-tap follow-up (wa.me click-to-chat).

## Source plan
Derived during this TDD run from the approved inline `/ecc:plan` output for:
> "in each tenant also allow super admin to connect the whatsapp of each tenant so that when the super tenant needs to follow up or ask anything its just one tap away"

Confirmed scope (via AskUserQuestion): **click-to-chat deep link**, **manual entry by super admin**.

## User journeys
1. As a super admin, I save a tenant's WhatsApp number (typed in any format) so it persists as a clean dial string.
2. As a super admin, I get a one-tap `wa.me` link with a prefilled greeting from the tenants console (list row + detail header/card).
3. The system rejects junk (letters-only / too short / too long) and lets me clear a number.

## Task report

### Task 1 — Normalize / validate / link helpers (pure core)
- **Summary:** Added `src/lib/admin/whatsapp.ts` with `toWaDigits`, `validateWhatsapp`, `buildWaLink`; centralizes the previously-inline `wa.me` pattern.
- **Validation command:** `npm run test:admin-whatsapp`
- **RED evidence:** before implementation —
  `Error: Cannot find module '../src/lib/admin/whatsapp'` (compile-time RED: the reproducer references the intended, not-yet-existent module).
- **GREEN evidence:** after implementation — `12 passed, 0 failed`.
- **Guaranteed:** formatting is stripped to bare digits; E.164 length bounds (8–15) enforced; greeting URL-encoded; no dangling `?text=` for empty messages.

### Task 2 — Schema field
- **Summary:** Added nullable `Tenant.ownerWhatsapp` (operator-set, not tenant-editable).
- **Validation:** `npx prisma generate` → OK. **Requires `npm run db:push` on each environment** before use (live DB is synced via db push; absent the column, reads/writes raise "column does not exist").

### Task 3 — Server action
- **Summary:** `setTenantWhatsappAction(slug, raw)` in `src/actions/admin.ts` — `requirePlatformUser()` guard, demo no-op, normalize+validate via `validateWhatsapp`, empty input clears (`null`), revalidates `admin:data` + tenant paths. Mirrors `suspendTenantAction`.
- **Validation:** `npx tsc --noEmit` — no errors in feature files.

### Task 4 — Data layer + UI
- **Summary:** `AdminTenantRow`/`TenantDetail` surface `ownerWhatsapp`; both cached tenant queries select it. `TenantDetailView` gains a "WhatsApp follow-up" card (set/update/clear + Message) and a header one-tap link; `TenantsTable` gains a per-row one-tap WhatsApp icon.
- **Validation:** `npx tsc --noEmit` — clean for all feature files.

## Test specification
| # | What is guaranteed | Test file / case | Type | Result | Evidence |
|---|--------------------|------------------|------|--------|----------|
| 1 | `+63 917 123 4567` and `(63) 917.123.4567` normalize to `639171234567` | `test-admin-whatsapp.ts: toWaDigits …` | unit | PASS | `npm run test:admin-whatsapp` |
| 2 | Letters-only / <8 / >15 digits are rejected with an error | `test-admin-whatsapp.ts: validateWhatsapp rejects …` | unit | PASS | `npm run test:admin-whatsapp` |
| 3 | E.164 boundary lengths (8 and 15) accepted | `test-admin-whatsapp.ts: accepts the E.164 boundary lengths` | unit | PASS | `npm run test:admin-whatsapp` |
| 4 | `buildWaLink` URL-encodes the greeting; omits `?text=` when empty | `test-admin-whatsapp.ts: buildWaLink …` | unit | PASS | `npm run test:admin-whatsapp` |

## Coverage & known gaps
- The testable pure core (normalize/validate/link) has full unit coverage (12/12).
- The server action and React surfaces follow existing untested conventions in this repo (e.g. `setTenantPlanAction`, `AdminPasswordCard`) and are verified by typecheck + manual QA, consistent with the project's script-based test approach (no Jest/RTL harness present).
- **Manual QA checklist:** set a number on a tenant → header/list one-tap opens WhatsApp with `Hi <tenant>, ` prefilled; clear it (empty + save) → links disappear; non-platform user is rejected by `requirePlatformUser()`.

## Merge evidence (RED → GREEN → feature)
- `264689d` test: add reproducer for super-admin tenant WhatsApp helpers (RED)
- `163d044` feat: tenant WhatsApp normalize/validate/link helpers (GREEN)
- `1997a0d` feat: super-admin one-tap WhatsApp follow-up per tenant
