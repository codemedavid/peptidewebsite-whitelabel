# TDD evidence — per-tenant Telegram order bot

**Source plan:** inline `/ecc:plan` output in-session (no `*.plan.md` artifact).
**Branch:** `feat/made-to-order` · **Commits:** `7fe7280` (RED) → `0a498d3` (GREEN) → operator-only move (below)

## User journeys

1. As a store owner, I want an alert the moment someone orders, in the app I
   already have open all day, so I stop refreshing the admin. (Setup itself is
   done FOR them by the operator — see "Where setup lives" below.)
2. As that owner, I want to **confirm** the order from the chat, so a customer
   isn't waiting while I find a laptop.
3. As that owner, I want the bot to be **mine** — my store's name on it — not a
   platform bot every tenant shares.
4. As that owner, I want to choose **exactly who** hears about orders and who may
   confirm them, so a packer can see work without being able to approve payment.
5. As a buyer, I don't want my name, phone and home address broadcast into a
   staff group chat I never agreed to.
6. As the operator, I want to grant this per tenant without moving plan ceilings.

## Where setup lives

Setup is **super-admin only**, on `/tenants/<slug>/integrations`, beside the
tenant's PostHog credentials. It is not a store-owner screen and the storefront
admin has no Telegram surface at all — asserted three ways (no `MODULE_FEATURE`
entry, no sidebar item, no registered view) so it cannot creep back in through
any one of them.

The reason is what the credential is: a bot token can read every message the bot
receives and post as the store, and saving one registers a webhook pointing a
third party at this deployment. That is operator infrastructure, not a per-store
preference. `notify.telegram` still gates whether a tenant's orders dispatch at
all, so the operator grants the feature and does the setup in the same console.

## The two load-bearing design decisions

**Authorization is a row, never a chat.** Receiving a button press proves only
that someone can see a chat the bot posts in — group members, forwarded
messages, anyone who guesses a callback payload. So the press is checked against
a linked `TelegramRecipient` naming that numeric Telegram user id and carrying
`canConfirm`. A group row stores `telegramUserId: null`, and a naive
`row.id === press.id` would match null to null and hand confirm rights to
everybody. That hole is closed explicitly in `findConfirmer` and tested four ways.

**The bot is not a second order engine.** Confirming is not a status write: it
deducts inventory, appends to the fulfilment journey and triggers the customer's
status email. `actions/orders.ts` is `"use server"`, so every export must be an
async action and nothing inside it could be shared with a route handler — which
is why the confirm path could so easily have become a second, drifting
implementation. Instead the transaction was extracted to
`lib/orders/apply-status.ts` and both doors call it.

## Task report

| # | Task | Command run | Result |
|---|------|-------------|--------|
| 1 | Write the gate before any implementation | `npm run test:telegram` | **RED** — `Error: Cannot find module '../src/lib/integrations/telegram-message'` |
| 2 | Five pure cores (message, update, authz, pairing, dedupe) | `npm run test:telegram` | first 88 checks green |
| 3 | Extract row↔Order mapping out of the `"use server"` module | `npx tsc --noEmit` | clean |
| 4 | Extract the status transaction into a shared, actor-agnostic engine | `npm run test:telegram` | wiring checks green |
| 5 | Webhook route, credential store, dispatch, owner panel, gating | `npm run test:telegram` | **GREEN — 124 checks, 0 failures** |
| 6 | Confirm the refactor broke no existing suite | 9 existing gates | 7 pass, 2 repointed, 2 pre-existing failures (below) |

### RED evidence
```
$ npm run test:telegram
Error: Cannot find module '../src/lib/integrations/telegram-message'
Require stack:
- scripts/test-telegram.ts
```
Compile-time RED: the gate newly references the five cores that do not exist.

