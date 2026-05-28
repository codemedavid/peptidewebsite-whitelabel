import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformUser } from "@/lib/auth/session";
import { resolveTenantByHost } from "@/lib/tenant/resolve";

// Diagnostic for custom-domain routing. Shows every Domain row in the DB plus
// the result of resolveTenantByHost() for a host you supply via ?host=… —
// useful when a customer reports their custom domain falling to /unknown-tenant.

export const dynamic = "force-dynamic";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "(unset)";

type Search = { host?: string };

export default async function DomainDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requirePlatformUser();
  const { host: queryHost } = await searchParams;

  const reqHost = (await headers()).get("x-tenant-host");
  const testHost = (queryHost ?? "").trim().toLowerCase();

  const rows = await prisma.domain.findMany({
    select: {
      hostname: true,
      verified: true,
      isPrimary: true,
      tenant: { select: { slug: true, status: true } },
    },
    orderBy: { hostname: "asc" },
  });

  const probe = testHost ? await resolveTenantByHost(testHost) : null;

  const labelStyle: React.CSSProperties = { color: "var(--ink-400)", fontSize: 12 };
  const monoStyle: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Domain diagnostics</h1>
          <p className="page-sub">Confirm a custom domain is mapped before debugging routing.</p>
        </div>
      </div>

      <section className="set-card" style={{ marginTop: 16 }}>
        <div className="set-card-head"><h2>Environment</h2></div>
        <div className="set-card-body">
          <div style={labelStyle}>NEXT_PUBLIC_ROOT_DOMAIN</div>
          <div style={monoStyle}>{ROOT}</div>
          <div style={{ ...labelStyle, marginTop: 12 }}>x-tenant-host on this request</div>
          <div style={monoStyle}>{reqHost ?? "(not set)"}</div>
        </div>
      </section>

      <section className="set-card" style={{ marginTop: 16 }}>
        <div className="set-card-head"><h2>Test a hostname</h2></div>
        <div className="set-card-body">
          <form method="GET" style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              name="host"
              defaultValue={testHost}
              placeholder="shop.acme.com"
              style={{ flex: 1 }}
            />
            <button className="btn btn-accent btn-sm" type="submit">Probe</button>
          </form>
          {testHost && (
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Result for <span style={monoStyle}>{testHost}</span></div>
              <div style={monoStyle}>
                {probe
                  ? `→ tenant ${probe.slug} (status: ${probe.status})`
                  : "→ no tenant resolved"}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="set-card" style={{ marginTop: 16 }}>
        <div className="set-card-head">
          <h2>Mapped domains ({rows.length})</h2>
        </div>
        <div className="set-card-body">
          {rows.length === 0 ? (
            <div className="set-notice">No custom domains in the DB.</div>
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-400)" }}>
                  <th style={{ padding: "8px 0" }}>Hostname</th>
                  <th>Tenant</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Primary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.hostname} style={{ borderTop: "1px solid var(--border-soft)" }}>
                    <td style={{ ...monoStyle, padding: "8px 0" }}>{r.hostname}</td>
                    <td style={monoStyle}>{r.tenant.slug}</td>
                    <td>{r.tenant.status}</td>
                    <td>{r.verified ? "yes" : "no"}</td>
                    <td>{r.isPrimary ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
