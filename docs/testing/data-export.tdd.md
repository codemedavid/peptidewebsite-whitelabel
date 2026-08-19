# Owner data export — TDD evidence

**Feature:** the store owner can export/download their products, customer data and
order history at any time — the concrete answer to *"if I ever decide not to
continue with Pepweb, can I take my data with me?"*

**Source plan:** none. Journeys were derived during this TDD run from the owner's
question (`/ecc:tdd-workflow`).

**Gate:** `npm run test:data-export` → `scripts/test-data-export.ts`

---

## User journeys

| # | Journey |
|---|---------|
| J1 | As an owner, I download my full product catalog as CSV, **one row per sellable option** (variations included), so another platform can import it. |
| J2 | As an owner, I download my customer list — deduplicated across repeat orders, with contact details, order counts and lifetime spend. |
| J3 | As an owner, I download my complete order history: one file of orders whose money reconciles with the admin, one of line items. |
| J4 | As an owner, I get the same data as machine-readable JSON so a developer can migrate it without parsing spreadsheets. |
| J5 | **Only the owner** can pull the export — a staff member with every module granted cannot walk out with the customer list. |
| J6 | The files are safe and lossless in Excel: addresses with commas, quotes and newlines survive, and no cell executes as a formula. |
| J7 | Nothing is silently dropped — trashed orders are exported too (flagged), and an empty store still yields header rows. |

---

## Task report

### 1. Pure export core — `src/lib/storefront/data-export.ts`

Shapes a tenant's catalog and order history into a five-file bundle. No DB, no
React, no browser, so the rules that are easy to break (money, dedupe, escaping)
are unit-testable.

- **RED:** `npm run test:data-export` → `Error: Cannot find module '../src/lib/storefront/data-export'` (compile-time RED; the reproducer newly references the missing implementation).
- **GREEN:** `npm run test:data-export` → `38 passed, 0 failed`.

Design decisions the tests pin:

- **Order totals reuse the shared `orderTotal()`** from `lib/storefront/admin-dashboard`, so an exported file can never disagree with the Orders screen. A second local sum would have been the obvious way to drift.
- **Products export one row per option.** A product with variations emits a row per variation carrying that option's own price, and its own stock when tracked (falling back to the base column, mirroring `effectiveStock`). One row per product would have thrown away the per-size prices the store actually sells at.
- **Customer identity is email → phone (punctuation stripped) → name.** Checkout does not require every field; a Messenger-first store has phone-only and name-only buyers, and without the fallback one person explodes into one "customer" per order.
- **Cancelled orders count toward the relationship, not the money.** They stay in `orders` (and get their own `cancelledOrders` column) but contribute no units and no spend — otherwise lifetime spend advertises revenue the store never took.
- **CSV injection guard applies to strings only.** `=`, `+`, `-`, `@`, tab and CR at the start of a *text* cell get an apostrophe prefix; a real negative *number* passes through untouched, because quoting it would corrupt the very totals the export exists to preserve.

### 2. Owner-only server action — `src/actions/storefront-export.ts`

`exportStoreDataAction()` guards with `requireStoreOwner()` and reads through the
existing tenant-scoped `listProductsAction` / `listStorefrontOrdersAction`,
inheriting the same `forTenant()`/RLS path rather than adding a second set of
queries. Trashed orders ride along flagged `Deleted` — an export taken on the way
out is the last chance to keep them.

Every other admin capability is delegable to staff; this one is deliberately not
a staff-grantable module, because "download the entire customer list in one
click" is the capability an owner would not hand to a part-time assistant.

- **Validation:** `npm run test:data-export` (wiring checks) — asserts the action guards with `requireStoreOwner()`, never falls back to `requireStaffPermission`, has no unscoped `prisma.*.findMany`, and calls the shared `buildDataExport`.

### 3. Admin panel + navigation

`AdminDataExport.tsx` ("Export My Data", Occasional group, `ownerOnly: true`)
downloads the prepared files. The panel does no data shaping of its own — the
action returns finished `{ filename, mime, content }` files.

