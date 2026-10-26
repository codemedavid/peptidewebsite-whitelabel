"use client";

// Admin → Group Buys → "Join flow": pick a round, then its Paid Access settings
// (presets + fine-tuning + live preview) and its member queue. Mounted by
// storefront/admin/AdminGroupBuys.tsx; talks to Paid Access only through ../actions.

import { useCallback, useState } from "react";

import type { Brand } from "@/storefront/types";
import type { GroupBuy } from "@/lib/storefront/group-buy";
import type { QueueCounts } from "../index";
import { PaidAccessQueue } from "./PaidAccessQueue";
import { PaidAccessSettingsPanel } from "./PaidAccessSettingsPanel";
import { paidAccessAdminCss } from "./styles";

type Props = {
  brand: Brand;
  groupBuys: GroupBuy[];
  /** Lets the tab show how many members are waiting on the store. */
  onWaitingCount?: (n: number) => void;
};

const LISTED = new Set(["draft", "scheduled", "active", "closed"]);
const STATUS: Record<string, string> = { active: "Live", scheduled: "Scheduled", closed: "Closed", draft: "Draft" };

export function PaidAccessAdmin({ brand, groupBuys, onWaitingCount }: Props) {
  const rounds = groupBuys.filter((g) => LISTED.has(g.status));
  const preferred = rounds.find((g) => g.status === "active") ?? rounds.find((g) => g.status === "scheduled") ?? rounds[0];
  const [selectedId, setSelectedId] = useState(preferred?.id ?? "");
  const round = rounds.find((g) => g.id === selectedId) ?? preferred;
  const handleCounts = useCallback((c: QueueCounts) => onWaitingCount?.(c.payments + c.approvals), [onWaitingCount]);

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
      <PaidAccessQueue key={`q-${round.id}`} groupBuyId={round.id} onCounts={handleCounts} />
    </div>
  );
}
