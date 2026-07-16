"use client";

// Super Admin — trial→Business upgrade requests. Store owners file these from
// their in-admin Upgrade page (proof-of-payment upload); approving here is
// what flips the tenant to Business and reactivates a paused storefront
// (decideUpgradeRequestAction). Decisions are final.

import { useState, useTransition } from "react";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { formatPesos } from "@/lib/admin/plans";
import {
  decideUpgradeRequestAction,
  type UpgradeRequestRow,
} from "@/actions/admin-upgrades";

type Props = { initial: UpgradeRequestRow[]; loadError?: string };

export function UpgradeRequestsManager({ initial, loadError }: Props) {
  const { showToast } = useAdminUI();
  const [rows, setRows] = useState<UpgradeRequestRow[]>(initial);
  const [pending, startTransition] = useTransition();

  function decide(id: string, decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideUpgradeRequestAction(id, decision);
      if ("error" in res) return showToast(res.error);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: decision } : r)));
      showToast(decision === "approved" ? "Upgrade approved — store is on Business." : "Request rejected.");
    });
  }

  const open = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Upgrade Requests</h1>
          <p className="page-sub">
            Trial stores that paid for Business and are waiting for confirmation. Approving flips
            the plan and reactivates the storefront immediately.
          </p>
        </div>
        <span className="badge badge-warn">{open.length} pending</span>
      </div>

      {loadError && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: 14, fontSize: 13 }}>{loadError}</div>
        </div>
      )}

      {[{ title: "Pending", list: open }, { title: "Decided", list: decided }].map(
        ({ title, list }) =>
          list.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }} key={title}>
              <div className="card-head">
                <h3 className="card-title">{title}</h3>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th>Upgrade</th>
                      <th>Due paid</th>
                      <th>Credit</th>
                      <th>Method</th>
                      <th>Proof</th>
                      <th>Filed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.tenantName}</b> <span className="mono">{r.tenantSlug}</span>
                        </td>
                        <td>
                          {r.fromPlan} → {r.toPlan}
                        </td>
                        <td>{formatPesos(r.amountCents)}</td>
                        <td>{r.creditCents > 0 ? `− ${formatPesos(r.creditCents)}` : "—"}</td>
                        <td>{r.payMethod ?? "—"}</td>
                        <td>
                          {r.proofUrl ? (
                            <a href={r.proofUrl} target="_blank" rel="noopener noreferrer">
                              view
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {r.status === "pending" ? (
                            <>
                              <button
                                className="btn btn-accent"
                                disabled={pending}
                                onClick={() => decide(r.id, "approved")}
                              >
                                Approve
                              </button>{" "}
                              <button
                                className="btn"
                                disabled={pending}
                                onClick={() => decide(r.id, "rejected")}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className={`badge ${r.status === "approved" ? "badge-ok" : ""}`}>
                              {r.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ),
      )}

      {rows.length === 0 && !loadError && (
        <div className="card">
          <div className="card-body" style={{ padding: 16, fontSize: 13 }}>
            No upgrade requests yet — trial stores that submit payment will appear here.
          </div>
        </div>
      )}
    </div>
  );
}
