# TDD Evidence — Hero Section image-banner mode

**Feature:** store owners can replace the written homepage hero with one uploaded
full-width banner image (height, focus point, alt text, click target, optional
text overlay + dark scrim).

**Branch:** `feat/gb-pricing-tab`
**Date:** 2026-07-28
**Pure core:** `src/lib/storefront/hero-media.ts`
**Gate:** `npm run test:hero-media`

## Source plan

No `*.plan.md` artifact — the plan was produced inline by `/ecc:plan` from a
Claude Design import (`Hero Section Admin.dc.html`, project
`bbb50641-cf5e-418b-b749-72db0946f257`, read via the `claude_design` MCP).

Two decisions were taken as stated defaults because the run proceeded without an
answer to the plan's open questions:

1. **Storage shape** — nested `branding.config.heroMedia`, mirroring
   `banner` / `cardDesign`, rather than more flat `hero*` keys.
2. **Scope** — classic-home tenants only. `TwoWaysHome.tsx` renders its own hero
   markup (`sf-twh__hero`) and is **deliberately excluded**; two-ways tenants
   (e.g. k-glow) are unaffected by this feature. See "Known gaps".

The design's cream/gold palette was **not** ported. The editor is themed from the
tenant's `--brand-*` tokens so it renders correctly for every white-label store —
the same decision already documented at the top of `AdminHeroSettings.tsx`.

## User journeys

1. As a store owner, I want to swap my written hero for one uploaded banner
   image, so my homepage matches my brand artwork.
2. As an owner who picked image mode but hasn't uploaded yet, I want my written
   hero to keep showing, so my storefront is never blank.
3. As an owner, I want the banner clickable to a page of my choice — or not
   clickable at all.
4. As an owner with a busy photo, I want a dark scrim so overlaid text stays
   readable.
5. As a customer, I must never be sent to a `javascript:` URL by a stored banner
   link.

## Task report

### Task 1 — Pure core (RED → GREEN)

Wrote `scripts/test-hero-media.ts` first, against a module that did not exist.

**RED** — `npm run test:hero-media`:

```
Error: Cannot find module '../src/lib/storefront/hero-media'
Require stack:
- /Users/…/scripts/test-hero-media.ts
  code: 'MODULE_NOT_FOUND'
```

Compile-time RED: the failure is caused by the intended missing implementation,
not by unrelated setup breakage. Checkpoint `ec20f13`.

**GREEN** — after writing `src/lib/storefront/hero-media.ts`:

```
42 passed, 0 failed
```

Checkpoint `d90c78c`. `npm run test:hero-links` re-run at 25/25 (unregressed).

### Task 2 — Persistence

`Brand.heroMedia` added; `saveHeroContentAction` merges `normalizeHeroMedia(input)`
into its existing read-modify-write of `branding.config`.

Type error surfaced and fixed during this task: Prisma's `InputJsonValue` rejects
`interface` types (no implicit index signature), so `HeroMedia` is a **type
alias**, matching `StorefrontBanner` / `CheckoutRulesConfig`.

```
npx tsc --noEmit → clean
npm run test:hero-media → 42 passed, 0 failed
```

No Prisma migration and no `db:push` — `heroMedia` lives inside the existing
`Branding.config` JSON column. Checkpoint `8ebd67d`.

### Task 3 — Storefront render

`Hero.tsx` gained an image branch ahead of the variant switch; `StorefrontApp.tsx`
extracted its CTA `switch` into a shared `targetHandler` now used by both the CTA
buttons and the banner click. Checkpoint `568eae6`.

```
npm run test:hero-media → 42 passed, 0 failed
npm run test:hero-links → 25 passed, 0 failed
npx tsc --noEmit → clean
```

### Task 4 — Admin editor

Mode picker, upload/replace/remove, height, focus, alt, link target, overlay +
scrim, desktop/mobile preview, tagline counter. Image panels extracted into
`AdminHeroMedia.tsx` to keep both files well under the 800-line limit.
Checkpoint `7c1c05b`.

