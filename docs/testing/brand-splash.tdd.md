# Brand Splash — the branded tenant loading screen

**Source plan**: inline `/ecc:plan` v3 (this session). No `*.plan.md` artifact was written.
**Branch**: `feat/brand-splash`
**Commits**: `7c1b262` (RED) → `4623343` (GREEN) → `b034859` (RED) → `f0b229d` (GREEN)

## What was built

Every white-label storefront now boots through a loading screen carrying the
tenant's own mark and colors instead of a generic skeleton. It is **on by
default for every tenant** — no entitlement, no grant, no owner toggle — and is
customizable **only by the platform operator**, on the per-tenant Branding page
(`/admin/tenants/[slug]/branding` → Storefront tab → **Loading screen**).

Operator controls: loading **design** (5), **background / accent / text colors**
(free hex, each with reset-to-theme), an uploaded **splash-only logo**, an
optional tagline, and the timing floor/ceiling.

## User journeys

1. As a shopper, I want the store I opened to identify itself while it loads, so
   I know whose shop I am on before anything renders.
2. As the platform operator, I want to set a tenant's loading screen background
   to any color, so it matches a brand the theme palette does not cover.
3. As the platform operator, I want to upload a mark used *only* on the loading
   screen, so a store whose header logo is wrong at that size still looks right.
4. As the platform operator, I want to pick the loading animation from something
   that shows me the real result, not from a list of names.
5. As a store owner, I should never see or be able to change this — it is a
   platform-level presentation decision, not a shop setting.
6. As any visitor, I must reach the store even if the page's JavaScript never
   runs, so the loading screen can never become an outage.

## Task report

### Task 1 — Branding-asset storage dispatch (`4623343`)

Adding a `splashLogo` upload kind exposed a live bug in the existing upload
path. `uploadBrandingAssetAction` and `removeBrandingAssetAction` each branched
`kind === "defaultProductImage" ? <config merge> : <column write>`, and the
column leg ends in `kind === "logo" ? { logoUrl } : { faviconUrl }` — so any new
config-blob kind reaching that line would have **silently overwritten the
tenant's favicon** with the splash mark, in 4 places (upload/remove × demo/prod).

Kinds now declare where they live (`assetTarget`) and both actions dispatch on
it. `applyBrandingAsset` generalizes the config merge to a nested path,
immutably at every level.

- **Validation**: `npm run test:brand-splash`, `npm run test:default-product-image`
- **RED**: `Error: Cannot find module '../src/lib/storefront/brand-splash'`
- **GREEN**: `38 passed, 0 failed` / `41 passed, 0 failed`
- **Guaranteed**: a config-backed asset kind cannot be written to a `Branding`
  column by omission; `applyBrandingAsset` refuses a column kind loudly rather
  than silently dropping the upload.

### Task 2 — Pure core, default-ON (`4623343`)

`normalizeBrandSplash` fails **ON**: absent, partial or junk config all resolve
to an enabled splash, and only a literal `false` disables it. Colors render into
an inline `style`, so `cleanHex` accepts `#rgb`/`#rrggbb` only. `splashVarsCss`
emits **only** the colors the operator actually set.

- **Validation**: `npm run test:brand-splash`
- **GREEN**: `38 passed, 0 failed`
- **Guaranteed**: `{enabled:"false"}` does **not** disable a store's splash (the
  string-truthiness trap); `"#fff;background-image:url(...)"` is dropped, not
  stored; an unset color emits no var, so the stylesheet's theme fallback keeps
  resolving rather than being shadowed by an empty string; `maxDurationMs` is
  capped at 5s so a mistyped value cannot hide a live storefront.

### Task 3 — Storefront render (`f0b229d`)

A fixed full-viewport overlay mounted by the storefront layout inside the
existing `cssVars` wrapper, below the access wall. Dismissal is doubled:
React clears it at `minDurationMs` (on hydration, not `window.load`, so it never
becomes the LCP element) and `brand-splash.css` clears it again at
`maxDurationMs` with **no JavaScript at all**.

- **Validation**: `npm run test:brand-splash-admin`
- **RED**: `15 failed, 4 passed`
- **GREEN**: `19 passed, 0 failed`
- **Guaranteed**: the dismissal uses `animation-fill-mode: forwards` plus
  `visibility: hidden` and `pointer-events: none`, so a dismissed overlay cannot
  linger as an invisible sheet swallowing every click; motion is opt-out under
  `prefers-reduced-motion` while the *lift itself* is not, since removing that
  would strand those visitors behind a permanent overlay.

