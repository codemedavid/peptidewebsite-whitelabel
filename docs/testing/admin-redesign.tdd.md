# TDD evidence — store-admin sidebar redesign

**Feature:** rebuild the tenant store admin as a sidebar workspace, per the Claude
Design project `Tenant Admin Redesign.dc.html` (layout 1A).
**Gate:** `npm run test:admin-dashboard` → `scripts/test-admin-dashboard.ts`
**Branch:** `feat/gb-pricing-tab`
**Checkpoints:** `603a160` (RED) → `70ec6e1` (GREEN) → this commit (UI layer)

## Source plan

Produced inline by `/ecc:plan` in this session (no `*.plan.md` artifact). Three
decisions were confirmed by the user before implementation:

1. **Fully brand-derived palette** — the design's Luminara hexes are mapped onto
   the tenant's existing `--brand-*` tokens, so all 20 theme presets re-skin the
   admin. No hardcoded cream/ink/rose ships.
2. **Shell now, screens incrementally** — this pass delivers the sidebar, topbar
   and redesigned dashboard; the 30 existing sub-views render unchanged inside
   the new content region. Re-skinning the Orders/Products/Inventory/Categories
   tables is a later pass.
3. **Order detail stays the existing full page** — the design's 398px drawer is
   not built; `AdminOrderDetail` carries far more (payment proof, courier,
   tracking, notes) than the mock's drawer.

## User journeys

| # | Journey |
|---|---|
| 1 | As a store owner, I want one persistent sidebar grouped by how often I use each tool, so I stop hunting through a flat grid of 30 tiles. |
| 2 | As a store owner, I want to jump to any tool by typing its name (⌘K), so navigation does not depend on remembering where it lives. |
| 3 | As a store owner **without** the Sales Analytics feature, I want the dashboard's main region to show my stock levels and recent orders, so the space is useful instead of advertising a feature I do not have. |
| 4 | As a staff member with limited grants, I want the sidebar and every dashboard shortcut to show only what I may open, so I never click into a permission error. |
| 5 | As a store owner on any theme preset, I want the admin to look like my store, so the workspace stays on-brand. |

## Task report

### Task 1 — dashboard capability gate + pure builders

**Summary:** added `src/lib/storefront/admin-dashboard.ts`: one capability gate
(`dashboardCapabilities`) combining the tenant entitlement (`isAdminViewVisible`)
with the staff grant (`isViewAllowed`), plus the pure builders every dashboard
number comes from.

**Validation:** `npm run test:admin-dashboard`

RED (before the module existed):

```
Error: Cannot find module '../src/lib/storefront/admin-dashboard'
Require stack:
- scripts/test-admin-dashboard.ts
```

GREEN:

```
56 passed, 0 failed
```

**Guaranteed:** the analytics fallback is decided on the DATA, not in CSS —
`buildMetricTiles` emits no `₱` string at all without the capability and
`buildRevenueSeries` returns `null`, so there is no rendered-then-hidden revenue
figure to leak. Both the tenant toggle and the staff grant must hold.

### Task 2 — grouped sidebar registry

**Summary:** added `src/storefront/admin/admin-nav.ts` — the Daily/Weekly/
Occasional registry keyed by canonical `View` ids, resolving visibility,
permission and the Business lock through the existing helpers only.

**Validation:** same gate. **Guaranteed:** a nav entry cannot widen access — the
gate fails if any staff-reachable item is not in `STAFF_MODULE_KEYS` or
`ALWAYS_ALLOWED_VIEWS`, so adding a tool to the sidebar without gating it is a
test failure rather than a silent permission hole.

### Task 3 — shell, dashboard and brand-derived CSS

**Summary:** `AdminShell.tsx` (sidebar + search topbar + content region + mobile
drawer), `AdminDashboard.tsx` (KPI tiles, revenue *or* stock region, needs-
attention, top categories, recent orders) and a `.sf-root .adm-*` block in
`storefront.css`. `AdminPage.tsx` becomes a router: its session guard, view
guard, trial/subscription chrome and all 30 sub-view branches are unchanged; only
the inline stats/quick-actions/categories markup was replaced.

**Validation:** `npx tsc --noEmit` filtered to the touched files → no errors;
`npm run test:admin-dashboard` → still 56/56.

