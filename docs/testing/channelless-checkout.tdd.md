# Channel-less checkout → thank-you → order tracker (TDD evidence)

**Date:** 2026-09-04 · **Branch:** `feat/made-to-order`
**Commits:** `5a7ac80` (RED) → `5c4c72d` (GREEN) → `ce85d1e` (polish)
**Suite:** `npm run test:channelless-checkout` — `scripts/test-channelless-checkout.ts`

## Source

No `*.plan.md` artifact. The input was a free-form request planned inline via
`/ecc:plan` and approved with "proceed"; journeys below were derived from it.

> when contact channels dont have any channels enabled the customer should be
> able to checkout still and after checking out a page will just pop up where in
> it will show thankyou for placing an order and kindly wait for the confirmation
> and to check your order status you can check the order status in order tracker
> page just search your order number or the website should use the cookies so
> that the website knows the recent order number of the user and will show it to
> the order tracker

## The bug this fixes

Every place-order button in the storefront was a CHANNEL button. `placeOrder`
opened `const channel = channels.find(...); if (!channel …) return;`, and the
drawer's footer short-circuited on `channels.length === 0` to:

> Online checkout isn't set up yet — please contact the store directly.

So a store with no contact channel could not take an order at all: the customer
filled in their address, chose a payment method, uploaded proof, and then found
no button. It was a CLIENT gate only — `placeStorefrontOrderAction` has never
required a channel (`contactMethod` is stored as a free string), so these were
orders the store could have had.

**Four live tenants were in this state** when the fix was written (read-only
audit of `branding.config.contactChannels`): `glowform-lab`, `dragon-peptides`,
`peptide-groupbuy`, `mstomato`.

## User journeys

- As a shopper at a store with no chat channel, I want to complete checkout on
  the site, so that I can actually buy.
- As that shopper, I want the screen after checkout to tell me the order is in
  and to wait for confirmation, so I don't think something went wrong.
- As that shopper, I want to check the order later by number on the Track page,
  without transcribing it off a screen.
- As a store owner WITH channels, I want nothing about my checkout to change.
- As a store owner who is not ready to sell, I want a way to stop orders — the
  store open/closed switch, not an accident of my channel config.

## Task report

**1 — RED.** Wrote the suite first (`5a7ac80`). It references two modules that
did not exist, so the first RED was compile-time:

```
$ npm run test:channelless-checkout
Error: Cannot find module '../src/lib/storefront/checkout-handoff'
Require stack:
- scripts/test-channelless-checkout.ts
```

**2 — RED (runtime).** Added the two pure modules only, then re-ran. ENGINE and
COOKIE went green; the three UI sections failed against the unchanged screens —
the intended business-logic failure, not setup breakage:

```
22 passed, 12 failed

CART      ✗ the dead-end 'checkout isn't set up' branch is gone
          ✗ the drawer branches on the shared hand-off predicate
          ✗ direct mode renders a place-order button
          ✗ placeOrder no longer requires a channel
          ✗ the order number is remembered after a successful placement
CONFIRM   ✗ the confirmation page branches on the same shared predicate
          ✗ direct mode thanks the customer and asks them to await confirmation
          ✗ direct mode points at the order tracker
          ✗ the tracker link is gated on the owner actually serving that page
          ✗ direct mode does not ask the customer to 'finalize' anything
TRACK     ✗ the tracker recalls the remembered order number
          ✗ the recalled number is looked up, not just typed into the box
```

**3 — GREEN** (`5c4c72d`). Two regimes, decided in one place:

| Module | Role |
|---|---|
| `src/lib/storefront/checkout-handoff.ts` | `resolveHandoffMode(brand)` → `"channels" \| "direct"`, delegating to `activeChannels` so the drawer and the confirmation screen cannot disagree |
| `src/lib/storefront/recent-order.ts` | the `sf_last_order` cookie — build / read / sanitize (pure) plus two DOM wrappers |

`placeOrder(channel: ContactChannel \| null)`; a null channel records
`contactMethod: "Website"` and the drawer renders one **Place order** button.
The confirmation screen swaps "Finalize your order" for a thank-you panel, and
the Track page seeds itself from the cookie (falling back to `myOrders`).

```
34 passed, 0 failed
```