### GREEN evidence
```
$ npm run test:telegram
124 checks, 0 failure(s)

$ npx tsc --noEmit          # clean (see "Known gaps" for one unrelated file)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The chat total equals `orderTotal()` — the number the email and admin show | `test-telegram.ts` "the printed total is orderTotal()" | unit | PASS |
| 2 | A buyer's `<b>`/`<script>` is escaped, so one bracket in a name can't make Telegram reject every alert | "a buyer's angle brackets are escaped" | unit | PASS |
| 3 | With customer details off, the alert keeps order/items/total and drops name, phone, email and street | 8 checks under "customer details are a per-recipient decision" | unit | PASS |
| 4 | `callback_data` stays inside Telegram's 64-byte limit, and an over-long id yields **no button** rather than a truncated (different) order id | "the 64-byte budget Telegram enforces" | unit | PASS |
| 5 | Arbitrary JSON — null, a string, `{}`, a callback with no sender — lands on `ignore`, never on an action | 4 + 2 checks | unit | PASS |
| 6 | A linked user with `canConfirm` is authorized; one without it, an unlinked stranger, and an empty roster are all refused | `findConfirmer` block | unit | PASS |
| 7 | **A null user id never matches a null, blank, or `"null"` presser** | 3 checks | unit | PASS |
| 8 | Ids compare as opaque strings — `"0555"` is not `"555"` | "ids are compared as strings" | unit | PASS |
| 9 | A blank webhook secret fails closed rather than matching everything | `verifyWebhookSecret` block | unit | PASS |
| 10 | A pairing code is single-use and expires; a replayed or stale code is refused | `pairingUsable` block | unit | PASS |
| 11 | Codes are stored hashed, normalize case-insensitively, and don't collide in 500 draws | pairing block | unit | PASS |
| 12 | A redelivered update is handled once, with bounded memory | `makeUpdateDeduper` block | unit | PASS |
| 13 | **A double confirm deducts stock once and appends one journey event** | "idempotency — a double press deducts once" | unit | PASS |
| 14 | The alert rides `after()` inside the `created` branch — an idempotent checkout retry never re-alerts, and a bot failure never breaks checkout | wiring checks on `actions/orders.ts` | source | PASS |
| 15 | The webhook confirms through the shared engine and never issues its own `storefrontOrder.updateMany` | wiring check on the route | source | PASS |
| 16 | The shared engine carries no cookie/session guard — it is actor-agnostic by construction | wiring check on `apply-status.ts` | source | PASS |
| 17 | The bot token is sealed with the envelope and no read path returns it to the client | wiring checks on store + actions | source | PASS |
| 18 | Every Telegram action is owner-only (staff can never redirect alerts to themselves) | wiring check on `actions/telegram.ts` | source | PASS |
| 19 | A chat can only be linked once per tenant; the pairing code column is `codeHash`, never plaintext | schema checks | source | PASS |

## Regression sweep

Ran after the extraction, since it moved code out of `actions/orders.ts`:

| Gate | Result |
|---|---|
| `test:cart`, `test:checkout-names`, `test:gb-report`, `test:two-ways-cart`, `test:variant-inventory` | PASS |
| `test:staff`, `test:plan-status`, `test:admin-dashboard`, `test:gb-rounds`, `test:two-ways-mode`, `test:store-status`, `test:currency`, `test:reseller-gate` | PASS |
| `test:plan-feature-config`, `test:feature-disclosure`, `test:mcp-features`, `test:reseller-feature-tree`, `test:coa-protocols` | PASS |
| `test:order-note`, `test:order-trash` | PASS **after repointing** — both assert on the mapping layer's *source text*, which moved to `lib/orders/db-mapping.ts`. The greps now read `actions/orders.ts + db-mapping.ts` as one source; **no assertion was weakened**. |

## Coverage and known gaps

This repo has no coverage instrumentation (no Jest/Vitest); the convention is a
self-contained `scripts/test-*.ts` gate per feature, and `npm run test:telegram`
is this feature's. Every pure module introduced here is exercised by it.

Deliberately **not** covered by the gate, and why:

- **The Bot API client** (`telegram.ts`) is I/O against api.telegram.org. It is
  kept dependency-light and total (5s timeout, never throws) rather than mocked.
- **The webhook's DB paths** need Postgres, so they are asserted at source level
  (that the route verifies the secret, authorizes via `findConfirmer`, dedupes,
  and confirms through the shared engine) rather than executed.
- **Live delivery is untested end-to-end.** Telegram cannot reach `lvh.me:3100`,
  so a webhook cannot be exercised locally without a tunnel. This is the one
  known gap that matters; see below.

### Two pre-existing failures, not caused by this work

- `scripts/test-business-package.ts` — asserts `PLAN_FEATURES.pro` is exactly 36
  keys. This change adds 7 lines, all inside `OPERATOR_GRANTABLE`, which does not
  feed `PLAN_FEATURES`; the `pro` set is byte-identical to its committed version.
- `npm run test:legacy-import` — "parses all 487 historical orders → 0". The dump
  in the repo root contains no `COPY public.orders` block at all (only `auth.*`
  tables), so the parser has nothing to read. Data drift, not code.
- `npx tsc` also reports errors in `scripts/test-tenant-lookup.ts`, which is
  another session's in-flight RED (commit `485667f`, landed on this branch
  mid-task). Left untouched.

## Remaining step before this can run in production

`npm run db:push` — `TelegramRecipient` and `TelegramPairing` are new models and
this project has no migrations. The change is additive (two new tables, no
column changes), but it touches the live database, so it is left for the
operator to run deliberately.

`ENCRYPTION_KEY` must also be set in the deployment environment; it already is
for PostHog, and the same key seals the bot token.
