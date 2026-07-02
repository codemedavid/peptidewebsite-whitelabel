# PostHog transactional email templates

Gmail-safe HTML **fragments** for PostHog Messaging's visual editor. In the
email editor, add a single full-width **HTML block** and paste a file's full
contents into it (the templates deliberately have no `<html>`/`<body>` shell —
the editor supplies those; a full document overflows the block). Put the
preview line noted in each file's top comment into PostHog's **Preheader**
field, and set the email's background color to `#EFEDE7` so the canvas matches
the card.

They are **tenant-brand aware**: every `order_placed` / `order_status_changed`
event this app captures is stamped with the tenant's branding
(`src/lib/analytics/events.ts` → `buildEmailBrand`), so one template renders
each store's own name, logo, colors and URL — no per-tenant editing. Since each
tenant has its own PostHog project, paste the same templates into every project.

## Which template goes where

| Template | PostHog trigger | Branch condition |
|---|---|---|
| `01-order-confirmation.html` | event `order_placed` | — |
| `02-order-confirmed.html` | event `order_status_changed` | `toStatus = confirmed` |
| `02b-order-processing.html` | event `order_status_changed` | `toStatus = processing` (optional — arrives close after "confirmed", skip if that feels like too many emails) |
| `03-order-shipped.html` | event `order_status_changed` | `toStatus = shipped` |
| `04-order-delivered.html` | event `order_status_changed` | `toStatus = delivered` |
| `05-order-cancelled.html` | event `order_status_changed` | `toStatus = cancelled` |

Workflow shape in PostHog: one workflow per event → for `order_status_changed`
add a branch/condition step on `event.properties.toStatus` → attach the matching
email. The buyer is reachable because capture `$set`s `email` on the person.

Test end-to-end from Super Admin → tenant → Integrations → "Send test events"
(events are flagged `test: true` and now carry the tenant's real branding).

## Variables available in templates (Liquid)

Personalization uses PostHog's Liquid syntax. Everything below maps 1:1 to what
the app captures.

### Person (all templates)

| Variable | Example |
|---|---|
| `{{ person.properties.name }}` | Jane Buyer |
| `{{ person.properties.email }}` | jane@example.com |

### Branding (all templates — stamped from the tenant's branding.config)

| Variable | Meaning |
|---|---|
| `{{ event.properties.brandName }}` | Store name — rendered as a text wordmark |
| `{{ event.properties.brandLogoUrl }}` | Logo URL (available but unused — the visual editor can't do conditional fallbacks, so templates use the wordmark; swap in an `<img>` per tenant if you want the logo) |
| `{{ event.properties.brandAccent }}` | Storefront CTA color — used for email buttons |
| `{{ event.properties.brandAccentText }}` | Text color on the accent |
| `{{ event.properties.brandCurrency }}` | e.g. ₱ |
| `{{ event.properties.storeUrl }}` | `https://<slug>.<root-domain>` — CTAs link to `{{ ... }}/#track` |
| `{{ event.properties.supportUrl }}` | "Questions?" link — the tenant's first enabled contact channel (`wa.me/…`, `t.me/…`, `m.me/…`, or `mailto:`); falls back to the store URL. Viber is skipped (Gmail strips `viber://`) |
| `{{ event.properties.supportLabel }}` | Name for that channel: "WhatsApp", "Telegram", "Messenger", "email", or "our website" |

Every brand variable is wrapped in `| default:` in the templates, so events
captured before branding-stamping existed (or a tenant with no branding) still
render with neutral ink + "Our store".

### `order_placed` (template 01)

`orderNumber`, `total`, `itemsCount`, `itemNames` (array — use
`{{ event.properties.itemNames | join: ", " }}`), `paymentMethod`,
`paymentStatus`, `shippingFee`, `adminFee`, `discountCode`, `discountAmount`,
`courier`, `city`, `province`, `groupBuyName`.

### `order_status_changed` (templates 02–05)

`orderNumber`, `fromStatus`, `toStatus`, `courier`, `trackingNumber`.
Note: status events do **not** carry items/totals — that's why 02–05 don't show
an order summary.

## Gmail constraints baked in

- Fluid table layout (`width:100%; max-width:600px`), `role="presentation"`,
  all CSS inline — fits PostHog's mobile preview and survives Gmail's `<style>`
  stripping and clipping (each file is well under the 102KB limit).
- Fonts are email-safe (Georgia headings / Arial body). Tenant Google Fonts
  cannot be used — Gmail strips webfonts.
- Buttons are padded table cells (no images), so they render before images load.
- Hidden preheader text controls the inbox preview line.
- Amounts render as raw numbers (`500`, not `500.00`) — Liquid has no money
  filter; PostHog sends whatever the event carries.

## PostHog visual-editor notes

- Templates use ONLY `{{ ... | default: ... }}` variables — no `{% if %}` tags,
  which PostHog's visual editor renders as literal text.
- The discount row was dropped from the confirmation email for the same reason;
  the Total already includes any discount.
- Edit in **Desktop** view; the mobile preview is ~360px and the fluid layout
  adapts to it automatically.
