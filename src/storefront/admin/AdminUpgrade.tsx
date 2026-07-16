"use client";

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { formatPesos } from "@/lib/admin/plans";
import {
  getUpgradeContextAction,
  submitUpgradeRequestAction,
  type UpgradeContext,
} from "@/actions/upgrade";
import { uploadStorefrontImageAction } from "@/actions/media";

/**
 * Upgrade to Business — the in-admin upgrade/payment page every trial surface
 * links to (banner CTA, locked BUSINESS tiles, feature spotlight).
 *
 * Order summary is SERVER-computed (plan_config Business price − trial credit,
 * actions/upgrade.ts) — the client only renders it. Payment is the platform's
 * manual proof-of-payment flow (the operator's receiving accounts, same as the
 * get-started wizard): pick the method paid, upload the receipt, and the
 * submission files a PENDING request the operator approves in Super Admin →
 * Upgrades. The plan flips only on approval.
 */
type Props = {
  brand: Brand;
  onBack: () => void;
};

export function AdminUpgrade({ brand, onBack }: Props) {
  const { toast } = useStore();
  const [ctx, setCtx] = useState<UpgradeContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [method, setMethod] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUpgradeContextAction().then((res) => {
      if (cancelled) return;
      if ("error" in res) setLoadError(res.error);
      else {
        setCtx(res);
        setMethod(res.methods[0]?.method ?? "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProof = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const res = await uploadStorefrontImageAction(form);
    setUploading(false);
    if ("error" in res) return toast(res.error);
    setProofUrl(res.url);
  };

  const handleSubmit = async () => {
    if (!ctx) return;
    setSubmitting(true);
    const res = await submitUpgradeRequestAction({ payMethod: method, proofUrl });
    setSubmitting(false);
    if ("error" in res) return toast(res.error);
    setSubmitted(true);
    toast("Upgrade submitted — we're reviewing your payment.");
  };

  const inReview = submitted || ctx?.pendingRequest;

  return (
    <div className="admin">
      <main className="admin__inner admin-upgrade">
        <button className="admin-upgrade__back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="admin-upgrade__title">Upgrade to Business</h1>

        {loadError && <div className="admin-card admin-upgrade__note">{loadError}</div>}
        {!ctx && !loadError && (
          <div className="admin-card admin-upgrade__note">Loading your upgrade options…</div>
        )}

        {ctx && inReview && (
          <div className="admin-card">
            <p className="admin-upgrade__lede">
              <b>Your upgrade is in review.</b> We're confirming your payment — your Business plan
              (and your storefront, if it's paused) activates the moment it's approved.
            </p>
          </div>
        )}

        {ctx && !inReview && (
          <div className="admin-upgrade__grid">
            <div className="admin-card">
              <h2 className="admin-card__title">Order summary</h2>
              <div className="admin-upgrade__line">
                <span>Business Package · monthly</span>
                <b>{formatPesos(ctx.quote.businessCents)}</b>
              </div>
              {ctx.quote.creditCents > 0 && (
                <div className="admin-upgrade__line admin-upgrade__line--credit">
                  <span>Trial payment credit</span>
                  <b>− {formatPesos(ctx.quote.creditCents)}</b>
                </div>
              )}
              <div className="admin-upgrade__due">
                <span>Due today</span>
                <span className="admin-upgrade__due-amt">{formatPesos(ctx.quote.dueTodayCents)}</span>
              </div>
              <p className="admin-upgrade__note">
                Then {formatPesos(ctx.quote.businessCents)}/month. Your storefront reactivates as
                soon as we confirm your payment. All features unlock, including{" "}
                <b>Sales Analytics</b>, <b>Product Card Customization</b>, <b>Checkout Fee</b> and{" "}
                <b>Delivery Note</b> — and every new feature we release.
              </p>
            </div>

            <div className="admin-card">
              <h2 className="admin-card__title">Payment</h2>
              {ctx.methods.length === 0 && (
                <p className="admin-upgrade__note">
                  No payment methods are configured yet — contact support to complete your upgrade.
                </p>
              )}
              {ctx.methods.map((m) => (
                <label
                  key={m.id}
                  className={`admin-upgrade__method${method === m.method ? " is-active" : ""}`}
                >
                  <input
                    type="radio"
                    name="upgrade-method"
                    checked={method === m.method}
                    onChange={() => setMethod(m.method)}
                  />
                  <span className="admin-upgrade__method-body">
                    <b>{m.method}</b>
                    <span className="admin-upgrade__note">
                      {m.account} {m.number && `· ${m.number}`} {m.note && `— ${m.note}`}
                    </span>
                    {method === m.method && m.qrUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="admin-upgrade__qr" src={m.qrUrl} alt={`${m.method} QR`} />
                    )}
                  </span>
                </label>
              ))}

              <div className="admin-upgrade__proof">
                <label className="admin-upgrade__proof-label" htmlFor="upgrade-proof">
                  Proof of payment
                </label>
                <input
                  id="upgrade-proof"
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleProof(e.target.files?.[0])}
                />
                {uploading && <span className="admin-upgrade__note">Uploading…</span>}
                {proofUrl && !uploading && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="admin-upgrade__qr" src={proofUrl} alt="Proof of payment" />
                )}
              </div>

              <button
                className="admin-upgrade__pay"
                disabled={submitting || uploading || !proofUrl || ctx.methods.length === 0}
                onClick={handleSubmit}
              >
                {submitting ? "Submitting…" : `Submit payment · ${formatPesos(ctx.quote.dueTodayCents)}`}
              </button>
              <div className="admin-upgrade__secure">
                Reviewed by {brand.name ? "the platform team" : "our team"} · usually within a day
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
