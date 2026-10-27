"use client";

// Admin → Group Buys → "Join flow": pick a round, then its Paid Access settings
// (presets + fine-tuning + live preview) — how people get in. Who is in lives
// on the "Members" tab (PaidAccessMembers). Mounted by
// storefront/admin/AdminGroupBuys.tsx; talks to Paid Access only through ../actions.

import { useState } from "react";

import type { Brand } from "@/storefront/types";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import { PaidAccessSettingsPanel } from "./PaidAccessSettingsPanel";
import { paidAccessAdminCss } from "./styles";

type Props = {
  brand: Brand;
  groupBuys: GroupBuy[];
  /** Members waiting on the store (proofs + approvals), for the nudge strip. */
  waiting?: number | null;
  /** Jump to the Members tab. */
  onOpenMembers?: () => void;
};

const LISTED = new Set(["draft", "scheduled", "active", "closed"]);
const STATUS: Record<string, string> = { active: "Live", scheduled: "Scheduled", closed: "Closed", draft: "Draft" };

export function PaidAccessAdmin({ brand, groupBuys, waiting, onOpenMembers }: Props) {
  const rounds = groupBuys.filter((g) => LISTED.has(g.status));
  const preferred = rounds.find((g) => g.status === "active") ?? rounds.find((g) => g.status === "scheduled") ?? rounds[0];
  const [selectedId, setSelectedId] = useState(preferred?.id ?? "");
  const round = rounds.find((g) => g.id === selectedId) ?? preferred;

  if (!round) {
    return (
      <div className="bnn">
        <style>{paidAccessAdminCss}</style>
        <div className="admin-empty-set">No rounds yet. Create one on the Rounds tab, then choose how people join it here.</div>
      </div>
    );
  }

  return (
    <div className="bnn">
      <style>{paidAccessAdminCss}</style>
      {!!waiting && onOpenMembers && (
        <div className="bnn-nudge" role="status">
          <span>
            <strong>{waiting} member{waiting === 1 ? "" : "s"}</strong> waiting on you.
          </span>
          <button type="button" className="admin-btn" onClick={onOpenMembers}>Review in Members</button>
        </div>
      )}
      {rounds.length > 1 && (
        <label className="bnn-field bnn-round-pick">
          <span className="admin-field__label">Round</span>
          <select className="admin-input" value={round.id} onChange={(e) => setSelectedId(e.target.value)}>
            {rounds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {STATUS[g.status] ?? g.status}
              </option>
            ))}
          </select>
        </label>
      )}
      <PaidAccessSettingsPanel key={`s-${round.id}`} groupBuyId={round.id} roundName={round.name} currency={brand.currency || "₱"} wholeCatalog={round.productIds.length === 0} />
    </div>
  );
}
