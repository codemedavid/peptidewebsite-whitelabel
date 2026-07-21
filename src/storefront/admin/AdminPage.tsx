"use client";

import { useState, useEffect } from "react";
import type { Brand, Order, Product } from "../types";
import { useStore } from "../store";
import { AdminIcon, tintStyle } from "./shared";
import { AdminAddProduct } from "./AdminAddProduct";
import { AdminProductsList } from "./AdminProductsList";
import { AdminCategoriesManager } from "./AdminCategoriesManager";
import { AdminOrders } from "./AdminOrders";
import { AdminOrderDetail } from "./AdminOrderDetail";
import { AdminShippingLocations } from "./AdminShippingLocations";
import { AdminCouriers } from "./AdminCouriers";
import { AdminInventory } from "./AdminInventory";
import { AdminLabResults } from "./AdminLabResults";
import { AdminPromoCodes } from "./AdminPromoCodes";
import { AdminPaymentMethods } from "./AdminPaymentMethods";
import { AdminOrderNotifications } from "./AdminOrderNotifications";
import { AdminNoticeModal } from "./AdminNoticeModal";
import { AdminTrackNote } from "./AdminTrackNote";
import { AdminFAQManager } from "./AdminFAQManager";
import { AdminProtocolsManager } from "./AdminProtocolsManager";
import { AdminReviewsManager } from "./AdminReviewsManager";
import { AdminResellerSettings } from "./AdminResellerSettings";
import { AdminAccessCode } from "./AdminAccessCode";
import { AdminCheckoutRules } from "./AdminCheckoutRules";
import { AdminFeeSettings } from "./AdminFeeSettings";
import { AdminGroupBuys } from "./AdminGroupBuys";
import { AdminGroupBuyRules } from "./AdminGroupBuyRules";
import { AdminAnalytics } from "./AdminAnalytics";
import { AdminCardStudio } from "./AdminCardStudio";
import { AdminAccountSettings } from "./AdminAccountSettings";
import { AdminHeroSettings } from "./AdminHeroSettings";
import { AdminBannerSettings } from "./AdminBannerSettings";
import { isAdminViewVisible, isAdminModuleLocked } from "../visibility";
import { AdminUpgrade } from "./AdminUpgrade";
import { TrialBanner } from "./TrialBanner";
import { SubscriptionBanner } from "./SubscriptionBanner";
import { TrialPlansScreen } from "./TrialPlansScreen";
import { AdminStaffList } from "./AdminStaffList";
import { AdminStaffForm } from "./AdminStaffForm";
import { isViewAllowed, quickActionToView, type StaffActor } from "./staff-permissions";
import { getStorefrontAdminSessionAction, type StaffListItem } from "@/actions/storefront-staff";

type View =
  | "dashboard"
  | "add-product"
  | "products"
  | "categories"
  | "orders"
  | "order-detail"
  | "shipping"
  | "couriers"
  | "inv"
  | "lab"
  | "promo"
  | "pay"
  | "faq"
  | "proto"
  | "reviews"
  | "reseller"
  | "access-code"
  | "analytics"
  | "design"
  | "checkout"
  | "fee"
  | "groupbuys"
  | "groupbuy"
  | "hero"
  | "banner"
  | "account"
  | "staff"
  | "staff-form"
  | "notify"
  | "notice"
  | "tracknote"
  | "upgrade";

