# TDD Evidence — Copyable Order Message

**Date:** 2026-08-06
**Branch:** `feat/gb-pricing-tab`
**Source plan:** none. Free-form request, verbatim:

> "allow customer too copy the order details message also so that when it doesnt work
> the auto filled they can just copy it"

Follows on from [sort-categories-and-order-confirmation.tdd.md](./sort-categories-and-order-confirmation.tdd.md),
Task 5, which built the Order Confirmed review screen. That screen could copy the order
*reference* but never the *order message* — the exact gap this change closes.

---

## User journey

As a customer whose chat app opened with an empty compose box, I want to copy my whole
order as text and paste it into the conversation myself, so that a failed prefill doesn't
leave me retyping my own order.

Three real ways the prefill fails, all previously unrecoverable from this page:

1. **Channels that cannot carry a body at all** — Telegram, Messenger, Instagram. The page
   already copied to the clipboard on those, but only as a side effect of tapping the
   channel, and with no visible way to retry if the write was denied.
2. **A prefilling channel that lands empty** — an in-app webview that drops the query
   string, or a link handed to the wrong app.
3. **No hand-off in sessionStorage** — private tab, storage full, session restored into a
   new tab. This was the worst case: `send()` returned early on `!handoff`, so *every
   channel button was inert* and the customer had no way off the page.

---

## Task report

### Task 1 — `formatOrderMessage` pure core

Rebuilds the chat message from the already-built `OrderConfirmation` view rather than from
the order or the cart, so the pasted text and the table the customer just read are the same
numbers by construction. Layout deliberately mirrors `buildOrderMessage` in
`src/storefront/checkout.ts` — the seller should not be able to tell whether a given message
was prefilled or pasted.

| Stage | Evidence |
|---|---|
| RED | `npm run test:order-confirmation` → `TypeError: (0 , import_order_confirmation.formatOrderMessage) is not a function` at `scripts/test-order-confirmation.ts:221`. Runtime RED: the test compiled and ran, and failed on the missing implementation. Commit `65ddbef`. |
| GREEN | `npm run test:order-confirmation` → `50 checks, 0 failure(s)` (was 34; +16 new). Commit `9cdc1f8`. |

No test expectation was changed to accommodate the implementation, and no production code
was changed to accommodate a test.

### Task 2 — Page wiring

`OrderConfirmedPage.tsx` + `storefront.css`. Commit `d3a7c65`.

| Check | Result |
|---|---|
| `npx tsc --noEmit --pretty false` | clean, exit 0 |
| `npm run test:order-confirmation` | `50 checks, 0 failure(s)` |
| `npm run test:cart` | `15 passed, 0 failed` |
| `npm run test:checkout-names` | `10 passed, 0 failed` |
| `npm run test:two-ways-cart` | `20 passed, 0 failed` |
| `npm run test:gb-cart-doses` | `22 passed, 0 failed` |
| `npm run test:order-detail` | `17 passed, 0 failed` |

Three behavior changes on the page:

- **A visible "Copy order details" button**, always shown — not revealed after a failure.
  The page cannot detect a chat app that opened blank, so the customer has to be able to
  reach for it unprompted.
- **`copyText()` with a real fallback chain.** `navigator.clipboard` is undefined outside a
  secure context and denied outright by several in-app browsers (Facebook and Instagram
  webviews among them) — precisely where the hand-off is least reliable. Falls back to
  `document.execCommand("copy")`; if *both* refuse, the message is put on screen in a
  read-only textarea that selects itself on focus, so the worst case is one gesture rather
  than retyping. A "Show order text" toggle exposes the same box on demand.
- **`send()` no longer requires the sessionStorage hand-off.** It uses the resolved
  `messageText`, which falls back to `formatOrderMessage(view)`. This fixes failure mode 3
  above: channel buttons now work with no hand-off at all.

---

## Test specification

All in `scripts/test-order-confirmation.ts`, section `copyable order message`.
Command for every row: `npm run test:order-confirmation`.

