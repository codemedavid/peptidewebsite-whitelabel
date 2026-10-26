"use client";

// Admin → Group Buys → Join flow → "Paid Access settings" for one round: pick a
// preset, fine-tune, and see the exact steps a member will walk. The schema
// (core/settings.ts) runs live as the owner types; the server runs it again on
// save and is the only authority. Members already joining keep the rules they
// joined under — saving never moves them.

import { useEffect, useMemo, useState } from "react";

import { useStore } from "@/storefront/store";
import { formatMoney } from "@/lib/storefront/currency";
import {
  PAID_ACCESS_PRESETS,
  applyPreset,
  detectPreset,
  firstStatus,
  previewSteps,
  stepperView,
  validateSettings,
  type PaidAccessSettings,
  type SettingsError,
} from "../client";
import { getPaidAccessSettingsAction, savePaidAccessSettingsAction } from "../actions";
import { CapacityFields, FormFields, PaymentFields, RulesFields, ScheduleFields, StepsEditor, type FieldsProps } from "./settings-fields";
import { CopyFields } from "./copy-fields";

type View = { exists: boolean; settings: PaidAccessSettings; suggested: PaidAccessSettings; version: number; slotsTaken: number; onlinePaymentsAvailable: boolean };

type Props = {
  groupBuyId: string;
  roundName: string;
  currency: string;
  /** The round covers the whole catalog (no assigned products). */
  wholeCatalog: boolean;
};

export function PaidAccessSettingsPanel({ groupBuyId, roundName, currency, wholeCatalog }: Props) {
  const { toast } = useStore();
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<PaidAccessSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [serverErrors, setServerErrors] = useState<SettingsError[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setDraft(null);
    setLoadError("");
    getPaidAccessSettingsAction(groupBuyId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) return setLoadError(res.message);
        setView(res);
        setDraft(res.exists ? res.settings : res.suggested);
      })
      .catch(() => !cancelled && setLoadError("We couldn't load the join settings. Please try again."));
    return () => {
      cancelled = true;
    };
  }, [groupBuyId]);

  const online = view?.onlinePaymentsAvailable ?? false;
  const clientErrors = useMemo(() => {
    if (!draft) return [];
    const r = validateSettings(draft, { onlinePaymentsAvailable: online });
    return r.ok ? [] : r.errors;
  }, [draft, online]);
  const errors = serverErrors.length > 0 ? serverErrors : clientErrors;

  if (loadError) return <div className="bnn-alert" role="alert">{loadError}</div>;
  if (!view || !draft) return <div className="bnn-skeleton" aria-busy="true" aria-label="Loading join settings" />;

  const money = (cents: number) => formatMoney(cents / 100, currency, { decimals: cents % 100 !== 0 });
  const preset = detectPreset(draft);
  const dirty = !view.exists || JSON.stringify(draft) !== JSON.stringify(view.settings);
  const preview = previewSteps(draft, money(draft.payment.amountCents));
  const firstScreen = stepperView(draft, firstStatus(draft.steps), { amountLabel: money(draft.payment.amountCents), copy: draft.copy });
  const errorAt = (path: string) => errors.find((e) => e.path === path)?.message;
  const errorFor = (path: string) => errorAt(path) ?? errors.find((e) => e.path.startsWith(`${path}.`))?.message;

  const change = (next: PaidAccessSettings) => {
    setServerErrors([]);
    setDraft(next);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const res = await savePaidAccessSettingsAction(groupBuyId, draft);
      if (!res.ok) {
        setServerErrors("errors" in res && res.errors ? res.errors : [{ path: "", message: res.message }]);
        return toast(res.message);
      }
      setView(res);
      setDraft(res.settings);
      toast(view.exists ? "Saved. New members follow these rules; people already joining keep theirs." : "Join flow is on for this round.");
    } catch {
      toast("Couldn't save — please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const fields: FieldsProps = { draft, onChange: change, errorFor, errorAt, currency, money, onlineAvailable: online };
  const general = errors.find((e) => e.path === "")?.message;

  return (
    <section className="bnn-settings" aria-labelledby={`bnn-settings-${groupBuyId}`}>
      <header className="bnn-settings__head">
        <div>
          <h3 className="admin-section__title" id={`bnn-settings-${groupBuyId}`}>
            How do people get into {roundName}?
          </h3>
          <p className="admin-field__hint">
            {view.exists ? `Settings v${view.version} · ${view.slotsTaken} slot${view.slotsTaken === 1 ? "" : "s"} taken` : "Not set up yet — this round stays members-only and nobody can join until you save."}
          </p>
        </div>
      </header>

      <div className="bnn-presets" role="radiogroup" aria-label="Presets">
        {PAID_ACCESS_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            className={`bnn-preset${preset === p.id ? " is-active" : ""}`}
            onClick={() => change(applyPreset(p.id, draft))}
          >
            <span className="bnn-preset__name">{p.label}</span>
            <span className="bnn-preset__desc">{p.description}</span>
          </button>
        ))}
        {preset === "custom" && <span className="bnn-custom">Custom flow</span>}
      </div>

      <div className="bnn-preview" aria-live="polite">
        <div className="bnn-preview__label">What members will see</div>
        <ol className="bnn-flow">
          {preview.map((step, i) => (
            <li key={`${step}-${i}`} className={`bnn-flow__step${i === preview.length - 1 ? " is-access" : ""}`}>
              <span className="bnn-flow__n">{i === preview.length - 1 ? "✓" : i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="bnn-preview__first">First screen: “{firstScreen.headline}”</p>
      </div>

      {wholeCatalog && draft.steps.length > 0 && (
        <div className="bnn-warn" role="note">
          This round has no assigned products, so it covers your whole catalog: while it’s live, people who aren’t in yet see an empty shop.
        </div>
      )}

      <StepsEditor {...fields} />
      {draft.steps.includes("payment") && <PaymentFields {...fields} />}
      {draft.steps.includes("form") && <FormFields {...fields} />}
      <CapacityFields {...fields} />
      <ScheduleFields {...fields} />
      <RulesFields {...fields} />
      <CopyFields {...fields} />

      {general && <div className="bnn-alert" role="alert">{general}</div>}
      <div className="bnn-settings__save">
        {errors.length > 0 && <span className="bnn-error">Fix {errors.length === 1 ? "the highlighted field" : `${errors.length} highlighted fields`} to save.</span>}
        <button type="button" className="admin-btn" disabled={!dirty || isSaving || errors.length > 0} onClick={() => void save()}>
          {isSaving ? "Saving…" : view.exists ? "Save changes" : "Save and open joining"}
        </button>
      </div>
    </section>
  );
}
