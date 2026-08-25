# MCP feature management — TDD evidence

**Task:** allow the ChatGPT MCP connector to turn tenant features on or off.
**Source plan:** none — journeys were written during this TDD run (Step 1).
**Gate:** `npm run test:mcp-features` (`scripts/test-mcp-features.ts`).

## What was missing

The connector could create a tenant, restyle it (`update_whitelabel_branding`)
and stock its catalog, but it had no read or write path for entitlements. Every
"switch group buys on for k-glow" still meant the operator opening
admin → tenants → Features by hand — the one thing the connector exists to avoid.

## User journeys

1. As a platform operator, I want to tell ChatGPT "turn on the group buy module
   for k-glow" so a tenant gets a feature without me opening the admin UI.
2. As an operator, I want to name features the way I say them ("group buy
   system", "Product reviews") and have the connector resolve them to keys.
3. As an operator, I want a label two modules share ("Excel export") refused with
   both candidates named, so the wrong module is never toggled.
4. As an operator, I want an unknown/mistyped feature refused with nothing
   written, rather than a silent no-op reported as success.
5. As an operator, I want a feature outside the tenant's package refused, naming
   the plan it needs — the connector must never grant beyond the plan.
6. As an operator, I want an already-on feature reported as unchanged, not as a
   change that never happened.
7. As an operator, I want a toggle back to the plan default to DROP the override
   row, not persist a redundant one.
8. As an operator, I want contradictory instructions (same feature in enable and
   disable) refused.
9. As an operator, I want an empty call refused, not reported as success.
10. As an operator, I want a warning when a switch would be inert (a slice
    without its module; a master switch turned off under live children).
11. As an operator, I want to ask what is on for a tenant and get the same sheet
    the admin Features panel shows.
12. As a maintainer, I want the tool schemas, the pure core and the route to
    agree, so the connector cannot advertise something the core refuses.

## Task report

| Task | Execution | Validation | Result |
|---|---|---|---|
| Reproducer | Wrote `scripts/test-mcp-features.ts` covering journeys 1–12 | `npm run test:mcp-features` | **RED** — `Cannot find module '../src/lib/tenant/feature-toggle'` (implementation absent, not a harness fault) |
| Pure core | `src/lib/tenant/feature-toggle.ts` — name resolution, ceiling enforcement, all-or-nothing batch, plan-default flagging, inert warnings, grouped inventory | `npm run test:mcp-features` | **GREEN** — 180 checks, 0 failures |
| Shared writer | `src/lib/tenant/feature-write.ts` — `ensureFeatureRegistered` + `applyFeatureWrites`, lifted out of `setTenantFeatureAction` so the admin editor and the connector write through one path | `npx tsc --noEmit` | exit 0 |
| MCP shell | `src/lib/mcp/feature-tool.ts` — `list_whitelabel_features` (read) + `set_whitelabel_features` (write, with `dryRun`) | live JSON-RPC, below | applied + reverted cleanly |
| Route wiring | `src/app/api/mcp/route.ts` — both tools in `tools/list`, dispatched behind `requireMcpAuth`, server instructions updated, serverInfo → 1.3.0 | `tools/list` over HTTP | 7 tools advertised |

### RED evidence

```
$ npm run test:mcp-features
Error: Cannot find module '../src/lib/tenant/feature-toggle'
Require stack:
- scripts/test-mcp-features.ts
```

### GREEN evidence

```
$ npm run test:mcp-features
  ... 180 ok
All MCP feature management checks passed
```

Two assertions in the reproducer were wrong about the repo's own contract and
were corrected before implementing (recorded here rather than hidden):
the tenant argument is `tenantSlug` (matching the other MCP tools, not `slug`),
and `storefront.sales_analytics.export_pdf` is already in the Starter ceiling —
so the inert-warning journey starts from a tenant whose operator revoked it.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A named module resolves to one planned change carrying its label and plan-default flag | `test-mcp-features.ts` §1 | unit | PASS |
| 2 | Catalog keys, constant names (`GB_MODULE`) and human labels all resolve | §2 | unit | PASS |
| 3 | A label shared by two modules is refused, naming both exact keys | §3 | unit | PASS |
| 4 | An unknown key, a non-string entry, or a bare string instead of a list refuses the WHOLE batch | §4 | unit | PASS |
| 5 | A plan-locked feature is refused naming the required plan; every `OPERATOR_GRANTABLE` key stays reachable on Starter | §5 | unit | PASS |
| 6 | Already in the requested state → `unchanged`, no write | §6 | unit | PASS |
| 7 | Back to the plan default → `matchesPlanDefault: true` so the writer deletes the override | §7 | unit | PASS |
| 8 | The same feature in enable and disable is refused | §8 | unit | PASS |
| 9 | `{}`, `{enable:[]}`, `{disable:[]}` are refused, never a false success | §9 | unit | PASS |
| 10 | Inert slice / stranded children produce warnings; enabling the master in the same call clears them | §10 | unit | PASS |
| 11 | Inventory lists every catalog feature once, grouped as admin does, and `lockedByPlan` equals the admin editor's rule exactly | §11 | unit | PASS |
| 12 | Both schemas take `tenantSlug`, reject stray args, advertise only resolvable keys; the route imports, lists, dispatches both and its instructions mention features | §12 | unit + source | PASS |

### Live integration evidence (dev server, real DB)

| Case | Call | Outcome |
|---|---|---|
| A | `list_whitelabel_features` k-glow, `enabledOnly` | 59/70 on, grouped as the admin panel |
| B | `set_whitelabel_features` dryRun, label "Card Studio" | `unchanged`; DB override row untouched |
| C | disable `storefront.card_studio` on beautystack (suspended tenant) | `applied`, `matchesPlanDefault: true` → override row **deleted** |
| D | re-enable it | `applied` → row **recreated** `enabled: true` (tenant back to its exact pre-test state) |
| E | `ecommerce.accounts` on a Starter tenant | refused: "not part of the Starter package — it needs the Automated plan" |
| F | "Excel export" | refused, both candidate keys named |
| G | `["groupbuy.module", "storefront.revews"]` | refused; nothing applied |
| I | no enable/disable | refused |
| J | wrong bearer token | rejected by `requireMcpAuth` before any DB read |
| K | dryRun disable `groupbuy.module` on k-glow | warned: 15 enabled capabilities would go inert |

## Coverage and known gaps

- The repo has no global coverage runner; per-feature gate scripts are the
  convention. This feature's gate is `npm run test:mcp-features` (180 checks).
- Regression suites re-run green after the `setTenantFeatureAction` refactor:
  `test:branding-update`, `test:plan-scope`, `test:plan-feature-config`,
  `test:feature-disclosure`, `test:mcp-auth`, `test:mcp-images`,
  `test:reseller-feature-tree`, `test:feature-spotlight`. `npx tsc --noEmit` exit 0.
- **Gap — demo mode.** The connector's write path is DB-only. `isDemoMode()`
  tenants are unaffected (the admin editor keeps its own demo branch); an MCP
  call against a demo deployment would write nothing. Not wired because the
  connector is an operator tool against the live platform.
- **Gap — the writer is not transactional.** `applyFeatureWrites` applies
  toggles sequentially so each key can self-register first. A mid-batch DB
  failure can leave earlier toggles applied; the tool then returns an error. The
  batch is validated in full *before* the first write, so this only triggers on
  an infrastructure fault, not on bad input.
- Deliberately out of scope: changing a tenant's PLAN from the connector. The
  ceiling is a commercial decision, and the tool names the plan needed instead.

## Merge evidence

- `bea6012` test(mcp): reproducer for connector-managed feature toggles — RED
- `fc3ea19` feat(mcp): let the connector read and toggle tenant features — GREEN

No separate refactor commit: the `setTenantFeatureAction` extraction onto the
shared writer landed inside the GREEN commit and is covered by the regression
suites above.
