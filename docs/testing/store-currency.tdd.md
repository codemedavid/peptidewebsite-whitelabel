# TDD evidence — the store currency

**Source plan:** none on disk. Journeys were derived during this TDD run from the
owner's request: *"add in the whitelabel the change currency so i can freely
change currency on any currency"* — i.e. a per-tenant, owner-switchable setting,
not a one-off stamp for a single Saudi tenant.

**Commits (all on `main`):**

| Stage | Commit | What it carries |
|---|---|---|
| Module | `9307fb0` | `feat: the owner picks the currency their shop trades in` |
| RED | `57e204a` | `test: reproducer for the currency sweep` |
| GREEN | `8cf2ee3` | `feat: a store's money prints in the store's currency` |

## User journeys

1. **As a shop owner outside the Philippines**, I want to pick the currency my
   shop trades in, so my prices read the way my customers expect.
2. **As a shop owner**, I want my store admin — dashboard, orders, analytics,
   order detail — to report my takings in *my* currency, so I am not mentally
   converting my own revenue.
3. **As a shopper**, I want the price to be legible, so I can tell
   `SAR 1,200` from a typo.
4. **As one of the ~30 tenants already live**, I want nothing to change, because
   I have never touched this setting.
5. **As the platform operator**, I want the SaaS fee a tenant pays me to stay in
   pesos, whatever currency their shop sells in.

## Task report

### 1. The setting itself — `src/lib/storefront/currency.ts`

A pure, JSON-safe module: `normalizeCurrency`, `formatMoney`,
`formatMoneyCents`, `resolveBrandCurrency`, and a 22-entry `CURRENCIES` registry.

Two rules carry the design, and both are asserted:

- **Fails safe to the peso.** Absent, empty, whitespace, or non-string config
  resolves to `₱`. This is what makes the change a no-op for every tenant alive.
- **The list is open.** An unregistered code (`ZMW`) or glyph (`₸`) is kept and
  formatted, marked `custom` — never silently swapped for pesos. A closed
  registry would make "any currency" a lie.

Spacing is *derived*, not stored: a symbol containing two or more consecutive
letters is spaced off its amount, a glyph hugs it. That single rule is what turns
`SAR1,200` into `SAR 1,200` while leaving `₱1,200` and `S$200` byte-identical.

```
RED:   npm run test:currency → MODULE_NOT_FOUND
GREEN: npm run test:currency → All currency checks passed. (52 checks)
```

### 2. The sweep — surfaces that print a tenant's money

The reproducer pinned two distinct defects.

**Defect A — surfaces blind to the setting.** `order-detail.ts`,
`lib/storefront/admin-dashboard.ts`, `AdminDashboard.tsx`, `AdminOrders.tsx` and
`AdminAnalytics.tsx` built money as `"₱" + n.toLocaleString()` and never looked
at the brand at all. `formatPHP` → `formatOrderMoney(n, currency?)`; private
`formatPeso` → exported `formatDashboardMoney(n, currency?)`; `buildMetricTiles`
gained an **optional** `currency` field so existing callers keep compiling and
keep printing pesos. `AdminOrders` and `AdminOrderDetail` already received the
`brand` prop and were discarding it with `void brand`.

**Defect B — the glue.** `formatGbMoney` and `optionLabel` did read
`brand.currency`, then concatenated it. Invisible while every store sold pesos;
renders `SAR1,200` the moment one doesn't. Both now route through `formatMoney`.

Also corrected: three demo paths in `src/actions/orders.ts` handed
`dbProductToStorefront` a literal `"₱"`, pinning a demo tenant to pesos however
its branding was configured — while the live path at `orders.ts:972` beside them
already read the setting.

```
RED:   npm run test:currency-surfaces → 10 currency-surface check(s) FAILED.
       (both glyph checks and all three boundary checks passed, so the gate
        discriminates rather than failing everything)
GREEN: npm run test:currency-surfaces → All currency-surface checks passed.
```

### 3. The boundary — what the sweep must NOT touch

