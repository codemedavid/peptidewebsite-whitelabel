# TDD evidence — connector restyles a tenant's brand splash

**Task:** "allow chatgpt mcp to rebrand edit the existing tenant"
**Branch:** `feat/brand-splash` · **Date:** 2026-08-21
**Extends:** [mcp-branding-update.tdd.md](./mcp-branding-update.tdd.md)

## Starting finding

The headline ask was **already shipped**. `update_whitelabel_branding` landed
2026-08-18 in `ea811ad`, is wired into the MCP route (`src/app/api/mcp/route.ts`),
and its gate passed untouched at the start of this session. No work was needed to
"allow the connector to rebrand an existing tenant" — it already could.

What was *not* covered were two brand surfaces:

| Surface | Key | Before | After |
|---|---|---|---|
| Brand splash | `brandSplash` | unreachable | `splash` section + `splashLogo` upload |
| Home layout | `layout.homeLayout` | accepted by core, **never advertised** | in the tool schema |

The `homeLayout` case was a silent drift: the pure core validated it, but the
JSON schema never listed it, so the connector never told the model it existed.

## User journeys

1. As an operator, I want to restyle a live store's loading screen through the
   connector, so I don't have to open the admin UI to change its colors.
2. As an operator, I want a splash retint to keep the tagline and durations
   already configured, so a one-key patch isn't quietly destructive.
3. As an operator, I want a bad splash value refused outright, so a remote agent
   never half-applies a restyle I can't see.
4. As an operator, I want the connector able to switch a store's home layout,
   since that's part of a rebrand.

## Task report

### Splash section (pure core, `src/lib/tenant/branding-update.ts`)

`brandSplash` is the module's first **nested** write target; every prior section
sets a flat `branding.config` key. A flat assignment would drop sibling splash
keys, so `applySplash` merges key-by-key onto a copy of the stored object.

Bounds are **imported** from `brand-splash.ts`, not restated, so the write path
cannot accept what the renderer would ignore. Where the renderer clamps junk
silently, this refuses it — a remote caller can't observe a clamp.

- RED: `12 check(s) failed`, every one `Unknown branding section "splash"` — the
  intended missing implementation, not unrelated breakage.
- GREEN: all 33 Journey 12 checks pass.

### Schema parity guard (Journey 13)

The two halves live in different files and fail in opposite directions:
in-schema-not-core rejects the whole patch; in-core-not-schema is unreachable.
The guard probes the core with `__drift_probe__` and reads back the allow-list
the unknown-key error already publishes, rather than copying the field tables
into a third place.

**Verified to fail on the bug it was written for.** Removing `homeLayout` from the
schema (restoring the original defect) produces:

```
FAIL  every layout field the core accepts is advertised — got ["homeLayout"]
1 check(s) failed
```

Restoring it returns the suite to green.

### `splashLogo` upload (`tenant-media.ts`, `update-branding-tool.ts`)

Added a `splash` media kind. The three per-kind ternaries in `resolveMcpImage`
became a `MEDIA_KINDS` table so a fourth kind is one entry, not three edits.
The uploaded URL merges into `brandSplash` rather than replacing it, since
`buildTenantBrandingUpdate` may have just written colors into the same object.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A splash color patch preserves tagline, design, logo and durations | J12 "tagline survives a color-only splash patch" | unit | PASS |
| 2 | A splash patch never touches payment methods or other commerce config | J12 "sibling commerce config survives" | unit | PASS |
| 3 | Unknown splash key / non-hex color / bad design enum reject the whole patch | J12 rejection checks | unit | PASS |
| 4 | `javascript:` splash logo and CSS-smuggling hex are refused | J12 injection checks | unit | PASS |
| 5 | Durations outside the renderer's own bounds are refused | J12 duration checks | unit | PASS |
| 6 | An inverted min/max pair errors instead of storing a value never honoured | J12 "min above the stored max rejected" | unit | PASS |
| 7 | `""` clears a splash color/logo back to the theme | J12 clear checks | unit | PASS |
| 8 | A splash patch applies to a tenant with no `brandSplash` at all | J12 fresh-tenant checks | unit | PASS |
| 9 | What the patch writes, `normalizeBrandSplash` reads back | J12 round-trip | unit | PASS |
| 10 | Every schema field is known to the core (no whole-patch rejections) | J13 forward parity | unit | PASS |
| 11 | Every core field is advertised by the schema (nothing unreachable) | J13 reverse parity | unit | PASS |
| 12 | Every schema enum value is accepted by the core | J13 enum parity | unit | PASS |

Command: `npm run test:branding-update` → `All tenant branding update checks passed`

## Regression evidence

```
branding-update        All tenant branding update checks passed
brand-splash           39 passed, 0 failed
brand-splash-admin     21 passed, 0 failed
mcp-images             7 passed
tenant-setup           13 passed
tenant-presets         65 passed, 0 failed
tsc --noEmit           exit 0
```

## Known gaps

- **Card Studio (`cardDesign` / `cardTemplates`) is still connector-unreachable.**
  Deliberately deferred — scoped out at the start of this session. Journey 13
  does not flag it, because the guard only compares fields *within* sections the
  schema declares; a whole missing section is invisible to it.
- The MCP route handler itself is not covered by an automated test; the pure core
  and the schema are. This matches the existing convention in this module.
- No live end-to-end call against a real tenant was made.

## Checkpoints

| Stage | Commit |
|---|---|
| RED | `c16f3e9` test(mcp): reproducer for restyling a tenant's brand splash |
| GREEN | `f8a30c8` feat(mcp): let the connector restyle a tenant's brand splash |
