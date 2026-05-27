import { Globe, Shield, Users, Plug } from "lucide-react";
import { requirePlatformUser } from "@/lib/auth/session";
import { getPlatformUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/fixtures";

export const dynamic = "force-dynamic";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "10px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
      <div style={{ color: "var(--ink-400)" }}>{k}</div>
      <div style={{ color: "var(--ink-900)" }}>{v}</div>
    </div>
  );
}

export default async function PlatformSettingsPage() {
  await requirePlatformUser();
  const demo = isDemoMode();
  const operator = demo ? null : await getPlatformUser();

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Platform Settings</h1>
          <p className="page-sub">Global configuration for the white-label platform</p>
        </div>
      </div>

      <div className="grid-2-eq">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Globe style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                General
              </h3>
            </div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              <Row k="Root domain" v={<span className="mono">{ROOT}</span>} />
              <Row k="Tenant URLs" v={<span className="mono">&lt;slug&gt;.{ROOT.replace(/:\d+$/, "")}</span>} />
              <Row k="Data source" v={<span className={"badge " + (demo ? "badge-warn" : "badge-success")}>{demo ? "Demo (file-backed)" : "Database (Postgres)"}</span>} />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Users style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                Operators
              </h3>
            </div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              <Row k="Signed in as" v={operator?.email ?? (demo ? "demo@platform" : "—")} />
              <Row k="Role" v={<span className="badge badge-accent">{operator?.role ?? "super_admin"}</span>} />
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Plug style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                Integrations
              </h3>
            </div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              {[
                { name: "Supabase Auth", on: true },
                { name: "Prisma / Postgres", on: !demo },
                { name: "ImageKit (media)", on: true },
                { name: "Stripe (billing)", on: false },
              ].map((it) => (
                <div key={it.name} className="row" style={{ justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <span style={{ fontSize: 13 }}>{it.name}</span>
                  <span className={"badge " + (it.on ? "badge-success" : "badge-neutral")}>
                    <span className="bdot" />
                    {it.on ? "Connected" : "Not configured"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">
                <Shield style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                Security
              </h3>
            </div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              <Row k="Tenant isolation" v={<span className="badge badge-success">RLS + forTenant()</span>} />
              <Row k="Platform guard" v="PlatformUser required" />
              <Row k="Audit trail" v="Event log (per tenant)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
