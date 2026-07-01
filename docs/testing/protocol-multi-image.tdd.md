# TDD Evidence — Multiple Images per Protocol

**Feature:** Let a store admin attach **several images** to a single protocol
(previously one `image`), in **both** presentation modes — an image-only
protocol becomes a gallery, and a details protocol can carry an optional gallery
below the typed fields. The public protocols page renders them as a **responsive
grid**. Fully backward-compatible with protocols already saved with a single
`image` string.

**Source plan:** Derived during this run from the approved `/ecc:plan` output for
"allow admin to upload several images of a protocol in one protocol" (scope =
both modes; display = responsive grid, both confirmed by the user). No
`*.plan.md` file was written.

## User journeys

1. As a store owner in **image mode**, I upload several dosing charts to one
   protocol and every image shows on the public page.
2. As a store owner in **details mode**, I attach a few supporting images and
   they render below the typed dosage/notes/storage fields.
3. As a store owner, I remove one image from a protocol's gallery without
   affecting the others.
4. As a customer, a protocol saved **before** this change (single `image`) still
   renders exactly as before — no data migration required.

## Design decision

Image resolution (new `images: string[]` vs. legacy single `image`) was
**extracted into a pure module** `src/lib/storefront/protocol-images.ts`
(`resolveProtocolImages` + `MAX_PROTOCOL_IMAGES`) so it is unit-testable without
the DB/Next/browser runtime, and so all three surfaces share one source of
truth: the server normalizer (`normalizeProtocols`), the admin editor
(`AdminProtocolsManager`), and the public page (`ProtocolsPage`). `images` is
authoritative when present (blanks dropped, capped); otherwise the legacy
`image` is used. New writes also mirror `image = images[0]` so any un-migrated
reader still resolves a value. This seam is what the RED/GREEN cycle proves.

## Task report

| Task | Summary | Validation command | Result |
|---|---|---|---|
| Extract + test image resolver | Wrote reproducer against a not-yet-existent module, then implemented it | `npm run test:protocol-images` | RED → GREEN (10/10) |
| Type + server normalize | `Protocol.images?: string[]`; `normalizeProtocols` canonicalizes via the core + mirrors `image` | `npm run typecheck` | GREEN, 0 type errors |
| Admin multi-upload UI | Batch upload, thumbnail grid + per-image remove, add tile; gallery in both modes | `npm run build` | Compiled successfully |
| Public responsive grid | `ProtocolsPage` renders `resolveProtocolImages(p)` as a grid in both modes | `npm run build` | Compiled successfully |

**RED evidence:** `npm run test:protocol-images` →
`Error: Cannot find module '../src/lib/storefront/protocol-images'`
(`MODULE_NOT_FOUND`), non-zero exit. The test compiled and executed against the
new symbol; the failure is the intended missing-implementation signal.

**GREEN evidence:** `npm run test:protocol-images` → `10 passed, 0 failed`, exit 0.

**Integration evidence:** `npm run typecheck` → exit 0; `npm run build` →
`✓ Compiled successfully`, `✓ Generating static pages (12/12)`. No stray direct
`.image` reads remain in the protocol surfaces (all route through
`resolveProtocolImages`).

## Test specification

| # | What is guaranteed | Test file / case | Type | Result |
|---|---|---|---|---|
| 1 | New `images[]` is returned as-is when present | `scripts/test-protocol-images.ts` | unit | PASS |
| 2 | Legacy single `image` resolves to `[image]` when `images` absent | `scripts/test-protocol-images.ts` | unit | PASS |
| 3 | `images` array is authoritative over a stale legacy `image` | `scripts/test-protocol-images.ts` | unit | PASS |
| 4 | Neither field set → `[]` | `scripts/test-protocol-images.ts` | unit | PASS |
| 5 | Empty `images: []` → `[]` (no legacy resurrection) | `scripts/test-protocol-images.ts` | unit | PASS |
| 6 | Blank/whitespace entries are dropped from `images` | `scripts/test-protocol-images.ts` | unit | PASS |
| 7 | A blank legacy `image` yields `[]`, not `[""]` | `scripts/test-protocol-images.ts` | unit | PASS |
| 8 | List is capped at `MAX_PROTOCOL_IMAGES` (order preserved) | `scripts/test-protocol-images.ts` | unit | PASS |
| 9 | Malformed non-array `images` does not throw | `scripts/test-protocol-images.ts` | unit | PASS |
| 10 | `MAX_PROTOCOL_IMAGES` is a sane positive cap | `scripts/test-protocol-images.ts` | unit | PASS |

## Coverage and known gaps

- This repo has **no coverage instrumentation** (tests are standalone `tsx`
  assertion scripts, e.g. `test:cart`, `test:hero-links`). Coverage is reported
  as guarantee coverage: the pure resolver — the backward-compat- and
  bound-critical logic — is fully exercised (10 assertions), and the server
  normalizer routes through the same core.
- **Untested (intentional):** the React presentation in `AdminProtocolsManager.tsx`
  (thumbnail grid, batch upload, remove/add tiles) and `ProtocolsPage.tsx` (grid
  render). These are visual/DOM concerns better covered by visual-regression/E2E
  than brittle markup assertions; the resolution *decision* they act on is
  covered by the resolver, and the server re-normalizes on save (the
  authoritative boundary + cap).
- **No DB migration:** protocols live in `branding.config` JSON; `images` is an
  additive optional field, so existing rows are unaffected. No `db:push` needed.

## Manual verification checklist (not automated)

- Store admin → Protocols → image mode: upload 3 images, confirm grid on
  `/#protocols`; details mode: attach images, confirm they render below fields.
- Confirm a pre-existing single-`image` protocol still renders unchanged.
- Responsive check at 320 / 768 / 1024 / 1440.
