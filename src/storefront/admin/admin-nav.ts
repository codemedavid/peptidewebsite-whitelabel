/**
 * Store-admin sidebar registry — the single ordered list of tools the redesigned
 * admin shell renders, grouped by how often a store owner actually needs them
 * (Daily / Weekly / Occasional, per the Tenant Admin Redesign).
 *
 * This module is DATA + one resolver. It deliberately owns no gating logic of
 * its own: visibility comes from `isAdminViewVisible` (super-admin / entitlement
 * toggles), permission from `isViewAllowed` (owner vs staff grants) and the
 * Business lock from `isAdminModuleLocked`. Adding an entry here can therefore
 * never widen access — an item whose view is not a gated module is caught by
 * scripts/test-admin-dashboard.ts.
 *
 * `view` is the canonical AdminPage View id, so there is ONE id space shared by
 * the sidebar, the view guard, the permission registry and MODULE_FEATURE (the
 * "New" tag). Pure and client-safe: no React, no DB.
 */

import type { Brand } from "../types";
import { isAdminViewVisible, isAdminModuleLocked } from "../visibility";
import { isViewAllowed, type StaffActor } from "./staff-permissions";

export type AdminNavGroupId = "daily" | "weekly" | "occasional";

export type AdminNavItem = {
  /** Canonical AdminPage View id — also the permission + entitlement key. */
  view: string;
  label: string;
  /** One-line description shown in search results and the mobile drawer. */
  hint: string;
  /** AdminIcon name (see shared.tsx). */
  icon: string;
  /** ADMIN_TINTS key used for the icon chip. */
  tint: string;
  group: AdminNavGroupId;
  /** Owner-only tools (billing, staff, notifications) — never offered to staff. */
  ownerOnly?: boolean;
};

/** A nav item resolved against one tenant + actor. */
export type ResolvedNavItem = AdminNavItem & {
  /** Business-exclusive and not entitled → renders locked, opens the upgrade page. */
  locked: boolean;
  /** Operator-flagged new feature → "New" tag. */
  isNew: boolean;
};

export type ResolvedNavGroup = {
  id: AdminNavGroupId;
  label: string;
  items: ResolvedNavItem[];
};

export const ADMIN_NAV_GROUPS: readonly { id: AdminNavGroupId; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "occasional", label: "Occasional" },
] as const;

