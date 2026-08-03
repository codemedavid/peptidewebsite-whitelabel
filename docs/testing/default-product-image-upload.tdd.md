# TDD Evidence — Super-admin upload for the default product image

**Date:** 2026-08-03
**Branch:** feat/gb-pricing-tab
**Scope:** Platform-admin Branding editor (`src/components/admin/BrandingEditor.tsx`), the branding upload/remove server actions (`src/actions/branding.ts`), and a new shared pure module (`src/lib/upload/branding-assets.ts`). The storefront render path was **already** complete and is unchanged — `resolveProductImage` / `normalizeDefaultProductImage` and their five consuming surfaces were shipped earlier.

## Source plan

Plan produced inline by `/ecc:plan` in this session (no `*.plan.md` artifact), from the request:

> "can you add in the branding a way for super admin to upload the default image of the products instead of our current default image for the products"

Confirmed with `proceed`.

## User journeys

1. As the super admin editing a tenant's branding, I can upload a default product image from the Brand assets block, next to the logo and the favicon.
2. As the super admin, that upload takes effect immediately — like the logo, it does not wait for "Save branding".
3. As the super admin, pressing "Save branding" after uploading does **not** undo the upload.
4. As the super admin, I can remove the image again and the storefront returns to its grey SVG placeholder.
5. As the super admin, the file picker offers only the formats a product card can actually use — a 10 MB photo is allowed here even though a logo is capped at 2 MB.
6. As a shopper, a product with no photo of its own shows the tenant's default image; a product with a photo keeps its own.

## Task report

**Behavior:** `branding.config.defaultProductImage` becomes operator-editable from the UI. It was previously settable only by script or by hand-editing the config blob.

- **New pure module** `src/lib/upload/branding-assets.ts` — owns the `BrandingAssetKind` union (now three kinds), `isBrandingAssetKind` (narrows the untrusted client-supplied kind), `brandingAssetRules` (per-kind size budget + allowed MIME set), `validateBrandingAssetFile`, and `applyDefaultProductImage` (the branding.config read-modify-write). Pure so the server action and the client editor can share one merge.
- **`uploadBrandingAssetAction` / `removeBrandingAssetAction`** — accept the new kind; validate per kind instead of against one hardcoded 2 MB / all-formats rule; for `defaultProductImage` they `upsert` a merged `branding.config` instead of writing a `Branding` column. Demo mode merges the data URL into the demo config.
- **`BrandingEditor`** — a third `AssetUpload` under Brand assets; `AssetUpload`'s `accept` is now derived from the kind's allowed types rather than hardcoded.

**The one non-obvious correctness point:** the editor holds all of `branding.config` in `cfg` and writes it back wholesale on "Save branding". Because this upload persists server-side into that same blob, a `cfg` still holding the config as it was loaded would silently overwrite the new image on the next save. `onDefaultProductImageChange` therefore mirrors the URL into `cfg` through the same `applyDefaultProductImage`, and a structural test asserts that wiring stays.

**Validation command:** `npm run test:default-product-image`

**RED (before implementation):** the shared module did not exist, so the suite could not even load — a compile-time RED caused by the missing implementation, not by broken test setup.

```
Error: Cannot find module '../src/lib/upload/branding-assets'
Require stack:
- /Users/…/scripts/test-default-product-image.ts
  code: 'MODULE_NOT_FOUND'
```

**GREEN (after implementation):**

```
41 passed, 0 failed
```

```
> npm run typecheck
> tsc --noEmit
(clean)
```

**What is guaranteed:** the per-kind upload rules, the immutability and key-removal semantics of the config merge, the round-trip compatibility between what is stored and what the storefront normalizer accepts, and the presence of the operator control plus the anti-clobber mirror.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Only the three real asset kinds are accepted; anything else (incl. `null`, `""`, objects) is refused before any write | `scripts/test-default-product-image.ts:branding asset kinds` | unit | PASS | `npm run test:default-product-image` |
| 2 | A logo/favicon keeps the 2 MB budget; the default product image gets 10 MB | `…:brandingAssetRules` | unit | PASS | same |
| 3 | The default product image accepts JPG/PNG/WebP and refuses `.ico` / SVG; favicons still accept `.ico` | `…:brandingAssetRules` | unit | PASS | same |
| 4 | A 3 MB photo passes as a default product image but is rejected as a logo, with a size error naming the right limit | `…:validateBrandingAssetFile` | unit | PASS | same |
| 5 | An unsupported type and a zero-byte file are both rejected with an operator-facing reason | `…:validateBrandingAssetFile` | unit | PASS | same |
| 6 | Storing the image leaves every other config key intact and never mutates the input config | `…:applyDefaultProductImage` | unit | PASS | same |
| 7 | Removing deletes the key outright (no empty string left behind) — blank/whitespace URLs remove too | `…:applyDefaultProductImage` | unit | PASS | same |
| 8 | What the merge stores is accepted by `normalizeDefaultProductImage`, so no dead value can be persisted | `…:applyDefaultProductImage` | unit | PASS | same |
| 9 | The server action validates per kind and persists through the shared merge | `…:operator surfaces` | structural | PASS | same |
| 10 | The Branding editor renders the upload control for the super admin | `…:operator surfaces` | structural | PASS | same |
| 11 | The editor mirrors the uploaded URL into `cfg` via `setCfg` + `applyDefaultProductImage`, so "Save branding" can't clobber it | `…:operator surfaces` | structural | PASS | same |
| 12 | (pre-existing) The five storefront surfaces resolve images through the brand default, and the config value is normalized server-side | `…:render surfaces use the fallback` | structural | PASS | same |

## Coverage and known gaps

This repository has no coverage instrumentation — its tests are self-contained `tsx` scripts under `scripts/`, not a Jest/Vitest suite, so an 80% line-coverage figure cannot be produced. Every exported function of the new module is exercised by the unit tests above; the action and editor wiring is covered structurally.

Known gaps, deliberate:

- **No end-to-end upload test.** The upload path needs a platform-operator session, a live DB, and ImageKit credentials. Journeys 1–4 remain to be confirmed manually: upload on a tenant with an imageless product (e.g. `k-glow`), press **Save branding**, reload, confirm the image survived, then Remove and confirm the placeholder returns. Journey 3 is the one worth actually doing — it is the regression the mirror exists to prevent.
- **Demo mode stores a data URL** that `normalizeDefaultProductImage` then refuses, so a demo default product image renders in the editor but not on the storefront. This follows the pre-existing http(s)-only rule (demo has nowhere to host a file) and is documented in the action rather than worked around.
- **No refactor commit.** Step 6 produced no changes worth committing; the implementation landed in its final shape.
- **Not in scope:** a platform-wide fallback for tenants that set none, and exposing this control to store owners in the tenant's own admin.

## Merge evidence

| Stage | Commit | Evidence |
|---|---|---|
| RED | `618300c` test: the super admin needs a way to upload the default product image | `npm run test:default-product-image` → `MODULE_NOT_FOUND ../src/lib/upload/branding-assets` |
| GREEN | `f760a43` feat: the super admin can upload a tenant's default product image | `npm run test:default-product-image` → 41 passed, 0 failed; `npm run typecheck` → clean |

A concurrent session committed to this branch between the two checkpoints; `git merge-base --is-ancestor 618300c HEAD` confirms the RED checkpoint is still reachable from HEAD.
