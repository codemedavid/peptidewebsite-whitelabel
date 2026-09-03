# TDD evidence — per-product share links

**Source plan:** inline `/ecc:plan` output in-session (no `*.plan.md` artifact).
**Branch:** `feat/made-to-order` · **Commits:** `5e10ff8` (RED) → `cad048c` → `6a3495e` → `8aa898e`

## User journeys

1. As a store owner, I want to send ONE customer ONE product, so that I don't
   have to say "open my store and scroll down".
2. As that customer, I want the link I was sent to preview as the product —
   photo, name, price — in Messenger/Viber, so I know what I'm being sent
   before I tap.
3. As that customer, I want the link to open on the product itself, on the
   store's real design, so it doesn't look like a different site.
4. As a store owner on an imported catalog, I want share links to work for my
   products too, not just ones created in the app.
5. As anyone holding an older `/products/<slug>` link, I want it to still work.

## Why a server route and not just a hash

A URL fragment is never sent to the server, so `#p/<slug>` pasted into a chat
previews as the bare store name with no photo. Journey 2 is only satisfiable by
a real route. This is the single load-bearing design decision in the change.

## Task report

| # | Task | Validation run | Result |
|---|------|----------------|--------|
| 1 | Gate written before implementation | `npm run test:product-link` | **RED** — `Cannot find module '../src/lib/storefront/product-link'` |
| 2 | Pure link helpers + slug through the mapping layer | `npm run test:product-link` | GREEN |
| 3 | `/p/[slug]` route with per-product OG tags | `npm run test:product-link`, live curl | GREEN |
| 4 | Share control on the classic card + quick-view | `npm run test:product-link` | GREEN |
| 5 | Two-ways shelf + group-buy page share controls | `npm run test:product-link` | **RED** vs `cad048c` (0 matches each), then GREEN |
| 6 | Slug backfill for non-create-path catalogs | `npx tsx scripts/backfill-product-slugs.ts` | 529 scanned, 529 already slugged, 0 to do |
| 7 | Browser verification | live curl at `peppies-intl.lvh.me:3100` | 2 defects found → fixed in `8aa898e` |

### RED evidence

```
$ npm run test:product-link
Error: Cannot find module '../src/lib/storefront/product-link'
Require stack:
- /Users/.../scripts/test-product-link.ts
```

Phase 5's RED was verified against the prior commit rather than by reverting
the working tree (a second session is active in this checkout, so `git stash`
was not safe):

```
$ git show cad048c:src/storefront/components/TwoWaysHome.tsx | grep -c ShareProductButton   → 0
$ git show cad048c:src/storefront/pages/GroupBuyPage.tsx   | grep -c 'variant="row"'         → 0
```

### GREEN evidence

```
$ npm run test:product-link      51 passed, 0 failed
$ npm run test:product-detail    20 passed, 0 failed
$ npx tsc --noEmit               (clean)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A product with a slug is addressed by it | `test-product-link.ts:productLinkKey` | unit | PASS |
| 2 | A product with no slug is still linkable, by id | same | unit | PASS |
| 3 | A blank/whitespace slug does not produce the bare path `/p/` | same | unit | PASS |
| 4 | Path, hash and absolute URL round-trip, including URL-unsafe keys | `productPath / productHash / parseProductHash` | unit | PASS |
| 5 | The share URL is correct for custom domains, `*.pepweb.store` and `lvh.me:3100` | `productShareUrl` | unit | PASS |
| 6 | `#p/<key>` never shadows `#catalog`, `#admin`, `#track`, `#groupbuy`, `#merchant`, `#order-confirmed` | `parseProductHash` | unit | PASS |
| 7 | A link key resolves slug-first, then id, so pre-backfill links survive it | `findProductByLinkKey` | unit | PASS |
| 8 | The slug survives the DB → storefront mapping | structural | integration | PASS |
| 9 | The SPA router parses `#p/<slug>` and threads it to the catalog | structural | integration | PASS |
| 10 | The deep-linked product is seeded at first render, so no catalog flash | structural | integration | PASS |
| 11 | `/p/[slug]` emits openGraph title, description and image | structural + live | integration | PASS |
| 12 | It reads tenant-scoped and 404s an unknown product | structural | integration | PASS |
| 13 | It renders the shared storefront home, not a rival product page | structural | integration | PASS |
| 14 | It is not gated behind `site.products` | structural | integration | PASS |
| 15 | Middleware 308s `/products/<slug>` before anything renders | structural + live | integration | PASS |
| 16 | The layout does not wrap `/p/` in the legacy chrome | structural | integration | PASS |
| 17 | The clipboard path has an `execCommand` fallback and a native share sheet | structural | integration | PASS |
| 18 | The two-ways shelf and group-buy page carry the control, in-flow | structural | integration | PASS |
| 19 | The backfill reuses the create path's `slugify` + `uniqueize` | structural | integration | PASS |

## Live verification (`peppies-intl.lvh.me:3100`)

| Request | Result |
|---|---|
| `/p/tirzepatide-15mg` | 200 · `og:title` "Tirzepatide 15 mg · Peppies Intl" · `og:description` "₱1,800.00 · …" · `og:image` ImageKit `tr=w-1200,q-75,f-auto` · `sf-detail` + product name in the server HTML |
| `/products/tirzepatide-15mg` | 308 → `/p/tirzepatide-15mg`; 200 after one hop |
| `/p/cmps0p8u00001mo7naj3njuzt` | resolves — the id fallback for imported catalogs |
| `/` | unchanged: 20 cards, 20 share buttons, no modal |

## Defects found by the browser pass (gates were green through both)

1. **`/products/<slug>` answered 200 with a not-found body instead of
   redirecting** — would have broken every legacy link. Cause: the
   `(storefront)` group has a `loading.tsx`, so its pages stream behind a
   Suspense boundary; Next flushes a 200 shell and a `redirect()` thrown in the
   page body afterwards can no longer set a status. Moved to middleware.
2. **A shared link flashed the bare catalog** before the quick-view appeared —
   the modal was opened from an effect, and effects don't run during SSR. Seeded
   with a lazy `useState` initializer.

Both are now gated (rows 15 and 10).

## Known gaps

- **An unknown `/p/<slug>` answers HTTP 200 with a not-found body**, not a 404.
  Same Suspense-boundary cause as defect 1, and **pre-existing** — the old
  `/products/[slug]` page called `notFound()` under the identical boundary.
  Left as-is rather than widened into this change. It matters for SEO (a dead
  product URL is indexable); fixing it means either removing the group's
  `loading.tsx` or resolving existence in middleware.
- No coverage of the `navigator.share` / clipboard / manual-fallback branches at
  runtime — they are browser-API-dependent and asserted structurally only.
- The backfill had nothing to do on this database (529/529 already slugged), so
  its write path is exercised only by the dry run.
- No visual regression screenshots: the Chrome MCP profile was held by a
  concurrent session and killing it was not safe.
