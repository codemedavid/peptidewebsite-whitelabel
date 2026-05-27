"use client";

// Custom-domain management for a tenant, shown as a card on the tenant Settings
// page. Lets an operator attach a domain the customer owns (e.g. shop.acme.com),
// shows the DNS records to set, and verifies it against Vercel. Once verified and
// marked primary, resolveTenantByHost() routes that hostname to this tenant.

import { useState } from "react";
import { Ic } from "@/components/admin/shell/primitives";
import {
  addTenantDomainAction,
  verifyTenantDomainAction,
  removeTenantDomainAction,
  setPrimaryTenantDomainAction,
} from "@/actions/admin";
import type { TenantDomainRow } from "@/lib/admin/data";
import type { DomainStatus, VerificationRecord } from "@/lib/vercel/domains";

type Props = {
  slug: string;
  initialDomains: TenantDomainRow[];
};

type Row = TenantDomainRow & { status?: DomainStatus };

/** Recommended DNS record for pointing a hostname at Vercel. */
function recommendedRecord(hostname: string): VerificationRecord {
  // 2 labels (acme.com) = apex → A record; more (shop.acme.com) = subdomain → CNAME.
  const isApex = hostname.split(".").length <= 2;
  return isApex
    ? { type: "A", domain: hostname, value: "76.76.21.21" }
    : { type: "CNAME", domain: hostname, value: "cname.vercel-dns.com" };
}

function DnsRecords({ hostname, status }: { hostname: string; status?: DomainStatus }) {
  // Prefer Vercel's own verification records; otherwise show the standard record.
  const records =
    status && status.verification.length > 0
      ? status.verification
      : [recommendedRecord(hostname)];
  return (
    <div className="dm-dns">
      <div className="dm-dns-title">Add these DNS records at your domain provider</div>
      <table className="dm-dns-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.type}</td>
              <td className="mono">{r.domain}</td>
              <td className="mono">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dm-dns-hint">
        DNS changes can take a few minutes (sometimes up to 48h) to propagate. Click Verify once set.
      </div>
    </div>
  );
}

export function DomainManager({ slug, initialDomains }: Props) {
  const [domains, setDomains] = useState<Row[]>(initialDomains);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // hostname currently working
  const [rowError, setRowError] = useState<Record<string, string>>({});

  function setError(hostname: string, msg?: string) {
    setRowError((e) => ({ ...e, [hostname]: msg ?? "" }));
  }

  async function add() {
    setAdding(true);
    setAddError(null);
    const res = await addTenantDomainAction(slug, input);
    setAdding(false);
    if ("error" in res) {
      setAddError(res.error);
      return;
    }
    const hostname = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/\.$/, "");
    setDomains((d) => [
      ...d,
      { id: hostname, hostname, verified: res.status.verified, isPrimary: false, status: res.status },
    ]);
    setInput("");
  }

  async function verify(hostname: string) {
    setBusy(hostname);
    setError(hostname);
    const res = await verifyTenantDomainAction(slug, hostname);
    setBusy(null);
    if ("error" in res) {
      setError(hostname, res.error);
      return;
    }
    setDomains((d) =>
      d.map((x) =>
        x.hostname === hostname ? { ...x, verified: res.status.verified, status: res.status } : x,
      ),
    );
    if (!res.status.verified) {
      setError(hostname, "DNS not detected yet — check the records and try again shortly.");
    }
  }

  async function remove(hostname: string) {
    setBusy(hostname);
    setError(hostname);
    const res = await removeTenantDomainAction(slug, hostname);
    setBusy(null);
    if ("error" in res) {
      setError(hostname, res.error);
      return;
    }
    setDomains((d) => d.filter((x) => x.hostname !== hostname));
  }

  async function makePrimary(hostname: string) {
    setBusy(hostname);
    setError(hostname);
    const res = await setPrimaryTenantDomainAction(slug, hostname);
    setBusy(null);
    if ("error" in res) {
      setError(hostname, res.error);
      return;
    }
    setDomains((d) => d.map((x) => ({ ...x, isPrimary: x.hostname === hostname })));
  }

  const valid = /\./.test(input.trim());

  return (
    <section className="set-card" data-section="domains">
      <div className="set-card-head">
        <div>
          <span className="set-eyebrow">Domains</span>
          <h2>Custom domains</h2>
          <p className="set-desc">
            Point a domain the customer owns (e.g. <code>shop.acme.com</code>) at this store. The
            platform subdomain always works; add a custom domain to use their own branding.
          </p>
        </div>
        <span className={"badge " + (domains.some((d) => d.verified) ? "badge-success" : "badge-neutral")}>
          {domains.length === 0
            ? "None"
            : `${domains.filter((d) => d.verified).length}/${domains.length} verified`}
        </span>
      </div>

      <div className="set-card-body">
        {/* add form */}
        <div className="dm-add">
          <input
            className="input"
            value={input}
            placeholder="shop.acme.com"
            aria-label="Custom domain"
            disabled={adding}
            onChange={(e) => {
              setInput(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !adding) add();
            }}
          />
          <button className="btn btn-accent btn-sm" onClick={add} disabled={!valid || adding}>
            {adding ? "Adding…" : (<><Ic.Plus /> Add domain</>)}
          </button>
        </div>
        {addError && <div className="set-err" role="alert" style={{ marginTop: 8 }}>{addError}</div>}

        {/* list */}
        {domains.length === 0 ? (
          <div className="set-notice" style={{ marginTop: 14 }}>
            <Ic.Globe />
            <div>No custom domains yet. The store is reachable at its platform subdomain.</div>
          </div>
        ) : (
          <div className="dm-list">
            {domains.map((d) => {
              const working = busy === d.hostname;
              return (
                <div key={d.hostname} className={"dm-item" + (d.verified ? " verified" : "")}>
                  <div className="dm-item-head">
                    <div className="dm-item-name">
                      <Ic.Globe />
                      <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="mono">
                        {d.hostname}
                      </a>
                      {d.isPrimary && <span className="badge badge-accent">Primary</span>}
                      {d.verified ? (
                        <span className="badge badge-success">
                          <Ic.CheckCircle /> Verified
                        </span>
                      ) : (
                        <span className="badge badge-warn">
                          <Ic.AlertCircle /> Pending DNS
                        </span>
                      )}
                    </div>
                    <div className="dm-item-actions">
                      {d.verified && !d.isPrimary && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => makePrimary(d.hostname)}
                          disabled={working}
                        >
                          Make primary
                        </button>
                      )}
                      {!d.verified && (
                        <button
                          className="btn btn-sm"
                          onClick={() => verify(d.hostname)}
                          disabled={working}
                        >
                          {working ? "Checking…" : (<><Ic.Refresh /> Verify</>)}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm dm-remove"
                        onClick={() => remove(d.hostname)}
                        disabled={working}
                        aria-label={`Remove ${d.hostname}`}
                      >
                        <Ic.Trash />
                      </button>
                    </div>
                  </div>
                  {!d.verified && <DnsRecords hostname={d.hostname} status={d.status} />}
                  {rowError[d.hostname] && (
                    <div className="set-err" role="alert" style={{ marginTop: 8 }}>
                      {rowError[d.hostname]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="set-foot">
        <span className="hint">
          <Ic.AlertCircle />
          Verified domains route to this store immediately. The primary is the canonical URL.
        </span>
      </div>
    </section>
  );
}
