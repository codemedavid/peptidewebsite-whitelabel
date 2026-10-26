# Wave 3A — admin screens (website + app, together)

Branch `bunuan/3a-admin` (after 2A merged), worktree `../pepweb-3a`, port 3131. Read README.md + HANDOFF-2A.md first. Use only 2A's actions; don't change server rules (ask in hand-off if one is missing).

## Build (each on the website AND the app)
- **Stage control bar** on the round (website `src/storefront/admin/AdminGroupBuys.tsx` + `DashboardGroupBuy.tsx`; app `mobile/src/app/(app)/manage/group-buys.tsx`): GB Open / GB Bunuan time / GB Close / GB Payment time — only the buttons the store's features + payment mode allow; blocked states explain why (pending payment checks list, Ligwak not locked). Optional payment due date.
- **Bunuan counter panel** (admin only, only in Bunuan): per variation "7 vials needed", filling live (poll ~5s), kit-complete ticks.
- **Order line editor** in the order detail (website admin orders + app order screen): add / remove / change qty, server-priced preview, warning when over the Bunuan allowance, disabled at Payment time.
- **Ligwak review**: suggested lines per variation (customer, order #, variation, vials), Ligwak / Keep per line, totals impact preview, Lock (confirm step), Recalculate (reason required).
- **Refunds** (pay_first): list with status trail + reference field.
- **Supplier report** button available once Bunuan ends; final after Lock.
- **Kit size per variation** field in the product editor (website `src/storefront/admin/AdminAddProduct.tsx` near "Vials per kit"; app product editor), shown for stores with Bunuan (not only group-buy-only stores).

Design: follow the existing admin styles (`.sf-root` scoped CSS, admin pills `--new/--available/--cancelled/--confirmed/--inactive`); empty, loading and error states for each panel. Verify visually on web (3131) and Expo web, phone width too.

**Done when:** both `tsc` clean, existing admin suites green, screenshots of every state in HANDOFF-3A.md.
