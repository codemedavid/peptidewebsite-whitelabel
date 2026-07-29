"use client";

// Shared payment-proof viewer + payment badge for the Group Buy surfaces (the
// report modal and each round's dashboard).
//
// Deliberately reuses the `od-proof-viewer` CSS and `hasPaymentProof` helper that
// AdminOrderDetail already established, rather than inventing a second proof
// viewer with its own inline styles — one look, one Escape behaviour, one place
// to fix. See AdminOrderDetail.tsx and storefront.css (.od-proof-viewer).

import { useEffect } from "react";

import { hasPaymentProof } from "./order-detail";
import type { PaymentDisplayStatus } from "@/lib/storefront/group-buy-orders";

/** A clickable proof thumbnail. Renders an em dash when no proof was uploaded,
 *  so the column stays aligned instead of collapsing. */
export function ProofThumb({
  url,
  orderNumber,
  onOpen,
  size = 44,
}: {
  url: string | null;
  orderNumber: string;
  onOpen: (url: string) => void;
  size?: number;
}) {
  if (!hasPaymentProof(url)) return <span style={{ opacity: 0.5 }}>—</span>;
  const src = url as string;
  return (
    <button
      type="button"
      className="od-proof od-proof--clickable"
      onClick={() => onOpen(src)}
      title="Click to view the payment proof full size"
      aria-label={`View payment proof for order ${orderNumber}`}
      style={{
        padding: 0,
        width: size,
        height: size,
        border: "1px solid rgba(0,0,0,.15)",
        borderRadius: 4,
        background: "none",
        cursor: "zoom-in",
        lineHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Payment proof for order ${orderNumber}`}
        width={size}
        height={size}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </button>
  );
}

/**
 * Full-screen proof viewer. The thumbnail crops the receipt, so this shows the
 * whole upload — the owner reads the reference number without downloading it.
 * Backdrop click, the close button, or Escape dismisses it.
 */
export function ProofLightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture-phase + stopPropagation so one Escape dismisses the proof, not
        // also the modal or dashboard sitting behind it.
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="od-proof-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Payment proof — ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        className="od-proof-viewer__close"
        aria-label="Close payment proof"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="od-proof-viewer__img"
        src={url}
        alt={`Payment proof for ${label}`}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Pending / Confirmed / Cancelled, colour-coded so a cancelled order can't be
 *  mistaken for a paid one at a glance. */
export function PaymentBadge({ status }: { status: PaymentDisplayStatus }) {
  const tone =
    status === "Confirmed"
      ? { bg: "rgba(22,140,80,.12)", fg: "#0f7a45" }
      : status === "Cancelled"
        ? { bg: "rgba(200,40,40,.12)", fg: "#b32626" }
        : { bg: "rgba(190,140,0,.14)", fg: "#8a6500" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {status}
    </span>
  );
}
