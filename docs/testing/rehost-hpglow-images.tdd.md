# TDD Evidence — Re-host hpglow images off old Supabase

**Task:** Rescue the `hpglow` tenant's images, which physically live in an OLD
Supabase project (`rtsnxmatvbabdylsnuuh.supabase.co`, bucket `menu-images`) while
the live app runs on a DIFFERENT Supabase project (`gnyeeoirbqxhyujptbwn`). Only
the URLs were copied into our DB — the image bytes never moved — so if the old
project is paused/deleted the images 404. Re-host them to the tenant's own
ImageKit folder and rewrite every stored reference.

**Source plan:** none — journeys derived during this run from the user's question
("if the old Supabase account is on hold, will the images be gone since the
reference is from the old Supabase?").

## Diagnosis (verified against the live DB)

- 52 distinct image URLs on host `rtsnxmatvbabdylsnuuh.supabase.co`, all under
  the `hpglow` tenant: **41 in `product.images`, 11 in `branding.config`**.
- Every other tenant's images already use `ik.imagekit.io` (311 URLs) — hpglow
  is the only tenant hostage to the old project.
- All 52 old URLs returned **HTTP 200** at diagnosis time (migration window open).

## User journeys

1. As the operator, I want hpglow's foreign image references identified so I know
   exactly what breaks if the old Supabase account is suspended.
2. As the operator, I want every foreign image downloaded to an off-site backup
   before any change, so the bytes survive even if the old project dies.
3. As the operator, I want a dry run that previews the exact DB rows that would
   change, and never writes the DB without `--apply`.
4. As the operator, when I apply, I want URLs rewritten **only** for images that
   were successfully re-hosted — never leaving a dangling reference.

## Task report

- **Pure rewrite logic** (`src/lib/migration/rehost-urls.ts`) — deep, exact,
  immutable JSON URL rewriter + collectors.
  - RED: `npx tsx scripts/test-rehost-urls.ts` → `Error: Cannot find module
    '../src/lib/migration/rehost-urls'` (test exercises the missing module).
  - GREEN: `npm run test:rehost-urls` → `12 passed, 0 failed`.
  - Guarantees: only mapped URLs change; unrelated ImageKit URLs untouched; input
    object never mutated; replacement count reported; deep nesting handled.
- **Migration orchestration** (`scripts/rehost-hpglow-images.ts`) — dry-run by
  default; download + backup + preview; `--apply` uploads to ImageKit and writes DB.
  - Dry run: `npx tsx scripts/rehost-hpglow-images.ts` →
    `downloaded: 52/52`, backup at `.rehost-backup/hpglow` (52 files, 73 MB),
    preview lists 41 products + `branding.config` (11 URLs). No DB write.
  - Apply: requires ImageKit creds (absent from local `.env`); aborts the DB
    write if any image fails to re-host, so no dangling reference is left.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Foreign-host detection matches old host, ignores our ImageKit host, tolerates non-URLs | `test-rehost-urls.ts:isForeignHostUrl*` | unit | PASS | `npm run test:rehost-urls` |
| 2 | All foreign URLs collected deep from arrays + nested objects, de-duplicated | `test-rehost-urls.ts:collectMatchingUrls*` | unit | PASS | `npm run test:rehost-urls` |
| 3 | Only mapped URLs rewritten; unmapped strings & non-strings preserved byte-for-byte | `test-rehost-urls.ts:rewriteJsonUrls leaves unmapped…` | unit | PASS | `npm run test:rehost-urls` |
| 4 | Input JSON is never mutated (immutability) | `test-rehost-urls.ts:…does NOT mutate the input` | unit | PASS | `npm run test:rehost-urls` |
| 5 | Every occurrence counted, incl. duplicates | `test-rehost-urls.ts:…counts every occurrence` | unit | PASS | `npm run test:rehost-urls` |
| 6 | Dry run downloads all foreign images and writes zero DB changes | `scripts/rehost-hpglow-images.ts` (no `--apply`) | integration (manual) | PASS | `downloaded: 52/52`, DB untouched |

## Coverage and known gaps

- The risky pure logic (URL rewrite) is unit-covered (12 assertions).
- The IO orchestration (download/upload/DB write) was validated via the dry run
  and then the real `--apply` run on 2026-07-22 (ImageKit creds added to `.env`):
  `✅ APPLIED: uploaded 52, updated 41 product(s), rewrote 52 reference(s)`.
- **Post-apply verification (independent of the script), against the live DB:**
  hpglow now has **0** `rtsnxmatvbabdylsnuuh.supabase.co` references and **52**
  `ik.imagekit.io/…/tenant/hpglow/` references; a sampled new URL returns HTTP 200.
  Rescue complete — hpglow no longer depends on the old host.
- Note: two tenants resemble hpglow — `hpglow` (affected) and `hp-glow` (slug with
  hyphen). Only `hpglow` carries foreign URLs. Possible duplicate to reconcile.