- **Validation:** `npm run test:data-export` (wiring checks) + `npm run test:admin-dashboard` → `56 passed, 0 failed` (nav registry invariants, incl. "owner-only views never leak to staff").

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Commas, quotes and newlines are escaped, and an address round-trips byte-identical | `test-data-export.ts:an address with a comma round-trips back to the same string` | unit | PASS |
| 2 | A formula-looking text cell (`=`, `+`, `-`, `@`, `=cmd\|…`) is neutralized before Excel sees it | `…:a formula-looking cell is neutralized (CSV injection)` | unit | PASS |
| 3 | A negative **number** stays a number — the injection guard never corrupts money | `…:a negative NUMBER is still a number` | unit | PASS |
| 4 | `null`/`undefined` become empty cells, never the string "undefined" | `…:null and undefined become an empty cell` | unit | PASS |
| 5 | A product with variations exports one row per option, each with its own price | `…:a product with variations exports ONE ROW PER OPTION with its own price` | unit | PASS |
| 6 | An untracked option falls back to the product's stock | `…:an option with no stock of its own falls back to the product's stock` | unit | PASS |
| 7 | The exported order total equals `orderTotal()` (items − discount + shipping + fee) | `…:the exported total is the SAME number the admin shows` | unit | PASS |
| 8 | Discount, shipping and admin fee are broken out as their own columns | `…:discount, shipping and admin fee are broken out` | unit | PASS |
| 9 | Trashed orders are exported with `Deleted = Yes`, never omitted | `…:a trashed order is exported and FLAGGED` | unit | PASS |
| 10 | One row per order line, with its line total | `…:buildOrderItemRows emits one row per LINE` | unit | PASS |
| 11 | Repeat orders from one email collapse into one customer (case/space-insensitive) | `…:repeat orders from one email collapse into ONE customer`, `…:email matching ignores case` | unit | PASS |
| 12 | Lifetime spend excludes cancelled orders; the order count includes them | `…:lifetime spend sums the order totals and EXCLUDES cancelled orders` | unit | PASS |
| 13 | Phone- and name-only customers still merge; different people never merge | `…:a customer with no email is keyed on their phone, then their name`, `…:two different people are never merged` | unit | PASS |
| 14 | An unidentifiable customer is skipped, not exported as a blank row | `…:an order with no identifiable customer is skipped` | unit | PASS |
| 15 | The newest address and contact method win | `…:the customer's latest known address and contact method are kept` | unit | PASS |
| 16 | The bundle is five files, slugged and dated, each CSV led by its header | `…:the bundle ships products, orders, order items, customers and a JSON dump` + 2 more | unit | PASS |
| 17 | The JSON dump parses and mirrors the CSV counts | `…:the JSON dump parses and mirrors the CSVs` | unit | PASS |
| 18 | An empty store yields header-only files, never zero-byte ones | `…:an empty store still produces header-only files` | unit | PASS |
| 19 | A hostile product name cannot smuggle a formula into the bundle | `…:a hostile product name cannot smuggle a formula` | unit | PASS |
| 20 | The action is owner-only and tenant-scoped; export is not staff-grantable | `…:the export action exists and is OWNER-ONLY`, `…:is tenant-scoped`, `…:NOT a staff-grantable module` | structural | PASS |
| 21 | The sidebar entry is `ownerOnly` and AdminPage routes the view | `…:the sidebar registers Export My Data as owner-only`, `…:AdminPage routes the export view` | structural | PASS |

---

## Coverage and known gaps

- `npm run test:data-export` → **38 passed, 0 failed**. Every exported function in `data-export.ts` is exercised.
- `npx tsc --noEmit` → clean for this change. (Pre-existing, unrelated: stale `.next/types` entries for deleted `boutique-preview` routes.)
- Regression neighbours, all green: `test:staff` 51/51, `test:admin-dashboard` 56/56, `test:order-trash` PASS, `test:cart` 20/20, `test:reviews` 7/7.

Intentional gaps:

- **No E2E click-through.** The panel's download path (`Blob` → `<a download>`) is browser-only; the file *content* — the part that can be wrong — is fully covered by the pure core, and the wiring checks prove the panel calls the action.
- **No ZIP.** The five files download individually (staggered 350 ms, since browsers throttle synthetic download bursts). Adding a zip would mean a new dependency; worth revisiting if owners report the multi-file prompt as friction.
- **Store settings are not exported** (FAQ, protocols, COA, theme). The owner asked for products, customers and orders; config export is a separate, larger surface with its own redaction question (never ship hashes or access codes).
- **Images are exported as URLs, not files.** They point at ImageKit and stay reachable; a true archive would need a media bundle.

## Merge evidence

If these checkpoints are squashed, this is the record:

- **RED** — `d34452f test: add reproducer for owner data export` — `npm run test:data-export` → `MODULE_NOT_FOUND: src/lib/storefront/data-export`.
- **GREEN** — `24806ee feat(storefront): owner data export` — `npm run test:data-export` → `38 passed, 0 failed`.
- **Refactor** — column arrays widened from `as const` tuples to `readonly string[]` (consumers index them by name), folded into the GREEN commit after re-running the gate.
