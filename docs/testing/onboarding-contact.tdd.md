# TDD evidence — WhatsApp-only Step 1 contact

**Source plan:** none. Journeys were derived during this TDD run from the owner's
request on the `/get-started` wizard Step 1 ("Business information"), plus two
clarifying answers (WhatsApp required; surface it in the Super Admin).

Owner's request, verbatim:

> we can remove the gmail and the whatsapp connect it automatically to the tenant
> so that i dont need to connect it manually and add a note in the whatsapp part
> that its to contact you once the website is done

Clarifications: WhatsApp should be **required**, and "connect it automatically"
means *"like connect it in whe whitelabel super admin part so i can contact them
easily"* — i.e. the number surfaces as one-tap contact for the operator, not as a
storefront setting.

## User journeys

1. As a client signing up, I want to give my WhatsApp number instead of an email,
   so that I'm contacted the way I actually use.
2. As a client, I want the form to tell me *why* my WhatsApp is needed, so I know
   it's how I'll hear that my website is done.
3. As a client, I can't accidentally submit an unreachable number — the form
   blocks a blank or undialable one.
4. As the operator, I want to message a sign-up straight from the Super Admin,
   so I never copy a number out of a submission by hand.
5. As the operator, I want older submissions (which have an email and no
   WhatsApp) to keep rendering, so the change isn't retroactive damage.

## Task report

| # | Task | Validation command | Result |
|---|------|--------------------|--------|
| 1 | Make `email` optional and `whatsapp` required + dial-validated in `onboardingSchema` | `npm run test:onboarding-contact` | RED → GREEN |
| 2 | Swap step-0 validation from email to WhatsApp; drop `email` from `Draft`/`draftToPayload` | `npm run test:onboarding-contact` | RED → GREEN |
| 3 | Remove the email field from `BusinessStep`; mark WhatsApp required with the contact note | `npm run test:onboarding-contact` | RED → GREEN |
| 4 | Success screen promises a WhatsApp message instead of an email | `npm run test:onboarding-contact` | RED → GREEN |
| 5 | Carry `whatsapp` on `OnboardingSummary`; populate in DB + demo mappers | `npm run test:onboarding-contact` | RED → GREEN |
| 6 | Super Admin list: search by number, show it as the row subtitle | `npm run test:onboarding-contact` | RED → GREEN |
| 7 | Super Admin detail: `wa.me` click-to-chat link in the header and Business card | `npm run test:onboarding-contact` | RED → GREEN |
| 8 | Type the server action's input as the schema's pre-defaults type | `npx tsc --noEmit` | GREEN (no output) |

### RED evidence

Run before any production change (commit `a489b8f`):

```
Onboarding Step 1 — WhatsApp replaces email as the contact channel
  ✗ accepts a submission that has no email address at all — expected parse to succeed,
    got [{"code":"invalid_type","expected":"string","received":"undefined","path":["email"]}]
  ✗ step 1 never reports an email error — unexpected email error: {"email":"Please enter a valid email address."}
  ✗ BusinessStep no longer renders the email address field — the email input is still rendered in Step 1
  ✗ the submission detail renders a wa.me click-to-chat link — the detail view does not build a wa.me link
  …
3 passed, 16 failed
```

All 16 failures were the intended missing behavior, not setup breakage.

### GREEN evidence

```
$ npm run test:onboarding-contact
19 passed, 0 failed

$ npx tsc --noEmit --pretty false
(no output)
```

Neighbouring suites, re-run for regressions:

```
test:checkout-total       13 passed, 0 failed
test:contact-channels     12 passed, 0 failed
test:yearly-subscription  27 passed, 0 failed
```

