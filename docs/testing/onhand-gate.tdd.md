# TDD evidence — checkout on-hand gate fails closed (Phase 2)

**Branch:** `feat/trial-system`
**Commits:** `012bdd2` (RED) → `6c0e9fd` (GREEN)
**Date:** 2026-07-18

## Source plan

Derived in-session from the ported access-gate + Group Buy spec (§5, §7). The
spec's literal "closed-round" gate (`products.group_buy_id` → reject if the round
isn't active) does **not** map onto this schema: here rounds own a `productIds`
JSON array and a product is not owned by any round, so a closed round's products
simply revert to ordinary on-hand stock. The real server-side trust boundary that
§5's FIX was pointing at is the **on-hand gate**: when the owner turns on-hand
sales OFF during a live run, paused products must be refused server-side. That
gate was failing OPEN. Operator decision (2026-07-17): **fail closed**.

## User journey

**As a store owner running a locked-down group buy** (on-hand sales OFF), I want
the server to refuse paused products even when its gate check errors, so a stale
or tampered client cannot slip an on-hand product through checkout.

## Task report

**Summary.** `groupBuyOnHandViolation` in the `"use server"` `actions/orders.ts`
wrapped its whole body in `try/catch` and returned `null` (= allow) on any error.
A transient failure in `resolveGroupBuyCaps` or `loadGroupBuys` let a paused
product through. Extracted the logic into a pure, testable module
(`src/lib/storefront/on-hand-gate.ts`) with injected async deps, then flipped the
catch to fail closed.

**Validation command.** `npm run test:onhand-gate`

**RED** (`012bdd2`) — 7 passed, 2 failed:

```
✗ FAILS CLOSED when caps resolution throws while on-hand sales are off
    — got null (fails OPEN — paused product would slip through)
✗ FAILS CLOSED when the rounds read throws while on-hand sales are off
```

**GREEN** (`6c0e9fd`) — 9 passed, 0 failed. `tsc --noEmit` exit 0.

**Guaranteed.** With on-hand sales off, an unevaluable gate rejects rather than
allows. Blast radius is bounded by construction: the common case (on-hand sales
allowed) short-circuits **before any I/O**, proven by the test that injects
throwing deps yet asserts `null` — so an ordinary checkout is never walled.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | On-hand allowed → everything permitted | `decideOnHandBlock:allows everything when on-hand sales are allowed` | unit | PASS |
| 2 | On-hand off → paused product blocked by name | `decideOnHandBlock:blocks a paused on-hand product…` | unit | PASS |
| 3 | On-hand off → in-buy product still allowed | `decideOnHandBlock:allows an in-buy product…` | unit | PASS |
| 4 | GB module off → gate N/A, allowed | `decideOnHandBlock:allows when the group buy module is off` | unit | PASS |
| 5 | On-hand allowed short-circuits before any DB call | `evaluateOnHandGate:common case … WITHOUT touching deps` | unit | PASS |
| 6 | On-hand off → paused product blocked via real resolvers | `evaluateOnHandGate:blocks the paused product…` | unit | PASS |
| 7 | Caps read throws + on-hand off → **fail closed** | `evaluateOnHandGate:FAILS CLOSED when caps resolution throws…` | unit | PASS |
| 8 | Rounds read throws + on-hand off → **fail closed** | `evaluateOnHandGate:FAILS CLOSED when the rounds read throws…` | unit | PASS |
| 9 | Gate error never walls checkout when on-hand allowed | `evaluateOnHandGate:a gate error NEVER walls checkout…` | unit | PASS |

## Coverage and known gaps

No global coverage instrumentation (no `test:coverage`); 80% not mechanically
reportable. `on-hand-gate.ts` is fully covered by the new suite. Follow-up:
`stampGroupBuy` (`orders.ts:345`) still swallows attribution errors and stamps
`null` — that is best-effort reporting, not a security bypass, so it is
lower-priority and intentionally left for a later pass.

## Merge evidence

If squashed: `012bdd2` RED (7 passed, 2 failed — fail-open returns null) →
`6c0e9fd` GREEN (9 passed, 0 failed). `tsc` exit 0; regression onhand-gate,
gb-rounds, cart, checkout-total, gate, plan-scope all PASS.
