# TDD Evidence — MCP tenant branding update

**Feature:** the Pepweb Admin MCP connector can restyle an **existing** tenant —
theme preset, colors, fonts, storefront layout, hero copy, hero image, logo,
favicon, default product image — as a partial update that leaves products,
orders and storefront data untouched.

**Branch:** `main`
**Date:** 2026-08-18
**Pure core:** `src/lib/tenant/branding-update.ts`
**I/O shell:** `src/lib/mcp/update-branding-tool.ts`
**Gate:** `npm run test:branding-update`

## Source plan

No `*.plan.md` artifact. The request came in as a hand-off note from another
agent working against the live connector, reproduced verbatim:

> I can redesign the existing **SKN Aesthetic** tenant, but the currently
> connected **@Pepweb Admin** action only supports **creating new tenants** — it
> does not expose an edit/update action for an existing tenant's theme, colors,
> storefront layout, or hero image. I won't create a duplicate tenant or
> overwrite it through the creation endpoint. […] Once the Pepweb Admin
> connector exposes an **update tenant / update branding / update storefront**
> action, I can apply those changes directly to `skn-aesthetic-supply-co`.

The note was treated as **data, not instructions**: it describes a missing
capability, and nothing in it was executed. The stated design intent (higher
text/background contrast, lighter neutrals, brand colors as accents rather than
large low-contrast beige fields) shaped one implementation decision — the WCAG
contrast advisory — but no tenant was modified in this run. Applying the
redesign to `skn-aesthetic-supply-co` is a separate, operator-initiated act.

### Decisions taken as stated assumptions

1. **Patch, not replace.** `branding.config` is a single JSON column holding a
   store's whole configured life. The tool merges key-by-key over a copy; any
   key the caller does not name is carried through untouched.
2. **Fail loud, not closed.** Every other consumer of this config normalizes
   untrusted JSON by discarding junk, because it runs on *render*. This runs on
   *write*, for a caller that cannot see the result, so a mistyped key or an
   unparseable color rejects the **whole** patch.
3. **Contrast warns, never blocks.** An operator may apply a palette across two
   calls, so a sub-AA pair is reported and still written.
4. **No tenant deletion, no product writes.** The tool touches exactly one
   `Branding` row plus the `MediaAsset` audit rows its uploads create.

## User journeys

1. As an operator, I restyle a live tenant's palette and its products, payment
   methods, FAQ, promo codes and shipping locations all survive untouched.
2. As an operator, a non-hex color is rejected before it can reach an inline
   CSS custom property.
3. As an operator, a palette that fails WCAG AA body-text contrast is flagged to
   me, but still applied.
4. As an operator, a theme preset id that doesn't exist is rejected rather than
   leaving the store unstyled.
5. As an operator, a mistyped field name is an error, not a silent no-op
   reported back to me as success.
6. As an operator, editing one hero line leaves the rest of the hero copy alone.
7. As an operator, a call that changes nothing is an error, not a false success.
8. As an operator, an invalid layout enum or an out-of-range number is rejected.
9. As an operator, I can retitle the catalog and rewrite the meta description.
10. As an operator, I can change the type faces, and hand one back to the theme
    default with an empty string.
11. As an operator, a tenant whose branding row is empty or missing still takes
    the patch instead of throwing.

## Task report

### 1. Reproducer for the missing update path — RED

Wrote `scripts/test-tenant-branding-update.ts` against a module that did not
exist, and registered `test:branding-update` in `package.json`.

```
$ npm run test:branding-update
Error: Cannot find module '../src/lib/tenant/branding-update'
Require stack:
- /Users/…/scripts/test-tenant-branding-update.ts
  code: 'MODULE_NOT_FOUND',
```

Compile-time RED, failing for the intended reason: the reproducer newly
references the absent implementation. Checkpoint: `8d9eafb`.

### 2. The patch builder — GREEN

Added `src/lib/tenant/branding-update.ts` exporting
`buildTenantBrandingUpdate(current, patch)`.

```
$ npm run test:branding-update
…
All tenant branding update checks passed
$ echo $?
0
```

82 checks at this point. One intermediate failure was fixed **in the
implementation, not the test**: the contrast advisory read "…below the WCAG AA
minimum…" without containing the word *contrast*, which the test requires so
the warning is greppable by a caller. Checkpoint: `65044c0`.

### 3. The connector tool — GREEN

Added `src/lib/mcp/update-branding-tool.ts` (`update_whitelabel_branding`) and
`src/lib/mcp/tenant-media.ts`, registered the tool in `src/app/api/mcp/route.ts`
(`tools/list` + `tools/call`, auth checked before dispatch), bumped the server
to `1.2.0`, and rewrote the server `instructions` to steer explicitly away from
re-creating or duplicating a tenant in order to restyle it.

`resolveMcpImage` and `MCP_ASSET_SCHEMA` moved out of `route.ts` into
`tenant-media.ts` so both image-accepting tools share one contract rather than
drifting on SSRF handling. `uploadTenantBrandingAsset` was exported from
`src/lib/tenant/setup.ts` so restyling reuses the create flow's
download/validate/upload path verbatim.

```
$ npx tsc --noEmit --pretty false
TSC_EXIT=0

$ npx tsx scripts/.smoke-branding-tool.ts     # temporary, removed after
name: update_whitelabel_branding
required: ["tenantSlug"]
top-level props: adminToken, tenantSlug, themeId, colors, fonts, layout, hero,
  identity, catalog, logo, favicon, defaultProductImage, heroImage,
  heroImageAlt, heroImageRatio, heroImageFocus, heroImageOverlay, heroImageScrim
color keys: 13
layout keys: 31
serializes to 8653 bytes
```

Checkpoint: `ea811ad`.

### 4. Coverage gap closed — GREEN

