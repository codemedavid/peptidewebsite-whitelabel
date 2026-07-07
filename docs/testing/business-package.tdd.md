# TDD Evidence — Business package = pepstack-davao's 15 default functionalities

**Source:** conversational plan (this session). **Branch:** feat/bulk-order-status.
**Goal:** make the Business (Pro) package default the 15 features active on tenant
`pepstack-davao`, for all future tenants, while keeping the inert Group-Buy /
Sales-Analytics scaffolding enable-able and not regressing existing tenants.

## User journeys
1. As the operator, provisioning a new Business tenant yields exactly the 15 visible
   functionalities (site + catalog + core storefront checkout + admin fee).
2. As the operator, I can still enable Group Buy / Sales Analytics for a Business
   tenant later (scaffolding retained in the ceiling).
3. As an existing Business tenant, I lose nothing (grandfathered).
4. As the platform, the Automated (Enterprise) tier is unchanged (full superset).

## The change
- `src/lib/features/catalog.ts`: `PRO` redefined as the curated 36 keys
  (15 visible + 9 SA + 12 GB scaffolding), decoupled from `...STARTER`;
  `ENTERPRISE` re-adds the 7 dropped features so it stays the same 58-key set.
  Shared SA/GB scaffolding extracted into named consts.
- 15 visible: homepage, contact form, blog, community link, product catalog,
  product specs, search, categories, dosage calculator, cart, checkout,
  discount codes, floating cart, order tracking, admin fee.
- 7 removed from Business default: bundles, customer accounts, upsells,
  multi-currency, email notifications, staff accounts, reseller portal.

## Task report
| Task | Summary | Command | Result |
|---|---|---|---|
| RED | Test pins pro=36 / 15 visible; guards Enterprise superset | `tsx scripts/test-business-package.ts` | 7 passed, **3 failed** (pro still 43) |
| GREEN | Redefined PRO/ENTERPRISE in catalog.ts | `tsx scripts/test-business-package.ts` | **10 passed, 0 failed** |
| Regress | Existing plan-feature-config suite still green | `tsx scripts/test-plan-feature-config.ts` | 20 passed, 0 failed |
| Types | Touched files typecheck clean | `tsc --noEmit` | no errors in catalog/plan-scope/test |
| Grandfather | Granted removed-7 (skipDuplicates) to 5 existing tenants; respected existing revokes; excluded pepstack-davao | one-off script | soi-health+1, urban-biopeptides+7, fit-n-glow+7, ar-jonina+3, peppies-intl+6 |
| Sync | Reconciled plan_features to catalog | `tsx scripts/sync-plan-features.ts` | pro −7; enterprise +1 (notify.admin_order drift fix); starter unchanged |
| Verify | Effective sets post-change | one-off script | pro ceiling=36, enterprise=58; pepstack-davao=15 (none of 7); other 5 retain exactly their prior features |

## Guarantees (test spec)
| # | Guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Business ceiling = exactly the 15 visible + SA(9) + GB(12) = 36 | `test-business-package.ts` | unit | PASS |
| 2 | getPlanScope('pro') surfaces exactly the 15 as active (state=included) | same | unit | PASS |
| 3 | SA/GB stay included-needs-addon (enable-able) | same | unit | PASS |
| 4 | Business no longer defaults the 7 removed features | same | unit | PASS |
| 5 | Enterprise still includes the 7 + remains a superset of pro | same | unit | PASS |
| 6 | Starter unchanged (still has Reseller portal) | same | unit | PASS |

## Notes / known gaps
- Grandfathering preserves existing tenants; only NEW Business tenants get the lean 15.
- `plan_features_config` PlatformSetting does not exist, so catalog.ts is the live
  source of truth (the /admin/plans "Package contents" editor shows the new default).
- Business marketing card (`src/lib/admin/plans.ts` feats) reviewed — advertises no
  removed feature; left unchanged. "Everything in Starter" is a marketing shorthand
  (Business drops the invisible-until-access-code Reseller portal; immaterial).
- Entitlement cache (unstable_cache, 5-min TTL) self-heals; grandfather-before-sync
  order guarantees no downtime for existing tenants.
