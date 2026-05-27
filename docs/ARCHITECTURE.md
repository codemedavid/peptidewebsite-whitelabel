# Automated Growth System — Architecture

Multi-tenant white-label SaaS for peptide sellers.
**One codebase · one database · per-tenant configs · feature-gated.**

> This document is the source of truth for the premium **Package 3 — Automated Growth System**.
> It is written to be *buildable*: every section maps to concrete files, tables, and libraries.

---

## 0. TL;DR — The opinionated stack

| Concern | Recommendation | Why |
|---|---|---|
| Framework | **Next.js (App Router) on Vercel** | SSR + edge middleware for tenant routing |
| DB | **Supabase Postgres + Prisma** | One DB, row-tenancy, RLS as defense-in-depth |
| Analytics | **PostHog** (per-tenant project keys) | Behavior, funnels, feature flags |
| Email | **Resend** (primary) behind a provider interface | Best DX, React Email, swappable |
| Queue / workflows | **Inngest** | Durable `sleep`/`waitForEvent` on serverless — the single most important choice |
| Secrets | **App-level AES-256-GCM envelope encryption**, KMS-backed key | No tenant secret in env vars |
| Feature gating | **Entitlements** (plan → features), never hardcoded packages | Add/move features without deploys |

The non-negotiable architectural decision is the **queue**. Abandoned-cart logic = "wait 1 hour, then check if they bought." On Vercel's serverless model you cannot hold a process open for an hour. Inngest (or QStash) makes durable delays a first-class primitive. Everything else flows from that.

---

## 1. System overview

```
                      ┌────────────────────────────────────────────┐
   custom domain ───► │  Vercel Edge Middleware: resolve tenant       │
  store.acme.com      │  (hostname → tenantId → request context)      │
                      └───────────────┬──────────────────────────────┘
                                      │
                ┌─────────────────────┼───────────────────────────────┐
                │                     │                                │
        ┌───────▼───────┐    ┌────────▼────────┐            ┌──────────▼─────────┐
        │  Next.js App   │    │  API / Server    │            │  Analytics client   │
        │  (storefront)  │    │  Actions / Routes│            │  (posthog-js, keyed │
        │                │    │                  │            │   to tenant project)│
        └───────┬───────┘    └────────┬─────────┘            └──────────┬─────────┘
                │                      │                                  │
                │              emit domain event                          │ capture
                │                      │                                  ▼
                │             ┌────────▼─────────┐                 ┌─────────────┐
                │             │  Event Bus        │                 │  PostHog     │
                │             │  (outbox + Inngest)│                │  (per tenant)│
                │             └────────┬─────────┘                  └─────────────┘
                │                      │
        ┌───────▼──────┐      ┌────────▼─────────────────────────────────────┐
        │  Supabase     │◄────►│  Inngest Functions (durable workflows)        │
        │  Postgres     │      │  • abandoned-cart  • welcome  • post-purchase │
        │  (1 DB, RLS)  │      │  • analytics-sink  • re-engagement            │
        └───────────────┘      └────────┬─────────────────────────────────────┘
                                         │
                          ┌──────────────┼───────────────┐
                          ▼              ▼                ▼
                    ┌──────────┐  ┌──────────┐    ┌──────────────┐
                    │  Resend  │  │  Stripe  │    │ future provs │
                    │  (email) │  │ (billing)│    │ (SMS, CRM...) │
                    └──────────┘  └──────────┘    └──────────────┘
```

**Three planes:**
1. **Request plane** — synchronous user traffic (storefront, checkout). Must be fast. Only *emits* events.
2. **Event plane** — domain events written to an outbox table and forwarded to Inngest.
3. **Work plane** — Inngest functions do the slow, delayed, retryable work (emails, analytics fan-out, journeys).

This separation is the whole game: the request plane never blocks on email or third-party APIs.

---

## 2. Tenancy model

### 2.1 Strategy: shared schema, row-level tenancy

One database, every business-data row carries `tenantId`. Chosen over schema-per-tenant or DB-per-tenant because:
- Cheapest to operate and migrate (one `prisma migrate`).
- Peptide white-label tenants are small/medium; you don't need hard physical isolation.
- Postgres **Row-Level Security (RLS)** gives defense-in-depth even with a shared connection.

