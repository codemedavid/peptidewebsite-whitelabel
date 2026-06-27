# PostHog + Gmail Integration — Implementation Plan

**Scope:** PostHog product analytics + Gmail email sending (transactional **and** marketing
automation) for the **Automated Growth** (enterprise) package.

**Hard constraint:** Do **not** remove or change the existing `mailto:` Gmail *contact channel*
(`src/lib/storefront/contact-channels.ts`). That is a separate, working feature (a customer-facing
contact button). The new "Gmail sender" is a server-side email engine that lives alongside it.

---

## 0. TL;DR — what's the state today

| Layer | Status |
|---|---|
| Feature flags (`ANALYTICS_POSTHOG`, `EMAIL_AUTOMATION`, `AUTOMATION_*`, `NOTIFY_EMAIL`, `INTEGRATIONS`) | ✅ defined, gated to enterprise |
| DB models (`TenantIntegration`, `Contact`, `Event`, `EmailLog`, `AutomationRun`) | ✅ exist in `schema.prisma`, **unused** |
| Entitlement gating (`hasFeature` / `requireFeature`) | ✅ working |
| Encryption envelope for creds | ❌ not built (only `ENCRYPTION_KEY` env slot referenced) |
| PostHog SDK / event capture | ❌ none |
| Email sending (server-side) | ❌ none — current Gmail is `mailto:` only |
| Automation engine (Inngest) | ❌ none — schema references it, not installed |
| Integration settings UI | ❌ none |

**Conclusion:** This is a build-out on top of a pre-designed schema. No redesign needed.

---

## 1. Decision: How tenants connect Gmail — OAuth vs App-Password vs Managed

