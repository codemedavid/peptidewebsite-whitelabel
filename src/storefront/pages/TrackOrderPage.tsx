"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { BackLink } from "../components/BackLink";

export function TrackOrderPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [result, setResult] = useState<{ number: string; status: string; eta: string } | null>(null);

  const lookup = () => {
    const n = orderNumber.trim();
    if (!n) return;
    // Demo lookup — a real implementation would query a backend.
    setResult({ number: n, status: "In transit", eta: "1–3 business days" });
  };

  return (
    <section className="page" id="track">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.trackBackLabel || "Back to Shop"} />
        <h1 className="page__title" style={{ textAlign: "center" }}>
          {brand.trackTitle || "Track Your Order"}
        </h1>
        <p className="page__sub" style={{ textAlign: "center", margin: "16px auto 0" }}>
          {brand.trackSub || "Enter your Order Number to check the current status of your package."}
        </p>

        <div className="track-form">
          <label className="input-wrap" aria-label="Order number">
            <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={orderNumber}
              placeholder={brand.trackPlaceholder || "Enter Order Number (e.g., TBS-1234)"}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") lookup();
              }}
            />
          </label>
          <button className="btn btn-primary" onClick={lookup}>
            {brand.trackCta || "Track Order"}
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {result && (
          <div className="track-result">
            <span className="track-result__dot" />
            <div>
              <div style={{ fontWeight: 600, color: "var(--brand-main)" }}>
                Order {result.number}
              </div>
              <div style={{ fontSize: 14, color: "var(--brand-text-muted)" }}>
                {result.status} · ETA {result.eta}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
