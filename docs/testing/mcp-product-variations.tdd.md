# TDD evidence — MCP connector can add product variations

**Date:** 2026-08-29
**Commits:** `3e588cf` (RED) → `b1a5070` (GREEN)
**Gate:** `npm run test:mcp-variations` (`scripts/test-mcp-variations.ts`)
**Source plan:** none on disk — journeys were derived during this TDD run from a
read of the existing MCP surface (`src/app/api/mcp/route.ts`) and the variation
save path.

## The ask

> allow chatgpt mcp to add tenant product variation

## What was actually wrong

Two independent holes, both found by reading the code before writing any test.

### 1. There was no way to ADD one option

The connector's only route to a variation was `update_products`. Its patch
semantics are whole-field replacement — `mergeProductPatch` does
`{ ...current, ...cleanPatch }` — so `patch.variations` **replaces the entire
option list**. An agent asked to "add a 10mg at ₱1,800" cannot see the options a
product already has, so the only call it can make is the one that deletes them.
On `mstomato`, whose products carry 81 colorways each, one well-meant
`variations: [{ 10mg }]` would have wiped 80 of them with no error and a success
report.

### 2. Per-variation photos never reached the database — on any surface

`normalizeProductInput` rebuilt each variation as `{name, price, stock?, gbPrice?}`
and dropped `image`. The MCP schema advertised the key, `cleanVariations`
persisted it, and the card's swipe gallery read it — but this one coercion step
sits between the payload and `productToDbWrite` on **both** the store-admin
editor's save path (`src/actions/products.ts:162`) and the connector's, so no
per-variation photo had ever survived a save from either. The previous session's
gallery work tested `cleanVariations` directly and so stepped over the gap.

## User journeys

1. As a platform operator, I want to tell ChatGPT "add a 10mg option at ₱1,800 to
   this product" and have it added *alongside* the existing options, because I do
   not have the list it would otherwise ask me to re-send.
2. As an operator, I want to correct one option's price or stock by name, so a
   typo does not mean rebuilding the whole picker.
3. As an operator, I want to give an option its own photo, so the card's swipe
   gallery shows the colorway the customer is buying.
4. As an operator, I want to remove an option that is gone for good without
   touching the rest.
5. As an operator, I want a genuine fresh start to be possible, but only when I
   ask for it by name — never something the model falls into.
6. As an operator, I must never end up with an option the storefront sells for ₱0
   because I forgot a price.
7. As an operator, a batch with one bad row must apply nothing: a picker
   half-rebuilt and reported as success is worse than an error, because nothing on
   the other end can look at the storefront to notice.

## Task report

| Task | Execution summary | Validation | Result |
|---|---|---|---|
| Reproduce both defects | `scripts/test-mcp-variations.ts` imports a `variation-plan` module that does not exist, and asserts the image round-trip through `normalizeProductInput` | `npx tsx scripts/test-mcp-variations.ts` | **RED** |
| Prove defect 2 against shipped code | Direct probe of `normalizeProductInput` with a hosted variation image | `npx tsx -e '…'` | **RED** |
| Pure decision core | `src/lib/storefront/variation-plan.ts` — `buildVariationPlan(existing, {mode, variations, remove})` | `npm run test:mcp-variations` | **GREEN** |
| Fix the image drop | `normalizeProductInput` now carries `image` through `normalizeHostedImageUrl` | `npm run test:mcp-variations` | **GREEN** |
| Expose the tool | `manage_product_variations` schema + handler, registered in `tools/list`, `tools/call`, and the server instructions | `npm run test:mcp-variations` | **GREEN** |
| No regressions | Typecheck + 14 neighbouring suites | `npx tsc --noEmit`, `npm run test:*` | **PASS** |

### RED evidence

```
$ npx tsx scripts/test-mcp-variations.ts
Error: Cannot find module '../src/lib/storefront/variation-plan'
  code: 'MODULE_NOT_FOUND'
```

```
$ npx tsx -e 'normalizeProductInput({… variations:[{name:"Roseberry",price:650,image:"https://ik.imagekit.io/pepweb/roseberry.jpg"}]})'
variations out: [{"name":"Roseberry","price":650}]
RED: image dropped by normalizeProductInput
```

### GREEN evidence

```
$ npm run test:mcp-variations
Journey 1 — adding an option leaves every other option alone
  ok    an add call succeeds
  ok    the new option is appended last
  …
Journey 8 — the schema, the core and the route agree
  ok    the tool declares add/replace/remove

All MCP product variation checks passed
```

```
$ npx tsx -e 'normalizeProductInput(… same input …)'
[{"name":"Roseberry","price":650,"image":"https://ik.imagekit.io/pepweb/roseberry.jpg"}]
```

```
$ npx tsc --noEmit --pretty false   # exit 0
```

## What shipped

