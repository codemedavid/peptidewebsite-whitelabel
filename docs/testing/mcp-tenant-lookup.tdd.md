# MCP tenant lookup — TDD evidence

**Gate:** `npm run test:tenant-lookup` · **Core:** `src/lib/tenant/tenant-lookup.ts` ·
**Shell:** `src/lib/mcp/tenant-lookup-tool.ts` · **Commits:** `485667f` (RED) → `59ffe62` (GREEN)

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request
"allow ChatGPT to rebrand any created tenant".

## The bug

`update_whitelabel_branding` shipped 2026-08-18 and could restyle an existing
tenant — but it resolved the tenant with `findUnique({ where: { slug } })` after
lowercasing. That only works when the caller already holds the **exact** slug,
which in practice meant a store ChatGPT had just created and been handed the slug
back for.

For every other store the connector was a dead end:

- Operator: *"restyle HP Glow in dark green."*
- ChatGPT guesses `hp-glow` → `Tenant "hp-glow" was not found.`
- The real slug is `hpglow`. Slug conventions across the live estate are genuinely
  mixed (`hpglow` vs `k-glow`, `pepsys-compound` vs `peppies-intl`), so this is not
  a guess the model can win.
- There was **no tenant listing tool at all**, so the failure carried no way forward.

So "the connector can rebrand a tenant" was true only of self-created ones.

## User journeys

1. Operator asks what stores exist → a directory of tenants ChatGPT never created.
2. Operator says the slug with different punctuation → resolves.
3. Operator pastes a storefront URL → resolves.
4. Two lookalike stores → refused, both named, nothing applied.
5. A typo → not-found that names near matches so the retry lands.
6. An exact slug is never dragged into a false ambiguity.
7. The directory never ships credentials or commercial data.
8. Trial / suspended / self-serve tenants are reachable too.
9. A huge estate is capped, not dumped into the model's context.
10. The tool schema, the core, the branding tool and the route all agree.

## Task report

### RED — `485667f`

```
$ npm run test:tenant-lookup
Error: Cannot find module '../src/lib/tenant/tenant-lookup'
```

Compile-time RED: the new test newly references the missing implementation, and
the failure is that absence — not unrelated setup breakage.

### GREEN — `59ffe62`

```
$ npm run test:tenant-lookup
...
All MCP tenant lookup checks passed
```

Two test inputs were corrected mid-cycle, and the correction is recorded here
rather than quietly folded in. Journey 4 originally probed `"glow labs p"` and
Journey 6 probed `"k glow"` against a store literally named *K Glow*; both
**resolved uniquely**, which is correct behaviour — a unique prefix, and an exact
display name, are legitimate matches. The journeys (ambiguity must be refused)
were right; the inputs did not create ambiguity. They were changed to inputs that
genuinely do (`"glow"` across two glow stores; a shared display name across two
slugs), and the unique-prefix and exact-name cases were **added as their own
passing guarantees** rather than dropped. No assertion was weakened.

### Live verification (read-only, against the production database)

```
tenants visible to the connector: 21
  hpglow                   HP GLOW  [active]
  k-glow                   K Glow  [active]
  mstomato                 Mstomato  [trial]
  beautystack              BeautyStack  [suspended]
  ... 17 more

secret leakage in the payload: none
  "hp-glow"                              -> hpglow
  "HP Glow"                              -> hpglow
  "https://hpglow.pepweb.store/#catalog" -> hpglow
  "kglow"                                -> k-glow
  "definitely-not-a-store"               -> REFUSED: No tenant matches ...
                                            Closest: dragon-peptides, ...
```

Each of the first three inputs returned "not found" before this change.

## Design rules the gate pins

**It never resolves to the wrong store.** A branding write is live and visible to
a tenant's customers, so a name fitting two stores is refused with both named —
the same stance `feature-toggle` takes on an ambiguous feature label. Guessing is
the one failure mode nobody can undo from a chat window.

**An exact slug always wins.** Matching is *tiered*, not one scoring pass: exact
slug → exact name → punctuation-blind slug → punctuation-blind name → prefix →
substring, each tier consulted only if every earlier one came up empty. Without
this, `k-glow` would be dragged into a false ambiguity by a `kglow` sibling.

**A miss teaches the next call.** A bare "not found" ends the conversation. A miss
carries near matches, ranked by shared prefix then shared characters.

**The directory is not a data export.** `buildTenantDirectory` projects field by
field instead of spreading the row, because a `Tenant` also carries
`adminPasswordHash`, `storeAdminPasswordHash`, `accessCodeHash`, `ownerWhatsapp`
and the whole subscription ledger. Journey 7 asserts on the serialized payload,
so a later widened `select` fails the gate rather than silently handing scrypt
hashes to a remote model.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Every tenant is listed, not only connector-created ones | `test-tenant-lookup.ts:Journey 1` | unit | PASS |
| 2 | `hp-glow` / `HP GLOW` / `kglow` reach the right store | `Journey 2` | unit | PASS |
| 3 | Scheme, host, port, path and fragment fall away from a pasted URL | `Journey 3` | unit | PASS |
| 4 | An ambiguous name resolves to nothing and names every candidate | `Journey 4` | unit | PASS |
| 5 | A unique prefix and an exact display name still resolve | `Journey 4` | unit | PASS |
| 6 | A typo returns near matches including the real store | `Journey 5` | unit | PASS |
| 7 | An exact slug wins over a lookalike sibling | `Journey 6` | unit | PASS |
| 8 | The directory ships no hash, owner contact or billing field | `Journey 7` | unit | PASS |
| 9 | Trial, suspended and self-serve tenants resolve and list | `Journey 8` | unit | PASS |
| 10 | A 400-store estate is capped at 100 and reports `truncated` | `Journey 9` | unit | PASS |
| 11 | Schema, core, branding tool and route agree | `Journey 10` | integration | PASS |
| 12 | The branding tool no longer resolves via `findUnique({ slug })` | `Journey 10` | integration | PASS |
| 13 | 21 live tenants resolve by slug, name and URL; no secrets | live smoke (read-only) | integration | PASS |

## Regression surface

| Gate | Result |
|------|--------|
| `npm run test:tenant-lookup` | PASS |
| `npm run test:branding-update` | PASS |
| `npm run test:mcp-features` | PASS (after unpinning a brittle 1400-char window) |
| `npm run test:mcp-auth` | PASS |
| `npm run test:mcp-images` | PASS |
| `npm run test:mcp-variations` | PASS |
| `tsc --noEmit` | clean |

`test:mcp-features` asserted that the route's server instructions mention
features by slicing a **fixed 1400 characters** from `instructions:`. Adding two
sentences ahead of the feature text pushed it out of that window — the assertion
broke, the behaviour did not. It now reads the whole instruction literal.

## Known gaps

- **Only `update_whitelabel_branding` uses the shared resolver.** The product and
  feature tools still resolve with an exact-slug `findUnique`, so
  `list_whitelabel_features` on "HP Glow" still fails where the branding tool now
  succeeds. `resolveTenantArg` is exported and drop-in; the request was scoped to
  rebranding, so the rest is left as a deliberate, mechanical follow-up.
- **No coverage run.** This repo has no aggregate coverage harness; gates are
  self-contained `tsx` scripts per feature, matching the house pattern.
- **Enumeration is a deliberate disclosure.** Any holder of `MCP_ADMIN_TOKEN` can
  now list every store on the platform. That token already provisions tenants and
  moves entitlements platform-wide, so this is no new privilege class — but it is
  a real widening of what a leaked token reveals, and is recorded as such.
