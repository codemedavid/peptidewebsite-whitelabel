/**
 * Every website admin view (src/storefront/admin/admin-nav.ts) → its NATIVE
 * app screen. The app renders no web pages: a view missing here is reported as
 * "not in the app yet" by openAdminView, never embedded.
 *
 * Adding a view = build app/(app)/manage/<view>.tsx and add it here.
 */
export const NATIVE_VIEW_ROUTES: Record<string, string> = {
  // Handled by existing tabs/screens.
  orders: "/orders",
  inv: "/products",
  analytics: "/insights",
  account: "/password",
  dashboard: "/",
  // Catalog.
  "add-product": "/manage/product-edit",
  products: "/manage/products",
  categories: "/manage/categories",
  "sort-categories": "/manage/sort-categories",
  currency: "/manage/currency",
  // Store setup.
  "store-status": "/manage/store-status",
  pay: "/manage/payments",
  shipping: "/manage/shipping",
  couriers: "/manage/couriers",
  fee: "/manage/fee",
  promo: "/manage/promo",
  banner: "/manage/banner",
  hero: "/manage/hero",
  // Content.
  faq: "/manage/faq",
  lab: "/manage/lab",
  proto: "/manage/protocols",
  reviews: "/manage/reviews",
  design: "/manage/card-studio",
  // Store rules.
  notice: "/manage/notice",
  tracknote: "/manage/track-note",
  notify: "/manage/notify",
  checkout: "/manage/checkout-rules",
  "access-code": "/manage/access-code",
  groupbuy: "/manage/order-ratio",
  groupbuys: "/manage/group-buys",
  reseller: "/manage/reseller",
  // Team & account.
  customers: "/customers",
  staff: "/manage/staff",
  billing: "/manage/billing",
  export: "/manage/export",
  upgrade: "/manage/upgrade",
};
