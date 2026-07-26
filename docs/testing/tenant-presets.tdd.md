# TDD evidence — Tenant presets ("duplicate the K Glow store")

**Date:** 2026-07-26
**Branch:** `main`
**Gate:** `npm run test:tenant-presets` — 45 assertions, pure (no DB/React/network)

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request:

> "i want kglow tenant website to be able to be duplicate easily in the whitelabel even the ui once the website offers a groupbuy and onhand"

Scope was confirmed with the user before implementation:

- **Preset carries** config + entitlements + theme. **No products** — each tenant keeps its own catalog.
- **Apply surfaces:** operator admin only — the new-tenant flow *and* apply-to-an-existing-tenant. (Script and store-admin self-serve surfaces were offered and not selected.)

## The problem

K Glow's "two ways to order" storefront was assembled by hand and was not reproducible:

| Piece | How it was done before |
|---|---|
| Two-ways home layout | `scripts/enable-two-ways-home.ts` (one-off — still the switch, now opt-in) |
| Group-buy catalog (25 products) | `scripts/seed-kglow-products.ts` |
| On-hand catalog (6 products) | `scripts/seed-kglow-onhand.ts` |
| Lab reports (7 Janoshik) | `scripts/seed-kglow-coa.ts` |
| 9 entitlements | clicked by hand in admin → Features |
| Theme `kglow` | picked by hand |
| Group-buy rules / settings / copy | store-admin UI edits |

The de-facto pattern for a new tenant was another copy-pasted `scripts/configure-<slug>.ts` — there are ~15 of them. There was **no tenant-level preset or clone concept** anywhere in the repo.

## Ground truth captured before writing the preset

Read from the live `k-glow` tenant (read-only probe, since discarded):

- `themeId` = `kglow`, `branding.config` holds 104 keys
- `homeLayout: "two-ways"`
- `groupBuyRules`: enabled, ratio enabled, `strict`, `bacWaterPerPeptide: 1`
- `groupBuyAllowOnHand` / `groupBuySettings` / `groupBuyContent`: **unset** → the store renders the shared defaults
- Entitlements ON (9): `groupbuy.two_ways_home`, `groupbuy.module`, `groupbuy.rules`, `groupbuy.scheduled`, `groupbuy.reports.auto_on_close`, `storefront.coa`, `storefront.protocols`, `storefront.card_studio`, `storefront.sales_analytics`

## User journeys

- **J1** As an operator, I create a new tenant already configured like K Glow, so I don't hand-run four scripts and click nine grants.
- **J2** As an operator, I apply the preset to an existing live tenant **without wiping its identity** — name, logo, colors, catalog, lab reports, owner secrets all survive.
- **J3** As an operator, I see exactly which config keys and entitlements will change *before* I commit to it.
- **J4** As a developer, I add a new store shape as data in one registry, not as another `configure-*.ts`.

## Task report

### 1. Pure core — `src/lib/tenant/presets.ts`

Declarative registry + one total, pure applier. Mirrors the house preset pattern (`lib/theme/presets.ts`, `storefront/cardDesign.ts`).

- **RED:** `npm run test:tenant-presets` → `Error: Cannot find module '../src/lib/tenant/presets'`. Compile-time RED caused by the intended missing implementation, not unrelated breakage.
- **GREEN:** `38 passed, 0 failed`.

Two invariants the gate enforces:

1. **Additive only** — never revokes an entitlement, never overwrites a config key the preset does not explicitly own.
2. **Nothing forbidden** — `PRESET_FORBIDDEN_KEYS` blocks secrets (`adminPassword`, `resellerAccessCode`), identity (`name`, `logoUrl`, palette, fonts, `coaReports`, `categories`, …) and server-projected keys (`groupBuyCaps`, `groupBuyGate`, `groupBuyBanner`, `trial`, `subscription`, …). Enforced twice: at compile time via `PresetConfig = Omit<Partial<Brand>, ForbiddenKey>`, and at test time over every registered preset.

### 2. The `kglow-two-ways` preset

`themeId: "kglow"`; grants `groupbuy.two_ways_home`, `groupbuy.module`, `groupbuy.rules`, `storefront.coa`; writes 8 config keys:

`homeLayout: "classic"`, `groupBuyAllowOnHand: true`, `showAdminGroupBuy: true`, `showAnalyticsGroupBuys: true`, `showPageCOA: true`, plus `groupBuySettings` / `groupBuyContent` / `groupBuyRules` (ratio floor: 1 bac water per peptide, strict, enforced in cart *and* at checkout).

**The dual "two ways to order" home is DEFAULT OFF** (changed 2026-07-26). The preset sets up the group-buy machinery but leaves the storefront on the classic hero → catalog home, so stamping it onto a live store never redesigns that store's front page. `groupbuy.two_ways_home` is still granted, so switching the split home on afterwards is one config key and no second trip to admin → Features:

