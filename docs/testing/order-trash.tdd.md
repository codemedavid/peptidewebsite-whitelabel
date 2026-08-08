# TDD evidence — order trash (recover or delete permanently)

**Source plan**: inline `/ecc:plan` output, 2026-08-08 (not written to a file).
**Feature**: deleting a storefront order soft-deletes it into a Trash view the
owner can restore from, or empty for good.
**Commits**: `f068ec8` (RED reproducer) → `3cf8fdc` (GREEN implementation).

## The problem

`deleteStorefrontOrdersAction` issued a hard `deleteMany`, and the Orders screen
placed **Delete All Orders** one button along from **Delete Selected**. One
mis-click took a tenant's sales history with it, with no way back.

## User journeys

1. As a store owner who deleted the wrong order, I want to find it in a Trash
   view and put it back exactly as it was, so a mis-click costs me nothing.
2. As a store owner clearing out test orders, I want to empty the trash
   deliberately, so old rows do not accumulate forever.
3. As a store owner, I want a deleted order to disappear from my revenue,
   reports and counts immediately — the same as before — so the trash is not a
   place where deleted orders quietly keep counting.
4. As a staff member with the `orders` grant, I want to delete and restore
   orders, but I should not be able to make a deletion permanent.
5. As a customer who was given an order number, I should get the same "not
   found" answer for a deleted order that a hard delete always gave me.

## Task report

### Task 1 — the shared rules module (`src/lib/orders/trash.ts`)

One definition of "trashed", spread by every caller: two Prisma where-fragments,
an `isTrashed` predicate, and `activeOrders` / `trashedOrders` for the in-memory
lists demo mode and the admin client hold.

- **Validation**: `npm run test:order-trash`
- **RED**: `Error: Cannot find module '../src/lib/orders/trash'` — the gate could
  not even load before the module existed.
- **GREEN**: all 63 checks pass.
- **Guaranteed**: the scope fails safe to `active` on any unrecognised input;
  `deletedAt` junk (empty string, whitespace, number, boolean, unparseable text,
  Invalid Date) reads as **not** trashed; the partition helpers never mutate or
  alias their input.

The two halves fail safe in opposite directions on purpose. An unrecognised
scope resolving to `trash` would look like the delete silently failed; junk
`deletedAt` resolving to trashed would hide a live order from the owner's books,
which is the failure that looks like data loss.

### Task 2 — the eleven reads a hard DELETE used to keep correct for free

This is where the risk of a soft delete actually lives, and the reads are spread
across five files nobody edits together.

| Read | File | Treatment |
|---|---|---|
| Admin Orders list | `actions/orders.ts` | scoped (`active` default) |
| Customer Track lookup | `actions/orders.ts` | filtered — trashed reads as not found |
| Single status update (read + write + re-read) | `actions/orders.ts` | filtered |
| Bulk status change (read + write + re-read) | `actions/orders.ts` | filtered |
| `clientId` idempotency probes (×2) | `actions/orders.ts` | **deliberately unfiltered**, marked `trash-exempt` |
| Group-buy supplier report | `actions/group-buys.ts` | filtered |
| Group-buy round candidates | `actions/group-buys.ts` | filtered |
| Group-buy banner fill count | `(storefront)/page.tsx` | filtered |
| Best-seller counts | `(storefront)/page.tsx` | filtered |
| Operator tenant revenue/counts | `lib/admin/data.ts` | filtered |
| Operator recent-orders feed | `lib/admin/data.ts` | filtered |
| Operator tenant detail | `lib/admin/data.ts` | filtered |

- **Validation**: `npm run test:order-trash` — the gate paren-matches every
  `storefrontOrder.findMany|findFirst|count|updateMany|deleteMany` call in those
  files and proves each carries the filter or a `trash-exempt` marker written on
  the query line itself.
- **RED**: `8 unfiltered read(s)`, `0/2 filtered` (group-buys), `0/2` (home),
  `0/3` (operator console).
- **GREEN**: every audit passes, with the exemption count pinned at exactly two.

The exemptions are capped at two so a future contributor cannot quietly excuse a
third. They exist because `@@unique([tenantId, clientId])` still counts a trashed
row: filtering there would turn a checkout retry into a constraint error on a
draft the buyer already paid for.

