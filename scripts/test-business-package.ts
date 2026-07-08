/**
 * Pins the Business (pro) package ceiling to the pepstack-davao reference set:
 * exactly 15 VISIBLE functionalities (site + catalog + basic ecommerce + admin
 * fee), plus the inert Sales-Analytics (9) and Group-Buy (12) scaffolding that
 * stays in the ceiling so those modules remain enable-able per tenant.
 *
 * Also guards the ripple risk: narrowing pro must NOT narrow the Automated
 * (enterprise) tier — the 7 features dropped from Business must still be in
 * Enterprise, and enterprise must remain a superset of pro.
 *
 * Pure (no DB / no Next runtime).  npm run test:business-package
 */
import assert from "node:assert";

import { FEATURES, PLAN_FEATURES, type FeatureKey } from "../src/lib/features/catalog";
import { getPlanScope } from "../src/lib/features/plan-scope";

// -- the pepstack-davao reference: the 15 features active by default on Business --
const BUSINESS_VISIBLE: FeatureKey[] = [
  FEATURES.SITE_HOMEPAGE,
  FEATURES.SITE_CONTACT_FORM,
  FEATURES.SITE_BLOG,
  FEATURES.STORE_COMMUNITY_LINK,
  FEATURES.SITE_PRODUCTS,
  FEATURES.STORE_PRODUCT_SPECS,
  FEATURES.STORE_SEARCH,
  FEATURES.STORE_CATEGORIES,
  FEATURES.STORE_CALCULATOR,
  FEATURES.ECOM_CART,
  FEATURES.ECOM_CHECKOUT,
  FEATURES.ECOM_DISCOUNTS,
  FEATURES.STORE_FLOATING_CART,
  FEATURES.STORE_ORDER_TRACKING,
  FEATURES.STORE_ADMIN_FEE,
];

// Inert scaffolding kept in the ceiling (invisible until a master switch is granted).
const SA_SCAFFOLDING: FeatureKey[] = [
  FEATURES.SA_SECTION_REVENUE,
  FEATURES.SA_SECTION_PRODUCTS,
  FEATURES.SA_SECTION_GROUP_BUYS,
  FEATURES.SA_SECTION_CUSTOMERS,
  FEATURES.SA_REPORT_DAILY,
  FEATURES.SA_REPORT_WEEKLY,
  FEATURES.SA_REPORT_MONTHLY,
  FEATURES.SA_EXPORT_EXCEL,
  FEATURES.SA_EXPORT_PDF,
];
const GB_SCAFFOLDING: FeatureKey[] = [
  FEATURES.GB_CREATE,
  FEATURES.GB_EDIT,
  FEATURES.GB_DUPLICATE,
  FEATURES.GB_ARCHIVE,
  FEATURES.GB_PRODUCT_ASSIGNMENT,
  FEATURES.GB_SUPPLIER_REPORTS,
  FEATURES.GB_REPORT_CSV,
  FEATURES.GB_REPORT_EXCEL,
  FEATURES.GB_REPORT_PDF,
  FEATURES.GB_REPORT_CUSTOMER_BREAKDOWN,
  FEATURES.GB_REPORT_PRODUCT_BREAKDOWN,
  FEATURES.GB_REPORT_SUPPLIER_SUMMARY,
];

// The 7 features REMOVED from the Business default (pepstack-davao revokes them).
const REMOVED_FROM_BUSINESS: FeatureKey[] = [
  FEATURES.ECOM_BUNDLES,
  FEATURES.ECOM_ACCOUNTS,
  FEATURES.ECOM_UPSELLS,
  FEATURES.STORE_MULTI_CURRENCY,
  FEATURES.NOTIFY_EMAIL,
  FEATURES.STORE_STAFF_ACCOUNTS,
  FEATURES.STORE_RESELLER_PORTAL,
];

const EXPECTED_PRO = new Set<FeatureKey>([...BUSINESS_VISIBLE, ...SA_SCAFFOLDING, ...GB_SCAFFOLDING]);

// ---- tiny assertion harness ----
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}`); console.error(`    ${e instanceof Error ? e.message : String(e)}`); }
}
const sorted = (a: readonly string[]) => [...a].sort();

console.log("business-package (pro ceiling = pepstack-davao reference)\n");

check("Business (pro) ceiling is EXACTLY the 15 visible + SA(9) + GB(12) = 36", () => {
  assert.deepEqual(sorted([...new Set(PLAN_FEATURES.pro)]), sorted([...EXPECTED_PRO]));
  assert.equal(new Set(PLAN_FEATURES.pro).size, 36);
});

check("Business includes every one of the 15 visible functionalities", () => {
  const pro = new Set(PLAN_FEATURES.pro);
  for (const k of BUSINESS_VISIBLE) assert.ok(pro.has(k), `pro missing visible: ${k}`);
});

check("Business keeps the inert Sales-Analytics + Group-Buy scaffolding", () => {
  const pro = new Set(PLAN_FEATURES.pro);
  for (const k of [...SA_SCAFFOLDING, ...GB_SCAFFOLDING]) assert.ok(pro.has(k), `pro missing scaffold: ${k}`);
});

check("Business no longer defaults the 7 removed features", () => {
  const pro = new Set(PLAN_FEATURES.pro);
  for (const k of REMOVED_FROM_BUSINESS) assert.equal(pro.has(k), false, `pro should not include: ${k}`);
});

check("getPlanScope('pro') surfaces EXACTLY the 15 as active (state=included)", () => {
  const scope = getPlanScope("pro");
  const active = scope.groups.flatMap((g) => g.features).filter((f) => f.state === "included").map((f) => f.key);
  assert.deepEqual(sorted(active), sorted(BUSINESS_VISIBLE));
});

check("getPlanScope('pro') keeps SA + GB as included-needs-addon (still enable-able)", () => {
  const byKey = new Map(getPlanScope("pro").groups.flatMap((g) => g.features.map((f) => [f.key, f.state] as const)));
  for (const k of [...SA_SCAFFOLDING, ...GB_SCAFFOLDING]) assert.equal(byKey.get(k), "included-needs-addon", `${k} should be included-needs-addon`);
});

check("Automated (enterprise) still includes all 7 features dropped from Business", () => {
  const ent = new Set(PLAN_FEATURES.enterprise);
  for (const k of REMOVED_FROM_BUSINESS) assert.ok(ent.has(k), `enterprise missing: ${k}`);
});

check("Automated (enterprise) remains a superset of Business (pro)", () => {
  const ent = new Set(PLAN_FEATURES.enterprise);
  for (const k of PLAN_FEATURES.pro) assert.ok(ent.has(k), `enterprise missing pro key: ${k}`);
});

check("Automated (enterprise) still carries its growth tier (analytics + automation)", () => {
  const ent = new Set(PLAN_FEATURES.enterprise);
  for (const k of [FEATURES.ANALYTICS_POSTHOG, FEATURES.AUTOMATION_WORKFLOWS, FEATURES.INTEGRATIONS, FEATURES.NOTIFY_TELEGRAM]) assert.ok(ent.has(k), `enterprise missing growth key: ${k}`);
});

check("Starter is unchanged (still carries Reseller portal)", () => {
  assert.ok(new Set(PLAN_FEATURES.starter).has(FEATURES.STORE_RESELLER_PORTAL));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