```
npx tsx scripts/enable-two-ways-home.ts <slug> two-ways
```

The `"classic"` must be written explicitly rather than omitted: `resolveHomeLayout` treats the entitlement as the only way in and reads an **absent** key while entitled as ON, so leaving `homeLayout` out of the preset would switch the split layout on for every tenant it touches. The gate asserts the resolved layout is `classic` both entitled and unentitled, and separately that the grant is still present.

### 3. Operator surfaces

| Surface | File |
|---|---|
| Server actions (preview + apply) | `src/actions/tenant-presets.ts` |
| New-tenant provisioning | `src/actions/onboarding.ts` (`presetId` on `createTenantSchema`, applied inside the create transaction) |
| New-tenant picker UI | `src/components/admin/tenant-presets/TenantPresetPicker.tsx` → mounted in `admin/tenants/new/page.tsx` |
| Existing-tenant apply UI | `src/components/admin/tenant-presets/ApplyTenantPresetCard.tsx` → mounted in `TenantDetailView.tsx` |

Existing-tenant flow is **preview-then-confirm**: it rewrites config and grants entitlements on a store that already has customers, so the operator sees the before→after diff first. A missing `Feature` row degrades loudly (named in the UI with the `db:sync-features` fix) instead of silently skipping the grant.

**Validation:** `npx tsc --noEmit` — no errors in any touched file.

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | Registry is non-empty and its keys match preset ids | `test-tenant-presets.ts` §1 | PASS |
| 2 | `getTenantPreset` resolves by id, returns null for unknown/blank | §1 | PASS |
| 3 | Every preset has id / name / tagline / themeId | §1 | PASS |
| 4 | K Glow preset uses the `kglow` theme and ships the two-ways home OFF (`homeLayout: "classic"`) | §2 | PASS |
| 5 | Preset grants the 4 group-buy + on-hand entitlements | §2 | PASS |
| 6 | An applied preset resolves to the classic home whether entitled or not | §2 | PASS |
| 6b | The `groupbuy.two_ways_home` grant is still issued, so flipping `homeLayout` to `"two-ways"` is all it takes to switch on | §2 | PASS |
| 7 | On-hand stays buyable during a live round; GB manager + analytics + COA page exposed | §2 | PASS |
| 8 | Every preset feature is a real catalog key | §3 | PASS |
| 9 | Every preset feature is `OPERATOR_GRANTABLE` — a preset can never bypass a plan ceiling | §3 | PASS |
| 10 | No preset lists a feature twice | §3 | PASS |
| 11 | Forbidden set covers secrets, identity and projected keys | §4 | PASS |
| 12 | No preset writes a forbidden key | §4 | PASS |
| 13 | Every preset config key is a real `Brand` key (checked against `types.ts` source) | §4 | PASS |
| 14 | Applying preserves unrelated config, secrets and owner content collections | §5 | PASS |
| 15 | Applying overwrites the keys the preset owns, and the theme | §5 | PASS |
| 16 | Applying never mutates the caller's config; returns a fresh object | §5 | PASS |
| 17 | Empty config (new tenant) yields a complete group-buy setup on the classic home | §6 | PASS |
| 18 | Malformed current state (`null` / `undefined` / string / array) is tolerated | §6 | PASS |
| 19 | Grants only what the tenant lacks; skips what it has | §7 | PASS |
| 20 | Application is additive only — no revoke channel exists | §7 | PASS |
| 21 | Change preview reports theme, per-key config before→after, and grants | §8 | PASS |
| 22 | No-op keys produce no change entries | §8 | PASS |
| 23 | Re-applying to its own output → zero changes, identical config (idempotent) | §9 | PASS |
| 24 | `groupBuyContent` / `groupBuyRules` / `groupBuySettings` survive their normalizers unchanged | §10 | PASS |
| 25 | Ratio floor is enabled, strict, 1 bac water per peptide | §10 | PASS |

## Post-review round (code review, same session)

A `/code-review` pass raised 7 findings; 5 were in this work and are fixed, 2 belong to
concurrent sessions' uncommitted files and were left untouched.

### HIGH — preset destroyed an existing tenant's group-buy configuration (fixed)

The first cut put `groupBuyRules` / `groupBuyContent` / `groupBuySettings` in `config`, which the
applier always overwrites. Applying to a store already running group buys would have replaced
owner-edited rules, explainer copy and round defaults with the shared defaults — while the card's
own subtitle promised "Additive: … never touched", and the confirm diff rendered
`groupBuyRules: {…} → {…}`, hiding it.

