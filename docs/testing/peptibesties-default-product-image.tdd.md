# TDD Evidence — Per-tenant default product image + PeptiBesties rebrand

**Date:** 2026-07-23 · **Branch:** main · **Commits:** `9926dd6` (RED), `2c50534` (GREEN)

## Source plan

No `*.plan.md` — journeys derived in-session from the request: make the supplied
PeptiBesties vial photo the default image of the products for tenant
`fit-n-glow`, and rebrand the tenant to **PeptiBesties** (name **and**
subdomain, per user's explicit choice).

## User journeys

1. As a store visitor, I see the brand's vial photo on any product without its
   own image, instead of a generic SVG/monogram placeholder.
2. As a store owner, products with real photos keep them — the default never
   overrides an actual image.
3. As the operator, a stored `defaultProductImage` config value can never place
   a `javascript:`/`data:` URL into an `<img src>`.
4. As the PeptiBesties owner, my store now lives at `peptibesties.<root>` under
   the name "PeptiBesties".

## Task report

| Step | Command | Result |
|---|---|---|
| RED | `npm run test:default-product-image` | `MODULE_NOT_FOUND ../src/lib/storefront/product-image` — intended missing implementation (compile-time RED) |
| GREEN | `npm run test:default-product-image` | **19 passed, 0 failed** |
| Typecheck | `npx tsc --noEmit` | Only 2 pre-existing errors in untouched legacy scripts (`fix-pepstack-reseller.ts`, `remove-reseller-data.ts`) |
| Data op (dry) | `node --env-file=.env --import tsx scripts/rebrand-fit-n-glow-peptibesties.ts --image=…` | Printed exact 4-step plan, no writes |
| Data op (apply) | same + `--apply` | slug `fit-n-glow`→`peptibesties`, name/storeName/config.name → `PeptiBesties`, vial uploaded to `/tenant/peptibesties`, `config.defaultProductImage` set, MediaAsset recorded |
| Verify | read-only Prisma inspect | DB confirms all fields (see below) |

Applied-state verification output:

```json
{
  "slug": "peptibesties",
  "name": "PeptiBesties",
  "storeName": "PeptiBesties",
  "configName": "PeptiBesties",
  "defaultProductImage": "https://ik.imagekit.io/jl17byaav/tenant/peptibesties/default-product-image_ORWrhnprM.jpeg?updatedAt=1784738036490"
}
```

First `--apply` run failed at `mediaAsset.create` (missing required
`imagekitId`) AFTER the rename+upload succeeded; the script was fixed to record
`up.fileId` and to reuse the already-uploaded file — the re-run logged
`✓ reusing uploaded …` (no duplicate object).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `normalizeDefaultProductImage` keeps http(s) URLs, trims whitespace | `scripts/test-default-product-image.ts` | unit | PASS |
| 2 | rejects `javascript:`, `data:`, relative paths, empty, non-strings | same | unit | PASS |
| 3 | `resolveProductImage`: own image wins; falls back on null/empty; null when neither | same | unit | PASS |
| 4 | Catalog, MerchantPage, TwoWaysHome, GroupBuyPage resolve through the fallback | same (structural) | integration | PASS |
| 5 | `Brand` declares `defaultProductImage`; page.tsx normalizes server-side; SEO detail page falls back | same (structural) | integration | PASS |

## Design notes

- `ProductCard` takes `defaultImage` as an **optional prop** (not `useStore`)
  because the platform admin's `CardDesignPicker` renders it outside the
  `StoreProvider`.
- Fallback is applied at **render**, not in the product mapping, so the store
  admin's product editor still shows "no image" for imageless products (no
  split-brain writes of the default onto Product rows).
- Slug-change blast radius (accepted): old ImageKit objects stay under
  `/tenant/fit-n-glow` (absolute URLs keep working); host-scoped cookies force
  re-login on the new subdomain; old emailed links to `fit-n-glow.<root>` break;
  cached host→tenant mapping expires ≤5 min on a running server.

## Coverage and known gaps

- The pure module `src/lib/storefront/product-image.ts` is fully covered (both
  functions, all branches).
- Component rendering is covered structurally (source-level assertions), not by
  DOM tests — consistent with this repo's script-based test convention.
- Cart/checkout renders no product images (verified) — no fallback needed there.
- No store-admin UI to change the default image yet (user chose the
  script-managed variant); adding an upload control to the branding panel is the
  natural follow-up.
