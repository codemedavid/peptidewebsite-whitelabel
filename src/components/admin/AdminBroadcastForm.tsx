"use client";

import { useEffect, useMemo, useState } from "react";
import { previewAdminBroadcastAction, sendAdminBroadcastAction } from "@/actions/admin-broadcast";
import { BROADCAST_LIMITS } from "@/lib/mobile/admin-broadcast-input";

type Tenant = { id: string; name: string; slug: string };
type Reach = { phones: number; stores: number } | null;

export function AdminBroadcastForm({ tenants }: { tenants: Tenant[] }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [reach, setReach] = useState<Reach>(null);
  const [reachError, setReachError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenantIds = useMemo(() => (scope === "all" ? [] : picked), [scope, picked]);
  const noneChosen = scope === "some" && picked.length === 0;

  useEffect(() => {
    setConfirming(false);
    if (noneChosen) {
      setReach({ phones: 0, stores: 0 });
      return;
    }
    let alive = true;
    setReach(null);
    setReachError(null);
    void previewAdminBroadcastAction(tenantIds).then((res) => {
      if (!alive) return;
      if ("error" in res) setReachError(res.error);
      else setReach({ phones: res.phones, stores: res.stores });
    });
    return () => {
      alive = false;
    };
  }, [tenantIds, noneChosen]);

  const shown = tenants.filter((t) => {
    const q = filter.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.slug.includes(q);
  });
  const ready = title.trim() && body.trim() && !noneChosen && (reach?.phones ?? 0) > 0;

  const send = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await sendAdminBroadcastAction({ title, body, tenantIds });
    setBusy(false);
    setConfirming(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setResult(
      res.phones === 0
        ? "No signed-in admin phones — nothing was sent."
        : `Sent to ${res.sent} of ${res.phones} phone${res.phones === 1 ? "" : "s"}${res.failed ? ` · ${res.failed} failed (phone offline or app removed)` : ""}.`,
    );
    setTitle("");
    setBody("");
  };

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="grid-2-eq">
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">Message</h3>
        </div>
        <div className="card-body col" style={{ gap: 14 }}>
          <label className="col" style={{ gap: 6 }}>
            <span className="field-label">Title</span>
            <input
              className="input"
              value={title}
              maxLength={BROADCAST_LIMITS.title}
              placeholder="PepWorld update is out"
              onChange={(e) => setTitle(e.target.value)}
            />
            <small className="muted">{title.length}/{BROADCAST_LIMITS.title}</small>
          </label>
          <label className="col" style={{ gap: 6 }}>
            <span className="field-label">Message</span>
            <textarea
              className="input textarea"
              rows={4}
              value={body}
              maxLength={BROADCAST_LIMITS.body}
              placeholder="Update the app from TestFlight / the App Store to get the Member tracker and per-dose availability."
              onChange={(e) => setBody(e.target.value)}
            />
            <small className="muted">{body.length}/{BROADCAST_LIMITS.body}</small>
          </label>

          <fieldset className="col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>Who gets it</legend>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
              All store admins
            </label>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="radio" name="scope" checked={scope === "some"} onChange={() => setScope("some")} />
              Only some stores
            </label>
          </fieldset>

          {scope === "some" && (
            <div className="col" style={{ gap: 8 }}>
              <input
                className="input"
                type="search"
                placeholder="Find a store"
                aria-label="Find a store"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="col" style={{ gap: 4, maxHeight: 240, overflowY: "auto" }}>
                {shown.map((t) => (
                  <label key={t.id} className="row" style={{ gap: 8, alignItems: "center", padding: "4px 2px" }}>
                    <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                    <span>{t.name}</span>
                    <span className="muted mono" style={{ fontSize: 12 }}>{t.slug}</span>
                  </label>
                ))}
                {shown.length === 0 && <span className="muted">No store matches.</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Preview</h3>
          </div>
          <div className="card-body">
            <div
              aria-label="Notification preview"
              style={{
                borderRadius: 18,
                padding: "12px 14px",
                background: "color-mix(in srgb, currentColor 7%, transparent)",
                display: "grid",
                gridTemplateColumns: "36px 1fr",
                gap: 10,
              }}
            >
              <div aria-hidden style={{ width: 36, height: 36, borderRadius: 9, background: "#111", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>P</div>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                  <span className="muted">PEPWORLD</span>
                  <span className="muted">now</span>
                </div>
                <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{title.trim() || "Title"}</div>
                <div style={{ fontSize: 14, overflowWrap: "anywhere" }}>{body.trim() || "Your message"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body col" style={{ gap: 12 }}>
            <div aria-live="polite">
              {reachError ? (
                <span className="badge badge-danger">{reachError}</span>
              ) : reach === null ? (
                <span className="muted">Counting signed-in admins…</span>
              ) : (
                <span>
                  Reaches <strong>{reach.phones}</strong> phone{reach.phones === 1 ? "" : "s"} across{" "}
                  <strong>{reach.stores}</strong> store{reach.stores === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <button
              type="button"
              className={`btn ${confirming ? "btn-danger" : "btn-primary"}`}
              disabled={!ready || busy}
              onClick={() => void send()}
            >
              {busy ? "Sending…" : confirming ? `Tap again to send to ${reach?.phones ?? 0} phones` : "Send notification"}
            </button>
            {confirming && !busy && (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            )}
            {result && <span className="badge badge-success" role="status">{result}</span>}
            {error && <span className="badge badge-danger" role="alert">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