/**
 * The registry, in sidebar order. Dashboard leads the Daily group — it is the
 * landing view and the fallback every guard bounces back to.
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  // ── Daily ────────────────────────────────────────────────────────────────
  { view: "dashboard", label: "Dashboard", hint: "Today at a glance", icon: "home", tint: "pink", group: "daily" },
  { view: "orders", label: "Orders", hint: "View transactions", icon: "cart", tint: "yellow", group: "daily" },
  { view: "store-status", label: "Store Status", hint: "Open or close the shop", icon: "shield", tint: "red", group: "daily" },
  { view: "add-product", label: "Add Product", hint: "Create new item", icon: "plus", tint: "pink", group: "daily" },
  { view: "products", label: "Manage Products", hint: "Edit existing items", icon: "box", tint: "green", group: "daily" },
  { view: "inv", label: "Inventory", hint: "Track stock", icon: "inbox", tint: "orange", group: "daily" },
  { view: "analytics", label: "Sales Analytics", hint: "Revenue & insights", icon: "trend", tint: "cyan", group: "daily" },

  // ── Weekly ───────────────────────────────────────────────────────────────
  { view: "categories", label: "Categories", hint: "Organize items", icon: "folder", tint: "orange", group: "weekly" },
  { view: "sort-categories", label: "Product Sort Categories", hint: "Edit the catalog's sort menu", icon: "trend", tint: "purple", group: "weekly" },
  { view: "promo", label: "Promo Codes", hint: "Manage discounts", icon: "tag", tint: "red", group: "weekly" },
  { view: "lab", label: "Lab Results", hint: "Manage COAs", icon: "shield", tint: "pink", group: "weekly" },
  { view: "couriers", label: "Couriers", hint: "Manage couriers", icon: "truck", tint: "mint", group: "weekly" },
  { view: "shipping", label: "Shipping", hint: "Manage rates", icon: "pin", tint: "cyan", group: "weekly" },
  { view: "reviews", label: "Reviews", hint: "Manage testimonials", icon: "star", tint: "pink", group: "weekly" },
  { view: "groupbuys", label: "Group Buys", hint: "Buying windows & reports", icon: "users", tint: "mint", group: "weekly" },
  { view: "groupbuy", label: "Order Ratio Control", hint: "Peptide ↔ bac water ratio", icon: "shield", tint: "cyan", group: "weekly" },
  { view: "staff", label: "Staff Accounts", hint: "Team access & permissions", icon: "users", tint: "purple", group: "weekly", ownerOnly: true },

  // ── Occasional ───────────────────────────────────────────────────────────
  { view: "hero", label: "Hero Section", hint: "Homepage headline & tagline", icon: "sparkle", tint: "yellow", group: "occasional" },
  { view: "banner", label: "Announcement Banner", hint: "Promo bar under the header", icon: "bell", tint: "orange", group: "occasional" },
  { view: "design", label: "Card Studio", hint: "Product card designs", icon: "palette", tint: "purple", group: "occasional" },
  { view: "fee", label: "Checkout Fee", hint: "Shipping / service fee", icon: "tag", tint: "yellow", group: "occasional" },
  { view: "checkout", label: "Smart Checkout", hint: "Cart & checkout rules", icon: "shield", tint: "cyan", group: "occasional" },
  { view: "pay", label: "Payments", hint: "Manage methods", icon: "card", tint: "purple", group: "occasional" },
  { view: "faq", label: "FAQ", hint: "Manage content", icon: "help", tint: "green", group: "occasional" },
  { view: "proto", label: "Protocols", hint: "Peptide guides", icon: "shield", tint: "pink", group: "occasional" },
  { view: "reseller", label: "Reseller Portal", hint: "Wholesale page & prices", icon: "tag", tint: "purple", group: "occasional" },
  { view: "access-code", label: "Access Code", hint: "Private store gate", icon: "shield", tint: "red", group: "occasional" },
  { view: "notice", label: "Notice Modal", hint: "Storefront pop-up notice", icon: "shield", tint: "orange", group: "occasional", ownerOnly: true },
  { view: "tracknote", label: "Delivery Note", hint: "Track-page delivery estimates", icon: "truck", tint: "mint", group: "occasional", ownerOnly: true },
  { view: "notify", label: "Order Notifications", hint: "Email me on new orders", icon: "bell", tint: "cyan", group: "occasional", ownerOnly: true },
  { view: "billing", label: "Billing", hint: "Pay & submit proof", icon: "card", tint: "green", group: "occasional", ownerOnly: true },
  { view: "account", label: "Account Settings", hint: "Change your password", icon: "shield", tint: "red", group: "occasional" },
] as const;

/** Max search results shown under the topbar field. */
const SEARCH_LIMIT = 6;

/**
 * The sidebar for one tenant + actor: hidden modules and ungranted tools are
 * dropped entirely, Business-exclusive ones stay visible but flagged `locked`.
 * Empty groups are omitted so a limited staff member never sees a bare heading.
 */
export function visibleNavGroups(brand: Brand, actor: StaffActor): ResolvedNavGroup[] {
  const isOwner = actor.kind === "owner";
  const newModules = brand.newModules ?? [];

  return ADMIN_NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: ADMIN_NAV.filter(
      (item) =>
        item.group === group.id &&
        (!item.ownerOnly || isOwner) &&
        isAdminViewVisible(brand, item.view) &&
        isViewAllowed(actor, item.view),
    ).map((item) => ({
      ...item,
      locked: isAdminModuleLocked(brand, item.view),
      isNew: newModules.includes(item.view),
    })),
  })).filter((group) => group.items.length > 0);
}

/**
 * Filter already-resolved items by the topbar query. Searching only ever
 * narrows what the sidebar already offers, so a hidden or ungranted tool can
 * never be reached through search. A blank query returns nothing — the sidebar
 * itself stays the way in.
 */
export function searchNavItems(items: ResolvedNavItem[], query: string): ResolvedNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q))
    .slice(0, SEARCH_LIMIT);
}
