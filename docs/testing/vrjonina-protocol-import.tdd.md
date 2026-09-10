# VR Jonina protocol guide import — TDD evidence

**Source plan:** none. Journeys were derived during this TDD run from the request
"add protocols to tenant vrjonina, all in this file `Downloads/drive-download-20260910T225906Z-1-001`".

## User journeys

1. As the VR Jonina store owner, I want the 34 supplier guide files I collected to appear
   on my storefront's Protocol Guide page, so customers can read dosing and preparation
   information without me retyping every document.
2. As the store owner, I want the protocols I already typed by hand to survive the import,
   so a bulk load can never quietly delete or duplicate my work.
3. As the store owner, I want a guide I already added (the MicaBlend 2.0 flyer) to be
   refreshed in place rather than added a second time.
4. As a customer reading the guides, I want the page to load quickly even though it now
   carries 89 guide images, and I want a larger render when I tap one to read it.

## Design decisions

- **One file becomes one image-mode protocol.** These are laid-out documents (quick-fact
  tables, dilution charts, do's and don'ts, step-by-step preparation) whose meaning does
  not survive being flattened into the five written Protocol fields. Image mode is also
  what the owner already chose for the MicaBlend 2.0 flyer that was on the page before
  this import. PDF pages are rendered at 144 dpi (≈1191×1685, ~215 KB as q82 JPEG).
- **No invented dosing text.** Image-mode rows are written with empty `dosage`,
  `frequency`, `duration`, `notes` and `storage` rather than text parsed out of the PDFs,
  because the storefront hides those fields in image mode and the owner never approved a
  paraphrase of medical-adjacent content. The rows stay editable in the store admin.
- **Two new categories** were needed — "Hormone Support" (HCG 500 IU) and "Immune Support"
  (Thymosin Alpha-1, VIP). Every other guide reuses a category the tenant already had.

## Task report

### 1. Import core (`src/lib/storefront/protocol-import.ts`)

Built `buildImageProtocol`, `protocolKey` and `mergeProtocolsByName` so a bulk import can
upsert guides into `branding.config.protocols` without losing hand-typed rows.

- Validation command: `npm run test:protocol-import`
- **RED** (commit `bbc5a88`):
  ```
  Error: Cannot find module '../src/lib/storefront/protocol-import'
  code: 'MODULE_NOT_FOUND'
  ```
- **GREEN** (commit `f5bcb8c`): `15 passed, 0 failed`
- Guaranteed: a same-named guide replaces its row in place, new guides append in order,
  existing rows the import does not mention are always kept, duplicate names inside one
  batch collapse, neither input list is mutated, and a nameless or imageless guide throws
  instead of writing a blank row.

### 2. Protocol gallery image sizing (`src/storefront/pages/ProtocolsPage.tsx`)

The page rendered raw `<img src>` for every guide page, so 89 imported images meant 14.8 MB
of full-resolution scans on one page.

- Validation command: `npm run test:image-optimization`
- **RED** (commit `1737c6b`): `5 FAILURE(S)` — protocols page did not import the image
  layer, thumbnails were untransformed, not lazy, not async-decoded, and no viewer width
  constant existed.
- **GREEN** (commit `2da8976`): `PASS`
- Guaranteed: gallery thumbnails go through `imageUrl()` at `PROTOCOL_THUMB_WIDTH` (640)
  with `loading="lazy"` and `decoding="async"`, and the full-size viewer requests a
  strictly larger render (`PROTOCOL_VIEWER_WIDTH`, 1200 — just under the ~1190 px a 144 dpi
  A4 page renders at, so it never pays for an upscale).

### 3. The import itself (`scripts/import-vrjonina-protocols.ts`)

Dry run, then applied against the live tenant.

- `npx tsx scripts/import-vrjonina-protocols.ts` → 34 guides, 89 images, 14.8 MB,
  `DRY RUN — nothing uploaded, nothing written.`
- `npx tsx scripts/import-vrjonina-protocols.ts --apply` →
  ```
  existing protocols: 26
    refreshed in place: 1 (MicaBlend 2.0 tirzepatide 30mg + cagrilintide 5mg)
    newly added:        33
  final protocol count: 59
  ✓ wrote 59 protocols to branding.config for vrjonina
  ```