`manage_product_variations` — a tool of its own rather than a mode on
`update_products`, so the connector reaches for it on the operator's own wording
and never has to touch the wholesale-replace path to edit an option.

| Mode | Behaviour |
|---|---|
| `add` (default) | Adds the options it names; a name the product already has is **patched in place**, keeping its position and every field the call left out. |
| `replace` | Installs exactly the list sent. The only mode that deletes options nobody mentioned, so the tool description tells the model to use it only on an explicit request. |
| `remove` | Drops named options; a name the product does not have refuses the whole call. |

Option photos may be sent as a hosted `image` URL or uploaded via `imageAsset`
(public URL / data URL / raw base64, through the same ImageKit path as product
images). Uploads resolve **before** the plan runs, so a failed upload refuses the
call rather than saving a half-photographed picker.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Adding an option appends it and leaves every other option's price, stock, photo and group price untouched | `test-mcp-variations.ts` Journey 1 | unit | PASS |
| 2 | The first option on a product that had none is accepted | Journey 1 | unit | PASS |
| 3 | Naming an existing option patches it in place and keeps its position in the picker | Journey 2 | unit | PASS |
| 4 | Options match case-insensitively, but the store's own spelling is what is saved and reported back | Journey 2 | unit | PASS |
| 5 | `stock: 0` is honoured as a real value; `stock: null` returns the option to shared base stock | Journey 2 | unit | PASS |
| 6 | A per-option photo survives `normalizeProductInput → productToDbWrite → dbProductToStorefront` | Journey 3 | integration | PASS |
| 7 | A non-http(s) option photo is dropped on save, and refused loudly at the connector boundary | Journey 3 | unit | PASS |
| 8 | `image: null` clears an option's photo | Journey 3 | unit | PASS |
| 9 | Removing an option leaves the rest intact; removing all of them empties the picker | Journey 4 | unit | PASS |
| 10 | `replace` installs exactly the sent list and reports what it displaced | Journey 5 | unit | PASS |
| 11 | A new option with no price, a blank price, `0`, or a negative price is refused — never coerced to a free checkout | Journey 6 | unit | PASS |
| 12 | A nameless option, a duplicate name, an empty call, an unknown mode, or a list past `MAX_VARIATIONS` is refused | Journey 6 | unit | PASS |
| 13 | One bad row in a batch applies nothing at all | Journey 6 | unit | PASS |
| 14 | Removing a name the product does not have refuses the whole call and names it back | Journey 7 | unit | PASS |
| 15 | The tool is registered in `tools/list`, dispatched in `tools/call`, named `manage_product_variations`, declares all three modes, and the server instructions point the model at it | Journey 8 | integration | PASS |

## Coverage and known gaps

The repo's convention for this area is per-feature `tsx` gate scripts rather than
a coverage-instrumented runner, so there is no percentage to quote. What that
leaves untested is stated plainly:

- **No live-tenant write was performed.** `callManageProductVariations` talks to
  a real store, and exercising it end to end would mutate production data. Its
  DB shell (tenant lookup, product match, ImageKit upload, `product.update`,
  `revalidateTenant`) is asserted structurally by Journey 8 and by reuse of the
  same helpers `callUpdateProducts` already uses in production; the decision it
  wraps is covered exhaustively by Journeys 1–7.
- **`gbPrice` on a non-group-buy product** is still stripped on read and write by
  `cleanVariations(…, keepGbPrice)`. That is pre-existing, deliberate, and
  covered by `npm run test:variation-gb-pricing`.
- **Renaming an option** is not supported. It was considered and dropped as
  YAGNI — the ask was to add. Today a rename is a `remove` plus an `add`.

Regression surface re-run and green: `test:mcp-features`, `test:mcp-auth`,
`test:mcp-images`, `test:product-variations`, `test:product-add-gates`,
`test:variation-gallery`, `test:variation-collapse`, `test:variation-price-reveal`,
`test:variation-gb-pricing`, `test:variant-inventory`, `test:product-detail`,
`test:cart`, `test:sale-price`, `test:reseller-gate`, plus `tsc --noEmit`.

## Merge evidence

If `3e588cf` and `b1a5070` are squashed, this is the record:

- **RED** — `npx tsx scripts/test-mcp-variations.ts` failed on the missing
  `variation-plan` module, and a direct probe showed `normalizeProductInput`
  returning `[{"name":"Roseberry","price":650}]` for an input that carried an
  `image`. No production file was edited before both failures were observed.
- **GREEN** — after adding `variation-plan.ts`, the `image` round-trip in
  `product-input.ts`, and the `manage_product_variations` tool, the same command
  passes every check, `tsc --noEmit` exits 0, and 14 neighbouring suites still pass.
- **Refactor** — one correction made under green: `added`/`updated` originally
  echoed the caller's spelling of an option name; they now report the name the
  store holds, since the operator reads that line back to confirm what moved.
