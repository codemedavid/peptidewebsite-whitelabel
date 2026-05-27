"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ic } from "./primitives";
import { CreateTenantDrawer } from "./CreateTenantDrawer";
import { signOutAction } from "@/actions/auth";

type NavItem = { id: string; label: string; href: string; icon: string; group: string; badge?: string };

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/", icon: "Home", group: "Platform" },
  { id: "tenants", label: "Tenants", href: "/tenants", icon: "Buildings", group: "Platform" },
  { id: "features", label: "Feature Modules", href: "/features", icon: "Layers", group: "Platform" },
  { id: "plans", label: "Plans & Billing", href: "/plans", icon: "Card", group: "Platform" },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: "Chart", group: "Insights" },
  { id: "settings", label: "Platform Settings", href: "/settings", icon: "Settings", group: "System" },
  { id: "audit", label: "Audit Logs", href: "/audit", icon: "History", group: "System" },
];

const CRUMB_LABEL: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));

/* ---------- UI context: open create drawer + toast from anywhere ---------- */
type AdminUI = { openCreate: () => void; showToast: (msg: string) => void };
const AdminUIContext = createContext<AdminUI | null>(null);
export function useAdminUI(): AdminUI {
  return useContext(AdminUIContext) ?? { openCreate: () => {}, showToast: () => {} };
}

function activeId(pathname: string): string {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/tenants")) return "tenants";
  const match = NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href));
  return match?.id ?? "dashboard";
}

export function AdminShell({
  children,
  operatorEmail,
  tenantCount,
  tenantNameBySlug,
}: {
  children: React.ReactNode;
  operatorEmail?: string | null;
  tenantCount?: number;
  tenantNameBySlug?: Record<string, string>;
}) {
  const pathname = usePathname() || "/";
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // restore persisted prefs
  useEffect(() => {
    const t = localStorage.getItem("sa-theme");
    if (t === "dark" || t === "light") setTheme(t);
    setCollapsed(localStorage.getItem("sa-collapsed") === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("sa-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("sa-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  const openCreate = useCallback(() => setDrawerOpen(true), []);

  // keyboard shortcuts: ⌘K focuses search, N opens create
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && el.matches("input, textarea, select")) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setDrawerOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        (document.querySelector(".sa .search-input") as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // breadcrumbs
  const id = activeId(pathname);
  const crumbs: string[] = ["Platform"];
  if (pathname.startsWith("/tenants/") && pathname !== "/tenants") {
    const slug = pathname.split("/")[2];
    crumbs.push("Tenants", tenantNameBySlug?.[slug] ?? slug);
  } else if (id === "dashboard") {
    crumbs.push("Dashboard");
  } else {
    crumbs.push(CRUMB_LABEL[NAV.find((n) => n.id === id)?.href ?? ""] ?? "Dashboard");
  }

  const groups: { name: string; items: NavItem[] }[] = [];
  for (const item of NAV) {
    const withBadge = item.id === "tenants" && tenantCount ? { ...item, badge: String(tenantCount) } : item;
    const g = groups.find((x) => x.name === item.group);
    if (g) g.items.push(withBadge);
    else groups.push({ name: item.group, items: [withBadge] });
  }

  const ChevronLeft = Ic.ChevronLeft;
  const Bell = Ic.Bell;
  const SearchI = Ic.Search;
  const Plus = Ic.Plus;
  const ThemeI = theme === "dark" ? Ic.Sun : Ic.Moon;
  const initials = (operatorEmail ?? "Super Admin").slice(0, 2).toUpperCase();

  return (
    <AdminUIContext.Provider value={{ openCreate, showToast }}>
      <div className="sa" data-theme={theme}>
        <div className={"app" + (collapsed ? " collapsed" : "")}>
          {/* SIDEBAR */}
          <aside className="sidebar">
            <div className="sidebar-brand">
              <div className="brand-mark">P</div>
              <div className="brand-text">Peptide&nbsp;Platform</div>
            </div>
            <nav className="sidebar-nav">
              {groups.map((g, gi) => (
                <div key={g.name}>
                  {!collapsed && <div className="nav-section-label">{g.name}</div>}
                  {collapsed && gi > 0 && <div style={{ height: 8 }} />}
                  {g.items.map((item) => {
                    const IconCmp = Ic[item.icon];
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className={"nav-item" + (id === item.id ? " active" : "")}
                        title={collapsed ? item.label : ""}
                      >
                        <IconCmp className="nav-icon" />
                        <span className="nav-label">{item.label}</span>
                        {item.badge && !collapsed && <span className="nav-badge">{item.badge}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="sidebar-foot">
              <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)}>
                <ChevronLeft />
                <span className="sidebar-foot-text">Collapse</span>
              </button>
            </div>
          </aside>

          {/* MAIN */}
          <div className="main-col">
            <header className="topbar">
              <div className="crumbs">
                {crumbs.map((c, i) => (
                  <span key={i} style={{ display: "contents" }}>
                    <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
                    {i < crumbs.length - 1 && <span className="sep">/</span>}
                  </span>
                ))}
              </div>
              <div className="topbar-spacer" />
              <div className="search-wrap">
                <SearchI className="search-icon" />
                <input className="search-input" placeholder="Search tenants, orders, features…" />
                <span className="kbd">⌘K</span>
              </div>
              <span className="status-pill">
                <span className="pulse" />
                All systems operational
              </span>
              <button className="icon-btn" title="Notifications">
                <Bell />
                <span className="dot" />
              </button>
              <button className="icon-btn" title="Toggle theme" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
                <ThemeI />
              </button>
              <button className="btn btn-accent btn-sm" onClick={openCreate}>
                <Plus /> New tenant
              </button>
              <div style={{ position: "relative" }}>
                <div className="avatar" title={operatorEmail ?? "Super admin"} onClick={() => setAvatarMenu((v) => !v)}>
                  {initials}
                </div>
                {avatarMenu && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setAvatarMenu(false)} />
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 38,
                        background: "var(--bg)",
                        border: "1px solid var(--border-c)",
                        borderRadius: 10,
                        boxShadow: "var(--shadow-lg)",
                        padding: 4,
                        minWidth: 200,
                        zIndex: 10,
                      }}
                    >
                      <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-500)", borderBottom: "1px solid var(--border-soft)", marginBottom: 4 }}>
                        {operatorEmail ?? "Super admin"}
                      </div>
                      <form action={signOutAction.bind(null, "/login")}>
                        <button type="submit" className="row" style={{ width: "100%", padding: "7px 9px", borderRadius: 6, fontSize: 13, color: "var(--ink-700)", gap: 8 }}>
                          <Ic.External style={{ width: 14, height: 14 }} /> Sign out
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            </header>

            <main className="page">{children}</main>
          </div>
        </div>

        <CreateTenantDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onToast={showToast} />

        {toast && (
          <div className="sa-toast">
            <Ic.CheckCircle />
            {toast}
          </div>
        )}
      </div>
    </AdminUIContext.Provider>
  );
}
