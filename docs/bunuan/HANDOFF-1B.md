# Hand-off — Wave 1B (GB payment mode)

Branch `bunuan/1b-payment-mode`. No schema change, no live-DB writes.

## What it does

One per-store setting: **Pay before checkout** (`pay_first`) or **Pay after close** (`pay_later`). The website checkout, the PepWorld app checkout and the server's placement stamp all read it.

- Stored at `branding.config.groupBuyPayment.mode`. Stores with no mode fall back to `groupBuyInvoice.enabled ? "pay_later" : "pay_first"`, so every existing store behaves as before.
- **The mode and the invoice switch are always written together.** Pay-after-close *is* the invoice machinery (flat once-per-round shipping fee, add-on rule, chat invoice, `INVOICE_PAYMENT_METHOD` marker). A mode save sets `groupBuyInvoice.enabled` and stamps `enabledAt` on off→on. An invoice save (including older app builds' "Pay after the group buy closes" toggle) sets the mode to match. If a hand-edited config disagrees, the explicit mode wins everywhere.
- **Website pay-later checkout:** a round cart skips the payment step (no method, no proof). It shows "You'll pay after the group buy closes…", the total line reads "Due after close", and shipping shows the round's flat fee. The server stamps the order unpaid with `INVOICE_PAYMENT_METHOD`. This is the same `stampGroupBuyInvoice` the app uses, with the app-only guard removed.
- **Stale tab:** a website order that arrives with a proof already uploaded (a tab opened before the switch) keeps its payment and is not re-billed on the invoice.

## Exported API

`src/lib/storefront/gb-payment-mode.ts`: pure, zero imports, byte-copied to `mobile/src/features/admin/group-buys/payment-mode.ts`. The test fails on drift.

```ts
type GbPaymentMode = "pay_first" | "pay_later";
const GB_PAYMENT_MODES: readonly GbPaymentMode[];
const GB_PAYMENT_MODE_COPY: Record<GbPaymentMode, { label: string; hint: string }>;
const PAY_LATER_CHECKOUT_NOTE: string;
normalizeGbPaymentMode(raw: unknown): GbPaymentMode | null;
gbPaymentModeFor(brandOrConfig: unknown): GbPaymentMode;                      // ← 2A snapshots this onto GroupBuy.paymentMode
withGbPaymentMode(config: unknown, mode: GbPaymentMode, now?: Date): Row;    // new object; syncs invoice.enabled/enabledAt
syncGbPaymentModeToInvoice(config: unknown): Row;                            // new object; mode ← invoice.enabled
isPayLaterCart(mode, round: { coversAll; productIds } | null, productIds: string[]): boolean;
```

Actions:
- `saveGroupBuyPaymentModeAction(mode: unknown)` in `src/actions/group-buys.ts`: the owner's save, guarded by `requireGroupBuyAdmin`, row-locked. Returns `{ ok, mode, invoice } | { error }`. It's in `BRIDGED_ACTIONS` (app) and the MCP `STORE_ACTION_ALLOWLIST`.
- `saveGbPaymentModeAction(slug, mode: unknown)` in `src/actions/branding.ts`: the operator's save (`getPlatformUser`), row-locked, same write.
- `listGroupBuysAction` now also returns `paymentMode`.
- `getTenantGbPaymentMode(slug)` in `src/lib/admin/data.ts`.
- `Brand.gbPaymentMode` and `Brand.gbPayLaterShippingFee` are set in `storefront-brand.ts`, only when the GB module is on.

## Settings UIs
1. Super admin → tenant **Settings** → new "Group buy payment" card (select, saves instantly).
2. Store admin → **Group Buys** → Rounds tab → "How customers pay" (two buttons, like Ways to order). The website store admin had no invoice card, so this sits above "Allow on-hand purchases".
3. App → Manage → **Group Buys** → `PaymentModeCard` (ChoicePills). The invoice card now shows only in pay_later and has lost its own switch. On a server that predates `paymentMode`, the app falls back to the old toggle.

## Tests
- `npm run test:gb-payment-mode`: **29 passed**. Pure checks, the drift check, and a PGlite flow covering website pay-later round order / on-hand order / stale-tab proof, app catalog + order, the switch to pay_first on both, the disagreeing-config case, and a legacy store.
- Mutation-checked: restoring the app-only guard (2 fail), dropping the stale-tab guard (1 fail), making the app catalog ignore the mode (1 fail). Keying `shop-flow`'s `isInvoiceCart` on the invoice flag instead survives on purpose: that check is only a shortcut, and the quote (keyed on the mode) decides.
- Green: `test:gb-invoice` 43/43, `test:gb-invoice-flow` 13, `test:mobile-shop` 36, `test:mcp-store-settings` 21, `test:gb-access-flow` 17. `tsc` is clean in root and in `mobile/`.
- Visual check: only the super-admin card, on a dev server in `DEMO_MODE` on port 3112 (no live DB). Both states render, and the saved value survives a reload. **Not visually checked:** the store-admin card (needs an owner sign-in), the website pay-later checkout (needs a live demo round) and Expo web. The browser extension wasn't connected, so I used headless Chrome.

## Files outside the brief's list (small hunks)
`src/storefront/types.ts` (2 Brand fields), `src/lib/storefront/storefront-brand.ts`, `src/lib/mobile/{shop-flow,group-buy-share,shop-catalog,admin-bridge}.ts`, `src/lib/mcp/store-settings-core.ts`, `src/actions/{group-buys,branding}.ts`, `src/lib/admin/data.ts`, the tenant settings `page.tsx` + `TenantSettingsView.tsx`, `mobile/.../InvoiceSettings.tsx` (`showSwitch` prop), `mobile/.../model.ts`.

## Notes / open questions
- **Behaviour change for live stores:** any store whose invoice switch is already on now also takes **website** group-buy orders unpaid (before, only the app did). That's what the brief asks for, but check which stores have `groupBuyInvoice.enabled` before this deploys. I didn't query the live DB.
- On the website, a guest (no account) always pays the flat fee. A signed-in buyer's add-on is waived server-side, but the checkout still shows the fee (no quote round-trip). The total the customer finally owes comes from the stored order (3B "Payment due").
- `pay_later` with a flat fee of ₱0 means free shipping on round orders. That's the existing invoice behaviour, kept.
- `currentAppShopperScope` stays imported in `orders.ts` (still used by the stale-tab check).
