"use client";

// Custom-domain management for a tenant, shown as a card on the tenant Settings
// page. A custom domain is a simple host → tenant mapping: the operator has
// already (a) attached the domain in the Vercel project and (b) confirmed the
// customer pointed DNS at the platform. Saving the hostname here is what makes
// resolveTenantByHost() route requests to this tenant.

import { useState } from "react";
import { Ic } from "@/components/admin/shell/primitives";
import {
  addTenantDomainAction,
  removeTenantDomainAction,
  setPrimaryTenantDomainAction,
} from "@/actions/admin";
import type { TenantDomainRow } from "@/lib/admin/data";

type Props = {
  slug: string;
  initialDomains: TenantDomainRow[];
};

export function DomainManager({ slug, initialDomains }: Props) {
  const [domains, setDomains] = useState<TenantDomainRow[]>(initialDomains);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
    setDomains((d) => [...d, { id: hostname, hostname, verified: true, isPrimary: false }]);
    setInput("");
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
            Map a domain the customer owns (e.g. <code>shop.acme.com</code>) to this store. Before
            adding it here, attach the domain in your Vercel project and have the customer point its
            DNS at the platform — then save the hostname below and it will route immediately.
          </p>
        </div>
        <span className={"badge " + (domains.length > 0 ? "badge-success" : "badge-neutral")}>
          {domains.length === 0 ? "None" : `${domains.length} mapped`}
        </span>
      </div>

      <div className="set-card-body">
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
                <div key={d.hostname} className="dm-item verified">
                  <div className="dm-item-head">
                    <div className="dm-item-name">
                      <Ic.Globe />
                      <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="mono">
                        {d.hostname}
                      </a>
                      {d.isPrimary && <span className="badge badge-accent">Primary</span>}
                    </div>
                    <div className="dm-item-actions">
                      {!d.isPrimary && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => makePrimary(d.hostname)}
                          disabled={working}
                        >
                          Make primary
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
          Mapped domains route to this store immediately. The primary is the canonical URL.
        </span>
      </div>
    </section>
  );
}