You asked the difference between the **Google API (OAuth)** approach and the **"default Gmail sender"**
you used before (that's SMTP with an app password, e.g. nodemailer). Here's the straight comparison.

### Option A — Gmail via SMTP App Password ("default Gmail sender")
The tenant generates a 16-char *app password* in their Google account and pastes it in. We send with
nodemailer over `smtp.gmail.com`.

- ✅ **Fastest to build** — a few hours; no Google approval, no OAuth dance.
- ✅ Familiar — this is what you used before.
- ❌ Requires the tenant to enable 2FA and dig out an app password (clunky, support-heavy).
- ❌ Gmail caps ~500 emails/day. Fine for transactional, **too low for marketing blasts**.
- ❌ Deliverability is mediocre for marketing (Gmail flags bulk sends; can suspend the account).
- ❌ We store a long-lived password (even encrypted, it's a bigger liability than a revocable token).

### Option B — Gmail via Google API (OAuth 2.0)
Tenant clicks **"Connect Google"**, consents, we store a refresh token and send via the Gmail API.

- ✅ **Cleanest UX** — one click, no passwords; tenant can revoke anytime from their Google account.
- ✅ More secure — short-lived access tokens + revocable refresh token, not a static password.
- ✅ Looks professional (this is what real SaaS products do).
- ❌ Requires a **Google Cloud project + OAuth consent screen verification** (Google review can take
  days–weeks for `gmail.send` scope, which is a "restricted" scope and may need a security assessment).
- ❌ Still bound by the **same ~500/day Gmail sending limit** — OAuth doesn't raise it.
- ❌ More code (token refresh, OAuth callback route, encrypted refresh-token storage).

### Option C — Managed provider (Resend / SendGrid / Mailgun) — *what your schema was designed for*
Note: `EmailLog.provider` literally enumerates `resend | sendgrid | mailgun` — **not gmail**. The DB
author intended marketing email to go through a managed provider, with the tenant's domain verified
(SPF/DKIM). Gmail "from" address can still appear via a verified sending domain or reply-to.

- ✅ **Best deliverability** and the only realistic option for **marketing volume** (thousands/day).
- ✅ Built-in open/click tracking, bounce/complaint webhooks → maps 1:1 to `EmailLog.status`.
- ✅ Simplest sending code (one HTTPS API call), no Gmail quota ceiling.
- ❌ Tenant must verify a domain (DNS records) for best results — more onboarding friction than a
  password, less than OAuth verification.
- ❌ Not literally "Gmail" — it sends *on behalf of* the tenant.

### 📌 Recommendation
Split by purpose, because transactional and marketing have opposite requirements:

1. **Transactional (order confirmations, status updates):** **Gmail OAuth (Option B)** — low volume,
   stays under the 500/day cap, and "sent from the store's own Gmail" is a nice trust signal. If you
   want to ship faster, App Password (Option A) is acceptable here as a v1.
2. **Marketing (abandoned cart, journeys, blasts):** **Managed provider (Option C, Resend)** — Gmail
   *cannot* safely do marketing volume and will get the tenant's account throttled or banned. This is
   also what `EmailLog`/`AutomationRun` were modeled around.

Build the sender behind a **provider interface** so a tenant can connect Gmail for transactional and
Resend for marketing independently — both rows in `TenantIntegration`, both gated by entitlements.

> If you truly want "Gmail only for everything" to match your prior project, use Option A/B for both
> and **cap/queue** marketing sends to respect the 500/day limit — but expect deliverability pain at
> scale. Flagged here so it's a conscious choice.

---

## 2. PostHog integration

### 2.1 Dependencies
- `posthog-node` (server-side capture — preferred, because the outbox dispatches from the server)
- *(optional)* `posthog-js` only if you also want client-side autocapture/session replay in the storefront

### 2.2 Per-tenant connection
- New `TenantIntegration` row, `provider = "posthog"`.
- `encryptedCredentials` = `{ projectApiKey }`; `config` = `{ host }` (default `https://us.i.posthog.com`).
- Connect/disconnect via a new Server Action (see §4 encryption).

### 2.3 Event capture — use the existing outbox
The `Event` model already has `analyticsSent` / `automationSent`. Follow that pattern:

1. **Write** an `Event` row at each meaningful action (don't call PostHog inline — keep checkout fast).
2. A **dispatcher** reads unsent events and:
   - sends to PostHog → sets `analyticsSent = true`
   - hands to automation → sets `automationSent = true`
3. Dispatcher trigger options (pick one):
   - **Inngest** cron/step (aligns with `AutomationRun`), or
   - a lightweight Next.js route hit by Vercel Cron, or
   - inline `after()` dispatch for v1 simplicity (upgrade later).

### 2.4 Event taxonomy (define a constant `EVENTS` map)
Hook points already exist in code:
- `product_viewed` — storefront product page
- `cart_item_added` / `cart_item_removed` — `src/storefront/store.tsx`
- `checkout_started` — checkout open
- `order_placed` — **server-side** in `createStorefrontOrder()` (`src/actions/orders.ts:838`) ← authoritative
- `order_status_changed` — `updateStorefrontOrderAction` (`orders.ts:990`)

Identify the visitor with a `distinctId` cookie → upsert a `Contact` (`@@unique([tenantId, distinctId])`).

### 2.5 Gating
- Wrap capture + dispatch in `hasFeature(tenantId, FEATURES.ANALYTICS_POSTHOG)`.
- If the tenant isn't entitled or hasn't connected, **no-op silently** (never break checkout).

### 2.6 Files to add
```
src/lib/integrations/posthog.ts        # client factory from TenantIntegration creds
src/lib/analytics/events.ts            # EVENTS catalog + emitEvent() (writes Event row)
src/lib/analytics/dispatch.ts          # outbox → PostHog + automation
src/lib/analytics/identity.ts          # distinctId cookie + Contact upsert
```

---

## 3. Gmail / email sending (transactional + marketing)

### 3.1 Dependencies
- Transactional via Gmail OAuth: `googleapis` (Gmail API) **or** `nodemailer` (if App Password)
- Marketing via managed: `resend` (recommended) — or provider SDK of choice
- Automation engine: `inngest` (schema's `AutomationRun.inngestRunId` already anticipates it)

### 3.2 Provider interface (keep mailto untouched)
```ts
// src/lib/email/types.ts
interface EmailProvider {
  send(msg: { to; subject; html; idempotencyKey }): Promise<{ providerMessageId }>;
}
```
Implementations: `GmailProvider` (OAuth/SMTP) and `ResendProvider`. Selected per-tenant from
`TenantIntegration`. The existing `contact-channels.ts` `mailto:` path is **not modified** — it stays
as the customer-facing contact button.

### 3.3 Transactional flow
1. On `order_placed` (in `createStorefrontOrder`, `orders.ts:838`), enqueue an order-confirmation email.
2. Render template → `EmailProvider.send()` → write `EmailLog` (`flow=null`, `template="order_confirmation"`,
   `idempotencyKey = order.id + template`).
3. Gate on `hasFeature(tenantId, FEATURES.NOTIFY_EMAIL)`.

### 3.4 Marketing automation flow
1. **Abandoned cart:** `cart_item_added` with no following `order_placed` within N hours → Inngest
   `abandoned-cart` function (sleep + condition), creates an `AutomationRun`, sends via marketing provider.
2. **Journeys** (welcome / reorder / win-back): event-triggered Inngest functions, each an `AutomationRun`
   with `functionId`, logging every send to `EmailLog` with the matching `flow`.
3. Respect `Contact.unsubscribed`; every marketing email needs an unsubscribe link (route that flips the flag).
4. Gate on `AUTOMATION_ABANDONED_CART` / `AUTOMATION_JOURNEYS` / `EMAIL_AUTOMATION` respectively.

### 3.5 Files to add
```
src/lib/email/types.ts                 # EmailProvider interface
src/lib/email/providers/gmail.ts       # OAuth or SMTP sender
src/lib/email/providers/resend.ts      # marketing sender
src/lib/email/send.ts                  # resolve tenant provider + write EmailLog (idempotent)
src/lib/email/templates/*.tsx          # order_confirmation, abandoned_cart, welcome, ...
src/inngest/client.ts                  # Inngest client
src/inngest/functions/abandoned-cart.ts
src/inngest/functions/journeys.ts
src/app/api/inngest/route.ts           # Inngest handler (note: middleware already excludes /api/inngest)
src/app/api/email/unsubscribe/route.ts # flips Contact.unsubscribed
```
> `src/middleware.ts:125` already excludes `/api/inngest` — the architecture anticipated this.

### 3.6 If Gmail OAuth is chosen — extra pieces
```
src/app/api/integrations/google/start/route.ts     # redirect to Google consent
src/app/api/integrations/google/callback/route.ts  # exchange code → store refresh token (encrypted)
```
Requires a Google Cloud OAuth client (`GOOGLE_CLIENT_ID`/`SECRET` env) and consent-screen verification
for the `gmail.send` scope — **start this approval early; it gates launch.**

---

## 4. Shared foundation: credential encryption (build first)

`TenantIntegration.encryptedCredentials` is `{ ciphertext, iv, tag }` with a `dataKeyId`. Nothing
encrypts/decrypts yet. Build this once; both PostHog and Gmail depend on it.

```
src/lib/crypto/envelope.ts    # AES-256-GCM encrypt/decrypt using ENCRYPTION_KEY
src/lib/integrations/store.ts # getIntegration(tenantId, provider) -> decrypted creds (cached)
                              # upsertIntegration(...) / setEnabled(...) / healthCheck(...)
```
- Use `ENCRYPTION_KEY` (already in `.env.example`) as the key-encryption key.
- `getIntegration()` decrypts on read; never log plaintext; cache per request.
- `tenantIntegration` is already in the RLS allowlist (`src/lib/db/tenant-client.ts:36`) ✅.

---

## 5. Settings UI (tenant store-admin)

New "Integrations" panel in store-admin (mirror existing admin panels like `AdminAnalytics.tsx`):
- **PostHog:** project API key + host, enable toggle, "Test connection" (health check).
- **Gmail:** "Connect Google" (OAuth) **or** app-password field; show connected account + disconnect.
- **Marketing email (Resend):** API key + verified domain status.
- Each section hidden unless the tenant is entitled (`hasFeature`), with an upsell to the Automated plan.

Wire saves through `upsertIntegration()`; show `healthOk` / `lastHealthCheckAt`.

---

## 6. Env vars to add (`.env.example`)
```
# PostHog default host (per-tenant key stored in DB)
POSTHOG_DEFAULT_HOST="https://us.i.posthog.com"
# Inngest
INNGEST_EVENT_KEY=""
INNGEST_SIGNING_KEY=""
# Gmail OAuth (only if Option B)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_OAUTH_REDIRECT="https://app.<root>/api/integrations/google/callback"
# Marketing provider (only if Option C)
RESEND_API_KEY=""   # or store per-tenant in TenantIntegration instead
```
> Decision: platform-wide keys (env) vs per-tenant keys (`TenantIntegration`). For a true whitelabel,
> prefer **per-tenant** so each store sends from its own account/quota. Use env only for the platform's
> own OAuth *app* credentials (`GOOGLE_CLIENT_ID/SECRET`).

---

## 7. Suggested build order (phased)

1. **Foundation** — `envelope.ts` + `integrations/store.ts` (encryption). *Unblocks everything.*
2. **PostHog** — `posthog.ts`, `events.ts`, `identity.ts`, hook `order_placed` server-side, simple
   inline dispatch. Ship + verify in PostHog.
3. **Outbox dispatcher** — move event dispatch to Inngest/cron; backfill `analyticsSent`.
4. **Transactional email** — provider interface + Gmail sender + order-confirmation template +
   `EmailLog`. (mailto stays as-is.)
5. **Inngest + abandoned cart** — first marketing automation, unsubscribe route.
6. **Journeys** — welcome / reorder / win-back.
7. **Integrations settings UI** + health checks + plan upsell.

Each phase is independently shippable and independently gated by its feature flag.

---

## 8. Risks / call-outs

- **Gmail OAuth verification lead time** — Google review of the restricted `gmail.send` scope can take
  weeks. If launch is near, start with App Password and migrate.
- **Gmail 500/day cap** — never route marketing volume through Gmail. Use a managed provider.
- **Don't block checkout** — all capture/send must be fire-and-forget / outbox; failures log, never throw.
- **Idempotency** — use `EmailLog.idempotencyKey` and `Event` outbox flags to avoid double-sends on retry.
- **RLS** — every new query goes through the tenant client; `Contact`/`Event`/`EmailLog`/`AutomationRun`
  must be added to the tenant-client allowlist if not already present (verify alongside `tenantIntegration`).
- **Unsubscribe + compliance** — marketing email legally needs unsubscribe + respects `Contact.unsubscribed`.
- **mailto preserved** — `contact-channels.ts` is untouched throughout.
```
