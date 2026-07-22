"use client";

// Store-admin Billing view (OWNER-ONLY). The tenant sees their subscription
// due window and files a proof-of-payment for the current term: amount, method,
// reference, date paid, and a payment screenshot. The screenshot is uploaded to
// the tenant's own ImageKit folder (uploadStorefrontImageAction, kind
// "subscription-proof"), then the payment is recorded via
// submitSubscriptionPaymentAction as a PENDING row. The platform operator
// confirms or rejects it on the super-admin tenant-detail Billing tab.
//
// Read side (the due window) comes from brand.subscription, projected
// server-side in the storefront RSC — never computed against the browser clock.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { uploadStorefrontImageAction } from "@/actions/media";
import {
  getBillingPaymentInfoAction,
  listMySubscriptionPaymentsAction,
  submitSubscriptionPaymentAction,
  type BillingPaymentChannel,
} from "@/actions/subscription-payments";
import {
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_TONE,
  parsePaymentAmountCents,
  paymentMethodOptions,
  type TenantInvoiceRow,
} from "@/lib/subscription/payments";
import { BILLING_CYCLE_LABELS } from "@/lib/subscription/billing-cycle";

/** ISO → "Aug 10, 2026" for the due-window summary. */
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Centavos → "₱1,499" (drops trailing .00, keeps real centavos). */
function fmtPesos(cents: number): string {
  return `₱${(cents / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/** Badge colors per status tone (matches the toast/success palette in use here). */
const STATUS_BADGE_STYLE: Record<"success" | "warn" | "danger", { background: string; color: string }> = {
  success: { background: "var(--sf-success-soft, #f0fdf4)", color: "var(--sf-success, #15803d)" },
  warn: { background: "var(--sf-warn-soft, #fffbeb)", color: "var(--sf-warn, #b45309)" },
  danger: { background: "var(--sf-danger-soft, #fef2f2)", color: "var(--sf-danger, #b91c1c)" },
};

export function AdminBilling({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { toast } = useStore();
  const sub = brand.subscription;

  // The provider's receiving accounts (/admin/payments) — drive both the "how
  // to pay" card and the method dropdown. null = still loading (defaults shown).
  const [payInfo, setPayInfo] = useState<{ instructions: string; channels: BillingPaymentChannel[] } | null>(null);
  const methodOptions = paymentMethodOptions((payInfo?.channels ?? []).map((c) => c.method));

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(methodOptions[0]);
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Invoice history — the tenant's own filed payments. null = still loading.
  const [history, setHistory] = useState<TenantInvoiceRow[] | null>(null);
  const loadHistory = useCallback(async () => {
    try {
      const res = await listMySubscriptionPaymentsAction();
      setHistory("error" in res ? [] : res.payments);
    } catch {
      setHistory([]);
    }
  }, []);
  useEffect(() => {
    void loadHistory();
    void (async () => {
      try {
        const res = await getBillingPaymentInfoAction();
        if (!("error" in res)) {
          setPayInfo(res);
          // Snap the selection to the provider's first channel so the submitted
          // method always matches an offered option.
          const opts = paymentMethodOptions(res.channels.map((c) => c.method));
          setMethod((current) => (opts.includes(current) ? current : opts[0]));
        }
      } catch {
        /* defaults stay in place */
      }
    })();
  }, [loadHistory]);

  const amountValid = parsePaymentAmountCents(amount) != null;
  const canSave = amountValid && !saving && !uploading;

  // What the provider set up for this tenant (super-admin "Monthly price due",
  // falling back to the plan list price) — projected server-side into
  // brand.subscription. Absent → no figure is shown.
  const amountDueCents = sub?.onSubscription ? sub.amountDueCents : undefined;
  const cycleLabel = sub?.onSubscription && sub.cycle ? BILLING_CYCLE_LABELS[sub.cycle].toLowerCase() : null;

  const pickProof = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "subscription-proof");
      const res = await uploadStorefrontImageAction(fd);
      if ("error" in res) toast(res.error);
      else setProofUrl(res.url);
    } catch {
      toast("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await submitSubscriptionPaymentAction({
        amount,
        method,
        reference,
        paidAt: paidAt || undefined,
        proofUrl: proofUrl ?? undefined,
      });
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setDone(true);
      setAmount("");
      setReference("");
      setPaidAt("");
      setProofUrl(null);
      toast("Payment submitted for review");
      void loadHistory();
    } catch {
      toast("Couldn't submit — please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>💳</span>
          Billing
        </h1>
        <div className="admin-form__bar-spacer" />
        <button className="admin-form__save" onClick={submit} disabled={!canSave}>
          {saving ? "Submitting…" : "Submit payment"}
        </button>
      </header>

      <div className="admin-form__body">
        {/* Subscription due window */}
        <div className="admin-form__card" style={{ marginBottom: 16 }}>
          <h2 className="admin-form__section">📅 Your subscription</h2>
          {sub?.onSubscription ? (
            sub.expired ? (
              <div className="admin-field__hint" style={{ marginTop: -8, color: "var(--sf-danger, #b91c1c)" }}>
                Your subscription ended on <b>{fmtDate(sub.endsAt)}</b>. Submit your renewal payment below to
                restore full access.
              </div>
            ) : (
              <div className="admin-field__hint" style={{ marginTop: -8 }}>
                Next payment due <b>{fmtDate(sub.endsAt)}</b>
                {typeof sub.daysLeft === "number" ? ` — ${sub.daysLeft} day${sub.daysLeft === 1 ? "" : "s"} left` : ""}. Pay early
                and file your proof below so your provider can confirm it.
              </div>
            )
          ) : (
            <div className="admin-field__hint" style={{ marginTop: -8 }}>
              No active subscription window is set. You can still file a payment below — your provider will match it
              to your account.
            </div>
          )}
          {typeof amountDueCents === "number" && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--sf-surface-2, #f8fafc)",
                border: "1px solid var(--sf-border, #e2e8f0)",
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span className="admin-field__label" style={{ margin: 0 }}>Amount due</span>
              <b style={{ fontSize: 18 }}>{fmtPesos(amountDueCents)}</b>
              {cycleLabel && <span className="admin-field__hint" style={{ margin: 0 }}>· billed {cycleLabel}</span>}
            </div>
          )}
        </div>

        {/* How to pay — the provider's receiving accounts (/admin/payments) */}
        {payInfo && payInfo.channels.length > 0 && (
          <div className="admin-form__card" style={{ marginBottom: 16 }}>
            <h2 className="admin-form__section">💳 Payment methods</h2>
            <div className="admin-field__hint" style={{ marginTop: -8, marginBottom: 12 }}>
              {payInfo.instructions.trim() || "Pay your provider through any of these accounts, then file your proof below."}
            </div>
            {payInfo.channels.map((ch) => (
              <div
                key={ch.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 2px",
                  borderTop: "1px solid var(--sf-border, #e2e8f0)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ch.method}</div>
                  <div className="admin-field__hint" style={{ margin: 0 }}>
                    {[ch.account, ch.number].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {ch.note.trim() && (
                    <div className="admin-field__hint" style={{ margin: 0 }}>{ch.note}</div>
                  )}
                </div>
                {ch.qrUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ch.qrUrl}
                    alt={`${ch.method} QR code`}
                    style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, border: "1px solid var(--sf-border, #e2e8f0)" }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* File a payment */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">🧾 Submit a payment</h2>
          <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 18 }}>
            After you pay, record it here with a screenshot so your provider can confirm it. It stays “awaiting
            confirmation” until they review it.
          </div>

          {done && (
            <div
              className="admin-field__hint"
              style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 8, background: "var(--sf-success-soft, #f0fdf4)", color: "var(--sf-success, #15803d)", fontWeight: 600 }}
            >
              ✓ Payment submitted — awaiting your provider&apos;s confirmation. File another below if needed.
            </div>
          )}

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Amount paid (₱)</label>
            <input
              className="admin-input"
              inputMode="decimal"
              value={amount}
              placeholder={typeof amountDueCents === "number" ? String(amountDueCents / 100) : "e.g. 1499"}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="admin-field__hint">
              {amount.trim() && !amountValid ? "Enter a valid amount greater than zero." : "The total you sent for this term."}
            </div>
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Payment method</label>
            <select className="admin-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Reference number</label>
            <input
              className="admin-input"
              value={reference}
              placeholder="e.g. 9021 447 6613"
              maxLength={120}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="admin-field" style={{ marginBottom: 14 }}>
            <label className="admin-field__label">Date paid</label>
            <input className="admin-input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>

          <div className="admin-field" style={{ marginBottom: 8 }}>
            <label className="admin-field__label">Payment screenshot</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickProof(f);
              }}
            />
            {proofUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proofUrl} alt="Payment proof" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--sf-border, #e2e8f0)" }} />
                <button type="button" className="admin-form__back" onClick={() => setProofUrl(null)}>
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="admin-input"
                style={{ textAlign: "left", cursor: "pointer", opacity: uploading ? 0.6 : 1 }}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Choose an image…"}
              </button>
            )}
            <div className="admin-field__hint">A GCash/bank receipt screenshot helps your provider confirm faster. Optional but recommended.</div>
          </div>
        </div>

        {/* Invoice history — the tenant's own filed payments and their review status */}
        <div className="admin-form__card" style={{ marginTop: 16 }}>
          <h2 className="admin-form__section">📜 Invoice history</h2>
          {history === null ? (
            <div className="admin-field__hint" style={{ marginTop: -8 }}>Loading your payments…</div>
          ) : history.length === 0 ? (
            <div className="admin-field__hint" style={{ marginTop: -8 }}>
              No payments filed yet — payments you submit above will appear here with their confirmation status.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {history.map((inv) => (
                <li
                  key={inv.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 2px",
                    borderTop: "1px solid var(--sf-border, #e2e8f0)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{inv.code}</div>
                    <div className="admin-field__hint" style={{ margin: 0 }}>
                      {fmtDate(inv.dateIso)} · {inv.method}
                    </div>
                  </div>
                  <b style={{ fontSize: 14, whiteSpace: "nowrap" }}>{fmtPesos(inv.amountCents)}</b>
                  <span
                    style={{
                      ...STATUS_BADGE_STYLE[SUBSCRIPTION_PAYMENT_STATUS_TONE[inv.status]],
                      padding: "3px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {SUBSCRIPTION_PAYMENT_STATUS_LABELS[inv.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
