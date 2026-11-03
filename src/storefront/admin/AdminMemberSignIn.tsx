"use client";

// Customers → "Members-only store" switch. On: every visitor signs in or creates
// an account before the store renders (components/AccountGate). The switch
// saves the moment it is flipped, like the Access Code gate's, because a
// half-saved privacy setting is worse than none.

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { getAccountGateAction, setAccountGateAction } from "@/actions/account-gate";

export function AdminMemberSignIn() {
  const { toast } = useStore();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getAccountGateAction()
      .then((res) => alive && setEnabled("error" in res ? null : res.enabled))
      .catch(() => alive && setEnabled(null));
    return () => {
      alive = false;
    };
  }, []);

  if (enabled === null) return null;

  const flip = async () => {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    try {
      const res = await setAccountGateAction({ enabled: next });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setEnabled(res.enabled);
      toast(res.enabled ? "Members-only is ON — visitors sign in first" : "Members-only is OFF — your shop is open to everyone");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cx-card" aria-labelledby="cx-member-signin">
      <div className="hero-editor__switchrow">
        <div>
          <h2 id="cx-member-signin" className="cx-card__title">
            Members-only store
          </h2>
          <p className="cx-empty" style={{ marginTop: 4 }}>
            {enabled
              ? "On — visitors must sign in or create an account before they see your shop. New sign-ups appear in this list."
              : "Off — anyone with your link can browse. Turn on to make visitors sign in or create an account first."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Members-only store"
          disabled={saving}
          className={`hero-editor__switch${enabled ? " is-on" : ""}`}
          onClick={() => void flip()}
        >
          <span className="hero-editor__switch-knob" />
        </button>
      </div>
    </section>
  );
}
