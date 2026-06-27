# TDD Evidence — Per-Tenant PostHog Integration

**Source plan:** the inline `/ecc:plan` output approved in-session (super-admin-managed
keys · server-side capture of `order_placed` + `order_status_changed` · PostHog
Messaging sends all email). No external `*.plan.md` file.

**Runner:** this repo has no Jest/Vitest. Its test idiom is self-contained `tsx`
scripts asserting against the **real** modules (see `test-access-gate.ts`,
`check-theme-contrast.ts`). New gate: `scripts/test-posthog.ts` → `npm run test:posthog`.

## User journeys

1. As a store owner on Automated Growth, I want my orders to flow into **my own**
   PostHog project so I can see who ordered and trigger emails.
2. As the platform operator, I want to paste each tenant's PostHog key in
   super-admin, test it, and toggle it on — without ever exposing the key.
3. As a customer, when I check out (and when my order ships/delivers), I want an
   email — sent by the store's PostHog workflow, addressed to me.
4. As any party, checkout must never slow or break because of analytics.

## RED → GREEN

| Stage | Command | Result |
|---|---|---|
| RED | `npm run test:posthog` (stubs throw `not implemented`) | **FAIL — 1 passed, 15 failed** (all failures = intended missing implementation) |
| GREEN | `npm run test:posthog` (real `envelope.ts` + `events.ts`) | **PASS — 16 passed, 0 failed** |
| Types | `npx tsc --noEmit` (whole project, incl. new UI/actions/hooks) | **0 errors** |
| Regression | `npm run test:posthog` after the UI layer landed | **PASS — 16/16** |

RED was a valid runtime RED: the test compiled and executed; every failure was the
seeded `not implemented` stub, not unrelated breakage.

## Test specification (pure cores)

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Secrets round-trip through AES-256-GCM (ASCII/unicode/empty) | `test-posthog.ts` envelope round-trip ×2 | unit | PASS |
| 2 | Ciphertext ≠ plaintext; IV is randomized per seal | `test-posthog.ts` | unit | PASS |
| 3 | Tampered ciphertext / tag is rejected (throws, never garbage) | `test-posthog.ts` ×2 | unit (security) | PASS |
| 4 | A blob sealed by key A cannot be opened by key B | `test-posthog.ts` | unit (security) | PASS |
| 5 | `dataKeyId` fingerprints the key (stable per key, differs across keys) | `test-posthog.ts` | unit | PASS |
| 6 | Malformed (non-32-byte) `ENCRYPTION_KEY` is rejected | `test-posthog.ts` | unit | PASS |
| 7 | `distinctId` = lowercased email → orderNumber → id, never empty | `test-posthog.ts` ×2 | unit | PASS |
| 8 | `orderTotal` = items + shipping + adminFee − discount, clamped ≥ 0 | `test-posthog.ts` | unit | PASS |
| 9 | `order_placed` has correct event, distinctId, total, itemsCount | `test-posthog.ts` | unit | PASS |
| 10 | Person `$set` carries email/name; omits email when buyer gave none | `test-posthog.ts` ×2 | unit | PASS |
| 11 | `order_status_changed` carries from/to status + tracking | `test-posthog.ts` | unit | PASS |

## Coverage & known gaps

The pure, security-sensitive cores (envelope crypto, event/identity builders) have
direct unit coverage — that is where correctness bugs would hide. The integration
layers are covered by the repo's existing gates, matching how this codebase already
validates DB/UI code:

- **`tsc --noEmit` = 0 errors** over `integrations/store.ts`, `integrations/posthog.ts`,
  `analytics/capture.ts`, the `orders.ts` hooks, the super-admin actions/page/component.
- **`npm run test:isolation`** exercises the `withTenant` tenant-client that
  `store.ts` reads/writes through.

**Intentionally untested by script** (manual / type-gated): the live `/capture/`
HTTP call and PostHog-side workflow/email delivery (external service, beta), and the
React admin component (visual). Manual verification per `docs/posthog-integration.md`:
place a test order on a connected store → event + identified person appear in PostHog.

**Not built (scope):** our own mailer, Inngest, `posthog-js` client capture,
`EmailLog`/`Contact` writes — PostHog Messaging owns sending per the locked plan.
