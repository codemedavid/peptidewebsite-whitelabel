"use client";

import { useState } from "react";
import type { Brand, Order, Product } from "../types";
import { useStore } from "../store";
import { AdminIcon, tintStyle } from "./shared";
import { AdminAddProduct } from "./AdminAddProduct";
import { AdminProductsList } from "./AdminProductsList";
import { AdminCategoriesManager } from "./AdminCategoriesManager";
import { AdminOrders } from "./AdminOrders";
import { AdminOrderDetail } from "./AdminOrderDetail";
import { AdminShippingLocations } from "./AdminShippingLocations";
import { AdminLabResults } from "./AdminLabResults";
import { AdminPromoCodes } from "./AdminPromoCodes";
import { AdminPaymentMethods } from "./AdminPaymentMethods";
import { AdminFAQManager } from "./AdminFAQManager";
import { AdminProtocolsManager } from "./AdminProtocolsManager";
import { AdminReviewsManager } from "./AdminReviewsManager";
import { isAdminViewVisible } from "../visibility";

type View =
  | "dashboard"
  | "add-product"
  | "products"
  | "categories"
  | "orders"
  | "order-detail"
  | "shipping"
  | "lab"
  | "promo"
  | "pay"
  | "faq"
  | "proto"
  | "reviews";

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

  // A view whose storefront page was just turned off in the super admin should
  // not stay visible — bounce back to the dashboard.
  const activeView: View = isAdminViewVisible(brand, view) ? view : "dashboard";

  // Sub-view routing
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
  if (activeView === "shipping") return <AdminShippingLocations brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "lab") return <AdminLabResults brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "promo") return <AdminPromoCodes brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "pay") return <AdminPaymentMethods brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "faq") return <AdminFAQManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "proto") return <AdminProtocolsManager brand={brand} onBack={() => setView("dashboard")} />;
  if (activeView === "reviews") return <AdminReviewsManager brand={brand} onBack={() => setView("dashboard")} />;

  const stats = [
    { label: "Total Products", value: products.length, icon: "box", tint: "pink" },
    { label: "Available Stock", value: products.length, icon: "trend", tint: "green" },
    { label: "Featured Items", value: products.filter((p) => p.featured).length, icon: "sparkle", tint: "yellow" },
    { label: "Categories", value: categories.filter((c) => c.id !== "all").length, icon: "users", tint: "cyan" },
  ];

  const quickActions = [
    { id: "add", label: "Add Product", hint: "Create new item", icon: "plus", tint: "pink" },
    { id: "manage", label: "Manage Products", hint: "Edit existing items", icon: "box", tint: "green" },
    { id: "cats", label: "Categories", hint: "Organize items", icon: "folder", tint: "orange" },
    { id: "orders", label: "Orders", hint: "View transactions", icon: "cart", tint: "yellow" },
    { id: "inv", label: "Inventory", hint: "Track stock", icon: "inbox", tint: "orange" },
    { id: "ship", label: "Shipping", hint: "Manage rates", icon: "pin", tint: "cyan" },
    { id: "couriers", label: "Couriers", hint: "Manage couriers", icon: "truck", tint: "mint" },
    { id: "lab", label: "Lab Results", hint: "Manage COAs", icon: "shield", tint: "pink" },
    { id: "promo", label: "Promo Codes", hint: "Manage discounts", icon: "tag", tint: "red" },
    { id: "pay", label: "Payments", hint: "Manage methods", icon: "card", tint: "purple" },
    { id: "faq", label: "FAQ", hint: "Manage content", icon: "help", tint: "green" },
    { id: "proto", label: "Protocols", hint: "Peptide guides", icon: "shield", tint: "pink" },
    { id: "reviews", label: "Reviews", hint: "Manage testimonials", icon: "star", tint: "pink" },
  ].filter((q) => isAdminViewVisible(brand, q.id));

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

      <main className="admin__inner">
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
                  className="admin-quick__btn"
                  onClick={() => {
                    if (q.id === "add") {
                      setEditingProduct(null);
                      setView("add-product");
                      return;
                    }
                    if (q.id === "manage") return setView("products");
                    if (q.id === "cats") return setView("categories");
                    if (q.id === "orders") return setView("orders");
                    if (q.id === "ship") return setView("shipping");
                    if (q.id === "lab") return setView("lab");
                    if (q.id === "promo") return setView("promo");
                    if (q.id === "pay") return setView("pay");
                    if (q.id === "faq") return setView("faq");
                    if (q.id === "proto") return setView("proto");
                    if (q.id === "reviews") return setView("reviews");
                    toast(`"${q.label}" — wire to your backend`);
                  }}
                >
                  <span className="admin-quick__icon" style={tintStyle(q.tint, "bg")}>
                    <span style={tintStyle(q.tint, "fg")}>
                      <AdminIcon name={q.icon} />
                    </span>
                  </span>
                  <span>
                    <span className="admin-quick__label">{q.label}</span>
                    <span className="admin-quick__hint">{q.hint}</span>
                  </span>
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