export function AdminPage({
  brand,
  onLogout,
  onExitToSite,
}: {
  brand: Brand;
  onLogout: () => void;
  onExitToSite: () => void;
}) {
  const { products, categories, toast, toastMsg } = useStore();
  const [view, setView] = useState<View>("dashboard");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffListItem | null>(null);

  // Who is signed in (owner | staff with permissions). Re-loaded server-side so a
  // suspended/removed staff session resolves to "none" and is logged out.
  const [actor, setActor] = useState<StaffActor | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStorefrontAdminSessionAction().then((info) => {
      if (cancelled) return;
      if (info.kind === "none") {
        onLogout();
        return;
      }
      setActor(
        info.kind === "owner"
          ? { kind: "owner" }
          : { kind: "staff", id: info.id, permissions: info.permissions },
      );
      setSessionLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [onLogout]);

  const isOwner = actor?.kind === "owner";

  // Don't flash the full menu before we know who the actor is — a staff member
  // must never momentarily see modules they aren't permitted.
  if (!sessionLoaded || !actor) {
    return (
      <div className="admin">
        <div className="admin__inner">
          <div className="admin-field__hint" style={{ padding: 48, textAlign: "center" }}>
            Loading…
          </div>
        </div>
      </div>
    );
  }

  // A view that's turned off in the super admin, that this actor isn't
  // permitted, or that is locked behind the Business upgrade (trial system)
  // must not stay visible — bounce back to the dashboard.
  const activeView: View =
    isAdminViewVisible(brand, view) && isViewAllowed(actor, view) && !isAdminModuleLocked(brand, view)
      ? view
      : "dashboard";

  // Trial chrome: the countdown / expired bar tops EVERY admin view while the
  // tenant is trial-governed (brand.trial is projected server-side).
  // Trial and subscription chrome are mutually exclusive by construction — the
  // server only projects brand.subscription for status != "trial" tenants — so a
  // store never shows both. The subscription banner is display-only (no gating);
  // only the trial-expired path below locks the whole admin.
  const headerChrome = brand.trial ? (
    <TrialBanner
      trial={brand.trial}
      onUpgrade={() => setView("upgrade")}
      onPreviewStore={onExitToSite}
    />
  ) : brand.subscription ? (
    <SubscriptionBanner subscription={brand.subscription} />
  ) : null;

  if (activeView === "upgrade") {
    return (
      <>
        {headerChrome}
        <AdminUpgrade brand={brand} onBack={() => setView("dashboard")} />
      </>
    );
  }

  // Trial expired: the whole admin sits behind "Choose how to continue" —
  // only the Upgrade page (above) stays reachable. Header chrome is kept so
  // the owner can still log out or preview the paused storefront.
  if (brand.trial?.expired) {
    return (
      <div className="admin">
        {headerChrome}
        <TrialPlansScreen onUpgrade={() => setView("upgrade")} />
      </div>
    );
  }

  // Sub-view routing — funneled through renderSubView() so the trial chrome
  // tops every sub-view without touching each branch.
  const renderSubView = () => {
  if (activeView === "add-product") {
    return (
      <AdminAddProduct
        brand={brand}
        initial={editingProduct}
        onCancel={() => {
          setView(editingProduct ? "products" : "dashboard");
          setEditingProduct(null);
        }}
        onSaved={(p) => {
          const returnTo = editingProduct ? "products" : "dashboard";
          setView(returnTo);
          setEditingProduct(null);
          setTimeout(() => toast(`Saved "${p.name}"`), 50);
        }}
      />
    );
  }
  if (activeView === "products") {
    return (
      <AdminProductsList
        brand={brand}
        onBack={() => setView("dashboard")}
        onAdd={() => {
          setEditingProduct(null);
          setView("add-product");
        }}
        onEdit={(p) => {
          setEditingProduct(p);
          setView("add-product");
        }}
      />
    );
  }
  if (activeView === "categories") {
    return <AdminCategoriesManager brand={brand} onBack={() => setView("dashboard")} />;
  }
  if (activeView === "orders") {
    return (
      <AdminOrders
        brand={brand}
        onBack={() => setView("dashboard")}
        onView={(o) => {
          setViewingOrder(o);
          setView("order-detail");
        }}
      />
    );
  }
  if (activeView === "order-detail" && viewingOrder) {
    return (
      <AdminOrderDetail
        brand={brand}
        order={viewingOrder}
        onBack={() => {
          setViewingOrder(null);
          setView("orders");
        }}
      />
    );
  }
  if (activeView === "analytics") return <AdminAnalytics brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "design") return <AdminCardStudio brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "shipping") return <AdminShippingLocations brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "couriers") return <AdminCouriers brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "inv") return <AdminInventory brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "lab") return <AdminLabResults brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "promo") return <AdminPromoCodes brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "pay") return <AdminPaymentMethods brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "notify") return <AdminOrderNotifications brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "notice") return <AdminNoticeModal brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "tracknote") return <AdminTrackNote brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "faq") return <AdminFAQManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "proto") return <AdminProtocolsManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "reviews") return <AdminReviewsManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "checkout") return <AdminCheckoutRules brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "fee") return <AdminFeeSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "groupbuys") return <AdminGroupBuys brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "groupbuy") return <AdminGroupBuyRules brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "hero") return <AdminHeroSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "banner") return <AdminBannerSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "account") return <AdminAccountSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "access-code") return <AdminAccessCode brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "reseller") {
    return (
      <AdminResellerSettings
        brand={brand}
        onBack={() => setView("dashboard")}
        onEdit={(p) => {
          setEditingProduct(p);
          setView("add-product");
        }}
      />
    );
  }

  if (activeView === "staff") {
    return (
      <AdminStaffList
        brand={brand}
        onBack={() => setView("dashboard")}
        onAdd={() => {
          setEditingStaff(null);
          setView("staff-form");
        }}
        onEdit={(s) => {
          setEditingStaff(s);
          setView("staff-form");
        }}
      />
    );
  }
  if (activeView === "staff-form") {
    return (
      <AdminStaffForm
        brand={brand}
        staff={editingStaff}
        onBack={() => {
          setEditingStaff(null);
          setView("staff");
        }}
        onSaved={() => {
          setEditingStaff(null);
          setView("staff");
        }}
      />
    );
  }

  return null;
  };
  const subView = renderSubView();
  if (subView) {
    return (
      <>
        {headerChrome}
        {subView}
      </>
    );
  }

  const stats = [
    { label: "Total Products", value: products.length, icon: "box", tint: "pink" },
    { label: "Available Stock", value: products.reduce((sum, p) => sum + (p.stock ?? 0), 0), icon: "trend", tint: "green" },
    { label: "Featured Items", value: products.filter((p) => p.featured).length, icon: "sparkle", tint: "yellow" },
    { label: "Categories", value: categories.filter((c) => c.id !== "all").length, icon: "users", tint: "cyan" },
  ];

  const quickActions = [
    { id: "add", label: "Add Product", hint: "Create new item", icon: "plus", tint: "pink" },
    { id: "manage", label: "Manage Products", hint: "Edit existing items", icon: "box", tint: "green" },
    { id: "cats", label: "Categories", hint: "Organize items", icon: "folder", tint: "orange" },
    { id: "hero", label: "Hero Section", hint: "Homepage headline & tagline", icon: "sparkle", tint: "yellow" },
    { id: "banner", label: "Announcement Banner", hint: "Promo bar under the header", icon: "bell", tint: "orange" },
    { id: "design", label: "Card Studio", hint: "Product card designs", icon: "palette", tint: "purple" },
    { id: "orders", label: "Orders", hint: "View transactions", icon: "cart", tint: "yellow" },
    { id: "analytics", label: "Sales Analytics", hint: "Revenue & insights", icon: "trend", tint: "cyan" },
    { id: "inv", label: "Inventory", hint: "Track stock", icon: "inbox", tint: "orange" },
    { id: "ship", label: "Shipping", hint: "Manage rates", icon: "pin", tint: "cyan" },
    { id: "fee", label: "Checkout Fee", hint: "Shipping / service fee", icon: "tag", tint: "yellow" },
    { id: "couriers", label: "Couriers", hint: "Manage couriers", icon: "truck", tint: "mint" },
    { id: "lab", label: "Lab Results", hint: "Manage COAs", icon: "shield", tint: "pink" },
    { id: "promo", label: "Promo Codes", hint: "Manage discounts", icon: "tag", tint: "red" },
    { id: "pay", label: "Payments", hint: "Manage methods", icon: "card", tint: "purple" },
    { id: "faq", label: "FAQ", hint: "Manage content", icon: "help", tint: "green" },
    { id: "proto", label: "Protocols", hint: "Peptide guides", icon: "shield", tint: "pink" },
    { id: "reviews", label: "Reviews", hint: "Manage testimonials", icon: "star", tint: "pink" },
    { id: "reseller", label: "Reseller Portal", hint: "Wholesale page & prices", icon: "tag", tint: "purple" },
    { id: "access-code", label: "Access Code", hint: "Private store gate", icon: "shield", tint: "red" },
    { id: "checkout", label: "Smart Checkout", hint: "Cart & checkout rules", icon: "shield", tint: "cyan" },
    { id: "groupbuys", label: "Group Buys", hint: "Buying windows & reports", icon: "users", tint: "mint" },
    { id: "groupbuy", label: "Order Ratio Control", hint: "Peptide ↔ bac water ratio", icon: "shield", tint: "cyan" },
    { id: "account", label: "Account Settings", hint: "Change your password", icon: "shield", tint: "red" },
    ...(isOwner
      ? [
          { id: "staff", label: "Staff Accounts", hint: "Team access & permissions", icon: "users", tint: "purple" },
          { id: "notify", label: "Order Notifications", hint: "Email me on new orders", icon: "bell", tint: "cyan" },
          { id: "notice", label: "Notice Modal", hint: "Storefront pop-up notice", icon: "shield", tint: "orange" },
          { id: "tracknote", label: "Delivery Note", hint: "Track-page delivery estimates", icon: "truck", tint: "mint" },
        ]
      : []),
  ]
    .filter((q) => isAdminViewVisible(brand, q.id) && isViewAllowed(actor, quickActionToView(q.id)))
    // Business-exclusive teasers (trial system): locked tiles stay VISIBLE with
    // a gold BUSINESS badge; clicking opens the Upgrade page, not the editor.
    .map((q) => ({ ...q, locked: isAdminModuleLocked(brand, q.id) }));

  const tints = ["green", "orange", "yellow", "cyan", "pink", "red"];
  const catCounts = categories
    .filter((c) => c.id !== "all")
    .map((c, i) => ({
      ...c,
      count: products.filter((p) => p.category === c.id).length,
      tint: tints[i % tints.length],
    }));

  return (
    <div className="admin">
      <header className="admin__bar">
        <a
          className="admin__brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onExitToSite();
          }}
        >
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} />
          ) : (
            <div className="admin__brand-mark">{brand.name?.[0]?.toUpperCase() || "B"}</div>
          )}
        </a>
        <div className="admin__pill">
          <span className="admin__pill-dot" />
          ADMIN DASHBOARD
        </div>
        <div className="admin__bar-spacer" />
        <a
          className="admin__bar-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onExitToSite();
          }}
        >
          View Website
        </a>
        <button className="admin__logout" onClick={onLogout}>
          Logout
        </button>
      </header>

      {headerChrome}

      <main className="admin__inner">
        {brand.featureSpotlight && (
          <div className="admin-spotlight">
            <span className="admin-spotlight__badge">NEW FEATURE</span>
            <span className="admin-spotlight__body">
              <span className="admin-spotlight__name">
                {brand.featureSpotlight.label}
                <span className="admin-spotlight__tag">BUSINESS EXCLUSIVE</span>
              </span>
              <span className="admin-spotlight__desc">
                {brand.featureSpotlight.description} Every new feature we release is included in
                Business — automatically.
              </span>
            </span>
            <button className="admin-spotlight__cta" onClick={() => setView("upgrade")}>
              Unlock with Business
            </button>
          </div>
        )}
        <div className="admin__stats">
          {stats.map((s) => (
            <div key={s.label} className="admin-stat">
              <div className="admin-stat__icon" style={tintStyle(s.tint, "bg")}>
                <span style={tintStyle(s.tint, "fg")}>
                  <AdminIcon name={s.icon} />
                </span>
              </div>
              <div className="admin-stat__label">{s.label}</div>
              <div className="admin-stat__value">{s.value}</div>
              <div className="admin-stat__watermark" style={tintStyle(s.tint, "fg")}>
                <AdminIcon name={s.icon} />
              </div>
            </div>
          ))}
        </div>

        <div className="admin__row">
          <div className="admin-card">
            <h2 className="admin-card__title">Quick Actions</h2>
            <div className="admin-quick">
              {quickActions.map((q) => (
                <button
                  key={q.id}
                  className={`admin-quick__btn${q.locked ? " is-locked" : ""}`}
                  onClick={() => {
                    if (q.locked) return setView("upgrade");
                    if (q.id === "add") {
                      setEditingProduct(null);
                      setView("add-product");
                      return;
                    }
                    if (q.id === "manage") return setView("products");
                    if (q.id === "cats") return setView("categories");
                    if (q.id === "hero") return setView("hero");
                    if (q.id === "banner") return setView("banner");
                    if (q.id === "design") return setView("design");
                    if (q.id === "orders") return setView("orders");
                    if (q.id === "analytics") return setView("analytics");
                    if (q.id === "inv") return setView("inv");
                    if (q.id === "ship") return setView("shipping");
                    if (q.id === "fee") return setView("fee");
                    if (q.id === "couriers") return setView("couriers");
                    if (q.id === "lab") return setView("lab");
                    if (q.id === "promo") return setView("promo");
                    if (q.id === "pay") return setView("pay");
                    if (q.id === "faq") return setView("faq");
                    if (q.id === "proto") return setView("proto");
                    if (q.id === "reviews") return setView("reviews");
                    if (q.id === "reseller") return setView("reseller");
                    if (q.id === "access-code") return setView("access-code");
                    if (q.id === "checkout") return setView("checkout");
                    if (q.id === "groupbuys") return setView("groupbuys");
                    if (q.id === "groupbuy") return setView("groupbuy");
                    if (q.id === "account") return setView("account");
                    if (q.id === "staff") return setView("staff");
                    if (q.id === "notify") return setView("notify");
                    if (q.id === "notice") return setView("notice");
                    if (q.id === "tracknote") return setView("tracknote");
                    toast(`"${q.label}" — wire to your backend`);
                  }}
                >
                  <span className="admin-quick__icon" style={tintStyle(q.tint, "bg")}>
                    <span style={tintStyle(q.tint, "fg")}>
                      <AdminIcon name={q.icon} />
                    </span>
                  </span>
                  <span>
                    <span className="admin-quick__label">
                      {q.label}
                      {brand.newModules?.includes(q.id) && (
                        <span className="admin-quick__new">New</span>
                      )}
                    </span>
                    <span className="admin-quick__hint">{q.hint}</span>
                    {q.locked && (
                      <span className="admin-quick__lockhint">
                        Business &amp; Automated exclusive — tap to upgrade
                      </span>
                    )}
                  </span>
                  {q.locked && <span className="admin-quick__badge">BUSINESS</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-card">
            <h2 className="admin-card__title">Categories</h2>
            <div className="admin-cats">
              {catCounts.map((c) => (
                <div key={c.id} className="admin-cat" onClick={() => setView("categories")}>
                  <span className="admin-cat__label">{c.label}</span>
                  <span className="admin-cat__count" data-tint={c.tint}>
                    {c.count}
                  </span>
                </div>
              ))}
            </div>
            <div className="admin__tip">
              <strong>Tip:</strong> Manage your categories, inventory, and product distribution from the
              “Categories” tab.
            </div>
          </div>
        </div>
      </main>

      <div className={`admin-toast ${toastMsg ? "is-shown" : ""}`}>{toastMsg}</div>
    </div>
  );
}