One assertion was corrected mid-run rather than the code: the header check
originally demanded `submission.email` be absent entirely, but the header keeps
it as a **fallback** for legacy rows. The assertion now proves WhatsApp *leads*
and email only appears behind the fallback branch.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A submission with no email at all is accepted | `scripts/test-onboarding-contact.ts:accepts a submission that has no email address at all` | unit | PASS |
| 2 | A submission with no WhatsApp number is rejected | `…:rejects a submission with no WhatsApp number` | unit | PASS |
| 3 | An undialable (too short) number is rejected | `…:rejects a WhatsApp number that is too short to dial` | unit | PASS |
| 4 | `+`, spaces and dashes are accepted and normalized | `…:accepts a human-formatted WhatsApp number` | unit | PASS |
| 5 | Step 1 never raises an email error | `…:step 1 never reports an email error` | unit | PASS |
| 6 | Step 1 blocks on a blank or too-short number | `…:step 1 blocks on a missing WhatsApp number` / `…too short` | unit | PASS |
| 7 | Step 1 passes on name + dialable number | `…:step 1 passes with a business name and a dialable WhatsApp number` | unit | PASS |
| 8 | The submit payload carries no email key | `…:draftToPayload no longer sends an email field` | unit | PASS |
| 9 | The email input is gone from Step 1 | `…:BusinessStep no longer renders the email address field` | structural | PASS |
| 10 | WhatsApp is required and shows its error | `…:BusinessStep marks WhatsApp as required and surfaces its error` | structural | PASS |
| 11 | The field explains we message them when the site is ready | `…:BusinessStep explains that WhatsApp is how we reach them` | structural | PASS |
| 12 | The success screen promises a WhatsApp message | `…:the success screen promises a WhatsApp message, not an email` | structural | PASS |
| 13 | `OnboardingSummary` carries the number | `…:OnboardingSummary carries the WhatsApp number` | structural | PASS |
| 14 | Both DB and demo mappers populate it | `…:both the DB and demo summary mappers populate whatsapp` | structural | PASS |
| 15 | The list is searchable by number | `…:the onboarding list is searchable by WhatsApp number` | structural | PASS |
| 16 | The detail builds a wa.me link | `…:the submission detail renders a wa.me click-to-chat link` | structural | PASS |
| 17 | The header leads with WhatsApp, email is legacy fallback | `…:the submission detail header leads with WhatsApp` | structural | PASS |

## Coverage and known gaps

This repo has no global coverage runner; the convention is one self-contained
`tsx` script per behavior (`npm run test:<name>`). Coverage of the changed
behavior is complete at the unit level; the structural guards stand in for
component rendering, which the repo does not currently exercise with a DOM
testing library.

Known gaps, deliberate:

- **No DB migration.** `OnboardingSubmission.email` stays `String` (non-null) and
  now receives `""` for new sign-ups, so no `db:push` is needed. If the column
  should become nullable, that's a separate, migration-bearing change.
- **`Settings.supportEmail`** is now seeded with `""` for new tenants (it is
  `String?` and read nowhere else in the app today).
- **Legacy rows** keep their email; the Super Admin falls back to it whenever a
  submission has no WhatsApp number. Not separately regression-tested against a
  real legacy row — only through the fallback branch assertion.
- **No E2E.** The wizard has no Playwright journey in this repo; adding one for
  the seven-step flow is a larger piece of work than this change warranted.

## Merge evidence

- RED checkpoint: `a489b8f test: reproducer for WhatsApp-only Step 1 contact + super-admin quick contact` (16 failing).
- GREEN checkpoint: `8cf9f96 feat: WhatsApp-only Step 1 contact with super-admin quick contact` (19 passing, `tsc` clean).
- **Split-commit caveat:** a concurrent session in the same worktree committed
  while this work was in progress, sweeping the Step 1 UI, `onboarding-types.ts`,
  `onboarding-data.ts` and `OnboardingDetail.tsx` edits into its own commit
  `5cf26ff feat: yearly billing option at get-started checkout`. Those changes
  are in the tree and covered by the tests above, but they are not attributable
  to `8cf9f96` — this report is the record of what they were and why.
