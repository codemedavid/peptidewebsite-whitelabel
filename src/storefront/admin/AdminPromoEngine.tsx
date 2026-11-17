"use client";

// Store-admin cards for the promo engine, shown at the top of Promo Codes:
//   • Sale Campaign — name, start/end, teaser, countdown bar
//     (lib/storefront/sale-campaign, FEATURES.STORE_SALE_CAMPAIGN)
//   • Free shipping over ₱X (lib/storefront/free-shipping,
//     FEATURES.STORE_FREE_SHIPPING_THRESHOLD)
// Each renders only when its operator grant is on, saves through its own
// server action (sanitized + entitlement-checked server-side), and mirrors
// into the live brand via setTweak so the storefront preview updates at once.

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { saveFreeShippingThresholdAction, saveSaleCampaignAction } from "@/actions/promo-engine";
import {
  CAMPAIGN_NAME_MAX,
  EMPTY_SALE_CAMPAIGN,
  campaignPhase,
  normalizeSaleCampaign,
  type CampaignPhase,
} from "@/lib/storefront/sale-campaign";
import { EMPTY_FREE_SHIPPING, normalizeFreeShippingThreshold } from "@/lib/storefront/free-shipping";

const SAVE_FAILED = "Couldn't save. Please sign in again and retry.";

