"use client";

// Store-admin card for the hero group-buy countdown (Group Buys → Rounds).
// Two switches — show the timer, show the text on top of it — plus the text
// for each phase. Saved via saveHeroCountdownAction into
// branding.config.heroCountdown; the storefront resolves the target from the
// rounds, so there is no date to type here.

import { useState } from "react";
import { saveHeroCountdownAction } from "@/actions/group-buys";
import {
  HERO_COUNTDOWN_AUTO_HEADING,
  HERO_COUNTDOWN_LIMITS,
  normalizeHeroCountdown,
  type HeroCountdownConfig,
} from "@/lib/storefront/hero-countdown";
import type { Brand } from "../types";
import { useStore } from "../store";

const ON_OFF: { value: boolean; label: string }[] = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

type Props = {
  brand: Brand;
};

export function AdminHeroCountdown({ brand }: Props) {
  const { toast } = useStore();
  const [saved, setSaved] = useState<HeroCountdownConfig>(() => normalizeHeroCountdown(brand.heroCountdownConfig));
  const [draft, setDraft] = useState<HeroCountdownConfig>(saved);
  const [busy, setBusy] = useState(false);

  const persist = async (next: HeroCountdownConfig, message: string) => {
    const prev = saved;
    setDraft(next);
    setSaved(next); // optimistic
    setBusy(true);
    const res = await saveHeroCountdownAction(next);
    setBusy(false);
    if ("error" in res) {
      setSaved(prev);
      setDraft(prev);
      return toast(res.error);
    }
    setSaved(res.countdown);
    setDraft(res.countdown);
    toast(message);
  };

  const textDirty = draft.closingHeading !== saved.closingHeading || draft.openingHeading !== saved.openingHeading;

  const switchRow = (label: string, value: boolean, onPick: (v: boolean) => void, disabled = false) => (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 10 }}
    >
      <span className="admin-field__hint">{label}</span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 6 }}>
        {ON_OFF.map((choice) => {
          const active = value === choice.value;
          return (
            <button
              key={choice.label}
              type="button"
              className={`admin-btn${active ? "" : " admin-btn--ghost"}`}
              style={{ padding: "4px 10px", fontSize: 12 }}
              aria-pressed={active}
              disabled={busy || disabled}
              onClick={() => !active && onPick(choice.value)}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      style={{
        margin: "4px 0 14px",
        padding: "12px 14px",
        border: "1px solid var(--brand-border, rgba(0,0,0,.12))",
        borderRadius: 10,
      }}
    >
      <div style={{ fontWeight: 600 }}>Hero countdown</div>
      <div className="admin-field__hint" style={{ marginTop: 2 }}>
        A live timer in your store&apos;s hero. While a round is open it counts down to its end
        date. Between rounds it counts down to the next <strong>scheduled</strong> round&apos;s
        start date. It hides itself when no round has a date to count to.
      </div>

      {switchRow("Show countdown", saved.enabled, (v) =>
        persist({ ...saved, enabled: v }, v ? "Countdown is on." : "Countdown is hidden."),
      )}
      {switchRow(
        "Text on top of the countdown",
        saved.showHeading,
        (v) => persist({ ...saved, showHeading: v }, v ? "Countdown text is on." : "Countdown text is hidden."),
        !saved.enabled,
      )}

      {saved.enabled && saved.showHeading && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="admin-field__label">Text while a round is open</span>
            <input
              className="admin-input"
              value={draft.closingHeading}
              maxLength={HERO_COUNTDOWN_LIMITS.heading}
              placeholder={HERO_COUNTDOWN_AUTO_HEADING.closing}
              onChange={(e) => setDraft({ ...draft, closingHeading: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="admin-field__label">Text before a round opens</span>
            <input
              className="admin-input"
              value={draft.openingHeading}
              maxLength={HERO_COUNTDOWN_LIMITS.heading}
              placeholder={HERO_COUNTDOWN_AUTO_HEADING.opening}
              onChange={(e) => setDraft({ ...draft, openingHeading: e.target.value })}
            />
          </label>
          <span className="admin-field__hint">
            Use <code>{"{name}"}</code> for the round&apos;s name. Leave a field blank to use the
            default text shown in it.
          </span>
          <div>
            <button
              type="button"
              className="admin-btn"
              style={{ padding: "6px 14px", fontSize: 13 }}
              disabled={busy || !textDirty}
              onClick={() => persist(normalizeHeroCountdown(draft), "Countdown text saved.")}
            >
              {busy ? "Saving…" : "Save text"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
