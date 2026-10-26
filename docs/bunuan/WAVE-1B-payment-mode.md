# Wave 1B — GB payment mode (pay before checkout / pay after close)

Branch `bunuan/1b-payment-mode`, worktree `../pepweb-1b`, port 3112. Read README.md first.

**Goal:** one per-store setting that both the website and the PepWorld app respect, set from three places, and website pay-after-close checkout.

## Today
- `branding.config.groupBuyInvoice` (`src/lib/storefront/gb-invoice.ts`, pure, byte-copied to `mobile/src/features/admin/group-buys/invoice.ts`; `npm run test:gb-invoice` fails on drift) = pay-after-close, but APP ONLY: `stampGroupBuyInvoice` in `validateLiveOrder` (`src/actions/orders.ts`) runs only in the app-shopper scope. The website always pays up front.

## Files you own
- New `src/lib/storefront/gb-payment-mode.ts` (pure): `GbPaymentMode = "pay_first" | "pay_later"`, `normalizeGbPaymentMode`, `gbPaymentModeFor(brand)` — reads a new `branding.config.groupBuyPayment.mode`, falling back to `groupBuyInvoice.enabled ? "pay_later" : "pay_first"` so existing stores keep behaving the same.
- `src/actions/orders.ts` — ONLY the checkout branch: pay_later round orders on the WEBSITE skip payment method + proof just like the app path (reuse `stampGroupBuyInvoice`, don't fork it). Keep the hunk small; 2A also edits this file later.
- Website checkout UI (find it from `CartCheckout`): hide the payment/proof step for pay_later round carts, show "You'll pay after the group buy closes".
- Settings UI, all three:
  1. Super admin tenant setup (operator): find the tenant detail Brand/feature tabs under `src/app/(platform)/admin` / `src/components/admin`.
  2. Store admin Group Buys settings (`src/storefront/admin/AdminGroupBuys.tsx`, near the invoice card).
  3. App `mobile/src/app/(app)/manage/group-buys.tsx` (+ `mobile/src/features/admin/group-buys/`).
  Writes go through existing branding-config save paths (owner-scoped actions; app uses the admin bridge / `BRIDGED_ACTIONS`).
- Optional: MCP connector field if `update_whitelabel_branding` has a natural place (see `mcp-store-settings` memory) — skip if it grows the scope.
- `scripts/test-gb-payment-mode.ts` + `npm run test:gb-payment-mode` (pure + a website checkout flow test with PGlite like `test-gb-invoice-flow`).

Do NOT touch `schema.prisma` (no column needed; the per-round snapshot is Wave 2A), the stage logic (1A), or Paid Access.

**Done when:** website pay_later GB checkout places an order with no payment/proof and the app still works; `test:gb-payment-mode`, `test:gb-invoice`, `test:gb-invoice-flow`, `test:mobile-shop` green; both `tsc` clean (root + `mobile/`); visual check of the three settings screens + checkout (web 3112, Expo web); HANDOFF-1B.md written.