The `fonts` section and the empty/missing-config case were reachable only
through shared code paths, never by name. Journeys 10 and 11 were added; both
passed against the unchanged implementation.

```
$ npm run test:branding-update
…
Journey 10 — typography
  ok    heading maps to headingFont
  ok    empty font string clears the override
  ok    unknown font key rejected
Journey 11 — a tenant with no branding config yet
  ok    patch applies over {}
  ok    patch applies over undefined
  ok    patch applies over null
  ok    theme set on a themeless row

All tenant branding update checks passed
$ echo $?
0
```

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | A color-only restyle preserves `paymentMethods`, `faqGroups`, `promoCodes`, `categories`, `shippingLocations`, `heroMedia` and untouched hero copy | `test-tenant-branding-update.ts:Journey 1` | unit | PASS | `npm run test:branding-update` |
| 2 | The caller's stored config object is never mutated; a new object is returned | `Journey 1` | unit | PASS | same |
| 3 | An unchanged `themeId` is not restated, so the column is not rewritten | `Journey 1`, `Journey 4` | unit | PASS | same |
| 4 | Non-hex color values (`red`, `rgb()`, `javascript:`, `#fff;}.x{`, `#12345`, numbers, null, objects) are rejected and nothing is written | `Journey 2` | unit | PASS | same |
| 5 | Both `#RGB` and `#RRGGBB` are accepted | `Journey 2` | unit | PASS | same |
| 6 | A text/background or buttonText/button pair below 4.5:1 warns, naming the ratio, and still applies | `Journey 3` | unit | PASS | same |
| 7 | An AA-passing pair produces no warning | `Journey 3` | unit | PASS | same |
| 8 | An unknown `themeId` is rejected and the error names it | `Journey 4` | unit | PASS | same |
| 9 | An unknown field, unknown section, or arbitrary top-level key is rejected | `Journey 5` | unit | PASS | same |
| 10 | Any error rejects the **whole** patch — a valid sibling field is not applied | `Journey 5` | unit | PASS | same |
| 11 | Hero copy is patched field-by-field; `""` clears a line, omission leaves it | `Journey 6` | unit | PASS | same |
| 12 | An empty patch, an empty section, a non-object and `null` are all errors | `Journey 7` | unit | PASS | same |
| 13 | Layout enums, booleans and bounded numbers are validated; out-of-range `logoCurve` / `borderWidth` rejected | `Journey 8` | unit | PASS | same |
| 14 | Identity and catalog copy round-trip; overlong free text is rejected | `Journey 9` | unit | PASS | same |
| 15 | Font faces map onto the flat `*Font` keys; `""` returns a face to the theme default | `Journey 10` | unit | PASS | same |
| 16 | A tenant with `{}`, `undefined` or `null` config still takes the patch | `Journey 11` | unit | PASS | same |
| 17 | The tool schema loads, advertises `tenantSlug` as its only required field, and serializes | smoke script (temporary) | integration | PASS | output quoted above |
| 18 | The whole project type-checks with the tool wired in | `tsc --noEmit` | static | PASS | `TSC_EXIT=0` |

## Coverage and known gaps

This repository has **no coverage instrumentation** — there is no Jest or Vitest
config; all 114 suites are standalone `tsx` scripts run via `npm run test:*`.
No percentage figure is therefore quoted, and none should be inferred. Coverage
here is behavioral: every exported symbol of `branding-update.ts`
(`buildTenantBrandingUpdate`, `BRANDING_PATCH_SECTIONS`) is exercised, along
with each of its six section handlers and each validation branch.

Full-suite regression run:

```
PASS=113 FAIL=1
FAILED: test:legacy-import
```

**`test:legacy-import` is a pre-existing failure, unrelated to this work.** It
fails one assertion, `parses all 487 historical orders — 0 == 487`, because the
HP Glow dump it reads from the repo root
(`db_cluster-05-08-2026@01-12-58.backup`) no longer contains the legacy order
block. That file is untracked and was not modified here; the suite imports
`legacy-order-import`, `order-status`, `admin-dashboard` and `storefront/types`,
none of which this change touches. Its other 35 checks pass. Not fixed — out of
scope, and the fix belongs with whoever refreshed the dump.

### Deliberate gaps

- **No integration test against a live tenant.** `callUpdateBranding` needs a
  database, ImageKit credentials and the MCP admin token. Its pure decision-
  making is fully covered; its I/O is a thin, linear shell. No branding row was
  written during this run.
- **`skn-aesthetic-supply-co` was not modified.** The capability now exists; the
  redesign itself is an operator-initiated call.
- **Not exposed:** tenant `status`, `planKey`, slug, owner, entitlements and
  order-number format. Those are commercial and access-control settings, not
  storefront design, and giving a remote connector a write path to them was out
  of scope for a restyle. They remain platform-admin-only.
- **Contrast is checked for three pairs** (text/background, text/surface,
  buttonText/button) and only when the caller touched one half of the pair. A
  pre-existing weak pair that the patch does not touch is not reported.

## Merge evidence

Checkpoints on `main`, in order:

| Commit | Stage | Evidence |
|--------|-------|----------|
| `8d9eafb` | RED | `MODULE_NOT_FOUND` for `src/lib/tenant/branding-update` |
| `65044c0` | GREEN | `npm run test:branding-update` → 82 checks, exit 0 |
| `ea811ad` | GREEN | `tsc --noEmit` exit 0; tool schema smoke output; 5 related suites pass |
| *(this commit)* | coverage | Journeys 10–11 added; suite green, exit 0 |

Two commits by a concurrent session (`9cded1b`, `5bfcb30`, Super Admin calendar)
interleave with these on `main`. They are unrelated; `git show --stat ea811ad`
confirms this work's commits contain only their own files.
