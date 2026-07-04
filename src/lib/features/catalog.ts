/**
 * The single registry of all gateable features.
 * Plans (Starter / Pro / Enterprise) map to subsets of these
 * — never `if (package === 3)`. See docs §3.
 */
export const FEATURES = {
  // Package 1 — Site
  SITE_HOMEPAGE: "site.homepage",
  SITE_PRODUCTS: "site.products",
  SITE_CONTACT_FORM: "site.contact_form",
  SITE_BLOG: "site.blog",
  // Package 2 — Ecommerce
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
  // Granular storefront/catalog toggles (the SlimDose list — see docs §6)
  STORE_CALCULATOR: "storefront.calculator",
  STORE_REVIEWS: "storefront.reviews",
  STORE_PRODUCT_SPECS: "storefront.product_specs",
  STORE_SEARCH: "storefront.search",
  STORE_CATEGORIES: "storefront.categories",
  STORE_COMMUNITY_LINK: "storefront.community_link",
  STORE_FLOATING_CART: "storefront.floating_cart",
  STORE_ORDER_TRACKING: "storefront.order_tracking",
  STORE_MULTI_CURRENCY: "storefront.multi_currency",
  STORE_RESELLER_PORTAL: "storefront.reseller",
  STORE_CARD_STUDIO: "storefront.card_studio",
  STORE_SALES_ANALYTICS: "storefront.sales_analytics",
  STORE_SMART_CHECKOUT: "storefront.smart_checkout",
  STORE_ACCESS_CODE: "storefront.access_code",
  STORE_ADMIN_FEE: "storefront.admin_fee",
  STORE_STAFF_ACCOUNTS: "storefront.staff_accounts",
  // Sales Analytics internals. Each key toggles one slice of the store-admin
  // Sales Analytics view; all of them are inert while the module itself
  // (STORE_SALES_ANALYTICS) is off. They sit in every plan ceiling (default ON)
  // so granting the module lights up the full dashboard; the operator revokes
  // individual slices per tenant from admin → Features.
  SA_SECTION_REVENUE: "storefront.sales_analytics.revenue",
  SA_SECTION_PRODUCTS: "storefront.sales_analytics.products",
  SA_SECTION_GROUP_BUYS: "storefront.sales_analytics.group_buys",
  SA_SECTION_CUSTOMERS: "storefront.sales_analytics.customers",
  SA_REPORT_DAILY: "storefront.sales_analytics.report_daily",
  SA_REPORT_WEEKLY: "storefront.sales_analytics.report_weekly",
  SA_REPORT_MONTHLY: "storefront.sales_analytics.report_monthly",
  SA_EXPORT_EXCEL: "storefront.sales_analytics.export_excel",
  SA_EXPORT_PDF: "storefront.sales_analytics.export_pdf",
  // Transactional notifications
  NOTIFY_EMAIL: "notify.email",
  NOTIFY_TELEGRAM: "notify.telegram",
  // Merchant "you received an order" alert emailed to the store owner (the email
  // sibling of NOTIFY_TELEGRAM). Delivered via the tenant's PostHog Messaging —
  // Automated-package feature. See lib/analytics/admin-notify.ts.
  NOTIFY_ADMIN_ORDER: "notify.admin_order",
  // Group Buy Management Module
  GB_MODULE: "groupbuy.module",
  GB_CREATE: "groupbuy.create",
  GB_EDIT: "groupbuy.edit",
  GB_DUPLICATE: "groupbuy.duplicate",
  GB_ARCHIVE: "groupbuy.archive",
  GB_SCHEDULED: "groupbuy.scheduled",
  GB_MULTIPLE_ACTIVE: "groupbuy.multiple_active",
  GB_PRODUCT_ASSIGNMENT: "groupbuy.product_assignment",
  GB_SUPPLIER_REPORTS: "groupbuy.supplier_reports",
  GB_RULES: "groupbuy.rules",
  // Excel & Supplier Reports — granular controls under "Supplier reports"
  GB_REPORT_EXCEL: "groupbuy.reports.excel",
  GB_REPORT_CSV: "groupbuy.reports.csv",
  GB_REPORT_PDF: "groupbuy.reports.pdf",
  GB_REPORT_AUTO_ON_CLOSE: "groupbuy.reports.auto_on_close",
  GB_REPORT_CUSTOMER_BREAKDOWN: "groupbuy.reports.customer_breakdown",
  GB_REPORT_PRODUCT_BREAKDOWN: "groupbuy.reports.product_breakdown",
  GB_REPORT_SUPPLIER_SUMMARY: "groupbuy.reports.supplier_summary",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

// Plan key → feature keys. Seeded into plans/plan_features. Editable without deploy.
const STARTER: FeatureKey[] = [
  FEATURES.SITE_HOMEPAGE,
  FEATURES.SITE_PRODUCTS,
  FEATURES.SITE_CONTACT_FORM,
  FEATURES.SITE_BLOG,
  FEATURES.STORE_PRODUCT_SPECS,
  FEATURES.STORE_SEARCH,
  FEATURES.STORE_CATEGORIES,
  FEATURES.STORE_COMMUNITY_LINK,
  FEATURES.STORE_CALCULATOR,
  // Available on every plan; the operator toggles it per tenant. The storefront
  // only surfaces the gated #merchant page once the store owner also sets an
  // access code, so being in the plan ceiling (default-on) exposes nothing.
  FEATURES.STORE_RESELLER_PORTAL,
  // Checkout admin fee: in every plan ceiling (default ON) so any tenant that
  // already configured a fee keeps charging it. The operator revokes it per
  // tenant from admin → Features to switch the whole admin-fee section off —
  // the storefront then drops the line and orders.ts stops stamping it.
  FEATURES.STORE_ADMIN_FEE,
  // Sales Analytics sub-features: in every plan ceiling (default ON) but inert
  // until the operator grants the STORE_SALES_ANALYTICS module itself.
  FEATURES.SA_SECTION_REVENUE,
  FEATURES.SA_SECTION_PRODUCTS,
  FEATURES.SA_SECTION_GROUP_BUYS,
  FEATURES.SA_SECTION_CUSTOMERS,
  FEATURES.SA_REPORT_DAILY,
  FEATURES.SA_REPORT_WEEKLY,
  FEATURES.SA_REPORT_MONTHLY,
  FEATURES.SA_EXPORT_EXCEL,
  FEATURES.SA_EXPORT_PDF,
  // Group Buy sub-capabilities sit in every plan ceiling (default ON) but stay
  // inert until the operator grants the GB_MODULE master switch per tenant (see
  // OPERATOR_GRANTABLE). resolveGroupBuyCaps ANDs each one with GB_MODULE, so
  // being default-on here just means granting the module lights up the basics.
  // The Enterprise-only extras (scheduling, parallel runs, auto-on-close) live
  // in ENTERPRISE below, not here.
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
const PRO: FeatureKey[] = [
  ...STARTER,
  FEATURES.ECOM_CART,
  FEATURES.ECOM_CHECKOUT,
  FEATURES.ECOM_BUNDLES,
  FEATURES.ECOM_DISCOUNTS,
  FEATURES.ECOM_ACCOUNTS,
  FEATURES.ECOM_UPSELLS,
  FEATURES.STORE_FLOATING_CART,
  FEATURES.STORE_ORDER_TRACKING,
  FEATURES.STORE_MULTI_CURRENCY,
  FEATURES.NOTIFY_EMAIL,
  // Staff Accounts: in the Business (pro) ceiling — so it's default-ON for
  // Business and Automated (enterprise inherits ...PRO). Starter does NOT carry
  // it, but it's also in OPERATOR_GRANTABLE below, so the operator can still
  // switch it on for an individual Starter tenant without a plan upgrade.
  FEATURES.STORE_STAFF_ACCOUNTS,
];
const ENTERPRISE: FeatureKey[] = [
  ...PRO,
  FEATURES.ANALYTICS_POSTHOG,
  FEATURES.ANALYTICS_DASHBOARD,
  FEATURES.BEHAVIOR_TRACKING,
  FEATURES.EVENT_TRACKING,
  FEATURES.AUTOMATION_WORKFLOWS,
  FEATURES.AUTOMATION_ABANDONED_CART,
  FEATURES.AUTOMATION_JOURNEYS,
  FEATURES.EMAIL_AUTOMATION,
  FEATURES.MARKETING_AUTOMATION,
  FEATURES.INTEGRATIONS,
  FEATURES.NOTIFY_TELEGRAM,
  // Admin order-alert email — Automated package, alongside the Telegram alert.
  FEATURES.NOTIFY_ADMIN_ORDER,
  // Group Buy Enterprise extras — the advanced controls beyond the basics every
  // plan ceiling carries. All still gated behind the operator-granted GB_MODULE.
  FEATURES.GB_SCHEDULED,
  FEATURES.GB_MULTIPLE_ACTIVE,
  FEATURES.GB_REPORT_AUTO_ON_CLOSE,
];

export const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  starter: STARTER,
  pro: PRO,
  enterprise: ENTERPRISE,
};

export const ALL_FEATURES = Object.values(FEATURES);

/**
 * Features outside every plan's default set (so OFF for all tenants until the
 * platform operator grants them) that are still toggleable per tenant from
 * admin → Features on any plan — they never show "Locked · upgrade plan".
 * Grants persist as TenantFeatureOverride rows (DB) / features.json (demo).
 */
export const OPERATOR_GRANTABLE: ReadonlySet<FeatureKey> = new Set([
  FEATURES.STORE_CARD_STUDIO,
  // Reviews / testimonials page. Outside every plan ceiling (default OFF) so no
  // tenant surfaces the Reviews page or its store-admin manager until the
  // operator grants it per tenant. Once granted, the store owner still controls
  // the page via the "Reviews page" branding toggle (resolveShowReviews ANDs the
  // two). Revoking hides the storefront page/nav AND the store-admin manager.
  FEATURES.STORE_REVIEWS,
  FEATURES.STORE_SALES_ANALYTICS,
  FEATURES.STORE_SMART_CHECKOUT,
  // Group Buy: both the management module (GB_MODULE) and the order-rules engine
  // (GB_RULES, gated independently of the module) are off for every tenant until
  // the operator grants them per tenant from admin → Features.
  FEATURES.GB_MODULE,
  FEATURES.GB_RULES,
  // Staff Accounts is a Business/Automated plan feature (default ON there), but
  // also operator-grantable so a Starter tenant can be switched on individually
  // without upgrading. For Starter it stays OFF until the operator grants it.
  FEATURES.STORE_STAFF_ACCOUNTS,
]);

/** Legacy plan keys → current tier keys (kept so older fixtures keep resolving). */
const PLAN_ALIASES: Record<string, string> = {
  basic: "starter",
  ecommerce: "pro",
  growth: "enterprise",
};

/** The feature set a plan permits — the ceiling. Toggles operate within it. */
export function planFeatureSet(planKey: string): Set<FeatureKey> {
  const key = PLAN_FEATURES[planKey] ? planKey : (PLAN_ALIASES[planKey] ?? planKey);
  return new Set(PLAN_FEATURES[key] ?? STARTER);
}

/**
 * Human-readable metadata for the admin Features panel.
 * `group` controls how toggles are clustered in the UI; ordering follows
 * FEATURE_GROUPS.
 */
export const FEATURE_GROUPS = [
  "Site",
  "Catalog",
  "Ecommerce",
  "Sales Analytics",
  "Group Buy",
  "Notifications",
  "Growth & Automation",
  "Integrations",
] as const;

export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export type FeatureMeta = { label: string; description: string; group: FeatureGroup };

export const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  [FEATURES.SITE_HOMEPAGE]: { label: "Homepage", description: "Public storefront landing page.", group: "Site" },
  [FEATURES.SITE_CONTACT_FORM]: { label: "Contact form", description: "Lets visitors send enquiries.", group: "Site" },
  [FEATURES.SITE_BLOG]: { label: "Research / blog", description: "Articles section and its nav link.", group: "Site" },
  [FEATURES.STORE_COMMUNITY_LINK]: { label: "Community link", description: "Link out to a Telegram/Discord community.", group: "Site" },

  [FEATURES.SITE_PRODUCTS]: { label: "Product catalog", description: "Product listing and detail pages.", group: "Catalog" },
  [FEATURES.STORE_PRODUCT_SPECS]: { label: "Product specs", description: "Purity, COA and spec details on product pages.", group: "Catalog" },
  [FEATURES.STORE_SEARCH]: { label: "Product search", description: "Catalog search box.", group: "Catalog" },
  [FEATURES.STORE_CATEGORIES]: { label: "Categories", description: "Browse products by category.", group: "Catalog" },
  [FEATURES.STORE_CALCULATOR]: { label: "Dosage calculator", description: "Reconstitution / dosage calculator tool.", group: "Catalog" },
  [FEATURES.STORE_CARD_STUDIO]: { label: "Card Studio", description: "Product card design studio in the store admin (presets, templates, per-card styling).", group: "Catalog" },
  [FEATURES.STORE_REVIEWS]: { label: "Product reviews", description: "Customer reviews / testimonials page on the storefront and its Reviews manager in the store admin. Operator-grantable, default OFF. Once on, the store owner still shows/hides the page from the branding editor.", group: "Catalog" },

  [FEATURES.ECOM_CART]: { label: "Shopping cart", description: "Add-to-cart and cart page.", group: "Ecommerce" },
  [FEATURES.ECOM_CHECKOUT]: { label: "Checkout", description: "Order placement and payment.", group: "Ecommerce" },
  [FEATURES.ECOM_BUNDLES]: { label: "Product bundles", description: "Sell grouped product bundles.", group: "Ecommerce" },
  [FEATURES.ECOM_DISCOUNTS]: { label: "Discount codes", description: "Coupon and promo codes at checkout.", group: "Ecommerce" },
  [FEATURES.ECOM_ACCOUNTS]: { label: "Customer accounts", description: "Customer login and order history.", group: "Ecommerce" },
  [FEATURES.ECOM_UPSELLS]: { label: "Upsells", description: "Cross-sell and upsell offers.", group: "Ecommerce" },
  [FEATURES.STORE_FLOATING_CART]: { label: "Floating cart", description: "Persistent floating cart widget.", group: "Ecommerce" },
  [FEATURES.STORE_ORDER_TRACKING]: { label: "Order tracking", description: "Public order-status / tracking lookup page.", group: "Ecommerce" },
  [FEATURES.STORE_MULTI_CURRENCY]: { label: "Multi-currency", description: "Display and charge in multiple currencies.", group: "Ecommerce" },
  [FEATURES.STORE_RESELLER_PORTAL]: { label: "Reseller portal", description: "Gated #merchant wholesale price list for verified resellers. The store owner sets the access code and per-product wholesale prices.", group: "Ecommerce" },
  [FEATURES.STORE_SALES_ANALYTICS]: { label: "Sales Analytics", description: "Sales Analytics view in the store admin (revenue & insights).", group: "Ecommerce" },
  [FEATURES.STORE_SMART_CHECKOUT]: { label: "Smart Checkout", description: "Smart Cart & Checkout rules view in the store admin — cart restrictions, checkout validations and custom messages. Off hides the editor and stops saved rules from constraining the cart.", group: "Ecommerce" },
  [FEATURES.STORE_ACCESS_CODE]: { label: "Access code gate", description: "Private-store access code: visitors must enter a code to view the storefront. Off hides the Access Code manager in the store admin and stops the gate from being enforced. Operator-grantable, default OFF.", group: "Ecommerce" },
  [FEATURES.STORE_ADMIN_FEE]: { label: "Admin fee", description: "The flat checkout admin (service) fee, configured per tenant in platform settings → Admin fee. Off hides the section, drops the fee line at checkout and stops orders charging it; saved label/amount are kept for when it's switched back on.", group: "Ecommerce" },
  [FEATURES.STORE_STAFF_ACCOUNTS]: { label: "Staff Accounts", description: "Owner-managed staff sub-accounts with per-module permissions in the store admin. Included with Business and Automated plans; operator-grantable on Starter. Off hides the Staff Accounts manager and blocks staff sign-in and management.", group: "Ecommerce" },

  [FEATURES.SA_SECTION_REVENUE]: { label: "Revenue analytics", description: "Revenue KPIs, revenue-over-time chart and payment-method breakdown. Needs the Sales Analytics module on.", group: "Sales Analytics" },
  [FEATURES.SA_SECTION_PRODUCTS]: { label: "Product analytics", description: "Items-sold KPI and top products by revenue. Needs the Sales Analytics module on.", group: "Sales Analytics" },
  [FEATURES.SA_SECTION_GROUP_BUYS]: { label: "Group buy analytics", description: "Revenue and order breakdown per group buy. Needs the Sales Analytics module on.", group: "Sales Analytics" },
  [FEATURES.SA_SECTION_CUSTOMERS]: { label: "Customer analytics", description: "Unique vs returning customers and top customers by revenue. Needs the Sales Analytics module on.", group: "Sales Analytics" },
  [FEATURES.SA_REPORT_DAILY]: { label: "Daily reports", description: "Day-by-day sales report table in the analytics view.", group: "Sales Analytics" },
  [FEATURES.SA_REPORT_WEEKLY]: { label: "Weekly reports", description: "Week-by-week sales report table in the analytics view.", group: "Sales Analytics" },
  [FEATURES.SA_REPORT_MONTHLY]: { label: "Monthly reports", description: "Month-by-month sales report table in the analytics view.", group: "Sales Analytics" },
  [FEATURES.SA_EXPORT_EXCEL]: { label: "Excel export", description: "Download the analytics view as an Excel workbook.", group: "Sales Analytics" },
  [FEATURES.SA_EXPORT_PDF]: { label: "PDF export", description: "Print / save the analytics view as a PDF report.", group: "Sales Analytics" },

  [FEATURES.GB_MODULE]: { label: "Group buy system", description: "Master switch for the Group Buy module — the store admin's Group Buys manager and order attribution. Off hides everything group-buy.", group: "Group Buy" },
  [FEATURES.GB_CREATE]: { label: "Create group buys", description: "Lets the store owner open new group buys.", group: "Group Buy" },
  [FEATURES.GB_EDIT]: { label: "Edit group buys", description: "Lets the store owner change a group buy's details, window and status.", group: "Group Buy" },
  [FEATURES.GB_DUPLICATE]: { label: "Duplicate group buys", description: "One-click copy of an existing group buy as a new draft.", group: "Group Buy" },
  [FEATURES.GB_ARCHIVE]: { label: "Archive group buys", description: "Lets the store owner archive finished group buys (kept for records, hidden from active lists).", group: "Group Buy" },
  [FEATURES.GB_SCHEDULED]: { label: "Scheduled group buys", description: "Group buys can be scheduled with a start date and go live automatically.", group: "Group Buy" },
  [FEATURES.GB_MULTIPLE_ACTIVE]: { label: "Multiple active group buys", description: "Allow more than one group buy to run at the same time.", group: "Group Buy" },
  [FEATURES.GB_PRODUCT_ASSIGNMENT]: { label: "Product assignment", description: "Assign specific products to each group buy; unassigned products fall outside it.", group: "Group Buy" },
  [FEATURES.GB_SUPPLIER_REPORTS]: { label: "Supplier reports", description: "Aggregated per-product order quantities for a group buy — the list to send the supplier.", group: "Group Buy" },
  [FEATURES.GB_RULES]: { label: "Group buy rules engine", description: "Order rules for group buys: admin fee (fixed/percentage), per-product and total vial minimums, bac water limits, cart & checkout validation.", group: "Group Buy" },
  [FEATURES.GB_REPORT_EXCEL]: { label: "Excel export", description: "Download group-buy reports as Excel (.xlsx) workbooks. Applies when Supplier reports is on.", group: "Group Buy" },
  [FEATURES.GB_REPORT_CSV]: { label: "CSV export", description: "Download group-buy reports as CSV files. Applies when Supplier reports is on.", group: "Group Buy" },
  [FEATURES.GB_REPORT_PDF]: { label: "PDF export", description: "Download group-buy reports as print-ready PDFs. Applies when Supplier reports is on.", group: "Group Buy" },
  [FEATURES.GB_REPORT_AUTO_ON_CLOSE]: { label: "Auto report on close", description: "Generate the report automatically the moment a group buy closes.", group: "Group Buy" },
  [FEATURES.GB_REPORT_CUSTOMER_BREAKDOWN]: { label: "Customer breakdown", description: "Reports include a per-customer section: each customer's items, quantities and totals.", group: "Group Buy" },
  [FEATURES.GB_REPORT_PRODUCT_BREAKDOWN]: { label: "Product breakdown", description: "Reports include a per-product section: units sold, order count and revenue per product.", group: "Group Buy" },
  [FEATURES.GB_REPORT_SUPPLIER_SUMMARY]: { label: "Supplier summary", description: "Reports include the consolidated order list for the supplier — aggregate quantity per product.", group: "Group Buy" },

  [FEATURES.NOTIFY_EMAIL]: { label: "Email notifications", description: "Transactional order emails to customers.", group: "Notifications" },
  [FEATURES.NOTIFY_TELEGRAM]: { label: "Telegram notifications", description: "Order alerts pushed to a Telegram channel.", group: "Notifications" },
  [FEATURES.NOTIFY_ADMIN_ORDER]: { label: "Admin order-alert email", description: "Emails the store owner “you received an order” on every new order, via the tenant's PostHog Messaging. The recipient address is set by the store owner in the store admin. Off hides the setting and stops the alert.", group: "Notifications" },

  [FEATURES.ANALYTICS_POSTHOG]: { label: "PostHog analytics", description: "Per-tenant PostHog product analytics.", group: "Growth & Automation" },
  [FEATURES.ANALYTICS_DASHBOARD]: { label: "Analytics dashboard", description: "In-app analytics dashboard.", group: "Growth & Automation" },
  [FEATURES.BEHAVIOR_TRACKING]: { label: "Behavior tracking", description: "Session and behavior capture.", group: "Growth & Automation" },
  [FEATURES.EVENT_TRACKING]: { label: "Event tracking", description: "Custom event taxonomy capture.", group: "Growth & Automation" },
  [FEATURES.AUTOMATION_WORKFLOWS]: { label: "Automation workflows", description: "Durable Inngest workflows.", group: "Growth & Automation" },
  [FEATURES.AUTOMATION_ABANDONED_CART]: { label: "Abandoned cart recovery", description: "Automated abandoned-cart sequence.", group: "Growth & Automation" },
  [FEATURES.AUTOMATION_JOURNEYS]: { label: "Customer journeys", description: "Multi-step lifecycle journeys.", group: "Growth & Automation" },
  [FEATURES.EMAIL_AUTOMATION]: { label: "Email automation", description: "Triggered marketing email flows.", group: "Growth & Automation" },
  [FEATURES.MARKETING_AUTOMATION]: { label: "Marketing automation", description: "Campaigns and segmentation.", group: "Growth & Automation" },

  [FEATURES.INTEGRATIONS]: { label: "Third-party integrations", description: "Connect external services.", group: "Integrations" },
};
