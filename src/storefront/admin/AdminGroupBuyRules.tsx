"use client";

// Store-admin view for Group Buy Rules → Order Ratio Control. Configures the
// peptide ↔ bacteriostatic-water ratio that lib/storefront/group-buy-rules
// enforces, in either DIRECTION: as a floor (every peptide requires N bac water)
// or as a cap (bac water may not exceed N per peptide vial, and peptide-only
// orders are fine). The cap supersedes the older maxPerPeptide ceiling.
// Store-wide: one rule, one default bac-water product.
//
// Persists through saveGroupBuyRulesAction (read-modify-write into
// branding.config.groupBuyRules) and mirrors into the live brand via setTweak so
// the open storefront cart updates without a reload. Holds the FULL rules object
// in state (seeded from normalizeGroupBuyRules) so editing the ratio never
// clobbers the engine's other settings.

import { useMemo, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveGroupBuyRulesAction } from "@/actions/storefront-admin";
import {
  normalizeGroupBuyRules,
  RATIO_MAX,
  DEFAULT_RATIO_MESSAGE,
  DEFAULT_CAP_MESSAGE,
  type GroupBuyRules,
  type RatioMode,
  type RatioDirection,
} from "@/lib/storefront/group-buy-rules";
import { classifyProductClass } from "@/lib/storefront/product-class";

const DIRECTION_COPY: Record<RatioDirection, { label: string; hint: string }> = {
  floor: {
    label: "Require bac water (floor)",
    hint: "Every peptide vial needs the ratio below in bacteriostatic water. A peptide-only cart is stopped until water is added.",
  },
  cap: {
    label: "Limit bac water (cap)",
    hint: "Bacteriostatic water can't exceed the ratio below per peptide vial. Peptide-only orders are always allowed; water without a peptide is not.",
  },
};

/** Auto-add exists to top a cart UP to a floor, so it is floor-only — a surplus
 *  can't be fixed by adding more water. Under a cap it behaves like strict. */
const MODE_COPY: Record<RatioMode, { label: string; hint: string; floorOnly?: boolean }> = {
  strict: {
    label: "Strict — block checkout",
    hint: "Customers can't check out until the cart complies.",
  },
  auto_add: {
    label: "Auto-add — keep the cart in sync",
    hint: "Adding a peptide automatically tops the cart up with the required bac water.",
    floorOnly: true,
  },
  warn: {
    label: "Warn — allow checkout",
    hint: "Show a reminder when the rule is broken, but let the order through.",
  },
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="admin-field" style={{ marginBottom: 14 }}>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      <div className="admin-field__hint">{hint}</div>
    </div>
  );
}

