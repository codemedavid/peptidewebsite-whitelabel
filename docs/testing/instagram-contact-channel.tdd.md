# TDD Evidence — Instagram as an order contact channel

**Task:** Add Instagram as a customer-facing order contact channel, alongside
WhatsApp / Telegram / Messenger / Viber / Gmail.

**Source plan:** derived inline from the `/ecc:plan` run in this session
(no `*.plan.md` artifact was written). Scope confirmed with the user:
*order contact channel* (not the pre-existing footer "follow us" social link),
linking to an **`ig.me/m/<handle>` DM thread**.

**Branch:** `feat/trial-system`
**Checkpoints:** `774f8a2` (RED, test) → `5d433e9` (GREEN, feat)

---

## User journeys

1. As a **platform operator**, I want to enable Instagram for a tenant and set its
   IG handle in the tenant settings, so that store can take orders over Instagram DM.
2. As a **customer**, I want to pick "Instagram" at checkout and be handed to a DM
   thread with the store (with my order summary copied to paste), so I can complete
   the order in the app I already use.
3. As the **email system**, I want the tenant's Instagram to resolve as the
   "Questions?" support link, so transactional emails point somewhere the store answers.

---

## Task report

**Summary:** Added `"instagram"` to `ContactChannelType`, wired it through the
channel metadata (drives admin form + normalization), the customer label map, the
checkout deep-link builder (`ig.me/m`, `@`-stripped), the analytics/email support
link, the admin settings glyph, and the default brand seed. No DB/schema change —
config lives in the existing `branding.config.contactChannels` JSON blob; existing
tenants are back-filled as a disabled/empty Instagram entry by `normalizeContactChannels`.

**Validation command:** `npm run test:contact-channels`

- **RED** (commit `774f8a2`, before implementation): `8 failed, 1 passed` — every
  Instagram assertion returned `undefined` (missing meta entry, missing label,
  `channelUrl` fell through with no matching `case`, support link skipped by the
  `default:` branch). `channelPrefills("instagram")` already returned `false`
  (correct-by-default, no change needed).
- **GREEN** (commit `5d433e9`, after implementation): `9 passed, 0 failed`.

**Type safety:** `npx tsc --noEmit` reports no errors in any touched file. The two
`Record<ContactChannelType, …>` maps (`CHANNEL_LABELS`, `CHANNEL_GLYPH`) are
compile-forced to include `instagram`. (An unrelated pre-existing syntax error in a
concurrent session's untracked file `src/storefront/admin/AdminGroupBuyRules.tsx`
is out of scope for this task and was left untouched.)

**Guaranteed by the passing tests:** enabling Instagram persists and round-trips
through normalization; the checkout button is labeled "Instagram"; the deep link is
`https://ig.me/m/<handle>` with a leading `@` and whitespace stripped; the channel
does not claim to prefill (clipboard fallback stays active); and email support links
resolve to the same `ig.me/m` URL.

---

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Instagram is listed in the channel metadata that drives the admin form | `scripts/test-contact-channels.ts:CONTACT_CHANNEL_META includes Instagram with a label` | unit | PASS | `npm run test:contact-channels` |
| 2 | Normalizer back-fills a disabled/empty Instagram entry for existing tenants | `…:normalizeContactChannels([]) back-fills a disabled Instagram entry` | unit | PASS | `npm run test:contact-channels` |
| 3 | A saved Instagram destination survives normalization (trimmed) | `…:normalizeContactChannels preserves a saved Instagram destination` | unit | PASS | `npm run test:contact-channels` |
| 4 | Customer-facing button label is "Instagram" | `…:CHANNEL_LABELS.instagram is 'Instagram'` | unit | PASS | `npm run test:contact-channels` |
| 5 | Checkout deep link is the ig.me/m DM thread | `…:channelUrl builds an ig.me/m DM link` | unit | PASS | `npm run test:contact-channels` |
| 6 | A leading @ in the handle is stripped | `…:channelUrl strips a leading @ from the handle` | unit | PASS | `npm run test:contact-channels` |
| 7 | Surrounding whitespace in the handle is trimmed | `…:channelUrl trims surrounding whitespace` | unit | PASS | `npm run test:contact-channels` |
| 8 | Instagram does not claim to prefill (clipboard fallback stays on) | `…:channelPrefills('instagram') is false` | unit | PASS | `npm run test:contact-channels` |
| 9 | Email support link resolves to the ig.me/m URL + "Instagram" label | `…:buildEmailBrand surfaces Instagram as the support link` | unit | PASS | `npm run test:contact-channels` |

---

## Coverage and known gaps

This repo has no line-coverage tooling; the `scripts/test-*.ts` suite is the
coverage mechanism (behavioral assertions per feature). This test exercises every
pure function on the Instagram path: metadata, normalization, label, deep-link
builder (3 input shapes), prefill flag, and the email support link.

Intentional gaps (unchanged, verified by inspection / tsc, not by a new test):

- **Admin glyph** (`CHANNEL_GLYPH.instagram` in `TenantSettingsView.tsx`) — a
  presentational SVG, compile-forced by the `Record<ContactChannelType, …>` type;
  visual, not asserted.
- **Storefront render** (`CartCheckout.tsx`) — data-driven off `activeChannels` +
  `CHANNEL_LABELS`; no per-channel branching to test. Worth a manual/E2E smoke:
  enable Instagram in `/admin/tenants/<slug>/settings`, then place a test order and
  confirm the button hands off to `ig.me/m/<handle>` with the summary on the clipboard.

## Merge evidence (for squash)

RED `774f8a2` → 8/9 failing (Instagram path returned `undefined`).
GREEN `5d433e9` → 9/9 passing. `tsc --noEmit` clean for all touched files.
