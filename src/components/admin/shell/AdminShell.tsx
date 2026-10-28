"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Ic } from "./primitives";
import { CreateTenantDrawer } from "./CreateTenantDrawer";
import { signOutAction } from "@/actions/auth";
import type { EditablePlanCard } from "@/lib/platform/plan-config";

type NavItem = { id: string; label: string; href: string; icon: string; group: string; badge?: string };

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", href: "/", icon: "Home", group: "Platform" },
  { id: "tenants", label: "Tenants", href: "/tenants", icon: "Buildings", group: "Platform" },
  { id: "onboarding", label: "Onboarding", href: "/onboarding", icon: "Sparkles", group: "Platform" },
  { id: "payments", label: "Checkout Payments", href: "/payments", icon: "DollarSign", group: "Platform" },
  { id: "upgrades", label: "Upgrade Requests", href: "/upgrades", icon: "Sparkles", group: "Platform" },
  { id: "features", label: "Feature Modules", href: "/features", icon: "Layers", group: "Platform" },
  { id: "plans", label: "Plans & Billing", href: "/plans", icon: "Card", group: "Platform" },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: "Chart", group: "Insights" },
  { id: "income", label: "My Income", href: "/income", icon: "DollarSign", group: "Insights" },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: "Calendar", group: "Insights" },
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
  if (pathname.startsWith("/onboarding")) return "onboarding";
  const match = NAV.find((n) => n.href !== "/" && pathname.startsWith(n.href));
  return match?.id ?? "dashboard";
}

export function AdminShell({
  children,
  operatorEmail,
  tenantCount,
  tenantNameBySlug,
  planCards,
}: {
  children: React.ReactNode;
  operatorEmail?: string | null;
  tenantCount?: number;
  tenantNameBySlug?: Record<string, string>;
  planCards?: EditablePlanCard[];
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(false);
  // Phone nav drawer. Stored as the path it was opened on, so navigating
  // anywhere closes it without an effect.
  const [navOpenAt, setNavOpenAt] = useState<string | null>(null);
  const navOpen = navOpenAt === pathname;
  const closeNav = useCallback(() => setNavOpenAt(null), []);
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

  // keyboard shortcuts: ⌘K focuses search, N opens create, Esc closes menus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAvatarMenu(false);
        setNavOpenAt(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.querySelector(".sa .search-input") as HTMLInputElement | null)?.focus();
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.matches("input, textarea, select"));
      // A bare N only — never while typing, with a modifier, or over an open dialog.
      const modified = e.metaKey || e.ctrlKey || e.altKey;
      const dialogOpen = !!document.querySelector(".sa-drawer-backdrop, [role='dialog']");
      if (!typing && !modified && !dialogOpen && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setDrawerOpen(true);
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
  } else if (pathname.startsWith("/onboarding/") && pathname !== "/onboarding") {
    crumbs.push("Onboarding", "Detail");
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

  // Global search jumps to the tenants list, filtered — the one thing it can
  // honestly search today.
  const submitSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
    const q = input?.value.trim() ?? "";
    router.push(q ? `/tenants?q=${encodeURIComponent(q)}` : "/tenants");
    input?.blur();
  };

  const ChevronLeft = Ic.ChevronLeft;
  const SearchI = Ic.Search;
  const Plus = Ic.Plus;
  const ThemeI = theme === "dark" ? Ic.Sun : Ic.Moon;
  const initials = (operatorEmail ?? "Super Admin").slice(0, 2).toUpperCase();

  return (
    <AdminUIContext.Provider value={{ openCreate, showToast }}>
      <div className="sa" data-theme={theme}>
        <div className={"app" + (collapsed ? " collapsed" : "")}>
          {navOpen && <div className="sidebar-scrim" onClick={closeNav} aria-hidden="true" />}
          {/* SIDEBAR */}
          <aside className={"sidebar" + (navOpen ? " open" : "")} id="sa-sidebar">
            <div className="sidebar-brand">
              <div className="brand-mark">P</div>
              <div className="brand-text">Pepweb&nbsp;Admin</div>
              <button type="button" className="icon-btn sidebar-close" onClick={closeNav} aria-label="Close menu">
                <Ic.X />
              </button>
            </div>
            <nav className="sidebar-nav" aria-label="Admin">
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
                        aria-current={id === item.id ? "page" : undefined}
                        title={collapsed ? item.label : ""}
                        onClick={closeNav}
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
              <button type="button" className="collapse-btn" onClick={() => setCollapsed((c) => !c)}>
                <ChevronLeft />
                <span className="sidebar-foot-text">Collapse</span>
              </button>
            </div>
          </aside>

          {/* MAIN */}
          <div className="main-col">
            <header className="topbar">
              <button
                type="button"
                className="icon-btn menu-btn"
                onClick={() => setNavOpenAt(pathname)}
                aria-label="Open menu"
                aria-expanded={navOpen}
                aria-controls="sa-sidebar"
              >
                <Ic.Menu />
              </button>
              <div className="crumbs">
                {crumbs.map((c, i) => (
                  <Fragment key={i}>
                    <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
                    {i < crumbs.length - 1 && <span className="sep">/</span>}
                  </Fragment>
                ))}
              </div>
              <div className="topbar-spacer" />
              <form className="search-wrap" role="search" onSubmit={submitSearch}>
                <SearchI className="search-icon" />
                <input
                  className="search-input"
                  name="q"
                  type="search"
                  placeholder="Search tenants…"
                  aria-label="Search tenants by name or subdomain"
                  autoComplete="off"
                />
                <span className="kbd">⌘K</span>
              </form>
              <button
                type="button"
                className="icon-btn"
                title="Toggle theme"
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              >
                <ThemeI />
              </button>
              <button type="button" className="btn btn-accent btn-sm new-tenant-btn" onClick={openCreate} aria-label="New tenant">
                <Plus /> <span className="new-tenant-label">New tenant</span>
              </button>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="avatar"
                  title={operatorEmail ?? "Super admin"}
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={avatarMenu}
                  onClick={() => setAvatarMenu((v) => !v)}
                >
                  {initials}
                </button>
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
                          <Ic.LogOut style={{ width: 14, height: 14 }} /> Sign out
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

        <CreateTenantDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onToast={showToast} planCards={planCards} />

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
