# Proof-of-payment uploads refused before they reach ImageKit

**Source plan:** none — journeys were derived during this TDD run from the report
"k-glow users not allowing to upload payment proof".

## Investigation: the premise did not hold

The report named one tenant, so the first job was deciding whether anything about
k-glow was actually different. It is not.

| Checked | Finding |
|---|---|
| Upload path | `uploadPaymentProofAction` (`src/actions/orders.ts`) via `CartCheckout.tsx` — shared by every tenant. The two-ways home layout k-glow uses still renders the one `CartCheckout`. |
| Is it working at all? | Yes. 14 of k-glow's 19 orders carry an ImageKit-hosted proof; the two most recent landed 2026-08-23 05:28 and 03:51 UTC. |
| Orders without proof | 5, all `pending`, newest 2026-08-11. |
| Tenant config | `requireProofOfPayment` unset → required (default). One active payment method (GoTyme) → `requiresPayment` true → the upload box renders. |
| Vercel runtime errors, 7d | No proof-upload errors. Failures return `{ error }` rather than throwing, so they never reach that table. |
| Body-size limit (first suspicion) | **Ruled out.** A 4.22 MB payment proof (hpglow, 2026-08-12) and a 4.49 MB product image uploaded fine, so `bodySizeLimit: "12mb"` is in effect. |

So this was never a tenant-wide block — it is individual customers hitting a
client-side refusal. The owner could not say which message they saw, so every
guard on the path was hardened rather than one guessed at.

## User journeys

1. As a customer paying by GoTyme on Android, I want my receipt screenshot
   accepted **even when my browser reports no MIME type for the file**, so I can
   finish checkout.
2. As an iPhone customer, I want a HEIC photo accepted without converting it.
3. As a customer holding a PDF bank receipt, I want to be told to send a
   screenshot instead of hitting an opaque "Unsupported type" dead end.
4. As a customer whose upload fails, I want the real reason, so I know whether to
   retry or shrink the image.
5. As the operator, I want refusals recorded, so the next report is diagnosable.

## Root cause

Both call sites gated on `file.type.startsWith("image/")`. `File.type` is a hint
the browser copies from the OS, not a fact about the bytes. Android's
Files/Documents picker, the Messenger and Instagram in-app webviews, and some
Samsung gallery builds hand back a genuine JPEG with `type === ""` or
`"application/octet-stream"`. Those customers were told *"Please pick an image
file."* about a real screenshot, with no way forward.

The refusal happened **before any byte reached ImageKit**, so nothing appeared in
the media library, nothing was logged, and the failure was invisible to the
operator — which is exactly why the report arrived with no detail attached.

## Task report

| Step | Command | Result |
|---|---|---|
| RED | `npm run test:proof-upload` | `Cannot find module '../src/lib/upload/image-file'` — the shared guard did not exist. Commit `ca05f6f`. |
| RED (runtime) | `npm run test:proof-upload` after adding the guard module | 12 passed, **3 failed** — the three call-site assertions, against unfixed production code. |
| GREEN | `npm run test:proof-upload` | **15 passed, 0 failed.** Commit `6e3694a`. |
| Typecheck | `npx tsc --noEmit --incremental` | exit 0. |
| Neighbours | `test:upload-limits`, `test:payment-proof-viewer`, `test:checkout-total`, `test:order-detail`, `test:cart`, `test:two-ways-cart`, `test:order-confirmation` | all PASS. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An Android JPEG arriving with an empty `type` is accepted on its extension | `scripts/test-proof-upload.ts` | unit | PASS |
| 2 | A screenshot sent as `application/octet-stream` is accepted | same | unit | PASS |
| 3 | An iPhone `.HEIC` with no reported type is accepted | same | unit | PASS |
| 4 | Extension matching is case-insensitive | same | unit | PASS |
| 5 | A declared `image/*` type is accepted, even with no extension | same | unit | PASS |
| 6 | A PDF receipt is refused **and told to send a screenshot** | same | unit | PASS |
| 7 | A `.pdf` with no reported type is refused on its extension too | same | unit | PASS |
| 8 | Videos and unknown extensions are refused | same | unit | PASS |
| 9 | A refusal never returns a blank reason | same | unit | PASS |
| 10 | `uploadPaymentProofAction` gates on the shared guard, not raw `startsWith` | same (source assertion) | integration | PASS |
| 11 | `CartCheckout` gates on the shared guard, not raw `startsWith` | same (source assertion) | integration | PASS |
| 12 | A failed upload surfaces the real reason, not a canned message | same (source assertion) | integration | PASS |

## Coverage and known gaps

- `src/lib/upload/image-file.ts` is covered exhaustively by the table above
  (every branch of `classifyProofFile`).
- **Not fixed:** `uploadStorefrontImageAction` (`src/actions/media.ts`) still
  gates on `file.type.startsWith("image/")`. Same defect class, but it is
  store-admin-facing rather than customer-facing, so it was left out of this
  change to keep the diff reviewable. It is a one-line swap to the same guard.
- **Not verified in the field.** The owner could not say which message customers
  saw, so this hardens every guard on the path rather than confirming one. The
  new `[payment-proof] refused for tenant …` warning is what will confirm it:
  if refusals keep appearing after deploy, the log line names the file, type and
  size that were rejected.
- No E2E test — the failure mode depends on a browser reporting a blank MIME
  type, which Playwright cannot faithfully reproduce.