Not every `₱` in this repo is the tenant's money. `lib/admin/plans.ts`,
`AdminBilling.tsx` and `components/admin/shell/primitives.tsx` price the SaaS
subscription the tenant pays the operator, which is pesos regardless of what
their shop sells. The gate asserts these **still** contain a hardcoded peso, so
over-sweeping fails loudly instead of silently repricing the operator's revenue.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Absent/empty/whitespace/non-string config resolves to the peso | `test-currency.ts` — "fails safe to the PESO" (7 checks) | unit | PASS |
| 2 | A currency resolves by ISO code or by symbol, either case, padded | `test-currency.ts` — "resolves a stored value however it was written" | unit | PASS |
| 3 | An unregistered code or glyph is kept and marked `custom`, not swapped for pesos | `test-currency.ts` — "an unregistered currency still works" | unit | PASS |
| 4 | Peso output is byte-identical to the strings the admin printed before | `test-currency.ts` — "the peso is unchanged" | unit | PASS |
| 5 | A word-like code is spaced from its digits; a glyph hugs them | `test-currency.ts` — "a multi-character code is spaced" | unit | PASS |
| 6 | NaN/undefined/Infinity print as zero, never "NaN", to a customer | `test-currency.ts` — "the awkward inputs" | unit | PASS |
| 7 | Zero-decimal currencies (JPY) drop the minor unit; Gulf dinars model 3 | `test-currency.ts` — registry + `formatMoney(1200,"JPY")==="¥1,200"` | unit | PASS |
| 8 | The brand's currency beats a stale symbol captured on a product row | `test-currency.ts` — "the brand is the authority" | unit | PASS |
| 9 | Group-buy prices and variation pills space a word-like code | `test-currency-surfaces.ts` — "never glues to the digits" | unit | PASS |
| 10 | Order detail and the dashboard can be asked for a currency, and default to peso | `test-currency-surfaces.ts` — "can be asked for a currency" | unit | PASS |
| 11 | No store-admin surface spells the peso in executable code | `test-currency-surfaces.ts` — structural scan of 5 files | structural | PASS |
| 12 | Order actions do not force the peso onto product rows | `test-currency-surfaces.ts` — regex on `dbProductToStorefront` | structural | PASS |
| 13 | The operator's SaaS billing still prices in pesos | `test-currency-surfaces.ts` — boundary scan of 3 files | structural | PASS |
| 14 | Order-detail money formats in the store's currency, peso by default | `test-order-detail.ts` (18/18) | unit | PASS |

**Regression sweep:** 34 related gates run, 0 failures — including
`test:group-buy-page`, whose pre-existing `formatGbMoney("₱",1200)==="₱1,200"`
and `("$",560)==="$560"` assertions are the compatibility proof that the spacing
rule left glyph output untouched.

```
npx tsc --noEmit --pretty false   → 0 errors
```

## Coverage and known gaps

There is no coverage instrument for these standalone `tsx` gates (the repo has no
Jest/Vitest for them), so no percentage is claimed. Coverage is by enumerated
guarantee, above.

Deliberately **out of scope**, and still peso:

- **Platform / SaaS billing** — `lib/admin/plans.ts`, `AdminBilling.tsx`,
  `components/admin/**`, Income/MRR views, `lib/subscription/**`. This is the
  operator's revenue, not the tenant's. Asserted by the boundary checks.
- **Marketing + onboarding** — `src/marketing/**`, `lib/onboarding/pricing.ts`,
  the get-started wizard. These price the subscription being sold.
- **Demo catalog fixtures** — `src/storefront/data.ts` seeds peso-priced sample
  products. The demo store is a peso store by definition.
- **Comments and doc examples** that mention `₱` are untouched by design; the
  structural scan strips comments before looking, so it stays a gate about
  behavior rather than prose.

**Not yet built (follow-on work):**

1. **The owner-facing picker.** `branding.config.currency` is read everywhere but
   there is no store-admin screen to write it, and no `saveCurrencyAction`. Until
   that ships the setting is operator-set only. It should also sync
   `StoreSettings.currency` and re-stamp `Product.currency` /
   `metadata.currencySymbol` so no row keeps a stale symbol.
2. **`src/lib/onboarding/mapping.ts:36`** still has `const CURRENCY_SYMBOL = "₱"`,
   so a tenant provisioned through onboarding is stamped peso regardless of the
   currency chosen. Needs to become a parameter defaulting to `₱`.
3. **No schema change is required** for any of this: `Product.currency`,
   `Order.currency` and `StoreSettings.currency` already exist in
   `prisma/schema.prisma`.