> Tradeoff: a query that forgets `WHERE tenant_id = ?` leaks data. We mitigate with (a) a Prisma client extension that *forces* the tenant filter, and (b) RLS as a backstop. See §11.4.

### 2.2 Tenant resolution (edge middleware)

```ts
// middleware.ts  (runs at the edge on every request)
import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host")!; // store.acme.com OR acme.peptide.app
  // Cache hostname→tenant in Edge Config / KV; fall back to DB on miss.
  const tenant = await resolveTenantByHost(host);
  if (!tenant) return NextResponse.rewrite(new URL("/_not-found", req.url));

  const res = NextResponse.next();
  res.headers.set("x-tenant-id", tenant.id);
  return res;
}

export const config = { matcher: ["/((?!_next|api/inngest|favicon.ico).*)"] };
```

`resolveTenantByHost` reads from **Vercel Edge Config / Upstash KV** (sub-ms), populated whenever a tenant adds/verifies a domain. DB is only the source of truth on cache miss.

Server code reads the tenant via a request-scoped helper:

```ts
// lib/tenant/context.ts
import { headers } from "next/headers";
export function getTenantId(): string {
  const id = headers().get("x-tenant-id");
  if (!id) throw new Error("No tenant in request context");
  return id;
}
```

---

## 3. Feature-gated package system

**Rule from the brief: do NOT hardcode packages. Use feature flags.**

### 3.1 The model: Plans → Entitlements → Features

- A **Feature** is the smallest gateable capability (`automation.abandoned_cart`, `analytics.dashboard`, `ecommerce.cart`).
- A **Plan** is a named bundle (Basic / Ecommerce / Automated Growth) that *maps* to a set of features.
- An **Entitlement** is the resolved set of features a given tenant currently has — derived from their plan **plus** any per-tenant overrides (trials, custom deals, beta access).

The three packages become rows in a `plans` table, not `if (package === 3)` branches.

```ts
// lib/features/catalog.ts  — the single registry of all features
export const FEATURES = {
  // Package 1
  SITE_HOMEPAGE: "site.homepage",
  SITE_PRODUCTS: "site.products",
  SITE_CONTACT_FORM: "site.contact_form",
  // Package 2
  ECOM_CART: "ecommerce.cart",
  ECOM_CHECKOUT: "ecommerce.checkout",
  ECOM_BUNDLES: "ecommerce.bundles",
  ECOM_DISCOUNTS: "ecommerce.discounts",
  ECOM_ACCOUNTS: "ecommerce.accounts",
  ECOM_UPSELLS: "ecommerce.upsells",
  // Package 3 — Automated Growth
  ANALYTICS_POSTHOG: "analytics.posthog",
  ANALYTICS_DASHBOARD: "analytics.dashboard",
  BEHAVIOR_TRACKING: "analytics.behavior_tracking",
  EVENT_TRACKING: "analytics.event_tracking",
  AUTOMATION_WORKFLOWS: "automation.workflows",
  AUTOMATION_ABANDONED_CART: "automation.abandoned_cart",
  AUTOMATION_JOURNEYS: "automation.journeys",
  EMAIL_AUTOMATION: "automation.email",
  MARKETING_AUTOMATION: "automation.marketing",
  INTEGRATIONS: "integrations.enabled",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];
```

Plans are seeded data, editable without a deploy:

```ts
// seed: plan_features mapping
const PLAN_FEATURES = {
  basic:       [SITE_HOMEPAGE, SITE_PRODUCTS, SITE_CONTACT_FORM],
  ecommerce:   ["...basic", ECOM_CART, ECOM_CHECKOUT, ECOM_BUNDLES, ECOM_DISCOUNTS, ECOM_ACCOUNTS, ECOM_UPSELLS],
  growth:      ["...ecommerce", ANALYTICS_POSTHOG, ANALYTICS_DASHBOARD, BEHAVIOR_TRACKING,
                EVENT_TRACKING, AUTOMATION_WORKFLOWS, AUTOMATION_ABANDONED_CART, AUTOMATION_JOURNEYS,
                EMAIL_AUTOMATION, MARKETING_AUTOMATION, INTEGRATIONS],
};
```

### 3.2 Entitlement resolution & enforcement

