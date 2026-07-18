# TDD Evidence — Visitor-Gate Heartbeat (Phase 6b)

**Source plan:** ported access-gate + Group Buy spec (§3 sessions / §4 `/api/session`), adapted to this Prisma/server-action/subdomain repo. Companion doc: `gb-rounds-access-code.tdd.md`.

## User journey

> As a store owner who rotates my access code, I want every currently-admitted
> visitor to be dropped back to the access wall — even one sitting idle on the
> hash-routed storefront who never triggers a new server render — so that
> rotating the code actually revokes access instead of only affecting new tabs.

Constraint carried verbatim from the spec: the heartbeat's positive signal must be an explicit `{ authenticated: true }` JSON literal. **A 2xx HTML shell (a misrouted request, an auth redirect, an offline service-worker response) must NOT be treated as authenticated.** The original port's habit of trusting `response.ok` is the bug being designed out.

## Why a heartbeat at all

The gate is already enforced on every *server* request three ways: middleware (`rollGateCookie`), the layout (`isGateUnlocked`), and a fresh uncached `getTenantGateState`. But the storefront home is a hash-routed client app — after first render an idle visitor never re-hits the server, so a rotated code wouldn't reach them until a hard refresh. The heartbeat closes exactly that gap.

## Task report

| Task | Summary | Command | Result |
|---|---|---|---|
| RED | Reproducer for the SPA-fallback guard; module absent | `npm run test:gate-heartbeat` | FAIL — `Cannot find module '../src/lib/auth/gate-heartbeat'` (compile-time RED, commit `fd93ec0`) |
| GREEN core | Pure `interpretHeartbeat` + `shouldReloadForGate` | `npm run test:gate-heartbeat` | PASS 10/10 (commit `7a02e8d`) |
| GREEN wiring | Endpoint + client poller + layout mount + shared decision | `npx tsc --noEmit` / `test:gate-heartbeat` / `test-access-gate` | 0 errors / 10/10 / 8/8 (commit `e84fc50`) |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Explicit `{authenticated:true}` JSON → authed | `test-gate-heartbeat.ts` | unit | PASS |
| 2 | Explicit `{authenticated:false}` (200 or 401) → invalidated (boot) | `test-gate-heartbeat.ts` | unit | PASS |
| 3 | A 2xx **HTML shell** → inconclusive, never authed | `test-gate-heartbeat.ts` | unit | PASS |
| 4 | HTML that merely *contains* the literal string is not authed (no substring match) | `test-gate-heartbeat.ts` | unit | PASS |
| 5 | Network error (null probe) → inconclusive (no false logout) | `test-gate-heartbeat.ts` | unit | PASS |
| 6 | JSON content-type but unparseable body → inconclusive | `test-gate-heartbeat.ts` | unit | PASS |
| 7 | JSON object missing `authenticated` → inconclusive | `test-gate-heartbeat.ts` | unit | PASS |
| 8 | Non-boolean `authenticated` (`"true"`, `1`) → inconclusive, never authed | `test-gate-heartbeat.ts` | unit | PASS |
| 9 | 5xx with JSON error body → inconclusive | `test-gate-heartbeat.ts` | unit | PASS |
| 10 | `shouldReloadForGate` boots ONLY on a confirmed invalidation | `test-gate-heartbeat.ts` | unit | PASS |

## Design notes / guarantees

- **No drift:** `evaluateVisitorGate(tenantId)` is the single gate decision consumed by both the layout (renders the wall) and `/api/gate/session` (answers `authenticated`). They cannot disagree.
- **Fail-safe, not fail-open:** the endpoint returns `500` (never `authenticated:false`) on error → the client reads it as inconclusive and does not mass-logout gated visitors on a transient blip; the layout still gates on the next real navigation.
- **No false logouts:** only a confirmed `invalidated` reloads. `inconclusive` (HTML shell, 5xx, network error, unparseable body) is a no-op.
- The heartbeat is mounted **only** for a gated-but-unlocked visitor (`status === "unlocked"`) — no polling when there is no wall to return to.

## Known gaps

- The client component (fetch + event listeners + reload) is covered by the pure decision core, not by a DOM/browser test — no jsdom/Playwright harness exists in this repo. The security-relevant logic (what a response *means*) is fully unit-tested; the untested part is event plumbing and `window.location.reload()`.
