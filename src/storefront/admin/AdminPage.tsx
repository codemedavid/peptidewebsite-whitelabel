"use client";

import { useState, useEffect } from "react";
import type { Brand, Order, Product } from "../types";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { useStore } from "../store";
import { getStorefrontProductsAction } from "@/actions/products";
import { AdminShell } from "./AdminShell";
import { AdminDashboard } from "./AdminDashboard";
import { dashboardCapabilities } from "@/lib/storefront/admin-dashboard";
import { canSeeGroupBuyPanel } from "@/lib/storefront/admin-dashboard-gb";
import { AdminAddProduct } from "./AdminAddProduct";
import { AdminProductsList } from "./AdminProductsList";
import { AdminCategoriesManager } from "./AdminCategoriesManager";
import { AdminSortCategories } from "./AdminSortCategories";
import { AdminOrdersHub, type OrdersFolderKey } from "./AdminOrdersHub";
import { AdminOrderDetail } from "./AdminOrderDetail";
import { AdminShippingLocations } from "./AdminShippingLocations";
import { AdminCouriers } from "./AdminCouriers";
import { AdminInventory } from "./AdminInventory";
import { AdminLabResults } from "./AdminLabResults";
import { AdminPromoCodes } from "./AdminPromoCodes";
import { AdminPaymentMethods } from "./AdminPaymentMethods";
import { AdminOrderNotifications } from "./AdminOrderNotifications";
import { AdminBilling } from "./AdminBilling";
import { AdminNoticeModal } from "./AdminNoticeModal";
import { AdminStoreStatus } from "./AdminStoreStatus";
import { AdminCurrency } from "./AdminCurrency";
import { AdminTrackNote } from "./AdminTrackNote";
import { AdminTimeline } from "./AdminTimeline";
import { AdminFAQManager } from "./AdminFAQManager";
import { AdminProtocolsManager } from "./AdminProtocolsManager";
import { AdminArticles } from "./AdminArticles";
import { AdminAssessments } from "./AdminAssessments";
import { AdminReviewsManager } from "./AdminReviewsManager";
import { AdminResellerSettings } from "./AdminResellerSettings";
import { AdminAccessCode } from "./AdminAccessCode";
import { AdminCheckoutRules } from "./AdminCheckoutRules";
import { AdminFeeSettings } from "./AdminFeeSettings";
import { AdminGroupBuys, type GroupBuysTab } from "./AdminGroupBuys";
import { AdminGroupBuyDetail } from "./AdminGroupBuyDetail";
import { AdminGroupBuyRules } from "./AdminGroupBuyRules";
import { AdminAnalytics } from "./AdminAnalytics";
import { AdminCardStudio } from "./AdminCardStudio";
import { AdminAccountSettings } from "./AdminAccountSettings";
import { AdminDataExport } from "./AdminDataExport";
import { AdminHeroSettings } from "./AdminHeroSettings";
import { AdminBannerSettings } from "./AdminBannerSettings";
import { isAdminViewVisible, isAdminModuleLocked } from "../visibility";
import { AdminUpgrade } from "./AdminUpgrade";
import { TrialBanner } from "./TrialBanner";
import { SubscriptionBanner } from "./SubscriptionBanner";
import { TrialPlansScreen } from "./TrialPlansScreen";
import { AdminStaffList } from "./AdminStaffList";
import { AdminCustomers } from "./AdminCustomers";
import { AdminStaffForm } from "./AdminStaffForm";
import { isViewAllowed, type StaffActor } from "./staff-permissions";
import { getStorefrontAdminSessionAction, type StaffListItem } from "@/actions/storefront-staff";
import { appInitialView } from "../app-embed";

const VIEWS = [
  "dashboard",
  "currency",
  "add-product",
  "products",
  "categories",
  "sort-categories",
  "orders",
  "order-detail",
  "shipping",
  "couriers",
  "inv",
  "lab",
  "promo",
  "pay",
  "faq",
  "proto",
  "articles",
  "assessments",
  "reviews",
  "reseller",
  "access-code",
  "analytics",
  "design",
  "checkout",
  "fee",
  "groupbuys",
  "groupbuy-detail",
  "groupbuy",
  "hero",
  "banner",
  "account",
  "export",
  "staff",
  "staff-form",
  "customers",
  "notify",
  "notice",
  "store-status",
  "tracknote",
  "timeline",
  "billing",
  "upgrade",
] as const;