**Defect found and fixed during implementation, not by a test**: the fast-path
dismissal originally reused the same `@keyframes` name as the timed hold with a
shorter duration. Re-declaring one animation with a new duration does not
restart it — the browser keeps the original start time and rescales — so at
250ms into a 900ms hold the overlay was already past the end of a 220ms timeline
and cut to hidden with no fade. The dismissal now has its own keyframes name.

### Task 4 — Operator controls (`f0b229d`)

`BrandSplashEditor`, a "Loading screen" section on the per-tenant Branding page.
Design tiles render the **real** overlay markup and stylesheet at tile size, so
the picker cannot drift from what a shopper sees. Everything except the upload
rides the existing **Save branding**: `saveBrandingAction` writes the config
object wholesale, so a second per-splash save action would only be clobbered by
the next save. The upload persists immediately, so its URL is mirrored back into
`cfg` — otherwise the next save would write a stale config over it.

Four form primitives (`CollapsibleSection`, `Segmented`, `AssetUpload`,
`HeaderColorField`) moved out of `BrandingEditor` into `branding-fields.tsx`:
importing them back out of `BrandingEditor` would have made the two files a
cycle, and copying them would have let the upload's error handling drift.
`BrandingEditor` drops 1420 → 1236 lines.

- **Validation**: `npm run test:brand-splash-admin`
- **GREEN**: `19 passed, 0 failed`
- **Guaranteed**: there is no `saveBrandSplashAction` to drift from Save
  branding; an uploaded mark survives the next Save branding.

### Task 5 — Owner-invisibility (`f0b229d`)

The feature is operator-only by design, which is a property that decays
silently. The suite greps `staff-permissions.ts`, `admin-nav.ts`,
`storefront-admin.ts` and `AdminPage.tsx` for `brandSplash` / `splashLogo` /
`BrandSplash` and fails if any of them ever mentions it.

Cross-check performed by hand: all 28 store-admin save actions in
`storefront-admin.ts` do a narrow `readConfig()` → spread-own-keys → write. None
replaces `branding.config` wholesale, so an owner editing their hero or banner
cannot clobber `brandSplash` even though it shares the blob and they cannot see
it. No defensive work was needed.

### Task 6 — Fallbacks beneath the splash — **no change required**

The plan's Phase 4 assumed `loading.tsx` and `PageSpinner` were unbranded grey.
Checked against the running server, that premise was wrong: the layout emits
`--muted` per tenant (hpglow: `0 0% 100%`), `Skeleton` consumes it via
`bg-muted`, and `sf-page-spinner__ring` already uses `var(--brand-main)`. Both
are already tenant-themed. No code was changed — the planned edit would have
been churn.

`PageSpinner` was deliberately *not* wired to the operator's splash accent:
`--splash-accent` is emitted inline on the splash element only, and lifting it
to the layout so route-transition chrome could read it would couple unrelated
surfaces to splash-specific config.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | An unconfigured tenant still gets a splash (absent/null/junk config → enabled) | `test-brand-splash.ts:absent config still yields an enabled splash` | unit | PASS |
| 2 | Only a literal `false` disables it; the string `"false"` does not | `test-brand-splash.ts:the string "false" does NOT disable it` | unit | PASS |
| 3 | A non-hex color is dropped, not stored — no CSS injection via inline style | `test-brand-splash.ts:a CSS injection attempt cannot survive normalization` | unit | PASS |
| 4 | An unset color emits no var, so the theme fallback keeps resolving | `test-brand-splash.ts:emits no vars when the operator set no colors` | unit | PASS |
| 5 | Splash logo precedence: upload > header logo > monogram | `test-brand-splash.ts:splashLogoUrl` (4 cases) | unit | PASS |
| 6 | `javascript:`/`data:` cannot reach the splash `<img src>` | `test-brand-splash.ts:only http(s) survives` | unit | PASS |
| 7 | An operator cannot hide a live store behind the splash (5s cap, min ≤ max) | `test-brand-splash.ts:a max duration is capped` | unit | PASS |
| 8 | A splash-logo upload cannot overwrite the tenant's favicon | `test-brand-splash.ts:splashLogo is a config-blob kind` | unit | PASS |
| 9 | Clearing an asset deletes the key rather than storing `""` | `test-brand-splash.ts:clearing DELETES the key` | unit | PASS |
| 10 | The config merge is immutable at every level of the path | `test-brand-splash.ts:is immutable` | unit | PASS |
| 11 | A column-backed kind fails loudly instead of dropping the upload | `test-brand-splash.ts:refuses a column-backed kind loudly` | unit | PASS |
| 12 | The default product image behaves exactly as before the refactor | `test-default-product-image.ts` (41 assertions) | unit | PASS |
| 13 | The storefront layout mounts the splash, gated on the tenant's config | `test-brand-splash-admin.ts:the storefront layout renders the splash` | structural | PASS |
| 14 | The splash lifts with no JavaScript at all | `test-brand-splash-admin.ts:the stylesheet dismisses the overlay on its own` | structural | PASS |
| 15 | A dismissed overlay cannot swallow clicks | `test-brand-splash-admin.ts:never traps a shopper behind an opaque layer` | structural | PASS |
| 16 | An uploaded mark survives the next Save branding | `test-brand-splash-admin.ts:an uploaded mark is mirrored into cfg` | structural | PASS |
| 17 | No second save action exists to drift from Save branding | `test-brand-splash-admin.ts:the config rides the existing Save branding` | structural | PASS |
| 18 | The store owner cannot see or edit the splash (4 surfaces) | `test-brand-splash-admin.ts:owner-invisibility` | structural | PASS |
| 19 | A real tenant renders the splash server-side with its own name and logo | `curl hpglow.lvh.me:3100` | manual | PASS |

