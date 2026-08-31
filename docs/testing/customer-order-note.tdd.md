# Customer order note — TDD evidence

**Date:** 2026-09-01
**Branch:** `main`
**Commits:** `6ed3165` (RED) → `2fc38fd` (GREEN) → `4209166` (styling)
**Source plan:** produced inline by `/ecc:plan` in this session (no `*.plan.md` artifact); the
approved plan's decisions are restated under *Decisions* below.

## The request

> "add a feature when placing an order a add a note: so that the admin can see when the customer
> have a reqs"

A buyer can leave a free-text note at checkout; the store owner reads it on the order.

## User journeys

1. **As a buyer**, I want to add a request when I place my order ("deliver after 5pm", "gate code
   1234"), so the store knows about it without me having to chase them in chat.
2. **As a buyer**, I want to see the note I wrote on the confirmation screen, so a typo in a
   delivery instruction is discoverable before I hand the order off.
3. **As a store owner**, I want the note wherever I actually read an order — the chat thread, the
   admin order page, the orders list, my CSV export — so I never ship past a request.
4. **As a store owner**, I want to turn the box off (or rename it) without a code change.
5. **As a store owner**, I must not leak a buyer's free-text note into the supplier copy of a
   group-buy report, which is the no-PII file a third party receives.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Its own `customerNote` column, **not** `shippingNote` | `shippingNote` flows the other way: the owner writes it, the customer reads it on the public Track page. Sharing one column would let the owner overwrite what a buyer asked for, and would republish the buyer's words on a page reachable with only an order number. |
| 2 | Owner toggle, **default ON**, with an editable label | Every other checkout field on this platform is tunable per tenant. An optional box costs a store nothing, so it ships on; an owner who doesn't want it gets a switch. |
| 3 | Always optional, never required | A required note would break checkout for every tenant that leaves the default on. |
| 4 | Admin **cannot** edit it — absent from `cleanPatch` | It is the customer's record of what they asked for. The owner already has `shippingNote` as their own channel. |
| 5 | **Not** rendered on the public Track page | That surface is owner→customer, and it is reachable with only an order number. |
| 6 | Owner's group-buy customer workbook only, never the supplier workbook | A free-text note is exactly where an address or phone number ends up. |

## RED → GREEN

**RED** — `6ed3165`, test written before any implementation:

```
$ npm run test:order-note
Error: Cannot find module '../src/lib/orders/customer-note'
Require stack:
- scripts/test-order-note.ts
```

The failure is the intended missing implementation (the normalizer module the test newly
references), not unrelated breakage.

**GREEN** — `2fc38fd`:

```
$ npm run test:order-note
50 checks, 0 failure(s)
```

One assertion was corrected mid-cycle rather than the code: the test claimed
`csvCell('=HYPERLINK("http://evil","click")')` starts with `'=`. It does not — a value containing
quotes is also CSV-wrapped, so the formula guard lands at `"'=`. `csvCell` was already correct; the
expectation was wrong and was rewritten to assert the real contract (plus a quote-free case,
`csvCell("=1+1") === "'=1+1"`).

## Task report

| Task | Result | Validation |
|---|---|---|
| Pure normalizer `src/lib/orders/customer-note.ts` | done | `test:order-note` §1 |
| Schema column `StorefrontOrder.customerNote` | done | `test:order-note` §8 |
| `Order.customerNote` type | done | `tsc --noEmit` |
| Server action: normalize / row type / read / write | done | `test:order-note` §7 |
| `cleanPatch` refuses it | done | `test:order-note` §7 (negative) |
| Owner toggle + label in `checkoutRules` | done | `test:order-note` §2 |
| Checkout textarea, gated on the toggle | done | `test:order-note` §8 |
| Chat hand-off message | done | `test:order-note` §3 |
| Confirmation view-model + pasteable message | done | `test:order-note` §4 |
| Admin order detail (read-only card) | done | `test:order-note` §8 |
| Orders list 📝 flag | done | `test:order-note` §8 |
| CSV export column | done | `test:order-note` §5 |
| Group-buy round rows + customer workbook | done | `test:order-note` §6 |
| Track page stays clear of it | done | `test:order-note` §8 (negative) |
| CSS for all three surfaces | done | visual only — see *Gaps* |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A note is trimmed, coerced from non-strings, and capped at 500 chars with no ragged trailing space | `scripts/test-order-note.ts` §1 | unit | PASS |
| 2 | An absent/null/whitespace-only note is `""`, never `undefined` | §1 | unit | PASS |
| 3 | Newlines inside a note survive — a buyer's list stays a list | §1 | unit | PASS |
| 4 | The note box defaults ON; a non-boolean config falls back to the default rather than reading as off | §2 | unit | PASS |
| 5 | A blank or whitespace-only label falls back to the built-in copy; the owner's own label wins and is capped | §2 | unit | PASS |
| 6 | The chat message carries the note, after the shipping address, and prints no heading when there is none | §3 | unit | PASS |
| 7 | `buildOrderMessage` still works when the argument is omitted (legacy call sites) | §3 | unit | PASS |
| 8 | The confirmation view-model carries the note; the pasteable message includes it and omits the heading when blank | §4 | unit | PASS |
| 9 | Every export row still matches `ORDER_COLUMNS` length — no column drift | §5 | unit | PASS |
| 10 | `Customer Note` and `Shipping Note` are separate export columns | §5 | unit | PASS |
| 11 | A formula-shaped note is neutralized for Excel, quoted or not | §5 | unit | PASS |
| 12 | Group-buy round lines carry the note; a note-less line is `""` | §6 | unit | PASS |
| 13 | **PRIVACY:** the supplier workbook never references the note; the owner's customer workbook does | §6 | source | PASS |
| 14 | The server action normalizes via the shared helper and threads the column through row type, read and write | §7 | source | PASS |
| 15 | **`cleanPatch` refuses `customerNote`** — no path rewrites a customer's request after placement | §7 | source | PASS |
| 16 | The schema declares `customerNote String @default("")` on `storefront_orders` | §8 | source | PASS |
| 17 | Checkout renders the textarea, gates it on the owner's switch, and carries the value into the draft | §8 | source | PASS |
| 18 | The admin order detail shows the note **read-only** — no input bound to it | §8 | source | PASS |
| 19 | The orders list flags orders that have a note | §8 | source | PASS |
| 20 | **The public Track page does not republish the note** | §8 | source | PASS |

## Regression suites

```
$ npm run test:order-note          50 checks, 0 failure(s)
$ npm run test:data-export         38 passed, 0 failed
$ npm run test:order-confirmation  50 checks, 0 failure(s)
$ npm run test:order-detail        18 passed, 0 failed
$ npm run test:gb-report           36 passed, 0 failed
$ npm run test:order-trash         PASS — order trash verified
$ npm run test:cart                20 passed, 0 failed
$ npx tsc --noEmit --pretty false  (no output)
```

## Coverage and known gaps

There is no repo-wide coverage instrument — this project gates behaviour with per-feature `tsx`
scripts under `scripts/test-*.ts`, and this feature added one covering all fourteen touchpoints.
Honest gaps:

1. **`npm run db:push` has NOT been run.** The `customerNote` column exists in
   `prisma/schema.prisma` and in the generated client, but not in the live database. Deploying
   before pushing will produce `column "customerNote" does not exist`. This is the one blocking
   step left, and it is a production action left to the operator.
2. **No browser verification.** The checkout textarea, the amber list flag and the order-detail
   card were not opened in a browser; their CSS is asserted only by the source-level checks that
   the markup exists. Worth a look at `<tenant>.lvh.me:3100` before shipping.
3. **The admin order-alert email does not carry the note.** `emails/posthog/06-admin-order-alert.html`
   is unchanged — an owner who works from that email alone will not see the request until they open
   the order. Deliberately out of scope; a reasonable follow-up.
4. **Not tested end-to-end against a real DB.** The DB round-trip is asserted at the mapping
   layer (`orderToDbCreate` / `dbOrderToStorefront`) and by source assertions, not by placing a
   real order.

## Concurrent-session note

The working tree was shared with another active session building **reseller access**, which had
uncommitted edits in `src/actions/orders.ts`, `src/storefront/types.ts`, `prisma/schema.prisma`,
`src/storefront/admin/AdminOrders.tsx` and `src/storefront/storefront.css` — four of them files
this feature also touched. All three commits here are therefore **partial commits**, staged with a
line-level filtered patch (`git apply --cached`) so that only customer-note hunks were committed and
the other session's in-progress work was left in the tree untouched. Each commit was verified with
`git diff --cached | grep` for foreign markers before being made.

A `TS2448 config used before its declaration` error in `src/actions/orders.ts` appeared during this
work; it belonged to that session's `stampResellerOrder` code, not to this feature, and had been
fixed by them by the final typecheck.