Fix: `TenantPreset` gained a second bucket, `defaults?: PresetConfig`, applied **fill-if-absent**.
Structural keys (`homeLayout`, `showAdminGroupBuy`, …) still always win; owner-editable blocks are
seeded only into a gap. New tenants are unaffected — their config is empty, so they still get a
complete setup.

- **RED:** `3 failed` — `owner-editable group-buy blocks live in 'defaults', not 'config'`,
  `preserves the owner's own group-buy rules, copy and settings` (*"clobbered owner rules"*),
  `the ratio floor is on, strict, 1 bac water per peptide`
- **GREEN:** `45 passed, 0 failed` (7 new assertions, §11)

Also fixed: `short()` in the confirm dialog now prints `not set → {6 keys}` instead of `{…} → {…}`,
and the card subtitle states that existing group-buy settings are kept.

### Other findings fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 2 | MEDIUM | No `isDemoMode()` guard — both actions hit Prisma in demo mode and return a misleading "Tenant not found" | Guard added in `plan()`, matching `actions/admin.ts` / `tenant-admin.ts` |
| 3 | MEDIUM | Preset silently overrode the operator's `ThemePresetPicker` choice | Each preset card now shows its theme, plus a warning line when one is selected |
| 4 | LOW | Unknown `presetId` silently provisioned a plain storefront and reported success | `createTenantSchema.presetId` now `.refine()`s against `TENANT_PRESETS` |
| 5 | LOW | Demo path returned before reading `presetId`, dropping it silently | Demo branch errors when a preset is selected |

### Findings NOT actioned — other sessions' in-flight files

Both live in files this session did not create or modify; editing them would collide with
concurrent work (see the `concurrent-sessions-git-hazard` note).

- **`src/storefront/components/Header.tsx:61`** (LOW) — with `headerShowLogo` and `headerShowBrand`
  both off, the `#top` anchor renders empty: a focusable link with no accessible name
  (WCAG 2.4.4 / 4.1.2).
- **`scripts/configure-luminara-changes.ts:46`** (LOW) — `c.name.trim()` throws on a courier row
  with no `name`; needs `(c.name ?? "").trim()`.

## Regression check

| Gate | Result |
|---|---|
| `test:tenant-presets` | 45 passed, 0 failed |
| `test:two-ways` | 18 passed, 0 failed |
| `test:two-ways-home` | 14 passed, 0 failed |
| `test:two-ways-cart` | 20 passed, 0 failed |
| `test:gb-ratio` | 19 passed, 0 failed |
| `test:gb-content` | PASS |
| `test:onhand-gate` | **8 passed, 1 failed — PRE-EXISTING** |

`test:onhand-gate` fails on `"blocks the paused product through the real resolvers"` (expected `/On-hand product/`). **Not caused by this work:** it imports only `on-hand-gate.ts` and `group-buy.ts`, both unmodified in the working tree, and no module added here is in its import graph. Left untouched — out of scope.

## Coverage and known gaps

No repo-wide coverage tool; this codebase's convention is one hand-rolled `tsx` gate per feature. The pure core (`src/lib/tenant/presets.ts`) is fully covered — every exported symbol and both invariants are asserted.

Deliberately **not** covered by automated tests:

- The two server actions (`src/actions/tenant-presets.ts`) — DB + `next/cache` bound, matching the repo's existing practice of not unit-testing server actions. Verified by `tsc` only.
- The two React components — no component-test harness exists in this repo.
- **End-to-end apply against a real tenant has not been run.** Recommended manual check: open an existing tenant in the platform admin → *Store preset* → **Preview changes**, confirm the diff, then **Apply**, and load the storefront.

Deliberate scope decisions:

- **Products are not copied.** The 25 group-buy + 6 on-hand K Glow SKUs stay in their seed scripts; the preset duplicates behaviour and layout only.
- **The preset grants 4 of K Glow's 9 entitlements** — the ones group buy + on-hand actually require. The other five (`groupbuy.scheduled`, `groupbuy.reports.auto_on_close`, `storefront.protocols`, `storefront.card_studio`, `storefront.sales_analytics`) are independent operator add-ons sold separately, so they were left out. Adding them is a one-line change to the preset's `features` array.

## Merge evidence

No commits were created — the repo is on the default branch `main` and the working tree carries unrelated in-progress changes from concurrent sessions. RED/GREEN evidence is preserved in this document.

- **RED:** `npm run test:tenant-presets` → `Cannot find module '../src/lib/tenant/presets'`
- **GREEN:** `npm run test:tenant-presets` → `38 passed, 0 failed`
- **Refactor:** `plan()` in `src/actions/tenant-presets.ts` switched from `"error" in p` narrowing to an explicit `ok` discriminant to fix two TS2322 errors; gate re-run green afterwards.