## Coverage and known gaps

This repository has **no coverage tooling** — no jest, vitest, c8 or nyc. Tests
are bespoke `tsx` assertion scripts run per feature, so the 80% line-coverage
target cannot be measured here and no coverage figure is claimed. The pure core
(`brand-splash.ts`) has every exported function and every branch of
`normalizeBrandSplash` exercised by name.

Verification actually run:

```
npm run test:brand-splash             38 passed, 0 failed
npm run test:brand-splash-admin       19 passed, 0 failed
npm run test:default-product-image    41 passed, 0 failed
npm run test:storefront-css-vars       5 passed, 0 failed
npm run test:logo-curve               15 passed, 0 failed
npm run test:header-logo              all checks passed
npx tsc --noEmit                      clean
curl http://hpglow.lvh.me:3100/       sf-splash--logo-pulse, --splash-hold:900ms,
                                      aria-label="Loading HP GLOW", header-logo fallback
```

### Gaps

- **`npm run build` was not run.** A dev server is live on port 3100 and a
  concurrent build clobbers `.next/`, 500-ing the running server (a recorded
  hazard in this project). `tsc --noEmit` is clean, which covers compilation.
  The build should be run once the dev server is free.
- **No visual regression at 320/768/1440, no cross-browser pass, and no
  JS-disabled browser check.** The no-JS dismissal is asserted structurally (the
  CSS carries `forwards` + `visibility: hidden` + `pointer-events: none`) but has
  not been exercised in a real browser with scripting off. That is the single
  highest-value manual check remaining, because that path is the feature's
  outage guard.
- **The splash was verified on one tenant only** (hpglow, which falls back to
  its header logo). Not yet seen: a tenant with a splash-specific upload, and a
  logo-less tenant rendering the monogram.
- **`db:push` not required** — no schema change; `brandSplash` is a key in the
  existing `branding.config` JSON.

## Test edits made during the cycle (disclosed)

Three assertions were changed. No behavioral assertion was touched.

1. `test-default-product-image.ts` — "the branding action persists the image
   into branding.config" named `applyDefaultProductImage` at the action call
   site. The dispatch refactor moved that call to `applyBrandingAsset`; the
   assertion now checks the same intent (merges via `applyBrandingAsset`,
   dispatches on `assetTarget`).
2. `test-default-product-image.ts` — "the editor mirrors the uploaded URL into
   cfg" likewise named the specific helper. The editor now mirrors every
   config-backed asset through one generic `mirrorAssetIntoCfg`; the assertion
   checks that, plus that the default product image is still mirrored.
3. `test-brand-splash-admin.ts` — "the config rides the existing Save branding"
   looked for the `brandSplash` key in the presentational panel. The container
   owns that state (`setTweak("brandSplash", …)` in `BrandingEditor`), which is
   the same split every other tweak uses. The assertion was wrong, not the code.

## Merge evidence

If these commits are squashed, this file is the surviving record. Sequence:

- `7c1b262` **RED** — core reproducer; failed at module resolution.
- `4623343` **GREEN** — pure core + asset-storage dispatch; 38/38, 41/41, tsc clean.
- `b034859` **RED** — render/operator reproducer; 15 failed, 4 passed.
- `f0b229d` **GREEN** — overlay, stylesheet, operator panel, primitives extraction;
  19/19, 38/38, 41/41, tsc clean, live-server render confirmed.
