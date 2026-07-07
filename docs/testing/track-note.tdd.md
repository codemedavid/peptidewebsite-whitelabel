# TDD — Track-Order Delivery Note

The per-tenant informational card shown on the storefront **Track Order** page,
directly under the "search your order number" box. Owner-editable in the store
admin (Dashboard → **Delivery Note**). Single-flag gate (`enabled`) — no operator
entitlement, any store may use it. Ships pre-filled with the J&T Davao example so
a store that switches it on has sensible starter content to keep or edit.

Requested for **pepstack davao**: the J&T Express delivery-estimate card
(Mindanao 1–5 days · Metro Manila & Luzon 3–7 days · Visayas 3–7 days · Island
Provinces 5–6 days; footnote about sending day / Palawan / business days).

## Pure core

`src/lib/storefront/track-note.ts`

- `TrackNoteConfig` — `{ enabled, title, subtitle, rows: {region,estimate}[], footnote }`
- `DEFAULT_TRACK_NOTE` — off-by-default baseline carrying the J&T Davao example copy
- `normalizeTrackNote(input)` — coerce untrusted `branding.config.trackNote` into a
  closed, safe shape (never throws): strict boolean gate, trimmed + length-capped
  copy, de-blanked + count-capped rows
- `isTrackNoteVisible(cfg)` — gate: `enabled && (title || rows.length)`

## RED → GREEN

```
npm run test:track-note
```

1. **RED** — test written first against `src/lib/storefront/track-note.ts`; run
   failed with `MODULE_NOT_FOUND` (core did not exist).
2. **GREEN** — implemented the pure core; **19 passed, 0 failed**.
3. Full `tsc --noEmit` — **0 errors**.

Coverage: gate truth table (undefined/null/disabled/enabled/empty), default
shape, non-object collapse, strict-boolean coercion, trim/preserve, blank-row
drop, partial-row keep, garbage-entry drop, count cap, length cap, idempotency,
end-to-end visibility.

## Wiring (config-driven, no slug branching)

- `src/storefront/types.ts` — `Brand.trackNote?: TrackNoteConfig`
- `src/app/(tenant)/(storefront)/page.tsx` — `brand.trackNote = normalizeTrackNote(config.trackNote)`
- `src/storefront/components/TrackNoteCard.tsx` — presentational card (reused live + preview)
- `src/storefront/pages/TrackOrderPage.tsx` — renders `<TrackNoteCard>` under the
  search form when `isTrackNoteVisible(brand.trackNote)`
- `src/storefront/storefront.css` — `.sf-root .track-note*` (two-column region/estimate grid)
- `src/actions/storefront-admin.ts` — `saveTrackNoteAction` (OWNER-ONLY, read-modify-write)
- `src/storefront/admin/AdminTrackNote.tsx` — owner editor with live preview
- `src/storefront/admin/AdminPage.tsx` — `tracknote` view + owner-only dashboard tile
  (also added the missing click dispatch for the sibling `notify`/`notice` tiles)

## Availability & defaults (all tenants)

Available to **every tenant's owner**, **off by default** with **empty** content —
no store inherits another store's copy (`DEFAULT_TRACK_NOTE` is empty + disabled;
there is no operator entitlement gate). Owners opt in from the store admin.

`TRACK_NOTE_EXAMPLE` holds the J&T Davao starter table; the editor's **Load J&T
Davao example** button fills the fields with it (review → edit → Save). Nothing is
shown to customers until an owner enables it and it has content
(`isTrackNoteVisible`).

## To go live for pepstack davao

Store admin → **Delivery Note** → **Load J&T Davao example** → tick "Show the
delivery note on my Track Order page" → Save. (No DB write ships with this change;
per the agreed scope the owner enables it in admin.)
