# Storefront rendering & caching — TDD evidence

**Task:** `/ecc:tdd-workflow "Proper rendering proper caching"`
**Scoped with the user to:** the customer-facing storefront is slow to render and images take too long to load.
**Branch:** `main` · **Date:** 2026-08-24

No `*.plan.md` was supplied; journeys were derived during this run from the reported symptom
and from measurements taken against the running app and the real database.

---

## Diagnosis (measured, before any change)

### Images

| Observation | Value |
|---|---|
| `next/image` usages in `src/storefront` | **0** |
| Raw `<img>` tags in `src/storefront` | 46 (18 customer-facing) |
| ImageKit transformation params (`tr=`) anywhere in the repo | **0** |
| Customer-facing `<img>` carrying a `loading` attribute | 2 of 18 |

`next.config.ts` already declares `formats: ["image/avif","image/webp"]` and a
`remotePatterns` entry for `ik.imagekit.io` — but nothing used `next/image`, so
none of it applied. Every storefront image was served at its **original upload
resolution**: a ~2000px photo painted into a ~300px product-card slot, once per
product on the page.

### Render

Timed directly against the real DB (`hpglow`), in the order the home page runs them:

| Call | Cold | Warm | Cached? |
|---|---|---|---|
| `getFeatureRegistry` | 517ms | 505ms | **no** |
| `products.findMany` | 947ms | 708ms | **no** |
| `orders.findMany` (best-seller scan) | 804ms | 721ms | **no** |
| **sequential total** | **2271ms** | **1935ms** | |

`getTenantContext`, `getEntitlements`, `getTrialState` and the subscription
loaders are already `unstable_cache`-wrapped and were **not** the cost. The ~20
`await hasFeature(...)` calls in the page collapse to a single DB read via
React `cache()` — also not the cost.

HTTP measurement of the same page (dev server): `ttfb≈51–95ms`, `total≈4s`,
`size≈298KB`. The fast TTFB is the `loading.tsx` shell flushing immediately; the
real work streams in behind it.

---

## User journeys

1. As a shopper on a phone, I want product images sized for my screen, so the catalog paints in a moment instead of downloading desktop-sized originals.
2. As a shopper, I want the hero to appear immediately and below-the-fold art to load lazily, so the first screen isn't blocked by images I can't see.
3. As a store owner previewing an upload, I want my local preview to still render, so optimization never breaks the admin.
4. As a developer, I want the transform to be idempotent and query-safe, so re-wrapping a URL can't corrupt it.
5. As a shopper, I want the store to render without waiting on data nobody edited, so the page appears quickly.
6. As an operator, when I save the feature registry I want stores to pick it up, so caching never strands my change.
7. As a store owner, when an order lands I want best sellers to reflect it within the cache window, so the sort stays meaningful.

---

## Task report

### Task 1 — Size storefront images at the ImageKit edge

Added `src/lib/media/image-url.ts`: appends ImageKit's `tr=` transform (width,
capped quality, `f-auto` for edge AVIF/WebP negotiation) to ImageKit-hosted URLs
**only**. `data:` / `blob:` / relative / foreign-host sources pass through
byte-for-byte, so admin upload previews and legacy art keep rendering. The
transform is query-safe (merged via `searchParams`, never a second `?`) and
idempotent (an existing `tr=` wins).

Wired through 12 customer-facing components with `srcSet`/`sizes` on repeated
images, `loading="lazy"` + `decoding="async"` below the fold, and the hero left
`eager` + `fetchPriority="high"` because it is the LCP element.

**Why URL transforms and not `next/image`:** ImageKit is already the CDN and does
this at its own edge; `next/image` would route every image through Vercel's
optimizer for no gain, and would fight storefront CSS that is tuned around real
`<img>` boxes (a documented hazard in this repo).

- RED: `npm run test:image-optimization` → `MODULE_NOT_FOUND: src/lib/media/image-url`
- GREEN: `npm run test:image-optimization` → **PASS**, 44 checks
- Live confirmation: refetched the rendered page — **205 of 266** `ik.imagekit.io`
  URLs in the HTML now carry `tr=w-`.

**Guaranteed:** ImageKit sources are resized/format-negotiated at the edge; non-ImageKit
sources are never rewritten; the hero keeps its LCP priority; below-the-fold art defers.

### Task 2 — Cache the two per-render reads nobody needs fresh

- `getFeatureRegistry` reads **one platform-global** `platform_settings` row that
  changes only when an operator saves, and only decides whether a cosmetic "new"
  badge shows. Every storefront on the platform paid a round trip for it. Now
  `unstable_cache`'d (1h) behind `platform:feature-registry`, busted inside
  `persistFeatureRegistry`. Demo mode still bypasses; reads still cannot throw.
- The best-seller tally is a full scan of the tenant's active orders (~490 for
  hpglow) reduced to a per-product count that only orders a sort dropdown. Moved
  to `src/lib/storefront/best-sellers.ts`, cached 5min on `tenant:<id>` +
  `tenant:<id>:orders`. Only the reduced counts leave the module.

`products.findMany` is **deliberately left uncached** — product rows carry stock,
and serving stale stock risks overselling. That is a product decision, not a perf one.

- RED: `npm run test:storefront-render-cost` → 5 failed assertions + `MODULE_NOT_FOUND: best-sellers`
- GREEN: `npm run test:storefront-render-cost` → **PASS**, 23 checks

