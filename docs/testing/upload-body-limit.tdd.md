# TDD Evidence — Logo/Favicon upload hang & unenforceable size limits

**Branch:** `feat/trial-system`
**Date:** 2026-07-17
**Trigger:** Operator report — logo/favicon upload sits on "Uploading…" and never finishes.

## Source plan

No `*.plan.md`. Journeys derived during this TDD run from an Explore trace of the
upload path (`BrandingEditor` → `uploadBrandingAssetAction` → `uploadTenantMedia`
→ ImageKit).

## User journeys

1. As a store operator, I want a logo near the documented 2 MB limit to actually
   upload, so that I don't hit an invisible framework cap.
2. As a store operator, I want a failed upload to show me an error, so that the
   form doesn't sit on "Uploading…" forever.

## Root cause

`next.config.ts` capped server-action bodies at `"2mb"`, exactly equal to the
logo/favicon `MAX_BYTES` (2 MB). Uploads travel as `multipart/form-data`, whose
encoding adds boundary + header overhead on top of the file bytes, so a 2 MB file
encodes to **2,119,148 bytes** — over the cap. Next rejects the request *before*
`uploadBrandingAssetAction` runs, and `AssetUpload.onFile` had no `try/catch`, so
`busy` stayed `true` and the UI hung with no error. The `MAX_IMAGE_BYTES = 10 MB`
constants were also dead — nothing over ~2 MB survived the body cap to reach them.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|---|---|---|---|
| Every declared per-file max fits under the body cap once multipart-encoded | `npm run test:upload-limits` | 4 pass / 6 fail → 10 pass / 0 fail | A file at the documented max is enforceable in-app, not silently killed by the framework |
| A thrown upload action resolves to `{ error }` instead of rejecting | `npm run test:upload-limits` | RED (threw) → GREEN | The form never hangs on "Uploading…"; failures render an error |
| The opaque body-limit throw maps to a human message | `npm run test:upload-limits` | RED → GREEN | Operator sees "File too large — try a smaller image." not a stack trace |
| `next.config.ts` reads the limit from the shared module | `npm run test:upload-limits` | GREEN | Config and per-file maxes can't drift back into conflict |

### RED evidence (`b6d2920`)

```
✗ a 2 MB logo fits under the configured body limit once encoded — a 2097152-byte
  logo encodes to 2119148 bytes, which exceeds the 2097152-byte body limit
✗ the 10 MB storefront-image max is reachable, not dead code
✗ settleUpload converts a thrown action into an error result (never rejects)
✗ settleUpload maps the opaque body-limit throw to a human message
✗ settleUpload survives a non-Error throw
✗ uploadErrorMessage never returns an empty string
4 passed, 6 failed
```

### GREEN evidence (`ef6154f`)

```
10 passed, 0 failed
```
`npx tsc --noEmit` → 0 errors.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `encodedSize` adds multipart overhead (encoded > raw) | `scripts/test-upload-limits.ts` | unit | PASS |
| 2 | 2 MB branding max fits under the body cap once encoded | `scripts/test-upload-limits.ts` | unit | PASS |
| 3 | 10 MB storefront-image max is reachable, not dead code | `scripts/test-upload-limits.ts` | unit | PASS |
| 4 | Body-limit string and byte count agree | `scripts/test-upload-limits.ts` | unit | PASS |
| 5 | `next.config.ts` reads `SERVER_ACTION_BODY_LIMIT` (no drift) | `scripts/test-upload-limits.ts` | integration | PASS |
| 6 | `settleUpload` returns the result on success | `scripts/test-upload-limits.ts` | unit | PASS |
| 7 | `settleUpload` converts a throw to `{ error }` (never rejects) | `scripts/test-upload-limits.ts` | unit | PASS |
| 8 | `settleUpload` maps body-limit throw to "File too large" | `scripts/test-upload-limits.ts` | unit | PASS |
| 9 | `settleUpload` survives a non-Error throw | `scripts/test-upload-limits.ts` | unit | PASS |
| 10 | `uploadErrorMessage` never returns an empty string | `scripts/test-upload-limits.ts` | unit | PASS |

## Files changed

- `src/lib/upload/limits.ts` (new) — single source of truth; `fitsServerActionBody()` invariant.
- `src/lib/upload/settle.ts` (new) — `settleUpload()` + `uploadErrorMessage()`.
- `next.config.ts` — body cap raised to `12mb`, imported from the shared module.
- `src/actions/branding.ts`, `src/actions/media.ts`, `src/actions/products.ts` — read shared maxes.
- `src/components/admin/BrandingEditor.tsx` — `AssetUpload.onFile`/`onRemove` route through `settleUpload`.
- `scripts/test-upload-limits.ts` (new) + `package.json` `test:upload-limits`.

## Coverage & known gaps

- No coverage instrumentation in this repo (convention: self-contained `tsx`
  gates). `test:upload-limits` covers every branch of both new modules.
- **Not addressed (out of scope of this fix):** the underlying slowness for
  files that *do* upload — every byte still double-hops (browser → Next server →
  ImageKit) with no client-side compression. The built-but-unused direct-to-
  ImageKit path (`/api/imagekit/auth` + `getTenantUploadAuth`) remains the real
  fix. Also unfixed: the awaited `mediaAsset.create` at `branding.ts:79` can
  still fail an upload whose image is already hosted (the other two actions guard
  this; this one doesn't).

## Merge evidence (for squash)

RED `b6d2920`: 4/10 pass — 2 MB logo encodes to 2,119,148 B > 2 MB cap; `settleUpload` rethrew.
GREEN `ef6154f`: 10/10 pass, tsc 0 — body cap → 12mb via shared module; `settleUpload` catches.
Refactor `7f7e96d`: `products.ts` routed through shared limits; 10/10 still green.