```ts
// lib/features/entitlements.ts
export async function getEntitlements(tenantId: string): Promise<Set<FeatureKey>> {
  // cached per-request + in KV (5 min TTL). Plan features ∪ tenant overrides − revocations.
  const tenant = await loadTenantWithPlan(tenantId);
  const fromPlan = tenant.plan.features.map(f => f.key);
  const overrides = tenant.featureOverrides; // {key, enabled}
  const set = new Set<FeatureKey>(fromPlan);
  for (const o of overrides) o.enabled ? set.add(o.key) : set.delete(o.key);
  return set;
}

export async function requireFeature(tenantId: string, key: FeatureKey) {
  const ents = await getEntitlements(tenantId);
  if (!ents.has(key)) throw new FeatureLockedError(key);
}
```

**Enforce at four layers (defense in depth):**
1. **UI** — hide/upsell locked features (`<Gate feature={...}>`).
2. **API / Server Actions** — `await requireFeature(tenantId, FEATURES.AUTOMATION_ABANDONED_CART)`.
3. **Event plane** — the event bus drops/ignores events a tenant isn't entitled to process (so a Basic tenant emitting `cart_item_added` never triggers automation).
4. **Worker** — Inngest functions re-check entitlement at execution time (a plan can be downgraded mid-flow; a sleeping abandoned-cart job must verify before sending).

> Layer 4 matters: a workflow sleeping for 24h could outlive the entitlement that started it. Always re-check inside the worker, not just at emit time.

---

## 4. Integration system (provider abstraction)

The integration layer is how *any* third party (PostHog, Stripe, Resend, future SMS/CRM) is configured per tenant, with credentials stored securely and toggleable.

### 4.1 The contract

```ts
// lib/integrations/types.ts
export type ProviderId = "posthog" | "stripe" | "resend" | "mailgun" | "sendgrid";

export interface IntegrationProvider<Creds = unknown, Cfg = unknown> {
  id: ProviderId;
  /** JSON-schema (zod) for the credentials this provider needs. */
  credentialsSchema: ZodType<Creds>;
  /** Non-secret config (e.g. PostHog host, default from-address). */
  configSchema: ZodType<Cfg>;
  /** Validate a tenant's creds by making a cheap live call. */
  healthCheck(creds: Creds, cfg: Cfg): Promise<{ ok: boolean; message?: string }>;
}
```

### 4.2 Registry + factory

```ts
// lib/integrations/registry.ts
const registry = new Map<ProviderId, IntegrationProvider>();
export const registerProvider = (p: IntegrationProvider) => registry.set(p.id, p);
export const getProvider = (id: ProviderId) => {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown provider ${id}`);
  return p;
};

// adding a new integration = register a module. Zero changes to callers.
registerProvider(posthogProvider);
registerProvider(resendProvider);
registerProvider(stripeProvider);
```

### 4.3 Resolving a configured, enabled integration for a tenant

```ts
// lib/integrations/resolve.ts
export async function getTenantIntegration(tenantId: string, id: ProviderId) {
  const row = await prisma.tenantIntegration.findUnique({
    where: { tenantId_provider: { tenantId, provider: id } },
  });
  if (!row || !row.enabled) return null;          // toggle = enable/disable
  const creds = await decryptCredentials(row.encryptedCredentials, row.dataKeyId);
  return { provider: getProvider(id), creds, config: row.config };
}
```

`enabled` is the on/off switch. Disabling never deletes credentials — flip the flag.

---

## 5. Secure credential storage

**Rule: no tenant secret in environment variables.** Tenant secrets live in the DB, **encrypted at rest with envelope encryption**.

### 5.1 Envelope encryption (AES-256-GCM)

```
                 ┌──────────────────────────────────────────┐
                 │  KMS / single master key (env: only key)  │
                 └───────────────┬──────────────────────────┘
                                 │ wraps
                          ┌──────▼───────┐
                          │  Data Key (DEK)│  per record (or per tenant)
                          └──────┬────────┘
                                 │ AES-256-GCM
                          ┌──────▼─────────────────────────┐
                          │  ciphertext + iv + authTag      │  → stored in DB
                          └─────────────────────────────────┘
```

- The **master key** is the *only* secret in env (`CREDENTIALS_MASTER_KEY`), ideally fronted by **AWS/GCP KMS** so the raw key never sits in env at all.
- Each credential blob is encrypted with a **data key**; the data key is wrapped by the master key. Rotating the master key re-wraps data keys without re-encrypting every blob.
- Algorithm: **AES-256-GCM** (authenticated — detects tampering).

```ts
// lib/crypto/envelope.ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export function encrypt(plaintext: string, dek: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