**Guaranteed:** ~1.2s of uncached sequential DB work is removed from every storefront
render; an operator's registry save still propagates; a trashed order still never ranks
as a sale; the stock read stays live.

### Task 3 — Keep the order-trash invariant intact across the move

`test:order-trash` enforced "every `storefront_orders` read spreads
`ACTIVE_ORDERS_WHERE`" by auditing `page.tsx`. Moving the best-seller read would
have slipped it out from under that guard. The audit now covers
`best-sellers.ts` as well and asserts the pair still adds up — the guarantee was
**extended, not relaxed**.

- GREEN: `npm run test:order-trash` → **PASS**

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Only ImageKit-hosted URLs are ever rewritten (parsed, not substring-matched) | `test-image-optimization.ts:isImageKitUrl` | unit | PASS |
| 2 | An ImageKit URL is resized, quality-capped and format-negotiated | `test-image-optimization.ts:imageUrl` | unit | PASS |
| 3 | `data:` / `blob:` / relative / foreign sources pass through unchanged | `test-image-optimization.ts:never corrupts` | unit | PASS |
| 4 | An existing query string survives; no second `?` is emitted | `test-image-optimization.ts:query-safe` | unit | PASS |
| 5 | Re-wrapping a URL does not stack transforms | `test-image-optimization.ts:idempotent` | unit | PASS |
| 6 | `srcSet` emits one transformed candidate per width with its descriptor | `test-image-optimization.ts:imageSrcSet` | unit | PASS |
| 7 | Card/hero width ladders ascend; card stays below hero; hero `sizes` is `100vw` | `test-image-optimization.ts:constants` | unit | PASS |
| 8 | Catalog images lazy-load, decode async, and are responsive | `test-image-optimization.ts:wiring` | integration | PASS |
| 9 | Hero stays eager with `fetchPriority=high` (LCP element) | `test-image-optimization.ts:wiring` | integration | PASS |
| 10 | Feature registry reads through a tagged, revalidating cache | `test-storefront-render-cost.ts:getFeatureRegistry` | integration | PASS |
| 11 | `persistFeatureRegistry` itself busts the tag | `test-storefront-render-cost.ts` | integration | PASS |
| 12 | Demo mode bypasses the cache; reads still cannot throw | `test-storefront-render-cost.ts` | integration | PASS |
| 13 | Best-seller tally is cached per tenant and tag-busted | `test-storefront-render-cost.ts:best sellers` | integration | PASS |
| 14 | The tally selects only `status`+`items` and returns counts, never orders | `test-storefront-render-cost.ts` | integration | PASS |
| 15 | `getBestSellerCounts` returns a count map and tallies nothing for an unknown tenant rather than throwing | `test-storefront-render-cost.ts:behaviour` | unit | PASS |
| 16 | Products are still read live (fresh stock) | `test-storefront-render-cost.ts` | integration | PASS |
| 17 | Every order read — in the page *and* the new loader — excludes trashed rows | `test-order-trash.ts` | integration | PASS |

Full sweep: **16 suites PASS** (`image-optimization`, `storefront-render-cost`,
`order-trash`, `catalog-sort`, `hero-flush`, `footer-style`, `brand-splash`,
`two-ways-home`, `boutique-home`, `editorial-home`, `store-status`, `cart`,
`two-ways-mode`, `price-font`, `gate`, `staff`) · `tsc --noEmit` clean.

---

## Coverage and known gaps

Exported-symbol coverage on the three new/changed units: **12/12 (100%)**.
The repo has no global coverage instrumentation (script-based `tsx` suites, no
Jest/Vitest), so this is symbol-level, not line-level.

**Honest gaps:**

- **No measured after-number for end-to-end page time.** The before-numbers are
  real (direct DB timing + HTTP timing). A concurrent session took the dev server
  on port 3100 down mid-task and I did not start a competing one, since that
  would collide on `.next/` and 500 the other session. The ~1.2s figure is the
  sum of the two calls removed from the render path, not an observed page delta.
  **Re-measure before/after on a production build to confirm.**
- **`products.findMany` (708ms) is untouched** — deliberately. Caching it trades
  stock freshness for speed and needs a product decision.
- The ~300KB HTML payload is dominated by a single 77KB RSC push (brand +
  catalog serialized for the client `StorefrontApp`). Not addressed here.
- A 3.9KB RSC chunk carries 3 order records (product names/qty/price, no PII)
  into the public payload. Small, but unexplained — worth a look.
- Admin-surface images (`src/storefront/admin/*`) were left unoptimized; the
  reported symptom was customer-facing.

## Merge evidence

Checkpoint commits on `main`, all reachable from `HEAD`:

| Stage | Commit |
|---|---|
| RED (images) | `c3a1735` test(storefront): reproducer for unoptimized storefront images |
| GREEN (images) | `d8541ae` perf(storefront): size images at the ImageKit edge |
| RED (render) | `7fa5737` test(storefront): reproducer for uncached per-render data cost |
| GREEN (render) | `b791a9d` perf(storefront): cache the two per-render reads nobody needs fresh |
| Refactor | `refactor(storefront): close coverage gaps on the new perf units` |

Note: a concurrent session interleaved unrelated commits into this branch during
the run (`ea3dab4`, `d7f6a2c`, `167eac1`, `934903a`). Each checkpoint above was
verified to contain only this task's files.