**4 — Polish** (`ce85d1e`). Browser verification found the thank-you panel had no
styles of its own (border 0, no padding, left-aligned). The suite asserts what
the page *says*, not how it looks, so only the browser could catch it.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A store with no/blank/disabled channels resolves to `"direct"`; one real channel resolves to `"channels"` | `test-channelless-checkout.ts` ENGINE (6) | unit | PASS |
| 2 | `resolveHandoffMode` never disagrees with `activeChannels`, across six channel shapes | ENGINE "agrees with activeChannels" | unit | PASS |
| 3 | The cookie round-trips an order number, carries `Path`, a multi-day `Max-Age` and `SameSite=Lax` | COOKIE (4) | unit | PASS |
| 4 | A cookie whose name merely *ends* with the key (`my_sf_last_order`) is never mistaken for it | COOKIE "name-exact" | unit | PASS |
| 5 | Junk, over-long and non-string values are refused, not echoed into the lookup field | COOKIE (3) | unit | PASS |
| 6 | The drawer no longer dead-ends, branches on the shared predicate, and renders a place-order button | CART (3) | source | PASS |
| 7 | `placeOrder` no longer bails out without a channel, and the number is remembered on success | CART (2) | source | PASS |
| 8 | The confirmation thanks the customer, asks them to await confirmation, links `#track`, and gates that link on `isPageVisible(brand,"track")` | CONFIRM (4) | source | PASS |
| 9 | "Finalize your order" and the copy-order fallback do not render in direct mode (balanced-paren branch split, not a regex guess) | CONFIRM "finalize" | source | PASS |
| 10 | The tracker recalls the cookie in a mount effect and looks it up; `myOrders` stays the fallback | TRACK (3) | source | PASS |
| 11 | A store WITH channels keeps its buttons, `channelUrl`/`channelPrefills` hand-off and copy-order fallback | NO REGRESSION (3) | source | PASS |
| 12 | Removing the "not set up yet" guard did not remove the real one — `isStoreClosed` still gates the drawer | NO REGRESSION "store closed" | source | PASS |

### Neighbouring suites (regression)

```
test:order-confirmation   50 checks, 0 failure(s)
test:contact-channels     12 passed, 0 failed
test:cart                 20 passed, 0 failed
test:checkout-total       13 passed, 0 failed
test:track-note           20 passed, 0 failed
test:order-detail         18 passed, 0 failed
test:store-status         PASS
test:two-ways-cart        20 passed, 0 failed
test:data-export          38 passed, 0 failed
npx tsc --noEmit          clean
```

## Browser verification

Dev server on `:3100`, tenant `mstomato` (a real 0-channel store).

| Step | Observed |
|---|---|
| Add to cart → Checkout | Details step renders — previously the dead-end message |
| Fill details → Continue | Payment step; footer button `Place order`, class `btn btn-primary sf-cart__cta sf-cart__place`, enabled |
| `#order-confirmed` | Heading "Order Received"; panel reads "Thank you for placing your order! We've received it and it's now waiting for confirmation…" then the tracker line and a **Track my order** button → `#track` |
| Same screen | `.sf-confirm__send` absent; no "Finalize your order", no "Copy order details" |
| Panel styling (after `ce85d1e`) | border 1px, radius 14px, `text-align: center`, padding 24px 20px, brand-tinted background |
| **Track my order** | `#track`, input pre-filled `MST-9001`, lookup ran automatically, journey rendered |
| localStorage wiped, cookie kept | input still pre-filled from the cookie ALONE; no "recent orders" list; server lookup correctly reports not-found for the synthetic number |
| Tenant `nova-lab` (Messenger) | "Send your order via" → Messenger button; **no** place-order button — unchanged |

Console: no errors, warnings or issues on the confirmation screen.

## Coverage and known gaps

- **No coverage percentage.** This repo has no coverage tooling — no vitest,
  jest, c8 or nyc, and no `test:coverage` script. Testing is ~150 bespoke `tsx`
  suites. The 80% target in the global rules is not measurable here, so no
  number is claimed. Coverage of the *changed* surface is stated per row above.
- **Server placement was not exercised end-to-end against live data.** The
  confirmation and tracker screens were verified by seeding the client state a
  real placement leaves behind (the tenant-namespaced `myOrders` mirror, the
  `sf_confirm` blob, the cookie) rather than writing a test order into the live
  `mstomato` tenant's order book. The drawer was driven as far as an enabled
  **Place order** button. The server leg is unchanged apart from
  `contactMethod`, which `src/actions/orders.ts:749` already stores as a free
  string with no channel validation.
- **Source-text assertions.** CART / CONFIRM / TRACK assert on component source
  rather than rendered output — this repo has no React test renderer. They are
  proxies; the browser pass above is what confirms behaviour.
- One assertion was rewritten between RED and GREEN: the "finalize" check
  originally required the literal shape `!isDirect`. The implementation used a
  ternary with a nested ternary inside the direct branch, which a lazy regex
  would mis-split, so it became a balanced-paren branch split asserting the same
  guarantee more strictly (thank-you in one branch, "Finalize your order" and
  the copy fallback only in the other).

## Notes for the operator

- The cookie is written for **every** store, not only channel-less ones, so
  one-tap tracking now works everywhere.
- It is not httpOnly (the page reads it) and carries only an order number.
  Looking an order up by number is already public and PII-free
  (`trackStorefrontOrderAction` returns status, journey and items — no customer
  data), so this exposes nothing new.
- If a store should not be taking orders, the control is the owner's
  **store open/closed** switch, which is enforced in the drawer and re-checked
  server-side. Having no contact channel is no longer a de-facto "closed".