**Guaranteed:** every admin surface is mixed from `--brand-*` tokens
(`color-mix` for hover/active/faint), so no palette is pinned to one tenant.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `showAdminAnalytics === false` revokes analytics for the owner too | `test-admin-dashboard.ts:dashboardCapabilities` | unit | PASS |
| 2 | A staff member without the analytics grant never gets the analytics capability | same | unit | PASS |
| 3 | Tenant entitlement and staff grant must BOTH hold | same | unit | PASS |
| 4 | No analytics → the operations layout (stock + recent orders) | `dashboardLayoutFor` | unit | PASS |
| 5 | No analytics → no revenue tile and no `₱` anywhere in the KPI row | `buildMetricTiles` | unit | PASS |
| 6 | Operations tiles report catalog + stock units instead | same | unit | PASS |
| 7 | Unfulfilled excludes shipped / delivered / cancelled | same | unit | PASS |
| 8 | Without the orders grant no order-derived tile is emitted | same | unit | PASS |
| 9 | `buildRevenueSeries` returns null without the capability | `buildRevenueSeries` | unit | PASS |
| 10 | Cancelled orders never contribute revenue | same | unit | PASS |
| 11 | Total = items − discount + shipping + admin fee | same | unit | PASS |
| 12 | `deltaPct` is null rather than Infinity/NaN with no prior window | same | unit | PASS |
| 13 | Stock panel orders out-of-stock → low → healthy | `buildStockPanel` | unit | PASS |
| 14 | Bars stay 0..100 and never divide by zero | same | unit | PASS |
| 15 | Variation-tracked stock sums its own pools; an untracked variation counts the shared base once | `productUnits` | unit | PASS |
| 16 | No orders grant → no recent-order rows | `buildRecentOrders` | unit | PASS |
| 17 | Rows carry the tenant-facing order code, not the internal id | same | unit | PASS |
| 18 | Every attention alert links to a view the actor may open | `buildAttentionAlerts` | unit | PASS |
| 19 | A healthy store produces no alerts | same | unit | PASS |
| 20 | Category shares exclude "all" and stay finite with zero products | `buildCategoryShares` | unit | PASS |
| 21 | No staff-reachable nav item escapes the permission registry | `admin-nav registry` | unit | PASS |
| 22 | Staff with no grants sees only always-allowed views | same | unit | PASS |
| 23 | Owner-only items never reach a staff member | same | unit | PASS |
| 24 | A super-admin-disabled module drops out of the sidebar | same | unit | PASS |
| 25 | Business-exclusive modules stay visible but flagged locked during a trial | same | unit | PASS |
| 26 | Search never returns an item the actor cannot open | `searchNavItems` | unit | PASS |

Full run: **56 passed, 0 failed.**

## Coverage and known gaps

This repo has no coverage tool wired (`package.json` exposes ~110 standalone
`test:*` gates, no `test:coverage`), so coverage is expressed as gate scope: the
new pure modules are covered function-by-function by the 56 assertions above.

Deliberate gaps, to be closed in the follow-up passes:

- **Sub-view chrome.** The 30 existing sub-views still render their own header +
  "Back" control inside the new shell, so navigation is briefly doubled. Phase 3
  of the plan suppresses that via one shared prop.
- **Sidebar count badges.** The design shows unfulfilled/low-stock counts on the
  Orders and Inventory items; not wired (the shell would have to fetch orders).
- **Subscription card in the sidebar footer.** Deliberately omitted — the
  existing `SubscriptionBanner` already renders the same countdown as header
  chrome, and duplicating it would show one tenant two different clocks.
- **No visual-regression or E2E coverage** for the shell yet. Manual checks at
  320/375/768/1024/1440 and a dark preset are still outstanding.
- **`npm run test:themes` not re-run** in this session — the new CSS adds no new
  color pair, only `color-mix` derivations of tokens that gate already covers.

## Merge evidence

- **RED** — `603a160`: gate added; `Cannot find module '../src/lib/storefront/admin-dashboard'`.
- **GREEN** — `70ec6e1`: pure modules added; `56 passed, 0 failed`; `tsc` clean.
- **UI layer** — this commit; gate still 56/56, touched files `tsc`-clean.

**Build status:** `npm run build` reaches `✓ Compiled successfully` and then
fails type-checking in `src/components/admin/pages/PlansManager.tsx`
(`EditablePlanCard.yearlyPriceCents`) — a **concurrent session's** in-flight
yearly-subscription work (`src/lib/onboarding/pricing.ts`, `src/lib/admin/plans.ts`,
`src/lib/platform/plan-config.ts` are modified in the shared tree by that session).
Those files are untouched by this work and none of them import the redesign. A
full green build must be re-confirmed once that work lands.