type View = (typeof VIEWS)[number];

/** Detail views that need a row handed over by their list — never an entry point. */
const DETAIL_VIEWS: ReadonlySet<string> = new Set(["order-detail", "groupbuy-detail", "staff-form"]);

/**
 * The first view: the one the Pepweb app asked for (app-embed.ts), if it names a
 * real entry view. It still goes through the activeView guard below.
 */
function initialView(): View {
  const asked = appInitialView();
  return asked && !DETAIL_VIEWS.has(asked) && (VIEWS as readonly string[]).includes(asked)
    ? (asked as View)
    : "dashboard";
}

export function AdminPage({
  brand,
  onLogout,
  onExitToSite,
}: {
  brand: Brand;
  onLogout: () => void;
  onExitToSite: () => void;
}) {
  const { toast, toastMsg, setProducts } = useStore();
  const [view, setView] = useState<View>(initialView);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  // The round whose dedicated dashboard is open. Same master-detail shape as
  // viewingOrder — the list hands the row over, the detail view hands back.
  const [viewingGroupBuy, setViewingGroupBuy] = useState<GroupBuy | null>(null);
  // The Orders folder that is open (a group buy, or a catch-all). Held here, not
  // in the hub, so backing out of an order lands on the same round.
  const [ordersFolder, setOrdersFolder] = useState<OrdersFolderKey>(null);
  // Where the round dashboard's Back goes — the Orders folder that opened it,
  // or the Group Buys list.
  const [groupBuyReturn, setGroupBuyReturn] = useState<"groupbuys" | "orders">("groupbuys");
  // Which Group Buys tab to land on — "members" when the dashboard's
  // "review join requests" shortcut sent us; every other entry opens Rounds.
  const [groupBuysTab, setGroupBuysTab] = useState<GroupBuysTab>("rounds");
  const [editingStaff, setEditingStaff] = useState<StaffListItem | null>(null);

  // Who is signed in (owner | staff with permissions). Re-loaded server-side so a
  // suspended/removed staff session resolves to "none" and is logged out.
  const [actor, setActor] = useState<StaffActor | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Paid group-buy access: a page rendered for a locked shopper (the admin
  // session is always cleared on document load) carries a catalog WITHOUT the
  // round's products and gb prices. The editors must never work from that — a
  // save would wipe the prices — so the admin waits for its own full catalog.
  const needsFullCatalog = !!brand.groupBuyTeaser;
  const [catalog, setCatalog] = useState<"ready" | "loading" | "failed">(needsFullCatalog ? "loading" : "ready");

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
      setDisplayName(info.displayName);
      setSessionLoaded(true);
      if (!needsFullCatalog) return;
      // Signed in now, so the refresh passes the admin through gb-access.
      getStorefrontProductsAction()
        .then((res) => {
          if (cancelled) return;
          if ("ok" in res && res.ok) {
            setProducts(res.products);
            setCatalog("ready");
          } else setCatalog("failed");
        })
        .catch(() => !cancelled && setCatalog("failed"));
    });
    return () => {
      cancelled = true;
    };
  }, [onLogout, needsFullCatalog, setProducts]);

  // Don't flash the full menu before we know who the actor is — a staff member
  // must never momentarily see modules they aren't permitted.
  if (sessionLoaded && catalog === "failed") {
    return (
      <div className="admin">
        <div className="admin__inner">
          <div className="admin-field__hint" role="alert" style={{ padding: 48, textAlign: "center" }}>
            Couldn&apos;t load your full catalog. Reload the page to try again.
          </div>
        </div>
      </div>
    );
  }
  if (!sessionLoaded || !actor || catalog !== "ready") {
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
    <SubscriptionBanner
      subscription={brand.subscription}
      // Billing is owner-only — offer the shortcut only to actors the view
      // guard would let through anyway.
      onOpenBilling={isViewAllowed(actor, "billing") ? () => setView("billing") : undefined}
    />
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
  if (activeView === "sort-categories") {
    return <AdminSortCategories brand={brand} onBack={() => setView("dashboard")} />;
  }
  if (activeView === "orders") {
    return (
      <AdminOrdersHub
        brand={brand}
        folder={ordersFolder}
        onFolder={setOrdersFolder}
        onBack={() => {
          setOrdersFolder(null);
          setView("dashboard");
        }}
        onView={(o) => {
          setViewingOrder(o);
          setView("order-detail");
        }}
        onOpenDashboard={(gb) => {
          setViewingGroupBuy(gb);
          setGroupBuyReturn("orders");
          setView("groupbuy-detail");
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
  if (activeView === "billing") return <AdminBilling brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "notice") return <AdminNoticeModal brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "store-status") return <AdminStoreStatus brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "currency") return <AdminCurrency brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "tracknote") return <AdminTrackNote brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "timeline") return <AdminTimeline brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "faq") return <AdminFAQManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "proto") return <AdminProtocolsManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "articles") return <AdminArticles brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "assessments") return <AdminAssessments brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "reviews") return <AdminReviewsManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "checkout") return <AdminCheckoutRules brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "fee") return <AdminFeeSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "groupbuys") {
    return (
      <AdminGroupBuys
        key={groupBuysTab}
        brand={brand}
        initialTab={groupBuysTab}
        onBack={() => setView("dashboard")}
        onOpen={(gb) => {
          setViewingGroupBuy(gb);
          setGroupBuyReturn("groupbuys");
          setView("groupbuy-detail");
        }}
      />
    );
  }
  if (activeView === "groupbuy-detail" && viewingGroupBuy) {
    return (
      <AdminGroupBuyDetail
        brand={brand}
        groupBuy={viewingGroupBuy}
        onBack={() => {
          setViewingGroupBuy(null);
          setView(groupBuyReturn);
        }}
      />
    );
  }
  if (activeView === "groupbuy") return <AdminGroupBuyRules brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "hero") return <AdminHeroSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "banner") return <AdminBannerSettings brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "account") return <AdminAccountSettings onBack={() => setView("dashboard")} />;
  if (activeView === "customers") return <AdminCustomers brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "export") return <AdminDataExport onBack={() => setView("dashboard")} />;
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

  // What this actor may see on the dashboard — the tenant entitlement AND the
  // staff grant, resolved in one place (lib/storefront/admin-dashboard).
  const caps = dashboardCapabilities(brand, actor);

  // Every navigation the shell, the search field and the dashboard emit lands
  // here. The activeView guard above still has the final say, so an unreachable
  // id simply bounces back to the dashboard.
  const openView = (next: string) => {
    if (next === "add-product") setEditingProduct(null);
    if (next === "groupbuys") setGroupBuysTab("rounds");
    setView(next as View);
  };

  return (
    <>
      <AdminShell
        brand={brand}
        actor={actor}
        activeView={activeView}
        displayName={displayName}
        onNavigate={openView}
        onLogout={onLogout}
        onExitToSite={onExitToSite}
      >
        {headerChrome}
        {subView ?? (
          <AdminDashboard
            brand={brand}
            caps={caps}
            greetingName={displayName}
            onOpen={openView}
            canGroupBuys={canSeeGroupBuyPanel(brand, actor)}
            onOpenGroupBuyJoins={() => {
              setGroupBuysTab("members");
              setView("groupbuys");
            }}
            onOpenGroupBuyRound={(gb) => {
              setGroupBuysTab("rounds"); // "back" from the round lands on Rounds
              setViewingGroupBuy(gb);
              setView("groupbuy-detail");
            }}
            onAddProduct={() => {
              setEditingProduct(null);
              setView("add-product");
            }}
          />
        )}
      </AdminShell>

      <div className={`admin-toast ${toastMsg ? "is-shown" : ""}`}>{toastMsg}</div>
    </>
  );
}
