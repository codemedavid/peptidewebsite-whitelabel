/**
 * Staff Accounts — permission registry + access rules. Pure and client-safe (no
 * "server-only", no DB), so it is the SINGLE source of truth shared by:
 *   - the admin menu + active-view guard (client, AdminPage.tsx),
 *   - every store-admin server action (server enforcement),
 *   - the test gate (scripts/test-staff-permissions.ts).
 *
 * Module keys are the canonical store-admin VIEW ids (see AdminPage's `View`
 * union), so there is ONE id space across the menu, the view guard, and the
 * server actions — no translation table to drift. The only menu→view exceptions
 * are the four quickAction ids that differ from their view (see below).
 */

export type StaffActor =
  | { kind: "owner" }
  | { kind: "staff"; id: string; permissions: string[] };

export type StaffModule = { key: string; label: string };

/**
 * Every gateable store-admin module, in dashboard order. The leading entries are
 * the spec's named modules; the trailing entries (design…groupbuys) are the
 * entitlement-gated views that also exist — included so a staff member can never
 * reach them ungated. "Account Settings" is intentionally NOT a module: it is
 * always-allowed (everyone changes their own password). Keep in sync with
 * AdminPage `quickActions`.
 */
export const STAFF_MODULES: readonly StaffModule[] = [
  { key: "add-product", label: "Add Product" },
  { key: "products", label: "Manage Products" },
  { key: "categories", label: "Categories" },
  { key: "hero", label: "Hero Section" },
  { key: "banner", label: "Announcement Banner" },
  { key: "orders", label: "Orders" },
  { key: "inv", label: "Inventory" },
  { key: "shipping", label: "Shipping" },
  { key: "fee", label: "Checkout Fee" },
  { key: "couriers", label: "Couriers" },
  { key: "lab", label: "Lab Results" },
  { key: "promo", label: "Promo Codes" },
  { key: "pay", label: "Payments" },
  { key: "faq", label: "FAQ" },
  { key: "proto", label: "Protocols" },
  { key: "reseller", label: "Reseller Portal" },
  // Entitlement-gated extras — present so staff can't see them without a grant.
  { key: "design", label: "Card Studio" },
  { key: "analytics", label: "Sales Analytics" },
  { key: "reviews", label: "Reviews" },
  { key: "access-code", label: "Access Code" },
  { key: "checkout", label: "Smart Checkout" },
  { key: "groupbuys", label: "Group Buys" },
  { key: "groupbuy", label: "Order Ratio Control" },
] as const;

export const STAFF_MODULE_KEYS: string[] = STAFF_MODULES.map((m) => m.key);

const MODULE_KEY_SET = new Set(STAFF_MODULE_KEYS);

/** Views every signed-in admin reaches regardless of grants. */
export const ALWAYS_ALLOWED_VIEWS = new Set<string>(["dashboard", "account"]);

/** The four menu (quickAction) ids whose id differs from their View id. */
const QUICK_ACTION_TO_VIEW: Record<string, string> = {
  add: "add-product",
  manage: "products",
  cats: "categories",
  ship: "shipping",
};

export function isValidModuleKey(key: unknown): boolean {
  return typeof key === "string" && MODULE_KEY_SET.has(key);
}

/** Resolve a menu (quickAction) id to its canonical View/module id. */
export function quickActionToView(quickActionId: string): string {
  return QUICK_ACTION_TO_VIEW[quickActionId] ?? quickActionId;
}

/**
 * Map a concrete view to the module key that gates it (sub-views fold into their
 * parent module). Returns the view itself when it is its own module.
 */
export function permissionViewFor(view: string): string {
  if (view === "order-detail") return "orders";
  // A round's dedicated dashboard is a sub-view of the Group Buys manager, so it
  // inherits that grant rather than needing one of its own — otherwise a
  // #groupbuy-detail deep-link would be reachable without the groupbuys module.
  if (view === "groupbuy-detail") return "groupbuys";
  return view;
}

/** Coerce untrusted form input into a clean, de-duplicated set of module keys. */
export function sanitizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    if (!MODULE_KEY_SET.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function staffHas(actor: { permissions: string[] }, key: string): boolean {
  return actor.permissions.includes(key);
}

/**
 * Can this actor open the given store-admin VIEW? Owner: always. Staff: only when
 * granted the module that gates the view, with two ergonomic rules — always-allowed
 * views (dashboard/account) are open to everyone, and a Manage-Products grant can
 * open the shared add-product editor to edit existing items. This drives the menu
 * + active-view guard; it is NOT the server enforcement boundary (that's
 * isModuleAllowed).
 */
export function isViewAllowed(actor: StaffActor, view: string): boolean {
  if (actor.kind === "owner") return true;
  if (ALWAYS_ALLOWED_VIEWS.has(view)) return true;
  const module = permissionViewFor(view);
  if (module === "add-product") {
    // The add-product view is reused for editing, reachable from Manage Products.
    return staffHas(actor, "add-product") || staffHas(actor, "products");
  }
  return staffHas(actor, module);
}

/**
 * STRICT per-module check used by server actions. Owner passes everything; staff
 * must hold the EXACT module key — no implies, no always-allowed leakage. This is
 * the real security boundary; the client menu is only a convenience over it.
 */
export function isModuleAllowed(actor: StaffActor, moduleKey: string): boolean {
  if (actor.kind === "owner") return true;
  return staffHas(actor, moduleKey);
}
