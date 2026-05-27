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
  STORE_PRODUCT_SPECS: "storefront.product_specs",
  STORE_SEARCH: "storefront.search",
  STORE_CATEGORIES: "storefront.categories",
  STORE_COMMUNITY_LINK: "storefront.community_link",
  STORE_FLOATING_CART: "storefront.floating_cart",
  STORE_ORDER_TRACKING: "storefront.order_tracking",
  STORE_MULTI_CURRENCY: "storefront.multi_currency",
  // Transactional notifications
  NOTIFY_EMAIL: "notify.email",
  NOTIFY_TELEGRAM: "notify.telegram",
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
];

export const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  starter: STARTER,
  pro: PRO,
  enterprise: ENTERPRISE,
};

export const ALL_FEATURES = Object.values(FEATURES);

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

  [FEATURES.ECOM_CART]: { label: "Shopping cart", description: "Add-to-cart and cart page.", group: "Ecommerce" },
  [FEATURES.ECOM_CHECKOUT]: { label: "Checkout", description: "Order placement and payment.", group: "Ecommerce" },
  [FEATURES.ECOM_BUNDLES]: { label: "Product bundles", description: "Sell grouped product bundles.", group: "Ecommerce" },
  [FEATURES.ECOM_DISCOUNTS]: { label: "Discount codes", description: "Coupon and promo codes at checkout.", group: "Ecommerce" },
  [FEATURES.ECOM_ACCOUNTS]: { label: "Customer accounts", description: "Customer login and order history.", group: "Ecommerce" },
  [FEATURES.ECOM_UPSELLS]: { label: "Upsells", description: "Cross-sell and upsell offers.", group: "Ecommerce" },
  [FEATURES.STORE_FLOATING_CART]: { label: "Floating cart", description: "Persistent floating cart widget.", group: "Ecommerce" },
  [FEATURES.STORE_ORDER_TRACKING]: { label: "Order tracking", description: "Public order-status / tracking lookup page.", group: "Ecommerce" },
  [FEATURES.STORE_MULTI_CURRENCY]: { label: "Multi-currency", description: "Display and charge in multiple currencies.", group: "Ecommerce" },

  [FEATURES.NOTIFY_EMAIL]: { label: "Email notifications", description: "Transactional order emails to customers.", group: "Notifications" },
  [FEATURES.NOTIFY_TELEGRAM]: { label: "Telegram notifications", description: "Order alerts pushed to a Telegram channel.", group: "Notifications" },

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
