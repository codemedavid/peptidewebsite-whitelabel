"use client";

// The header every tenant page shares (rendered by tenants/[slug]/layout.tsx):
// identity, the tenant-level actions, and ONE tab bar that spans the in-page
// detail tabs and the branding/features/settings/integrations sub-routes. The
// layout stays mounted across those routes, so switching tabs keeps context
// instead of dropping the operator onto a bare sub-page.

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ic, StatusBadge, TenantAvatar } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { planMeta } from "@/lib/admin/plans";
import { suspendTenantAction } from "@/actions/admin";
import { buildWaLink } from "@/lib/admin/whatsapp";
import { activeTenantTab, buildTenantTabs } from "@/components/admin/pages/tenant-tabs";
import type { AdminTenantRow } from "@/lib/admin/data";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");

const PLAN_BADGE: Record<string, string> = { enterprise: "badge-accent", pro: "badge-info" };

type Props = { tenant: AdminTenantRow };

export function TenantWorkspaceHeader({ tenant }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const tabParam = useSearchParams().get("tab");
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();

  const pm = planMeta(tenant.planKey);
  const storefront = `https://${tenant.slug}.${ROOT}`;
  const tabs = buildTenantTabs(tenant.slug, { orders: tenant.orders, features: tenant.features });
  const active = activeTenantTab(pathname, tabParam);
  const isSuspended = tenant.status === "suspended";

  const toggleSuspend = () => {
    const verb = isSuspended ? "Reactivate" : "Suspend";
    const warning = isSuspended
      ? `Reactivate ${tenant.name}? Its storefront comes back online.`
      : `Suspend ${tenant.name}? Its storefront goes offline for customers until you reactivate it.`;
    if (!window.confirm(warning)) return;
    startTransition(async () => {
      const res = await suspendTenantAction(tenant.slug);
      if ("error" in res) showToast(`${verb} failed: ${res.error}`);
      else {
        showToast(`Tenant ${res.status === "suspended" ? "suspended" : "reactivated"}`);
        router.refresh();
      }
    });
  };

  return (
    <header className="tw-head">
      <Link href="/tenants" className="tw-back">
        <Ic.ChevronLeft aria-hidden /> All tenants
      </Link>
      <div className="tw-identity">
        <TenantAvatar name={tenant.name} logoUrl={tenant.logoUrl} size={48} />
        <div className="tw-identity-text">
          <div className="tw-title-row">
            <h1 className="page-title tw-title">{tenant.name}</h1>
            <StatusBadge status={tenant.status} />
            <span className={"badge " + (PLAN_BADGE[pm.key] ?? "badge-neutral")}>{pm.label}</span>
          </div>
          <div className="tw-meta">
            <a className="mono tw-domain" href={storefront} target="_blank" rel="noreferrer">
              {tenant.slug}.{ROOT} <Ic.External aria-hidden />
            </a>
            {tenant.owner && (
              <span>
                <Ic.Users aria-hidden /> {tenant.owner}
              </span>
            )}
            {tenant.email && (
              <span>
                <Ic.Mail aria-hidden /> {tenant.email}
              </span>
            )}
          </div>
        </div>
        <div className="tw-actions">
          {tenant.ownerWhatsapp && (
            <a
              className="btn btn-sm btn-accent"
              href={buildWaLink(tenant.ownerWhatsapp, `Hi ${tenant.name}, `)}
              target="_blank"
              rel="noopener noreferrer"
              title="Message this tenant on WhatsApp"
            >
              <Ic.Send /> WhatsApp
            </a>
          )}
          <a
            className="btn btn-sm"
            href={`${storefront}/#admin`}
            target="_blank"
            rel="noreferrer"
            title="Opens the store's own admin sign-in in a new tab"
          >
            <Ic.External /> Open store admin
          </a>
          <button
            type="button"
            className={"btn btn-sm" + (isSuspended ? "" : " tw-danger")}
            onClick={toggleSuspend}
            disabled={pending}
          >
            <Ic.Lock /> {pending ? "Working…" : isSuspended ? "Reactivate" : "Suspend"}
          </button>
        </div>
      </div>

      <nav className="tabs tw-tabs" aria-label={`${tenant.name} sections`}>
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={"tab" + (active === t.id ? " active" : "")}
            aria-current={active === t.id ? "page" : undefined}
            scroll={false}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count tnum">{t.count}</span>}
          </Link>
        ))}
      </nav>
    </header>
  );
}
