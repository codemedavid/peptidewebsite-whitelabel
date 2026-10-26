# Wave 3B — customer screens (website + app, together)

Branch `bunuan/3b-customer` (after 2A merged), worktree `../pepweb-3b`, port 3132. Read README.md + HANDOFF-2A.md first. Use only 2A's contract types; don't change server rules.

## Build (website AND PepWorld app)
- **Bunuan storefront state**: only the open variations are buyable, each with a quiet "up to N vials" and the qty field capped at N; everything else reads as closed for this round. A short banner: "Last call — help fill the kits". NO kit progress bar: remove the existing `KitProgressBar` (catalog cards + GroupBuyPage, see `src/lib/storefront/gb-moq-kits.ts` `roundKitProgress`) for stores with Bunuan. Over-limit server errors shown clearly.
- **Order list** (website `src/storefront/pages/AccountPage.tsx` + order Track page; app shop orders, see `src/lib/mobile/order-rounds.ts`): grouped **Live** (current round, stage badge: Open / Bunuan time / Closed / Payment time) and **Recent**. Every line shows product **and variation name**, qty, unit price, line status: Pending, Success, Partial ("2 Success · 3 Cancelled"), Cancelled (struck through, excluded from total). Old total struck next to the new one. "Changed by the store" note on admin-edited lines.
- **Payment time** (pay_later): latest order shows "Payment due ₱X" (+ due date if set) and the proof upload (reuse the existing proof upload + `classifyProofFile`).
- **Refund status** (pay_first): Refund under review → Refund on the way → Refunded (+ reference).

Verify visually: web 3132 at 375/768/1440, Expo web, before/after states for every line status.

**Done when:** both `tsc` clean, storefront + mobile-shop suites green, screenshots in HANDOFF-3B.md.
