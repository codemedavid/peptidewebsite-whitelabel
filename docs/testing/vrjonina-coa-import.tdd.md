# VR Jonina lab certificate (COA) import — TDD evidence

**Source plan:** none. Journeys were derived during this TDD run from the request
"add also the coa … in tenant vr jonina, `Downloads/drive-download-20260910T233004Z-1-001`".

## User journeys

1. As the VR Jonina store owner, I want the 45 lab certificates I collected to appear on my
   storefront's Lab Reports page, so customers can check purity without me retyping anything.
2. As a customer, I want each card to show the correct lab, date and headline result, so the
   page is worth reading before I open a certificate.
3. As the store owner, I want a re-run of the import to refresh rows rather than duplicate
   them, and never to delete a report I added by hand.
4. As a customer, I want the page to paint quickly even though it carries 45 scans.

## Design decisions

- **Metadata was read off each certificate, not parsed from the file name.** The file names
  are unreliable: `Janoshik 04-31-2026 Ipamorelin` is an impossible date (the report reads
  30 APR 2026), `Janoshik 12_17_2026 GHKCu` is a year out (17 DEC 2025), and
  `Janoshik 12_16_2025 NAD PURITY` claims a purity test the certificate does not contain —
  that report states content only (529.73 mg). All 45 were read individually.
- **The purity chip carries the real headline result.** Certificates that report no purity
  figure show what they do report: `pH 7.62`, `8.58 mg/ml`, `Not detected`, `Pass`,
  `<1 EU/vial`. Nothing is inferred or rounded.
- **Certificates were re-encoded before hosting**: 21.9 MB of mixed webp/png/jpeg sources,
  one a 13.7 MB screenshot, became 4.1 MB of 1400 px JPEGs.
- **`coaPartners` was corrected** from the seed placeholder "Chromate" to the two labs that
  actually issued these reports, Janoshik and Vanguard.

## Task report

### 1. COA import core (`src/lib/storefront/coa-import.ts`)

- Validation command: `npm run test:coa-import`
- **RED** (commit `925133f`): `Cannot find module '../src/lib/storefront/coa-import'`
- **GREEN** (commit `912c644`): `19 passed, 0 failed`
- Guaranteed: the built row round-trips through the server's `normalizeCoaReports` unchanged;
  a nameless row, a missing or non-https image, and an unparseable date each throw rather
  than degrade; ids derive from the name so a re-import refreshes in place; a duplicate id
  inside one batch throws rather than silently dropping a lab result.

**The duplicate guard caught a real defect during the dry run.** Two Benzyl Alcohol
certificates produced ids that collided after the 50-character slug truncation
(`coa-bacteriostatic-water-10ml-benzyl-alcohol-test-1131`). Without the guard one of the two
lab results would have vanished. The names were shortened to `#113177` / `#113176`.

### 2. Lab report thumbnail sizing (`src/storefront/pages/COAPage.tsx`)

- Validation command: `npm run test:image-optimization`
- **RED** (commit `9d25f5c`): `5 FAILURE(S)` — COA page did not import the image layer,
  thumbnails were untransformed, not lazy, not async-decoded, no width constant.
- **GREEN** (commit `f792e7e`): `PASS`
- Guaranteed: thumbnails render through `imageUrl()` at `COA_THUMB_WIDTH` (640) with
  `loading="lazy"` and `decoding="async"`.

### 3. The import itself (`scripts/import-vrjonina-coa.ts`)

- Dry run: 45 certificates, `source 21.9 MB → hosted 4.1 MB`, `DRY RUN — nothing uploaded`.
- Apply: `✓ wrote 45 lab reports to branding.config for vrjonina`.
- Read-back: 45 rows in the database, every image on ImageKit.
- Browser check (`http://vrjonina.lvh.me:3100/#coa`, after a dev-server restart to flush the
  branding cache): 45 cards, 45 purity chips, 45 dates, **0 Invalid Date**, partners line
  reads "Janoshik + Vanguard". After scrolling the whole page: 45 thumbnails loaded,
  0 broken. On first paint only 15 transformed images are requested, the rest lazy-load.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A built report round-trips through the server normalizer byte-for-byte | `scripts/test-coa-import.ts:survives the server normalizer` | unit | PASS | `npm run test:coa-import` |
| 2 | A nameless report throws instead of being silently dropped | `scripts/test-coa-import.ts:buildCoaReport` | unit | PASS | `npm run test:coa-import` |
| 3 | A missing or non-https certificate image throws | `scripts/test-coa-import.ts:buildCoaReport` | unit | PASS | `npm run test:coa-import` |
| 4 | A date the card cannot render throws; a blank date is allowed | `scripts/test-coa-import.ts:buildCoaReport` | unit | PASS | `npm run test:coa-import` |
| 5 | A blank purity is allowed for tests with no purity figure | `scripts/test-coa-import.ts:buildCoaReport` | unit | PASS | `npm run test:coa-import` |
| 6 | Re-importing a report refreshes its row in place | `scripts/test-coa-import.ts:mergeCoaReportsById` | unit | PASS | `npm run test:coa-import` |
| 7 | An import never drops a report the owner added by hand | `scripts/test-coa-import.ts:mergeCoaReportsById` | unit | PASS | `npm run test:coa-import` |
| 8 | Two reports sharing an id abort the import instead of losing a result | `scripts/test-coa-import.ts:mergeCoaReportsById` | unit | PASS | caught a real collision in the dry run |
| 9 | Lab report thumbnails are ImageKit-sized, lazy and async-decoded | `scripts/test-image-optimization.ts` | source gate | PASS | `npm run test:image-optimization` |
| 10 | Untrusted COA config is sanitized before it reaches the page | `scripts/test-coa.ts` | unit | PASS | `npm run test:coa` (11 passed) |

## Coverage and known gaps

- No coverage tooling exists in this repository (no `test:coverage`, no Jest, no Vitest), so
  no percentage was measured and none is claimed. Suites touching this change:
  `test:coa-import` (19), `test:coa` (11), `test:image-optimization` (PASS).
- **Not automated:** the transcription of purity, lab and date off 45 certificate images.
  Each was read individually and each value is visible on the linked certificate, so a
  customer can check any figure against the source. The date format is machine-validated;
  the purity strings are not, because no machine-readable source exists.
- **Third-party branding:** every certificate is issued to "Mama Mica GLW", the supplier, and
  the Vanguard scans carry a large Mama Mica watermark. Flagged, not changed.
- **One scruffy asset:** the GHK-Cu December 2025 certificate is a phone screenshot with the
  browser chrome and status bar visible. Imported as supplied.
- **Cache:** the storefront caches branding, so the live page served the old list until the
  dev server was restarted. Production needs an admin Save or a restart.

## Merge evidence

- `925133f` test: RED — `test:coa-import` fails MODULE_NOT_FOUND on the missing import core.
- `912c644` feat: GREEN — `test:coa-import` 19 passed, 0 failed.
- `6475dc6` feat: the import script (dry run by default).
- `9d25f5c` test: RED — `test:image-optimization` 5 FAILURE(S) on the COA cards.
- `f792e7e` perf: GREEN — `test:image-optimization` PASS.