export function decrypt(blob: { ciphertext: string; iv: string; tag: string }, dek: Buffer) {
  const d = createDecipheriv("aes-256-gcm", dek, Buffer.from(blob.iv, "base64"));
  d.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(blob.ciphertext, "base64")), d.final()]).toString("utf8");
}
```

### 5.2 Alternatives & tradeoff

| Option | Pros | Cons |
|---|---|---|
| **App-level AES-GCM + KMS** (recommended) | Portable, cheap, full control, rotation | You own the code path |
| **Supabase Vault (pgsodium)** | In-DB encryption, transparent | Ties you to Supabase, less portable |
| **HashiCorp Vault / Doppler** | Enterprise secret mgmt | Operational overhead, overkill at start |

Start with app-level AES-GCM where the master key is a KMS key. Never log decrypted creds; decrypt **just-in-time** inside the worker, never store decrypted values in cache.

---

## 6. PostHog integration (per-tenant)

Each tenant has **their own PostHog project key + host + settings**, stored as a `tenantIntegration` row. No global PostHog env var for tenant data.

### 6.1 Server-side: cached per-tenant clients

```ts
// lib/analytics/posthog-server.ts
import { PostHog } from "posthog-node";
import { LRUCache } from "lru-cache";

const clients = new LRUCache<string, PostHog>({
  max: 500,
  ttl: 1000 * 60 * 30,             // 30 min
  dispose: (client) => client.shutdown(),
});