| # | What is guaranteed | Test name | Type | Result |
|---|---|---|---|---|
| 1 | The message names the order and the store | `the message names the order and the store` | unit | PASS |
| 2 | A store with no name still yields a self-identifying order header | `no store name → the order still names itself` | unit | PASS |
| 3 | Every line carries quantity and line total | `every item lists quantity and line total` | unit | PASS |
| 4 | The size is not printed twice when the stored name already carries it | `a variation the stored name already carries is not repeated` | unit | PASS |
| 5 | A size the stored name lacks IS spelled out, so the seller can fulfil | `a variation the stored name lacks is appended so the store knows the size` | unit | PASS |
| 6 | Discount, shipping and fee are broken out when present | `the breakdown appears when there is a discount, shipping or a fee` | unit | PASS |
| 7 | The pasted total is the same number the screen shows | `the message's total is the number the screen shows` | unit | PASS |
| 8 | A plain order gets one Total line, not a wall of identical figures | `a plain order gets one Total line, no breakdown` | unit | PASS |
| 9 | A codeless discount leaves no empty parentheses | `a discount with no code leaves no empty parentheses` | unit | PASS |
| 10 | Shipping with no courier leaves no empty parentheses | `shipping with no courier leaves no empty parentheses` | unit | PASS |
| 11 | Contact details survive into the message | `the customer block carries name, email and phone` | unit | PASS |
| 12 | Ship-to is the same one-line address the screen shows | `the ship-to line is the same one-line address the screen shows` | unit | PASS |
| 13 | The payment method is carried | `the payment method is carried` | unit | PASS |
| 14 | The message never prints `undefined`, `null` or `NaN` | `the message never prints undefined, null or NaN` | unit | PASS |
| 15 | An order missing every optional field still formats cleanly | `an order missing every optional field still formats cleanly` | unit | PASS |
| 16 | Formatting is pure — the view is not mutated | `formatting the message does not mutate the view` | unit | PASS |

Row 14 is the point of the whole feature: this button exists for customers whose prefill
failed, and a message containing "undefined" is worse than no message.

---

## Coverage and known gaps

The project has no global coverage instrument; its convention is per-feature pure gates
under `scripts/`, and the new function is covered that way end to end. Deliberate,
non-silent gaps:

- **`npm run build` was NOT run.** A dev server was live on this machine, and a concurrent
  build clobbers `.next/` and takes the running server down with site-wide 500s. `tsc
  --noEmit` is clean and every related gate passes, but the production build has not been
  exercised against these changes. **Run `npm run build` with the dev server stopped before
  deploying.**
- **No automated test for `copyText()` or the JSX.** It is browser-API branching
  (`navigator.clipboard` → `execCommand` → reveal) and the repo has no component-test
  harness or jsdom setup. Worth checking by hand: the button on iOS Safari, inside the
  Messenger in-app browser, and on plain `http://` (insecure context, where
  `navigator.clipboard` is undefined and the execCommand path must carry it).
- **`formatOrderMessage` and `buildOrderMessage` are parallel implementations.** They are
  kept deliberately similar in output but are not shared code — the checkout builds from
  `CartLine[]`, this builds from the view. Reseller tier tags (`buildOrderMessage`'s
  `(reseller — vials only @ ₱x/ea)`) are NOT reproduced, because the stored order does not
  retain the tier. A pasted reseller order therefore shows the correct prices but not the
  tier label. Flagged rather than fixed: the price is what the seller acts on.
- **No migration.** Nothing persisted changed.

## Merge evidence

Checkpoint commits on `feat/gb-pricing-tab`, oldest first:

| Commit | Stage |
|---|---|
| `65ddbef` | RED — reproducer for the copyable order message (runtime failure, missing export) |
| `9cdc1f8` | GREEN — `formatOrderMessage`, 50 checks 0 failures |
| `d3a7c65` | Page + styles; tsc clean, six gates green |

If these are squashed, this table and the results above are the surviving record.
