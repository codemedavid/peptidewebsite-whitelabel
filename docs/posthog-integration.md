# PostHog Integration — Operator Runbook

Per-tenant PostHog analytics + **PostHog-sent** checkout/delivery emails. Each
tenant uses its **own** PostHog project (its own keys), so data and emails are
fully isolated. The app's only job is to **emit identified events**; the emails
themselves are built **inside each tenant's PostHog project** (Messaging →
Workflows + Email channel).

> **Decisions baked in** (from planning): keys are managed in **super-admin**;
> capture is **server-side only** (`order_placed`, `order_status_changed`);
> **PostHog Messaging sends all email** (we don't run our own mailer for this).

---

## Architecture (one glance)

```
Checkout (StorefrontOrder)                    Admin marks shipped/delivered
   placeStorefrontOrderAction                    updateStorefrontOrderAction
        │ after()                                      │ after()
        ▼                                              ▼
   capturePostHogEvent(order_placed)          capturePostHogEvent(order_status_changed)
        │  (gated: ANALYTICS_POSTHOG + enabled integration; demo-safe; never throws)
        ▼
   POST {host}/capture/  with the tenant's OWN project key
        │   event + properties + $set:{ email, name, phone }
        ▼
   Tenant's PostHog project  ──►  Workflow trigger  ──►  Email channel  ──►  customer inbox
```

Key files:
- `src/lib/crypto/envelope.ts` — AES-256-GCM seal/open for the stored key (tested).
- `src/lib/integrations/store.ts` — encrypted CRUD over `TenantIntegration`.
- `src/lib/integrations/posthog.ts` — stateless `/capture/` POST + health probe.
- `src/lib/analytics/events.ts` — `Order` → event payload + `$set` identity (tested).
- `src/lib/analytics/capture.ts` — the gated, never-throwing entry point.
- `src/actions/admin-integrations.ts` + `src/components/admin/AdminIntegrations.tsx` — the super-admin UI.

---

## Part A — Connect a tenant (you, in super-admin)

1. In the tenant's **PostHog** account, create (or pick) the **project** for this store.
2. Copy the **Project API Key** (`phc_…`) from **Settings → Project → Project API Key**.
   - This is a public *ingest* key — it can only send events, never read. Safe to store.
3. In our **super-admin** → **Tenants → {store} → Integrations**:
   - Paste the key, set the **Host** (default `https://us.i.posthog.com`; use
     `https://eu.i.posthog.com` for EU or your self-hosted URL), **Save key**.
   - Click **Test connection** — a throwaway event is sent; a green result means
     the key/host are good. (Health is recorded and shown with a timestamp.)
   - Click **Enable**. The store now emits events.

> The tenant must be entitled to **PostHog analytics** (`ANALYTICS_POSTHOG`,
> Automated Growth plan). If not, the panel shows an upsell and stays inert.

---

## Part B — Build the emails (inside the tenant's PostHog project)

PostHog **Messaging is an opt-in beta** — request access for the project if the
Messaging section isn't visible.

1. **Verify a sending domain** — Messaging → Channels → Email → add + verify the
   store's domain (DNS records). **Emails will not deliver until this passes.**
2. **Configure the email channel** — set the *from name* and *from email*
   (e.g. `Acme Peptides <orders@acme.com>`).
3. **Workflow 1 — order confirmation**
   - Trigger: event `order_placed`.
   - Send email to the person (the buyer's `email` is set on the person via `$set`).
   - Useful properties: `orderNumber`, `total`, `itemsCount`, `itemNames`,
     `paymentMethod`, `city`, `province`, `groupBuyName`.
4. **Workflow 2 — shipping / delivery**
   - Trigger: event `order_status_changed`.
   - Condition: `toStatus` is `shipped` or `delivered` (add a branch per status
     if you want different copy).
   - Useful properties: `orderNumber`, `fromStatus`, `toStatus`, `courier`,
     `trackingNumber`.

---

## Event reference (what we emit)

| Event | When | Person `$set` | Key properties |
|---|---|---|---|
| `order_placed` | new order stored (DB path, `created`) | `email`, `name`, `phone` | `orderNumber`, `total`, `itemsCount`, `itemNames`, `paymentMethod`, `paymentStatus`, `shippingFee`, `adminFee`, `discountCode`, `discountAmount`, `courier`, `city`, `province`, `groupBuyName` |
| `order_status_changed` | fulfillment status changes | `email`, `name`, `phone` | `orderNumber`, `fromStatus`, `toStatus`, `courier`, `trackingNumber` |

`distinctId` = the buyer's email (lowercased) when present, else the order
number, else the draft id — so repeat buyers map to one PostHog person and are
reachable by Messaging.

---

## Operational notes

- **Never blocks checkout.** Capture runs in `after()` and swallows all errors;
  an unconfigured/disabled/unentitled tenant is a silent no-op.
- **Demo tenants** never emit (no DB / no PostHog).
- **Key rotation.** Rotating `ENCRYPTION_KEY` makes existing sealed keys
  unreadable (`dataKeyId` fingerprint mismatch) → capture no-ops; re-paste each
  tenant's key in the admin to re-seal under the new key.
- **No marketing volume caps to worry about** — PostHog handles sending; we only
  emit. (If you later want our own transactional fallback, the `EmailLog` schema
  is still there — out of scope for this build.)
- **Verify quickly:** place a test order on a connected store → the event +
  identified person (with email) appear in that project's PostHog **Activity**.