export function AdminGroupBuyRules({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { products, setTweak, toast } = useStore();
  const [rules, setRules] = useState<GroupBuyRules>(() => normalizeGroupBuyRules(brand.groupBuyRules));
  const [saving, setSaving] = useState(false);

  const ratio = rules.ratio;
  const isCap = ratio.direction === "cap";

  // Immutable helper — never mutate the rules object in place.
  const patchRatio = (patch: Partial<GroupBuyRules["ratio"]>) =>
    setRules((r) => ({ ...r, ratio: { ...r.ratio, ...patch } }));

  // Auto-add only makes sense for a floor (see MODE_COPY.floorOnly).
  const modeOptions = (Object.keys(MODE_COPY) as RatioMode[]).filter(
    (m) => !isCap || !MODE_COPY[m].floorOnly,
  );

  /**
   * Switching direction rewrites the settings that would otherwise contradict
   * the new one: auto-add can't service a cap, and copy written for one
   * direction reads as nonsense in the other ("add 2 more" on a cart that has
   * too much water), so direction-specific tokens are dropped back to the
   * built-in default.
   */
  const onDirectionChange = (direction: RatioDirection) => {
    const wrongTokens = direction === "cap" ? /\{(shortfall|required)\}/ : /\{(allowed|bacWater|surplus)\}/;
    patchRatio({
      direction,
      mode: direction === "cap" && ratio.mode === "auto_add" ? "strict" : ratio.mode,
      message: wrongTokens.test(ratio.message) ? "" : ratio.message,
    });
  };

  // Products classified (or heuristically read) as bac water — the sensible
  // options for the auto-add default. Falls back to every product so an
  // unclassified catalog can still pick one.
  const bacWaterOptions = useMemo(() => {
    const tagged = products.filter((p) => classifyProductClass(p) === "bacWater");
    return tagged.length > 0 ? tagged : products;
  }, [products]);

  const autoAddNeedsProduct =
    ratio.enabled && !isCap && ratio.mode === "auto_add" && !ratio.defaultBacWaterProductId;

  const save = async () => {
    if (saving) return;
    if (autoAddNeedsProduct) {
      toast("Pick a default bacteriostatic water product for auto-add.");
      return;
    }
    setSaving(true);
    try {
      const value = normalizeGroupBuyRules(rules);
      const res = await saveGroupBuyRulesAction(value);
      if ("error" in res) {
        toast(res.error ?? "Couldn't save — please sign in again and retry.");
        return;
      }
      setTweak({ groupBuyRules: value });
      toast("Group Buy rules saved");
    } catch {
      toast("Couldn't save — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>💧</span>
          Order Ratio Control
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="admin-form__body">
      <div className="admin-form__card">
        <h2 className="admin-form__section">⚙️ Engine</h2>
        <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
          Tie bacteriostatic water to the peptides in the cart — either requiring it or limiting it.
          Classify each product as peptide or bac water in the product editor; this rule counts the
          cart by those tags.
        </div>
        <Toggle
          label="Enable Group Buy rules"
          hint="Master switch. Off keeps every rule below dormant."
          checked={rules.enabled}
          onChange={(enabled) => setRules((r) => ({ ...r, enabled }))}
        />
      </div>

      <div className="admin-form__card" style={{ opacity: rules.enabled ? 1 : 0.55 }}>
        <h2 className="admin-form__section">Peptide ↔ bacteriostatic water ratio</h2>
        <Toggle
          label={isCap ? "Limit bac water per peptide" : "Require bac water per peptide"}
          hint={DIRECTION_COPY[ratio.direction].hint}
          checked={ratio.enabled}
          onChange={(enabled) => patchRatio({ enabled })}
        />

        <div className="admin-field" style={{ marginBottom: 14 }}>
          <label className="admin-field__label">Direction</label>
          <select
            className="admin-select"
            value={ratio.direction}
            disabled={!ratio.enabled}
            onChange={(e) => onDirectionChange(e.target.value as RatioDirection)}
          >
            {(Object.keys(DIRECTION_COPY) as RatioDirection[]).map((d) => (
              <option key={d} value={d}>
                {DIRECTION_COPY[d].label}
              </option>
            ))}
          </select>
          <div className="admin-field__hint">{DIRECTION_COPY[ratio.direction].hint}</div>
        </div>

        <div className="admin-field" style={{ marginBottom: 14 }}>
          <label className="admin-field__label">
            {isCap ? "Max bac water per peptide vial" : "Bac water per peptide vial"}
          </label>
          <input
            className="admin-input"
            type="number"
            min={1}
            max={RATIO_MAX}
            step={1}
            value={ratio.bacWaterPerPeptide}
            disabled={!ratio.enabled}
            onChange={(e) => patchRatio({ bacWaterPerPeptide: Number(e.target.value) || 1 })}
          />
          <div className="admin-field__hint">
            {isCap
              ? "1 = at most one bac water per peptide vial (default). Set 2 to allow two, and so on."
              : "1 = a 1:1 ratio (default). Set 2 for 2:1, 3 for 3:1, and so on."}
          </div>
        </div>

        <div className="admin-field" style={{ marginBottom: 14 }}>
          <label className="admin-field__label">Enforcement mode</label>
          <select
            className="admin-select"
            value={ratio.mode}
            disabled={!ratio.enabled}
            onChange={(e) => patchRatio({ mode: e.target.value as RatioMode })}
          >
            {modeOptions.map((m) => (
              <option key={m} value={m}>
                {MODE_COPY[m].label}
              </option>
            ))}
          </select>
          <div className="admin-field__hint">{MODE_COPY[ratio.mode].hint}</div>
        </div>

        {!isCap && ratio.mode === "auto_add" && (
          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Default bacteriostatic water product</label>
            <select
              className="admin-select"
              value={ratio.defaultBacWaterProductId ?? ""}
              disabled={!ratio.enabled}
              onChange={(e) => patchRatio({ defaultBacWaterProductId: e.target.value || null })}
            >
              <option value="">— Select a product —</option>
              {bacWaterOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="admin-field__hint">
              Auto-add tops the cart up with this product. Required for auto-add mode.
            </div>
          </div>
        )}

        <div className="admin-field" style={{ marginBottom: 4 }}>
          <label className="admin-field__label">Custom message (optional)</label>
          <input
            className="admin-input"
            type="text"
            maxLength={300}
            placeholder={isCap ? DEFAULT_CAP_MESSAGE : DEFAULT_RATIO_MESSAGE}
            value={ratio.message}
            disabled={!ratio.enabled}
            onChange={(e) => patchRatio({ message: e.target.value })}
          />
          <div className="admin-field__hint">
            {isCap ? (
              <>
                Tokens: <code>{"{ratio}"}</code>, <code>{"{peptide}"}</code>,{" "}
                <code>{"{allowed}"}</code>, <code>{"{bacWater}"}</code>,{" "}
                <code>{"{surplus}"}</code>. Blank uses the default copy.
              </>
            ) : (
              <>
                Tokens: <code>{"{ratio}"}</code>, <code>{"{shortfall}"}</code>,{" "}
                <code>{"{required}"}</code>, <code>{"{peptide}"}</code>. Blank uses the default copy.
              </>
            )}
          </div>
        </div>
      </div>

      <div className="admin-form__card" style={{ opacity: rules.enabled ? 1 : 0.55 }}>
        <h2 className="admin-form__section">📍 Where it applies</h2>
        <Toggle
          label="Validate in the cart"
          hint="Show the ratio message in the cart drawer as the customer shops."
          checked={rules.validation.cart}
          onChange={(cart) => setRules((r) => ({ ...r, validation: { ...r.validation, cart } }))}
        />
        <Toggle
          label="Validate at checkout"
          hint="Re-check on the server at order placement (recommended — can't be bypassed)."
          checked={rules.validation.checkout}
          onChange={(checkout) =>
            setRules((r) => ({ ...r, validation: { ...r.validation, checkout } }))
          }
        />
      </div>
      </div>
    </div>
  );
}