export async function getPosthogForTenant(tenantId: string): Promise<PostHog | null> {
  if (clients.has(tenantId)) return clients.get(tenantId)!;
  const integ = await getTenantIntegration(tenantId, "posthog");
  if (!integ) return null;          // tenant not entitled / not configured
  const client = new PostHog(integ.creds.projectApiKey, {
    host: integ.config.host ?? "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
  clients.set(tenantId, client);
  return client;
}
```

### 6.2 Client-side: dynamic init

The PostHog **project API key is write-only ingest** (safe to expose, like a Stripe publishable key). The storefront fetches it for the current tenant and inits `posthog-js`:

```ts
// app/(storefront)/providers/AnalyticsProvider.tsx
"use client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

export function AnalyticsProvider({ children, ph }: { children: ReactNode; ph: { key: string; host: string } | null }) {
  useEffect(() => {
    if (!ph) return;               // tenant not on Growth plan → no init
    posthog.init(ph.key, { api_host: ph.host, person_profiles: "identified_only", capture_pageview: false });
  }, [ph]);
  return ph ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : <>{children}</>;
}
```

The server passes `ph` only if `getEntitlements(tenantId).has(ANALYTICS_POSTHOG)` — so analytics is feature-gated at the root.

### 6.3 Analytics abstraction layer

**Never call PostHog directly from features.** Go through an interface so PostHog is swappable and so events are validated/typed.

```ts
// lib/analytics/index.ts
export interface AnalyticsSink {
  capture(p: { tenantId: string; distinctId: string; event: AnalyticsEvent; props?: Record<string, unknown> }): Promise<void>;
  identify(p: { tenantId: string; distinctId: string; traits: Record<string, unknown> }): Promise<void>;
}

// PostHog implementation
export const analytics: AnalyticsSink = {
  async capture({ tenantId, distinctId, event, props }) {
    const ph = await getPosthogForTenant(tenantId);
    ph?.capture({ distinctId, event, properties: { tenant_id: tenantId, ...props } });
  },
  async identify({ tenantId, distinctId, traits }) {
    const ph = await getPosthogForTenant(tenantId);
    ph?.identify({ distinctId, properties: traits });
  },
};
```

---

## 7. Event-driven architecture

### 7.1 The domain event taxonomy

Events are **past-tense facts**. Naming convention: `object_action`, snake_case (PostHog-friendly, and the analytics name == the domain event name → one taxonomy to maintain).

```ts
// lib/events/catalog.ts
export const EVENTS = {
  // lifecycle
  PAGE_VIEWED: "page_viewed",
  PRODUCT_VIEWED: "product_viewed",
  PRODUCT_SEARCHED: "product_searched",
  // ecommerce funnel
  CART_ITEM_ADDED: "cart_item_added",
  CART_ITEM_REMOVED: "cart_item_removed",
  CART_VIEWED: "cart_viewed",
  CHECKOUT_STARTED: "checkout_started",
  CHECKOUT_COMPLETED: "checkout_completed",   // == order placed
  PAYMENT_FAILED: "payment_failed",
  ORDER_FULFILLED: "order_fulfilled",
  // lifecycle / marketing
  ACCOUNT_CREATED: "account_created",
  EMAIL_SENT: "email_sent",
  EMAIL_OPENED: "email_opened",
  EMAIL_CLICKED: "email_clicked",
  SUBSCRIPTION_RENEWED: "subscription_renewed",
} as const;
export type DomainEventName = (typeof EVENTS)[keyof typeof EVENTS];
```

**Naming rules:** past-tense `object_action`; properties in snake_case; money in minor units + currency; always include `tenant_id`, `distinct_id`, `timestamp`. Reserve a `revenue` property for ecommerce events so PostHog/funnels can sum it.

### 7.2 Emit once, fan out everywhere (outbox + Inngest)

A single `emitEvent` call does three things atomically-ish:
1. Writes to the **`events` outbox table** (audit trail + replay).
2. Sends to **PostHog** via the analytics sink (behavior/funnels).
3. Sends to **Inngest** to trigger automation.

```ts
// lib/events/emit.ts
export async function emitEvent<E extends DomainEventName>(input: {
  tenantId: string; distinctId: string; name: E; props?: Record<string, unknown>;
}) {
  const event = { id: ulid(), ts: new Date(), ...input };

  // 1. outbox (durable, in the same txn as the business write when possible)
  await prisma.event.create({ data: { ...event, props: input.props ?? {} } });

  // 2. analytics (gated — sink no-ops if tenant lacks PostHog)
  await analytics.capture({ tenantId: input.tenantId, distinctId: input.distinctId, event: input.name, props: input.props });

  // 3. automation (gated — Inngest only fires functions for entitled tenants)
  await inngest.send({ name: `peptide/${input.name}`, data: event });
}
```

> **Outbox pattern** is why this is reliable: the event row is the durable record. A background reconciler can replay any event that failed to reach PostHog/Inngest. For strict delivery, write the outbox row in the same DB transaction as the order/cart mutation, then a separate dispatcher forwards it.

### 7.3 Customer journeys & funnels

- **Funnels** are defined in PostHog from the event taxonomy: `product_viewed → cart_item_added → checkout_started → checkout_completed`. No code — they're a product of consistent event names.
- **Journeys** are stateful, multi-step automations (welcome series, win-back) implemented as Inngest functions keyed by `distinctId`, advancing on incoming events.

---

## 8. Email automation & the abandoned-cart workflow

### 8.1 Provider abstraction (Resend primary)

```ts
// lib/email/types.ts
export interface EmailProvider {
  send(p: { from: string; to: string; subject: string; react?: ReactElement; html?: string;
            tags?: Record<string, string>; idempotencyKey?: string }): Promise<{ id: string }>;
}
```

Recommendation order: **Resend** (React Email templates, great DX, webhooks for opens/clicks) → SendGrid (mature, high volume) → Mailgun (deliverability tooling). All implement the same interface; the tenant's choice + API key live in `tenantIntegration`. **Never raw Gmail SMTP** — no deliverability, no per-tenant sending domains, gets you blocklisted.

Each tenant uses **their own verified sending domain** (DKIM/SPF via Resend domains API) so emails come from `hello@acme-peptides.com`, not your shared domain. This is essential for white-label and deliverability.

### 8.2 The abandoned-cart workflow (Inngest — the canonical example)

```ts
// inngest/functions/abandoned-cart.ts
export const abandonedCart = inngest.createFunction(
  { id: "abandoned-cart", cancelOn: [{ event: "peptide/checkout_completed", match: "data.distinctId" }] },
  { event: "peptide/cart_item_added" },
  async ({ event, step }) => {
    const { tenantId, distinctId, props } = event.data;

    // (4) re-check entitlement at execution time
    const ents = await step.run("check-entitlement", () => getEntitlements(tenantId));
    if (!ents.has(FEATURES.AUTOMATION_ABANDONED_CART)) return { skipped: "not_entitled" };

    // durable delay — survives deploys, no process held open
    await step.sleep("wait-1h", "1h");

    // did they buy? cancelOn already aborts on checkout_completed, but double-check the cart
    const cart = await step.run("load-cart", () => getActiveCart(tenantId, distinctId));
    if (!cart || cart.items.length === 0) return { skipped: "cart_empty_or_purchased" };

    const contact = await step.run("resolve-contact", () => getContactEmail(tenantId, distinctId));
    if (!contact?.email || contact.unsubscribed) return { skipped: "no_contact" };

    // first nudge
    await step.run("send-reminder-1", () =>
      sendTenantEmail(tenantId, {
        to: contact.email, template: "abandoned-cart-1", idempotencyKey: `ac1:${cart.id}`,
        data: { items: cart.items, recoverUrl: cart.recoverUrl },
      }));
    await emitEvent({ tenantId, distinctId, name: EVENTS.EMAIL_SENT, props: { flow: "abandoned_cart", step: 1 } });

    // second nudge 23h later (still cancels on purchase via cancelOn)
    await step.sleep("wait-23h", "23h");
    const stillOpen = await step.run("recheck-cart", () => getActiveCart(tenantId, distinctId));
    if (stillOpen?.items.length) {
      await step.run("send-reminder-2", () =>
        sendTenantEmail(tenantId, {
          to: contact.email, template: "abandoned-cart-2", idempotencyKey: `ac2:${cart.id}`,
          data: { items: stillOpen.items, recoverUrl: stillOpen.recoverUrl, discountCode: "COMEBACK10" },
        }));
    }
    return { sent: true };
  },
);
```

What makes this robust:
- `cancelOn` matched by `distinctId` → the instant the customer checks out, the whole flow is cancelled. No "we emailed someone who already bought."
- `step.sleep` is **durable** — deploys, restarts, and scale-to-zero don't lose the timer.
- `idempotencyKey` per email step → retries never double-send.
- Entitlement re-checked inside the worker (downgrade safety).

### 8.3 Other journeys (same pattern)
- **Welcome series** — trigger `account_created`, send 3 emails over 7 days, branch on `product_viewed`.
- **Post-purchase / reorder** — trigger `checkout_completed`, `step.sleep('25d')`, send reorder reminder (peptide cycles are recurring → strong recurring-revenue lever).
- **Win-back** — scheduled Inngest cron scans contacts with no order in 60 days.
- **Payment recovery (dunning)** — trigger `payment_failed`, retry sequence.

---

## 9. Queue / job system

### 9.1 Recommendation: **Inngest**

| Need | Inngest |
|---|---|
| Durable multi-hour `sleep` on serverless | ✅ first-class `step.sleep` |
| Cancel a running flow on an event | ✅ `cancelOn` / `waitForEvent` |
| Step-level retries + idempotency | ✅ built-in |
| Concurrency / rate-limit per tenant | ✅ `concurrency: { key: "event.data.tenantId" }` |
| Works on Vercel with zero infra | ✅ single `/api/inngest` route |
| Observability (replay, logs) | ✅ dashboard |

### 9.2 Alternatives & tradeoff

| Option | When to pick it |
|---|---|
| **QStash (Upstash)** | Lighter, cheaper, simple delayed HTTP callbacks; you build flow logic yourself. Good if you want minimal vendor surface. |
| **Trigger.dev** | Similar to Inngest, code-first long-running jobs. |
| **BullMQ + Redis** | Max control / lowest unit cost at scale — but needs a **always-on worker** (Railway/Fly/ECS), which breaks the pure-Vercel model. Pick only once volume justifies running infra. |
| **pg-boss (Postgres queue)** | No new infra (uses Supabase), but again needs a long-running worker and you build delays/cancellation. |

Start on Inngest; its delay/cancel semantics are exactly the abandoned-cart shape and it needs no servers. Re-evaluate BullMQ only if job volume makes per-execution pricing the bottleneck.

---

## 10. Analytics dashboard

- **Tenant-facing dashboard** in the app reads aggregates from PostHog's query API (HogQL) scoped to that tenant's project, *plus* fast counters materialized in Postgres (orders, revenue, recovered-cart count) for instant loads.
- Gate the whole route behind `ANALYTICS_DASHBOARD`.
- Show: funnel conversion, revenue, top products, abandoned-cart recovery rate, email open/click, active journeys.
- Materialize automation KPIs (emails sent, carts recovered, revenue recovered) in an `automation_metrics` rollup table updated by Inngest — don't recompute from raw events on every dashboard load.

---

## 11. Database structures (Prisma / Postgres)

Full schema in `prisma/schema.prisma`. Key tables:

```
tenants                  id, name, slug, status, plan_id, created_at
domains                  id, tenant_id, hostname (unique), verified, is_primary
plans                    id, key (basic|ecommerce|growth), name
features                 id, key (unique)                ← the FEATURES catalog
plan_features            plan_id, feature_id             ← package→features map
tenant_feature_overrides tenant_id, feature_id, enabled  ← trials/custom deals
tenant_integrations      tenant_id, provider, enabled,
                         encrypted_credentials(jsonb), data_key_id, config(jsonb)
                         UNIQUE(tenant_id, provider)
contacts                 id, tenant_id, distinct_id, email, unsubscribed, traits(jsonb)
products / carts / cart_items / orders / order_items      (ecommerce)
events                   id, tenant_id, distinct_id, name, props(jsonb), ts   ← outbox/audit
email_logs               id, tenant_id, contact_id, provider_message_id, template, status, flow
automation_runs          id, tenant_id, function_id, distinct_id, status      ← journey state
automation_metrics       tenant_id, period, emails_sent, carts_recovered, revenue_recovered
```

### 11.4 Multi-tenant safety

- **Prisma client extension** injects `where: { tenantId }` and rejects writes missing `tenantId`.
- **RLS policies** on every tenant table: `USING (tenant_id = current_setting('app.tenant_id'))`. Set `app.tenant_id` per connection/transaction. This is the backstop if app code is ever wrong.
- All `(tenant_id, ...)` composite indexes; `tenant_id` is the leading column of every index.

---

## 12. Recommended packages

| Purpose | Package |
|---|---|
| ORM | `prisma`, `@prisma/client` |
| Analytics | `posthog-node`, `posthog-js` |
| Queue/workflows | `inngest` |
| Email | `resend`, `react-email`, `@react-email/components` |
| Billing | `stripe` |
| Validation | `zod` |
| IDs | `ulid` |
| Caching | `@upstash/redis` or Vercel KV / Edge Config |
| Crypto | Node `crypto` (built-in) + `@aws-sdk/client-kms` (optional master key) |
| Rate limit | `@upstash/ratelimit` |

---

## 13. Common mistakes to avoid

1. **Hardcoding packages** (`if package===3`). Use entitlements; packages are data.
2. **Tenant secrets in env vars.** They belong encrypted in the DB. Env holds only the master key.
3. **Holding a serverless function open to "wait" for abandoned cart.** It will time out. Use durable `step.sleep`.
4. **Not cancelling flows on purchase.** Customers who already bought get "you left something behind" → trust destroyed. Use `cancelOn`/`waitForEvent`.
5. **Re-checking entitlement only at emit time.** Plans change mid-flow; re-check in the worker.
6. **Sending all tenant email from one shared domain.** Kills deliverability and the white-label illusion. Per-tenant verified sending domains.
7. **Calling PostHog/Resend directly from feature code.** Go through the abstraction so providers are swappable and events are validated.
8. **Forgetting `tenant_id` in a query.** Enforce with a Prisma extension + RLS backstop.
9. **No idempotency on emails/webhooks.** Retries double-send. Use idempotency keys + dedupe on provider message IDs.
10. **Exposing the PostHog *personal* API key client-side.** Only the *project* (ingest) key is safe in the browser; the personal/management key stays server-side encrypted.
11. **Treating events as commands.** Events are past-tense facts; consumers decide what to do. Keeps the system decoupled.
12. **One giant `track()` with free-form strings.** Typed event catalog or your funnels rot within a month.

---

## 14. Build order (suggested)

1. Tenancy: middleware resolution, tenant context, Prisma + RLS, feature catalog & entitlements.
2. Integration system: `tenant_integrations`, envelope crypto, provider registry, admin UI to add keys + health check.
3. PostHog: server clients, client provider, analytics sink, event catalog + `emitEvent` (outbox).
4. Inngest: `/api/inngest` route, abandoned-cart function, email provider + Resend + per-tenant domains.
5. Journeys: welcome, post-purchase/reorder, win-back, dunning.
6. Dashboard + `automation_metrics` rollups.
7. Harden: rate limits, idempotency, replay/reconciler for the outbox.