```
npx tsc --noEmit → clean
npm run build → success (all routes compiled)
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Unknown/garbage config never throws and yields written-hero defaults | `test-hero-media.ts:empty input → safe written-hero defaults` | unit | PASS | `npm run test:hero-media` |
| 2 | `null`/`undefined`/number/string input does not throw | `test-hero-media.ts:null / non-object input does not throw` | unit | PASS | same |
| 3 | A `javascript:` banner src is stripped to `""` | `test-hero-media.ts:strips a javascript: image URL` | unit | PASS | same |
| 4 | A `data:text/html` src is rejected; only base64 **image** data URLs inline | `test-hero-media.ts:drops a non-image data: URL` | unit | PASS | same |
| 5 | An oversized data URL is dropped rather than bloating `branding.config` | `test-hero-media.ts:drops an oversized data: URL…` | unit | PASS | same |
| 6 | Scrim is clamped to 0–70 and snapped to the 5% step | `test-hero-media.ts:scrim clamps…` / `…snaps to the 5% step` | unit | PASS | same |
| 7 | Unknown ratio/focus/linkType/linkPage fall back to safe defaults | `test-hero-media.ts:unknown ratio / focus…`, `…unknown linkType…` | unit | PASS | same |
| 8 | Normalized output is a closed 10-key shape — no extra keys smuggled in | `test-hero-media.ts:output is a closed shape…` | unit | PASS | same |
| 9 | Normalizing normalized output is stable (idempotent) | `test-hero-media.ts:normalizing its own output is stable` | unit | PASS | same |
| 10 | **Journey 2:** image mode with no image renders the written hero | `test-hero-media.ts:image mode WITHOUT an image falls back…` | unit | PASS | same |
| 11 | Image mode whose URL was stripped as unsafe also falls back | `test-hero-media.ts:image mode whose URL was stripped…` | unit | PASS | same |
| 12 | Tenants with no `heroMedia` at all are unaffected (written hero) | `test-hero-media.ts:no heroMedia config at all…` | unit | PASS | same |
| 13 | Ratio keys map to 3:1 / 2:1 / 3:2 aspect ratios (reserves space, no CLS) | `test-hero-media.ts:ratio keys map to the designed aspect ratios` | unit | PASS | same |
| 14 | **Journey 4:** scrim alpha is 0 whenever the overlay is off | `test-hero-media.ts:scrim alpha is 0 whenever the overlay is off` | unit | PASS | same |
| 15 | **Journey 3:** `linkType: "none"` yields an inert banner | `test-hero-media.ts:linkType none → inert banner` | unit | PASS | same |
| 16 | **Journey 5:** a custom banner link with an unsafe URL never navigates | `test-hero-media.ts:custom + unsafe URL → inert…` | unit | PASS | same |
| 17 | Page/home/catalog link targets resolve identically to hero CTAs | `test-hero-media.ts:page catalog → catalog target` (+ home, track) | unit | PASS | same |
| 18 | Existing hero CTA link behaviour is unregressed | `scripts/test-hero-links.ts` | unit | PASS | `npm run test:hero-links` → 25/25 |
| 19 | Whole app compiles and all routes build with the new hero branch | `npm run build` | build | PASS | build output, all routes |

## Regression sweep

```
hero-media       42 passed, 0 failed
hero-links       25 passed, 0 failed
banner           35 passed, 0 failed
two-ways-home    14 passed, 0 failed
gb-pricing       33 passed, 0 failed
npx tsc --noEmit → clean
npm run build    → success
```

## Coverage and known gaps

This repo uses self-contained `tsx` assertion scripts, not Jest/Vitest — there is
no `npm run test:coverage` and no instrumented coverage number to quote. Coverage
is assessed by surface instead: **every exported function** in
`src/lib/storefront/hero-media.ts` (`safeImageSrc`, `normalizeHeroMedia`,
`resolveHeroMedia`, `heroMediaAspect`, `heroMediaPosition`,
`heroMediaScrimAlpha`, `resolveHeroMediaLink`) is exercised, including its
failure paths.

Intentional gaps — untested by automation, verified by build/typecheck only:

1. **React components** (`Hero.tsx` image branch, `AdminHeroSettings`,
   `AdminHeroMedia`). No component test harness exists in this repo. The logic
   they depend on is in the pure core and is covered; the JSX is not.
2. **The upload round-trip** (`uploadStorefrontImageAction`, ImageKit). Reuses the
   shared action already used by six other admin panels; not re-tested here.
3. **Visual regression** at 320/768/1024/1440 and the a11y pass (keyboard
   activation of the dropzone and the banner, contrast of overlay text over the
   scrim) — **not yet run**. Recommended before release.
4. **Two-ways home layout** is out of scope by decision, not oversight;
   `TwoWaysHome.tsx` keeps its own hero and ignores `heroMedia`.

## Post-review fixes (`/code-review`, same day)

Three findings landed in this feature's code and were fixed; the review's other
seven belong to the Group Buys → Pricing work earlier on this branch and were
left for a separate decision.

| Finding | Severity | Fix |
|---|---|---|
| Overlay CTA clicks bubbled to the banner wrapper → double navigation, and `role="link"` illegally wrapped `<button>`s | HIGH | Overlay `stopPropagation`s clicks; the wrapper is only a focusable `role="link"` when the overlay is OFF (`Hero.tsx:keyboardLink`). With the overlay on, the CTA is the keyboard affordance. |
| An over-cap `data:` URL (ImageKit unconfigured) was dropped silently — perfect preview, banner gone after Save | MEDIUM | New `heroMediaSrcIssue()`; `AdminHeroMedia` toasts "too large / unsupported" at upload time and refuses to store the value. |
| `safeHttpUrl` **truncated** long CDN URLs to 500 chars, persisting a broken 404 URL | LOW | `safeImageSrc` no longer routes http through `safeHttpUrl`; it checks length against `HERO_MEDIA_MAX_HTTP_URL_LEN` (2000) and rejects rather than truncates. |

Added 10 assertions (RED first: `42 passed, 10 failed` → GREEN `52 passed, 0 failed`),
including the round-trip guarantee the editor depends on — *any src
`heroMediaSrcIssue` clears is one `normalizeHeroMedia` keeps byte-exact*.

```
npm run test:hero-media → 52 passed, 0 failed
npm run test:hero-links → 25 passed, 0 failed
npx tsc --noEmit → clean
npm run build → ✓ Compiled successfully
```

The `Hero.tsx` propagation fix is JSX and therefore still covered only by build +
manual verification, per gap 1 below.

## Merge evidence

If these checkpoints are squashed, preserve:

- **RED** `ec20f13` — `test: add reproducer for hero image-banner mode`;
  `npm run test:hero-media` failed with `MODULE_NOT_FOUND` on the missing core.
- **GREEN** `d90c78c` — `feat: hero-media pure core…`; 42 passed, 0 failed.
- `8ebd67d` — persistence (`tsc` clean, no migration).
- `568eae6` — storefront render (hero-media 42/42, hero-links 25/25).
- `7c1c05b` — admin editor (`tsc` clean, `npm run build` passes).
