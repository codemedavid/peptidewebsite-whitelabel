# In-app shop (customer "app edition")

Status: in progress, 2026-09-30, branch `feat/mobile-admin-app`. Phase 4 of
COMMUNITY.md.

## Decisions (user, 2026-09-30)

- **Native shop, website rules.** Native screens in the Expo app, over
  `/api/mobile/v1/shop/*`. Every price, fee, stock, promo and group-buy rule is
  the website's own code — nothing is re-implemented in the app.
- **Browse free, sign in to buy.** A phone linked to a store (store link) can
  browse its catalog signed out. Checkout needs a customer account, so every
  app order lands in *My orders*.
- **customer-accounts merged first.** `feat/customer-accounts` (89a7c62) was
  committed on its branch and three-way merged into this working tree; the app
  and the website share one order-to-account link.

## How the website logic is reused

The website's checkout actions (`placeStorefrontOrderAction`,
`uploadPaymentProofAction`, `quoteStorefrontOrderAction`) find their tenant from
the request host and the shopper from the customer cookie. An app request has
neither, so the shop routes authenticate the bearer token first and run the
unmodified action inside an **app shopper scope**
(`src/lib/auth/app-shopper-scope.ts`, AsyncLocalStorage — same pattern as the
admin bridge's `app-actor-scope.ts`). Inside the scope:

- `getTenantIdOrNull()` / `getTenantSlug()` return the session's tenant.
- `getSignedInCustomer()` returns the session's customer (re-read from the DB,
  so a disabled account or bumped `sessionVersion` still fails closed).
- The order is linked to that customer even when the website feature
  `STORE_CUSTOMER_ACCOUNTS` is off — an app customer IS an account.
- Reseller pricing stays locked (no reseller cookie): the app shows the public
  price list, exactly what a signed-out website visitor sees.

`quoteStorefrontOrderAction` is the live placement path minus the write: same
re-pricing, shipping, admin fee, promo, QR PH fee and every blocking rule. The
app never computes a total itself; the checkout screen shows the quote.

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /shop/catalog?store=` | optional (session wins over `store`) | shopper-safe store, products, categories, checkout config |
| `POST /shop/quote` | optional | authoritative totals + first blocking error |
| `POST /shop/proof` | customer | payment-proof upload (multipart `file`) |
| `POST /shop/orders` | customer | place order (idempotent on `id`) |
| `GET /shop/orders` | customer | my orders |

Gates: the store must be live (not pending / suspended / trial-paused) and hold
`MOBILE_COMMUNITY` (the customer app). A store with an active access code is
**private**: signed-out browsing answers `forbidden` ("sign in"), signed-in
customers are known accounts and pass. Promo codes are never shipped; the
quote validates them. The app route (not the website action) also requires an
active payment method and, when the store asks for it, a proof upload.

## Out of scope for v1

Reseller / wholesale price list, the group-buy page's round UI (group-buy
products are still sold at their live-round price and the server's
no-mixing rule applies), reviews, protocols, lab reports.