### Task 3 — trash / restore / purge

- **Validation**: `npm run test:order-trash`
- **RED**: all nine action checks failed — the actions did not exist.
- **GREEN**: all pass.
- **Guaranteed**:
  - purge is scoped to `TRASHED_ORDERS_WHERE`, so no id list, however crafted or
    stale, reaches a live order through the permanent-delete path;
  - purge requires `actor.kind === "owner"` — staff may delete and restore, but
    a trash the same hand can empty is not a safety net;
  - none of the three reference `applyOrderStockMove`, `adjustProductStock` or
    `planStatusChange`, so the trip through the trash never moves stock. A hard
    delete never restocked either: the goods left the shelf at confirmation.

### Task 4 — the column, the mapper, the type, the screen

- **GREEN**: `storefront_orders.deletedAt DateTime?` plus
  `@@index([tenantId, deletedAt])`; `deletedAt` mapped from the DB **row** only,
  never through `normalizeOrderInput` — the same discipline `imported` follows,
  because a buyer able to set it would place orders invisible to the owner.
- The Orders screen gains an Orders/Trash tab pair with counts, "Move to Trash"
  in place of "Delete Selected", per-row and bulk Restore, and an Empty Trash
  that requires typing `DELETE` rather than accepting a reflex OK.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An unrecognised scope resolves to the active list, never the trash | `test-order-trash.ts` — "fails safe to active" | unit | PASS |
| 2 | Junk in `deletedAt` leaves an order visible | `test-order-trash.ts` — "only a real timestamp counts" | unit | PASS |
| 3 | The partition helpers preserve order and never mutate their input | `test-order-trash.ts` — "activeOrders / trashedOrders" | unit | PASS |
| 4 | Every storefront_orders read filters or is an audited exemption | `test-order-trash.ts` — source audit, 5 files | static | PASS |
| 5 | Exactly two reads are exempt (the idempotency probes) | `test-order-trash.ts` — exemption cap | static | PASS |
| 6 | Permanent delete can only remove rows already trashed | `test-order-trash.ts` — purge scope | static | PASS |
| 7 | Only the owner can empty the trash | `test-order-trash.ts` — owner gate | static | PASS |
| 8 | Trash, restore and purge never move stock | `test-order-trash.ts` — inventory checks ×3 | static | PASS |
| 9 | Demo mode applies the same rule as the SQL path | `test-order-trash.ts` — demo parity | static | PASS |
| 10 | `deletedAt` comes from the row, never from checkout input | `test-order-trash.ts` — row mapper | static | PASS |

## Commands actually run

```
npm run test:order-trash        PASS — order trash verified (63 checks, 0 failed)
npx tsc --noEmit --pretty false exit 0

Regression, 9/9 PASS:
  test:store-status          PASS — store open/closed switch verified
  test:bulk-order-status     PASS — 27 passed, 0 failed
  test:order-detail          17 passed, 0 failed
  test:gb-report-orders      22 passed, 0 failed
  test:gb-report             12 passed, 0 failed
  test:admin-dashboard       56 passed, 0 failed
  test:staff                 PASS — 51 passed, 0 failed
  test:order-confirmation    50 checks, 0 failure(s)
  test:isolation             ISOLATION HOLDS — tenant data does not cross
```

## Known gaps

- **`npm run build` was not run.** A dev server was live on port 3100, and a
  concurrent build clobbers `.next/` and takes that server down with
  server-wide 500s. `tsc --noEmit` covers the compile check; the build should be
  run once the dev server is stopped.
- **`npm run db:push` has not been run.** The column does not exist on any live
  database yet, so the feature will throw "column does not exist" until it is.
  Deferred rather than run because this repo has several *other* schema changes
  pending push, and `db:push` would apply all of them at once — a decision for
  the operator, not a side effect of this work.
- **`test:legacy-import` fails one check** — "parses all 487 historical orders"
  (`0 == 487`). Pre-existing and unrelated: it parses a local dump this change
  never touches, and `src/lib/orders/legacy-import.ts` is unmodified.
- **No retention timer.** Trash holds orders until someone empties it. An
  auto-purge would need a per-tenant scheduler this repo does not have.
- **No E2E coverage.** The repo has no Playwright suite; the source audit is the
  standing guard against a future unfiltered read.