/** ISO instant → the value a <input type="datetime-local"> shows (local time). */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** datetime-local value (local time) → ISO instant, or "". */
function fromLocalInput(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const PHASE_LABEL: Record<CampaignPhase, string> = {
  off: "Not running",
  teaser: "Teaser showing",
  live: "Live now",
  ended: "Ended",
};

function SaleCampaignCard({ brand }: { brand: Brand }) {
  const { toast, setTweak } = useStore();
  const initial = brand.saleCampaign ?? EMPTY_SALE_CAMPAIGN;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [name, setName] = useState(initial.name);
  const [startsAt, setStartsAt] = useState(toLocalInput(initial.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial.endsAt));
  const [teaser, setTeaser] = useState(initial.teaser);
  const [teaserDays, setTeaserDays] = useState<number | string>(initial.teaserDays);
  const [showBar, setShowBar] = useState(initial.showBar);
  const [saving, setSaving] = useState(false);

  const payload = {
    enabled,
    name,
    startsAt: fromLocalInput(startsAt),
    endsAt: fromLocalInput(endsAt),
    teaser,
    teaserDays: Number(teaserDays) || 0,
    showBar,
  };
  const saved = brand.saleCampaign ?? EMPTY_SALE_CAMPAIGN;
  const phase = campaignPhase(saved, true);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveSaleCampaignAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      const next = normalizeSaleCampaign(payload);
      setTweak({
        saleCampaign: next,
        saleCampaignWindow: next.enabled ? { startsAt: next.startsAt, endsAt: next.endsAt } : null,
      });
      toast(next.enabled ? "Sale campaign saved" : "Sale campaign saved (off)");
    } catch {
      toast(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-form__card promo-engine__card" aria-labelledby="sale-campaign-title">
      <div className="promo-engine__head">
        <h2 id="sale-campaign-title" className="admin-form__section">⚡ Sale Campaign</h2>
        <span className={`promo-engine__phase is-${phase}`}>{PHASE_LABEL[phase]}</span>
      </div>
      <p className="admin-field__hint">
        One start and end time for an 11.11-style sale. Sale prices, promo codes and free shipping
        marked <strong>Only during the sale</strong> switch on and off with it, and shoppers see a
        countdown across the top of your store.
      </p>

      <label className="admin-check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Campaign on</span>
      </label>

      <div className="admin-modal__row">
        <label className="admin-field__label" htmlFor="sc-name">Sale name</label>
        <input id="sc-name" className="admin-input" value={name} maxLength={CAMPAIGN_NAME_MAX}
          placeholder="11.11 Mega Sale" onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="promo-engine__grid">
        <div className="admin-modal__row" style={{ margin: 0 }}>
          <label className="admin-field__label" htmlFor="sc-start">Starts</label>
          <input id="sc-start" className="admin-input" type="datetime-local" value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className="admin-modal__row" style={{ margin: 0 }}>
          <label className="admin-field__label" htmlFor="sc-end">Ends</label>
          <input id="sc-end" className="admin-input" type="datetime-local" value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div className="promo-engine__checks">
        <label className="admin-check">
          <input type="checkbox" checked={showBar} onChange={(e) => setShowBar(e.target.checked)} />
          <span>Show the countdown bar on the store</span>
        </label>
        <label className="admin-check">
          <input type="checkbox" checked={teaser} disabled={!showBar}
            onChange={(e) => setTeaser(e.target.checked)} />
          <span>
            Tease it
            <input className="admin-input promo-engine__days" type="number" min={1} max={30}
              value={teaserDays} disabled={!showBar || !teaser} aria-label="Teaser days"
              onChange={(e) => setTeaserDays(e.target.value)} />
            days before it starts
          </span>
        </label>
      </div>

      <div className="promo-engine__actions">
        <button className="promo-btn-green" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save campaign"}
        </button>
      </div>
    </section>
  );
}

function FreeShippingCard({ brand }: { brand: Brand }) {
  const { toast, setTweak } = useStore();
  const currency = brand.currency || "₱";
  const initial = brand.freeShippingThreshold ?? EMPTY_FREE_SHIPPING;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [minSubtotal, setMinSubtotal] = useState<number | string>(initial.minSubtotal || "");
  const [usdMin, setUsdMin] = useState<number | string>(initial.usdMinSubtotal ?? "");
  const [campaignOnly, setCampaignOnly] = useState(initial.campaignOnly);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const payload = {
      enabled,
      minSubtotal: Number(minSubtotal) || 0,
      usdMinSubtotal: Number(usdMin) || 0,
      campaignOnly,
    };
    try {
      const res = await saveFreeShippingThresholdAction(payload);
      if ("error" in res) {
        toast(res.error);
        return;
      }
      const next = normalizeFreeShippingThreshold(payload);
      setTweak({ freeShippingThreshold: next });
      toast(next.enabled ? "Free shipping saved" : "Free shipping saved (off)");
    } catch {
      toast(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-form__card promo-engine__card" aria-labelledby="free-ship-title">
      <div className="promo-engine__head">
        <h2 id="free-ship-title" className="admin-form__section">🚚 Free shipping over a minimum</h2>
      </div>
      <p className="admin-field__hint">
        Orders whose items reach the minimum ship free. Shoppers below it see “Add {currency}X more
        for free shipping” in their cart.
      </p>
      <label className="admin-check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Free shipping on</span>
      </label>
      <div className="promo-engine__grid">
        <div className="admin-modal__row" style={{ margin: 0 }}>
          <label className="admin-field__label" htmlFor="fs-min">Minimum order ({currency})</label>
          <input id="fs-min" className="admin-input" type="number" min={0} value={minSubtotal}
            placeholder="e.g. 1500" onChange={(e) => setMinSubtotal(e.target.value)} />
        </div>
        {brand.dualMarket === true && (
          <div className="admin-modal__row" style={{ margin: 0 }}>
            <label className="admin-field__label" htmlFor="fs-usd">International minimum (USD)</label>
            <input id="fs-usd" className="admin-input" type="number" min={0} value={usdMin}
              placeholder="Blank = not for International" onChange={(e) => setUsdMin(e.target.value)} />
          </div>
        )}
      </div>
      {brand.saleCampaignEntitled === true && (
        <label className="admin-check">
          <input type="checkbox" checked={campaignOnly} onChange={(e) => setCampaignOnly(e.target.checked)} />
          <span>Only during the sale campaign</span>
        </label>
      )}
      <div className="promo-engine__actions">
        <button className="promo-btn-green" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save free shipping"}
        </button>
      </div>
    </section>
  );
}

/** The promo-engine cards this store is granted; nothing when none is. */
export function AdminPromoEngine({ brand }: { brand: Brand }) {
  const campaign = brand.saleCampaignEntitled === true;
  const freeShipping = brand.freeShippingThresholdEntitled === true;
  if (!campaign && !freeShipping) return null;
  return (
    <div className="promo-engine">
      {campaign && <SaleCampaignCard brand={brand} />}
      {freeShipping && <FreeShippingCard brand={brand} />}
    </div>
  );
}