- Read-back check: 59 protocols, 34 image-mode rows, 89 images, 0 non-ImageKit URLs,
  0 dry-run placeholders, sampled URLs return HTTP 200.
- Browser check (`http://vrjonina.lvh.me:3100/#protocols`): "59 protocols found",
  59 headings, 20 category options, and only 9 image requests on first paint — the closed
  accordions do not fetch, and the open one requests `tr=w-640,q-75,f-auto`.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A guide's page images become an image-mode protocol with empty, admin-editable written fields | `scripts/test-protocol-import.ts:buildImageProtocol` | unit | PASS | `npm run test:protocol-import` |
| 2 | Blank image URLs are dropped and the gallery is capped at MAX_PROTOCOL_IMAGES | `scripts/test-protocol-import.ts:buildImageProtocol` | unit | PASS | `npm run test:protocol-import` |
| 3 | A guide with no usable image or no name throws instead of writing a blank row | `scripts/test-protocol-import.ts:buildImageProtocol` | unit | PASS | `npm run test:protocol-import` |
| 4 | Name matching ignores case, spacing and punctuation but keeps different strengths apart | `scripts/test-protocol-import.ts:protocolKey` | unit | PASS | `npm run test:protocol-import` |
| 5 | A same-named guide is refreshed in place, never duplicated | `scripts/test-protocol-import.ts:mergeProtocolsByName` | unit | PASS | `npm run test:protocol-import` |
| 6 | An import never drops a protocol the owner typed by hand | `scripts/test-protocol-import.ts:mergeProtocolsByName` | unit | PASS | `npm run test:protocol-import` |
| 7 | Neither the existing nor the incoming list is mutated | `scripts/test-protocol-import.ts:mergeProtocolsByName` | unit | PASS | `npm run test:protocol-import` |
| 8 | Protocol gallery thumbnails are ImageKit-sized, lazy-loaded and async-decoded | `scripts/test-image-optimization.ts` | source gate | PASS | `npm run test:image-optimization` |
| 9 | The full-size viewer requests a larger render than the thumbnail | `scripts/test-image-optimization.ts` | source gate | PASS | `npm run test:image-optimization` |
| 10 | Legacy single-image and new multi-image protocols both still resolve | `scripts/test-protocol-images.ts` | unit | PASS | `npm run test:protocol-images` (10 passed) |
| 11 | The import script refuses to run if any file in the source folder is unmapped, or if the merge would shrink the list | `scripts/import-vrjonina-protocols.ts` guards | runtime guard | PASS | dry run listed all 34 files, final count 59 ≥ 26 |

## Coverage and known gaps

- This repository has **no coverage tooling** — there is no `test:coverage` script, no Jest
  and no Vitest. Testing is a suite of self-contained `tsx` gates under `scripts/`. No
  coverage percentage was measured, and none is claimed. The three suites touching this
  change all pass: `test:protocol-import` (15), `test:protocol-images` (10),
  `test:image-optimization` (PASS).
- **Not automated:** the PDF rendering step itself. It shells out to `python3` + PyMuPDF
  and was verified by eye on rendered output and by the byte counts in the dry run.
- **Left for the owner, deliberately:** ten pre-existing typed protocols cover the same
  peptide as a newly imported guide (NAD+, GHK-Cu ×2, Glutathione, Lipo C, MOTS-c ×2,
  KLOW, Semax+Selank, Tesamorelin). Deleting them was not requested, so the import reports
  them and leaves them in place.
- **Third-party branding:** every imported guide carries the supplier's "Mama Mica GLW"
  logo and their personal disclaimer. The owner had already accepted this for the
  MicaBlend 2.0 flyer; it now appears on 31 more guides. Flagged, not changed.
- **Cache:** a direct-Prisma script cannot flush the storefront's branding cache. The live
  page serves the previous list until an admin Save or a server restart.

## Merge evidence

If these commits are squashed, the RED/GREEN record is:

- `bbc5a88` test: RED — `test:protocol-import` fails MODULE_NOT_FOUND on the missing import core.
- `f5bcb8c` feat: GREEN — `test:protocol-import` 15 passed, 0 failed.
- `c7f1b25` feat: the import script (dry run by default).
- `1737c6b` test: RED — `test:image-optimization` 5 FAILURE(S) on the protocol gallery.
- `2da8976` perf: GREEN — `test:image-optimization` PASS.
