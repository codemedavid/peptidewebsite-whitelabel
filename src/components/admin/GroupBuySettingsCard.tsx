"use client";

// Super-admin card on the tenant Features page: the Group Buy defaults the
// store admin's "New group buy" form prefills from (status / duration /
// delivery ETA). Persisted in branding.config.groupBuySettings via
// saveGroupBuySettingsAction — platform-operator only.

import { useState } from "react";
import { Check, Users } from "lucide-react";
import {
  GROUP_BUY_SETTINGS_DEFAULTS,
  type GroupBuySettings,
} from "@/lib/storefront/group-buy";
import { saveGroupBuySettingsAction } from "@/actions/group-buys";

const STATUS_OPTIONS: Array<{ value: GroupBuySettings["defaultStatus"]; label: string }> = [
  { value: "draft", label: "Draft — owner launches manually" },
  { value: "scheduled", label: "Scheduled — goes live at the start date" },
  { value: "active", label: "Active — live immediately" },
];

type SaveStatus = "saved" | "dirty" | "saving" | "error";

export function GroupBuySettingsCard({
  slug,
  initial,
}: {
  slug: string;
  initial: GroupBuySettings;
}) {
  const [status, setStatus] = useState<GroupBuySettings["defaultStatus"]>(initial.defaultStatus);
  const [days, setDays] = useState<number>(initial.defaultDurationDays);
  const [eta, setEta] = useState<string>(initial.defaultDeliveryEta);
  const [save, setSave] = useState<SaveStatus>("saved");

  async function persist() {
    setSave("saving");
    const res = await saveGroupBuySettingsAction(slug, {
      defaultStatus: status,
      defaultDurationDays: days,
      defaultDeliveryEta: eta,
    });
    setSave("ok" in res ? "saved" : "error");
  }

  const mark = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setSave("dirty");
  };

  return (
    <section className="ftr-gcard">
      <header className="ftr-ghead">
        <span className="ftr-gicon">
          <Users size={16} aria-hidden />
        </span>
        <h2 className="ftr-gtitle">Group Buy Settings</h2>
        {save === "saved" && (
          <span className="ftr-save-pill" role="status">
            <Check size={14} aria-hidden /> Saved
          </span>
        )}
        {save === "saving" && (
          <span className="ftr-save-pill saving" role="status">
            <span className="ftr-dot" aria-hidden /> Saving…
          </span>
        )}
        {save === "error" && (
          <button type="button" className="ftr-save-pill error" role="alert" onClick={persist}>
            Save failed — retry
          </button>
        )}
      </header>

      <div className="ftr-row">
        <div className="ftr-fmain">
          <div className="ftr-fname">Default status</div>
          <div className="ftr-fdesc">How a new group buy starts when the store owner creates one.</div>
        </div>
        <select
          aria-label="Default group buy status"
          value={status}
          onChange={(e) => mark(setStatus)(e.target.value as GroupBuySettings["defaultStatus"])}
          style={{ minWidth: 260 }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ftr-row">
        <div className="ftr-fmain">
          <div className="ftr-fname">Default duration</div>
          <div className="ftr-fdesc">Days between the prefilled start and end dates (1–365).</div>
        </div>
        <input
          aria-label="Default group buy duration in days"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => mark(setDays)(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
          style={{ width: 90 }}
        />
      </div>

      <div className="ftr-row">
        <div className="ftr-fmain">
          <div className="ftr-fname">Default delivery ETA</div>
          <div className="ftr-fdesc">Customer-facing estimate prefilled on each new group buy.</div>
        </div>
        <input
          aria-label="Default delivery ETA"
          type="text"
          maxLength={200}
          value={eta}
          placeholder={GROUP_BUY_SETTINGS_DEFAULTS.defaultDeliveryEta}
          onChange={(e) => mark(setEta)(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </div>

      <div className="ftr-row" style={{ justifyContent: "flex-end" }}>
        <button
          type="button"
          className="ftr-vstore"
          disabled={save === "saving" || save === "saved"}
          onClick={persist}
        >
          Save settings
        </button>
      </div>
    </section>
  );
}
